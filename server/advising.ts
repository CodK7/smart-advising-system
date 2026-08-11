/**
 * Academic decision support.
 *
 * Everything here is derived from the student's actual transcript and the
 * published study plan. Nothing is generated from a hash of the student ID,
 * which is how the previous dashboard produced its "history".
 */

import type { Client, InArgs } from '../database/sqlite.js';
import { LEVEL_ORDER, studyPlanSourceFor, type Level } from '../database/dataset.js';
import { effectivePlanForStudent, nextTermAfter } from './academic.js';

export { nextTermAfter } from './academic.js';

export const PROBATION_THRESHOLD = 2.0;

/** Credit load ceiling. Students on probation carry a reduced load. */
const NORMAL_MAX_CREDITS = 18;
const PROBATION_MAX_CREDITS = 12;

export interface CourseRef {
  code: string;
  title: string;
  credits: number;
  is_elective: number;
}

export interface Recommendation extends CourseRef {
  reason: 'retake' | 'plan' | 'elective';
  blockedBy: string[];
}

export interface AdvisingReport {
  studentId: string;
  gpa: number;
  level: string;
  major: string;
  completedCredits: number;
  planCompletedCredits: number;
  totalPlanCredits: number;
  progressPercent: number;
  inProgressCredits: number;
  onProbation: boolean;
  creditCap: number;
  nextTerm: string;
  planDataStatus: {
    available: boolean;
    unavailableLevels: Level[];
  };
  recommended: Recommendation[];
  blocked: Recommendation[];
  retakes: Recommendation[];
  alerts: { severity: 'danger' | 'warning' | 'info'; code: string }[];
}

// The local SQLite adapter returns a generic row type; the callers below know the shape of each
// query, so widen once here rather than casting through `unknown` everywhere.
const rows = async (db: Client, sql: string, args: InArgs = []): Promise<unknown[]> =>
  (await db.execute({ sql, args })).rows;

/**
 * Build the advising report for one student.
 *
 * A course is recommended when it belongs to the student's plan, they have not
 * already taken it, and every prerequisite is complete. Courses whose
 * prerequisites are outstanding are returned separately as `blocked` so the
 * student can see *why* rather than just not seeing the course.
 */
export async function buildAdvisingReport(db: Client, studentId: string): Promise<AdvisingReport | null> {
  const studentRows = await rows(
    db,
    `SELECT s.id, s.major, s.level, s.gpa FROM students s WHERE s.id = ?`,
    [studentId],
  );
  if (studentRows.length === 0) return null;

  const student = studentRows[0] as { id: string; major: string; level: string; gpa: number };
  const unavailableLevels = LEVEL_ORDER.filter((level) => !studyPlanSourceFor(student.major, level));

  const enrollments = (await rows(
    db,
    `SELECT e.course_code, e.status, e.grade_points, e.term, e.term_order, c.credits
     FROM enrollments e JOIN courses c ON c.code = e.course_code
     WHERE e.student_id = ?`,
    [studentId],
  )) as { course_code: string; status: string; grade_points: number | null; term: string; term_order: number; credits: number }[];

  const completed = new Set(enrollments.filter((e) => e.status === 'completed' && (e.grade_points ?? 0) > 0).map((e) => e.course_code));
  const attempted = new Set(enrollments.map((e) => e.course_code));

  const completedCredits = enrollments
    .filter((e) => e.status === 'completed' && (e.grade_points ?? 0) > 0)
    .reduce((s, e) => s + e.credits, 0);
  const inProgressCredits = enrollments.filter((e) => e.status === 'in_progress').reduce((s, e) => s + e.credits, 0);

  const currentTerm = enrollments
    .filter((enrollment) => enrollment.status === 'in_progress')
    .sort((a, b) => b.term_order - a.term_order)[0]?.term ?? 'Spring 2026';
  const nextTerm = nextTermAfter(currentTerm);

  /*
   * Which semester to advise for is a question about the student's position in
   * their study plan, not about the calendar. Deriving it from the term name
   * (Fall -> 1, Spring -> 2) breaks as soon as the two drift apart: a BTech
   * student enrolled in semester 1 whose next calendar term happened to map
   * back to semester 1 was offered nothing at all, because every remaining
   * course in the plan sits in semester 2.
   */
  const effectivePlan = await effectivePlanForStudent(db, studentId);
  const inProgressSemesters = effectivePlan
    .filter((course) => course.status === 'in_progress')
    .map((course) => ({ semester: Number(course.semester) }));

  // If the student is mid-level (semester 1) the next step is semester 2 of the
  // same level; after semester 2 they roll into semester 1 of the level above.
  const currentSemester = Math.max(1, ...inProgressSemesters.map((r) => r.semester));
  const nextSemester = currentSemester === 1 ? 2 : 1;
  const advancesLevel = currentSemester === 2;

  /*
   * Prerequisites are a boolean formula, not a flat list: rows sharing an
   * alt_group are alternatives (OR), and every distinct group must be
   * satisfied (AND). CSSE2205 needs "CSSE2101 AND (CSWD2101 OR CSPG1205)".
   */
  const prereqRows = (await rows(
    db,
    'SELECT course_code, prereq_code, alt_group FROM course_prerequisites',
  )) as { course_code: string; prereq_code: string; alt_group: number }[];

  const prereqs = new Map<string, Map<number, string[]>>();
  for (const p of prereqRows) {
    if (!prereqs.has(p.course_code)) prereqs.set(p.course_code, new Map());
    const groups = prereqs.get(p.course_code)!;
    groups.set(p.alt_group, [...(groups.get(p.alt_group) ?? []), p.prereq_code]);
  }

  /** Groups the student has not satisfied; empty means the course is open. */
  const unmetPrereqs = (code: string): string[] => {
    const groups = prereqs.get(code);
    if (!groups) return [];
    const unmet: string[] = [];
    for (const alternatives of groups.values()) {
      // One completed alternative satisfies the whole group.
      if (!alternatives.some((c) => completed.has(c))) {
        unmet.push(alternatives.join(' or '));
      }
    }
    return unmet;
  };

  // Candidate pool: the current level, plus the level above when the student is
  // about to finish this one, so they roll forward instead of running dry.
  const levelIdx = LEVEL_ORDER.indexOf(student.level as (typeof LEVEL_ORDER)[number]);
  const nextLevel = LEVEL_ORDER[Math.min(levelIdx + 1, LEVEL_ORDER.length - 1)];
  const candidateLevels = advancesLevel ? [student.level, nextLevel] : [student.level, student.level];

  const planRows = effectivePlan.filter((course) => candidateLevels.includes(course.level));

  const recommended: Recommendation[] = [];
  const blocked: Recommendation[] = [];

  for (const course of planRows) {
    if (attempted.has(course.code)) continue;
    if (course.semester !== nextSemester) continue;

    const missing = unmetPrereqs(course.code);
    const entry: Recommendation = {
      code: course.code,
      title: course.title,
      credits: course.credits,
      is_elective: course.is_elective,
      reason: course.is_elective ? 'elective' : 'plan',
      blockedBy: missing,
    };

    if (missing.length > 0) {
      blocked.push(entry);
    } else {
      recommended.push(entry);
    }
  }

  // Failed courses must be repeated before anything else.
  const retakes: Recommendation[] = [];
  for (const e of enrollments) {
    if (e.status === 'completed' && (e.grade_points ?? 0) === 0) {
      const info = (await rows(db, 'SELECT code, title, credits FROM courses WHERE code = ?', [e.course_code]))[0] as
        | CourseRef
        | undefined;
      if (info) {
        retakes.push({ ...info, is_elective: 0, reason: 'retake', blockedBy: [] });
      }
    }
  }

  const onProbation = student.gpa < PROBATION_THRESHOLD;
  const creditCap = onProbation ? PROBATION_MAX_CREDITS : NORMAL_MAX_CREDITS;

  // Retakes take priority, then plan courses, trimmed to the credit ceiling.
  const ordered = [...retakes, ...recommended];
  const withinCap: Recommendation[] = [];
  let credits = 0;
  for (const c of ordered) {
    if (credits + c.credits > creditCap) continue;
    withinCap.push(c);
    credits += c.credits;
  }

  const alerts: AdvisingReport['alerts'] = [];
  if (onProbation) alerts.push({ severity: 'danger', code: 'probation' });
  else if (student.gpa < 2.5) alerts.push({ severity: 'warning', code: 'at_risk' });
  if (retakes.length > 0) alerts.push({ severity: 'warning', code: 'retakes_required' });
  if (blocked.length > 0) alerts.push({ severity: 'info', code: 'blocked_prerequisites' });

  const totalPlanCredits = effectivePlan.reduce((sum, course) => sum + Number(course.credits), 0);
  const planCompletedCredits = effectivePlan
    .filter((course) => completed.has(course.code))
    .reduce((sum, course) => sum + Number(course.credits), 0);
  const progressPercent = totalPlanCredits
    ? Math.min(100, Math.max(0, Math.round((planCompletedCredits / totalPlanCredits) * 100)))
    : 0;

  return {
    studentId: student.id,
    gpa: student.gpa,
    level: student.level,
    major: student.major,
    completedCredits,
    planCompletedCredits,
    totalPlanCredits,
    progressPercent,
    inProgressCredits,
    onProbation,
    creditCap,
    nextTerm,
    planDataStatus: {
      available: unavailableLevels.length === 0,
      unavailableLevels,
    },
    recommended: withinCap,
    blocked,
    retakes,
    alerts,
  };
}

/** Term-by-term GPA history, computed from the transcript. */
export async function buildGpaHistory(db: Client, studentId: string) {
  const termRows = (await rows(
    db,
    `SELECT term, term_order,
            ROUND(SUM(grade_points * credits) / SUM(credits), 2) AS term_gpa,
            SUM(grade_points * credits) AS points,
            SUM(credits) AS credits
     FROM enrollments e JOIN courses c ON c.code = e.course_code
     WHERE e.student_id = ? AND e.status = 'completed'
     GROUP BY term, term_order
     ORDER BY term_order`,
    [studentId],
  )) as { term: string; term_order: number; term_gpa: number; points: number; credits: number }[];

  // Cumulative GPA is credit-weighted across all terms up to and including each.
  let runningPoints = 0;
  let runningCredits = 0;
  return termRows.map((t) => {
    runningPoints += t.points;
    runningCredits += t.credits;
    return {
      term: t.term,
      termGpa: Number(t.term_gpa.toFixed(2)),
      cumulativeGpa: Number((runningPoints / runningCredits).toFixed(2)),
      credits: t.credits,
    };
  });
}
