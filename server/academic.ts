import type { Client, InStatement, Row } from '../database/sqlite.js';
import { studyPlanSourceFor } from '../database/dataset.js';
import { ACADEMIC_LEVELS, type AcademicLevel, ValidationError } from './validation.js';

const GRADE_SCALE = [
  { grade: 'A', points: 4.0 },
  { grade: 'A-', points: 3.7 },
  { grade: 'B+', points: 3.3 },
  { grade: 'B', points: 3.0 },
  { grade: 'B-', points: 2.7 },
  { grade: 'C+', points: 2.3 },
  { grade: 'C', points: 2.0 },
  { grade: 'C-', points: 1.7 },
  { grade: 'D+', points: 1.3 },
  { grade: 'D', points: 1.0 },
  { grade: 'F', points: 0.0 },
] as const;

export interface EffectivePlanRow extends Row {
  level: AcademicLevel;
  semester: number;
  is_elective: number;
  code: string;
  title: string;
  credits: number;
  status: 'completed' | 'in_progress' | 'planned' | null;
  grade: string | null;
}

export async function effectivePlanForStudent(db: Client, studentId: string): Promise<EffectivePlanRow[]> {
  const student = await db.execute({ sql: 'SELECT major FROM students WHERE id = ?', args: [studentId] });
  if (student.rows.length === 0) return [];
  const major = String(student.rows[0].major);
  const sources = ACADEMIC_LEVELS.flatMap((level, order) => {
    const sourceMajor = studyPlanSourceFor(major, level);
    return sourceMajor ? [{ level, sourceMajor, order }] : [];
  });
  if (sources.length === 0) return [];

  const values = sources.map(() => '(?, ?, ?)').join(', ');
  const result = await db.execute({
    sql: `WITH plan_sources(level, source_major, level_order) AS (VALUES ${values})
          SELECT p.level, p.semester, p.is_elective, c.code, c.title, c.credits,
                 e.status, e.grade
          FROM plan_sources ps
          JOIN study_plan_items p ON p.major = ps.source_major AND p.level = ps.level
          JOIN courses c ON c.code = p.course_code
          LEFT JOIN enrollments e ON e.course_code = c.code AND e.student_id = ?
          ORDER BY ps.level_order, p.semester, c.code`,
    args: [...sources.flatMap((source) => [source.level, source.sourceMajor, source.order]), studentId],
  });

  return result.rows as EffectivePlanRow[];
}

/** Choose canonical letter grades whose credit-weighted mean is closest to the requested GPA. */
export function gradesForTarget(
  credits: number[],
  targetGpa: number,
  options: { minimumPoints?: number } = {},
): { grade: string; points: number }[] {
  if (credits.length === 0) return [];
  if (!Number.isFinite(targetGpa) || targetGpa < 0 || targetGpa > 4) {
    throw new ValidationError('GPA must be between 0.0 and 4.0.', 'INVALID_GPA');
  }
  if (credits.some((credit) => !Number.isInteger(credit) || credit <= 0)) {
    throw new ValidationError('Course credits must be positive integers.', 'INVALID_CREDITS');
  }
  const minimumPoints = options.minimumPoints ?? 0;
  const gradeScale = GRADE_SCALE.filter((grade) => grade.points >= minimumPoints);
  if (gradeScale.length === 0 || targetGpa < gradeScale.at(-1)!.points || targetGpa > gradeScale[0].points) {
    throw new ValidationError('The requested GPA cannot be represented by the allowed grade range.', 'UNREPRESENTABLE_GPA');
  }
  const totalCredits = credits.reduce((sum, value) => sum + value, 0);
  const targetTenths = Math.round(targetGpa * 10 * totalCredits);
  let states = new Map<number, number[]>([[0, []]]);

  for (const courseCredits of credits) {
    const next = new Map<number, number[]>();
    for (const [sum, grades] of states) {
      gradeScale.forEach((grade, gradeIndex) => {
        const nextSum = sum + Math.round(grade.points * 10 * courseCredits);
        if (!next.has(nextSum)) next.set(nextSum, [...grades, gradeIndex]);
      });
    }
    states = next;
  }

  const best = [...states.keys()].reduce((winner, candidate) =>
    Math.abs(candidate - targetTenths) < Math.abs(winner - targetTenths) ? candidate : winner,
  );
  return states.get(best)!.map((gradeIndex) => gradeScale[gradeIndex]);
}

/** Advance a validated academic term label by one semester. */
export function nextTermAfter(term: string): string {
  const match = /^(Fall|Spring) (\d{4})$/.exec(term);
  if (!match) return term;
  const [, season, yearText] = match;
  const year = Number(yearText);
  return season === 'Fall' ? `Spring ${year + 1}` : `Fall ${year}`;
}

export async function currentEnrollmentStatements(
  db: Client,
  studentId: string,
  major: string,
  level: AcademicLevel,
): Promise<InStatement[]> {
  const sourceMajor = studyPlanSourceFor(major, level);
  if (!sourceMajor) {
    throw new ValidationError('No study plan is available for the selected major and level.', 'MISSING_STUDY_PLAN');
  }

  const existingStudent = await db.execute({ sql: 'SELECT level FROM students WHERE id = ?', args: [studentId] });
  if (existingStudent.rows.length === 0) {
    throw new ValidationError('Student not found.', 'UNKNOWN_STUDENT');
  }
  const currentPlan = await effectivePlanForStudent(db, studentId);
  const activeSemesters = currentPlan
    .filter((course) => course.status === 'in_progress')
    .map((course) => Number(course.semester));
  const preferredSemester = String(existingStudent.rows[0].level) === level && activeSemesters.length > 0
    ? Math.max(...activeSemesters)
    : 1;

  const plan = await db.execute({
    sql: `SELECT p.course_code, p.semester
          FROM study_plan_items p
          WHERE p.major = ? AND p.level = ?
            AND NOT EXISTS (
              SELECT 1 FROM enrollments e
              WHERE e.student_id = ? AND e.course_code = p.course_code AND e.status = 'completed'
            )
          ORDER BY p.semester, p.course_code`,
    args: [sourceMajor, level, studentId],
  });
  if (plan.rows.length === 0) {
    const published = await db.execute({
      sql: 'SELECT 1 FROM study_plan_items WHERE major = ? AND level = ? LIMIT 1',
      args: [sourceMajor, level],
    });
    if (published.rows.length === 0) {
      throw new ValidationError('No study plan is available for the selected major and level.', 'MISSING_STUDY_PLAN');
    }
  }
  const availableSemesters = new Set(plan.rows.map((row) => Number(row.semester)));
  const semester = availableSemesters.has(preferredSemester)
    ? preferredSemester
    : (availableSemesters.has(1) ? 1 : 2);
  const selectedCourses = plan.rows.filter((row) => Number(row.semester) === semester);

  const currentTerm = await db.execute({
    sql: `SELECT term, term_order, status FROM enrollments WHERE student_id = ?
          ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END,
                   term_order DESC LIMIT 1`,
    args: [studentId],
  });
  const latest = currentTerm.rows[0];
  const reusesExistingTerm = latest?.status === 'in_progress' || latest?.status === 'planned';
  const term = latest
    ? (reusesExistingTerm ? String(latest.term) : nextTermAfter(String(latest.term)))
    : 'Spring 2026';
  const termOrder = latest ? Number(latest.term_order) + (reusesExistingTerm ? 0 : 1) : 0;

  return [
    { sql: "DELETE FROM enrollments WHERE student_id = ? AND status IN ('in_progress', 'planned')", args: [studentId] },
    ...selectedCourses.map((row) => ({
      sql: `INSERT INTO enrollments
            (student_id, course_code, term, term_order, status, grade, grade_points)
            VALUES (?, ?, ?, ?, 'in_progress', NULL, NULL)`,
      args: [studentId, String(row.course_code), term, termOrder],
    })),
  ];
}
