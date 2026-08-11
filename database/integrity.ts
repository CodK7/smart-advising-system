/** Pure integrity checks for the authoritative seed dataset. */

import {
  COURSE_TITLES,
  ELECTIVE_POOLS,
  LEVEL_ORDER,
  MAJORS,
  PREREQUISITES,
  STAFF,
  STUDENTS,
  STUDY_PLANS,
  studyPlanSourceFor,
  type Level,
} from './dataset.js';

const USER_ID = /^[A-Za-z0-9]{5,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{7,15}$/;
const PASSWORD_HASH = /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/i;
const OFFICIAL_ROLES = new Set(['System Admin', 'Registrar Admin', 'Student Affairs Admin', 'Advisor', 'Student']);
const COURSE_CODE = /^(?:[A-Z]{2,8}\d{4}|GENELEC\d+|MAJELEC\d+)$/;

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function effectivePlanCodes(major: string): string[] {
  return LEVEL_ORDER.flatMap((level) => {
    const source = studyPlanSourceFor(major, level);
    return source ? (STUDY_PLANS[source]?.[level] ?? []) : [];
  });
}

/** Return every deterministic seed-data error without touching the database. */
export function datasetIntegrityErrors(): string[] {
  const errors: string[] = [];
  const majorNames = MAJORS.map((major) => major.name);
  const majorSet = new Set(majorNames);
  const staffIds = new Set(STAFF.map((staff) => staff.id));
  const advisorIds = new Set(STAFF.filter((staff) => staff.role === 'Advisor').map((staff) => staff.id));
  const allPeople = [...STAFF, ...STUDENTS];

  for (const name of duplicates(majorNames)) errors.push(`duplicate major: ${name}`);
  for (const major of MAJORS) {
    if (!major.name.trim() || !major.name_ar.trim()) errors.push(`major has an empty localized name: ${major.name}`);
  }

  for (const id of duplicates(allPeople.map((person) => person.id))) errors.push(`duplicate user id: ${id}`);
  for (const email of duplicates(allPeople.map((person) => person.email.toLowerCase()))) {
    errors.push(`duplicate email (case-insensitive): ${email}`);
  }

  for (const person of allPeople) {
    if (!USER_ID.test(person.id)) errors.push(`invalid user id: ${person.id}`);
    if (!person.name.trim()) errors.push(`empty user name: ${person.id}`);
    if (!EMAIL.test(person.email)) errors.push(`invalid email: ${person.id}`);
    if (person.phone !== null && !PHONE.test(person.phone)) errors.push(`invalid phone: ${person.id}`);
    if (!PASSWORD_HASH.test(person.passwordHash)) errors.push(`invalid password hash: ${person.id}`);
    const role = 'role' in person ? person.role : 'Student';
    if (!OFFICIAL_ROLES.has(role)) errors.push(`invalid role: ${person.id} -> ${role}`);
  }
  for (const staff of STAFF) {
    if (!staff.department.trim()) errors.push(`empty staff department: ${staff.id}`);
  }

  for (const student of STUDENTS) {
    if (!majorSet.has(student.major) || student.major === 'Common') {
      errors.push(`unknown student major: ${student.id} -> ${student.major}`);
    }
    if (!LEVEL_ORDER.includes(student.level)) errors.push(`invalid student level: ${student.id} -> ${student.level}`);
    if (!Number.isFinite(student.gpa) || student.gpa < 0 || student.gpa > 4) {
      errors.push(`invalid student GPA: ${student.id} -> ${student.gpa}`);
    }
    if (!staffIds.has(student.advisorId) || !advisorIds.has(student.advisorId)) {
      errors.push(`student references a non-advisor: ${student.id} -> ${student.advisorId}`);
    }
    if (
      student.completedCredits !== undefined &&
      (!Number.isInteger(student.completedCredits) || student.completedCredits < 0 || student.completedCredits % 3 !== 0)
    ) {
      errors.push(`invalid completed-credit target: ${student.id} -> ${student.completedCredits}`);
    }

    const planCodes = effectivePlanCodes(student.major);
    if (planCodes.length === 0) errors.push(`student has no effective study plan: ${student.id}`);
    for (const code of duplicates(planCodes)) errors.push(`duplicate course in ${student.major} effective plan: ${code}`);
    if ((student.completedCredits ?? 0) > planCodes.length * 3) {
      errors.push(`completed-credit target exceeds the study plan: ${student.id}`);
    }
  }

  for (const major of majorNames.filter((name) => name !== 'Common')) {
    const planCodes = effectivePlanCodes(major);
    for (const code of duplicates(planCodes)) errors.push(`duplicate course in ${major} effective plan: ${code}`);
  }

  const referencedCourses = new Set<string>();
  for (const [major, plans] of Object.entries(STUDY_PLANS)) {
    if (!majorSet.has(major)) errors.push(`study plan references unknown major: ${major}`);
    for (const [level, codes] of Object.entries(plans)) {
      if (!LEVEL_ORDER.includes(level as Level)) errors.push(`study plan has unknown level: ${major} -> ${level}`);
      for (const code of codes ?? []) {
        referencedCourses.add(code);
        if (!COURSE_CODE.test(code)) errors.push(`invalid course code in study plan: ${code}`);
      }
      for (const code of duplicates(codes ?? [])) errors.push(`duplicate study-plan course: ${major}/${level}/${code}`);
    }
  }

  const prereqKeys: string[] = [];
  const prereqGraph = new Map<string, string[]>();
  for (const prerequisite of PREREQUISITES) {
    const { course, prereq, group = 0 } = prerequisite;
    referencedCourses.add(course);
    referencedCourses.add(prereq);
    prereqKeys.push(`${course}\u0000${prereq}`);
    if (course === prereq) errors.push(`course is its own prerequisite: ${course}`);
    if (!Number.isInteger(group) || group < 0) errors.push(`invalid prerequisite group: ${course}/${prereq}/${group}`);
    prereqGraph.set(course, [...(prereqGraph.get(course) ?? []), prereq]);
  }
  for (const key of duplicates(prereqKeys)) {
    const [course, prereq] = key.split('\u0000');
    errors.push(`duplicate prerequisite relation: ${course} -> ${prereq}`);
  }

  for (const [major, codes] of Object.entries(ELECTIVE_POOLS)) {
    if (!majorSet.has(major) || major === 'Common') errors.push(`elective pool references unknown major: ${major}`);
    for (const code of codes) {
      referencedCourses.add(code);
      if (!COURSE_CODE.test(code)) errors.push(`invalid elective course code: ${code}`);
    }
    for (const code of duplicates(codes)) errors.push(`duplicate elective-pool course: ${major}/${code}`);
  }

  for (const code of referencedCourses) {
    if (!COURSE_TITLES[code]?.trim()) errors.push(`referenced course has no title: ${code}`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (course: string): void => {
    if (visiting.has(course)) {
      errors.push(`prerequisite cycle contains: ${course}`);
      return;
    }
    if (visited.has(course)) return;
    visiting.add(course);
    for (const prerequisite of prereqGraph.get(course) ?? []) visit(prerequisite);
    visiting.delete(course);
    visited.add(course);
  };
  for (const course of prereqGraph.keys()) visit(course);

  return [...new Set(errors)].sort();
}

export function assertDatasetIntegrity(): void {
  const errors = datasetIntegrityErrors();
  if (errors.length > 0) {
    throw new Error(`Seed dataset failed integrity validation:\n- ${errors.join('\n- ')}`);
  }
}
