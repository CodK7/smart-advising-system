/** Shared application roles, synchronized with the official login PDF. */
export type Role =
  | 'System Admin'
  | 'Registrar Admin'
  | 'Student Affairs Admin'
  | 'Advisor'
  | 'Student';

export type AdminRole = Extract<Role, `${string} Admin`>;

export const ADMIN_ROLES: readonly AdminRole[] = [
  'System Admin',
  'Registrar Admin',
  'Student Affairs Admin',
];

export function isAdminRole(role: Role): role is AdminRole {
  return ADMIN_ROLES.includes(role as AdminRole);
}

export type Level =
  | 'Diploma First Year'
  | 'Diploma Second Year'
  | 'Advanced Diploma'
  | 'BTech';

/** The session user, as returned by /api/me. Carries no secrets. */
export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  department: string;
  role: Role;
}

/** A student's academic profile, from /api/student/:id/profile. */
export interface StudentProfile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string;
  major: string;
  level: Level;
  gpa: number;
  advisor_id: string | null;
  advisor_name: string | null;
  advisor_email: string | null;
  advisor_phone: string | null;
  advisor_department: string | null;
}

export interface Course {
  code: string;
  title: string;
  credits: number;
  is_elective?: number;
}

export interface Recommendation extends Course {
  reason: 'retake' | 'plan' | 'elective';
  blockedBy: string[];
}

export interface AdvisingReport {
  studentId: string;
  gpa: number;
  level: Level;
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

export interface TermGpa {
  term: string;
  termGpa: number;
  cumulativeGpa: number;
  credits: number;
}

export interface Enrollment {
  course_code: string;
  title: string;
  credits: number;
  term: string;
  term_order: number;
  status: 'completed' | 'in_progress' | 'planned';
  grade: string | null;
  grade_points: number | null;
}

export interface Transcript {
  history: TermGpa[];
  enrollments: Enrollment[];
}

export interface StudyPlanRow {
  level: Level;
  semester: number;
  is_elective: number;
  code: string;
  title: string;
  credits: number;
  status: 'completed' | 'in_progress' | 'planned' | null;
  grade: string | null;
}

export interface StudentSummary {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string;
  major: string;
  level: Level;
  gpa: number;
  advisor_id?: string | null;
  advisor_name: string | null;
}

/** A row in the admin's user-management table. */
export interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string;
  role: Exclude<Role, 'Student'>;
  advisee_count: number;
}

/** One counselling note, scoped to (student, advisor). */
export interface AdvisorNote {
  id: number;
  student_id: string;
  advisor_id: string;
  advisor_name: string;
  content: string;
  created_at: string;
  updated_at: string;
}

/** Everything the advisor's profile drawer needs, in one round trip. */
export interface StudentDetail {
  profile: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    department: string;
    major: string;
    level: Level;
    gpa: number;
    advisor_id: string | null;
    advisor_name: string | null;
    advisor_department: string | null;
  };
  studyPlan: StudyPlanRow[];
  advising: AdvisingReport | null;
}

export interface Contact {
  id: string;
  name: string;
  email: string;
  department: string;
  role: Role;
}

export interface Message {
  id: number;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  is_read: number;
}

/**
 * Headline counts. SCOPED to the caller: for an Advisor, `totalStudents` and
 * `atRiskStudents` describe their own caseload, not the institution — so the
 * metric cards are true for whoever is reading them.
 */
export interface AdminStats {
  totalStudents: number;
  totalAdvisors: number;
  totalAdmins: number;
  totalMajors: number;
  totalCourses: number;
  atRiskStudents: number;
  goodStandingStudents: number;
  averageGpa: number;
}
export interface CurriculumOverview {
  majors: { name: string; name_ar: string; student_count: number; course_count: number }[];
  prerequisites: {
    course_code: string;
    course_title: string;
    prereq_code: string;
    prereq_title: string;
    alt_group: number;
  }[];
}

export interface UniversitySettings {
  portal_notice: string;
  support_email: string;
  academic_year: string;
}
