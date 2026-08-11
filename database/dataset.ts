/**
 * Seed/reference data for the Smart Academic Advising System.
 *
 * For account identity, email, password credential, ID, and role, the official
 * Login Data PDF is the sole source of truth. STAFF and STUDENTS below are the
 * application's checked transcription of that roster; only one-way password
 * hashes are stored in source control. Academic curriculum/profile fields come
 * from the project's supplied academic source data. No official GPA source was
 * supplied, so the fixed student GPA values below are explicitly demo data.
 *
 * Where an academic source is incomplete or self-inconsistent, the gap is
 * marked with a NOTE comment rather than being silently invented. The seeder
 * prints every outstanding source conflict during `npm run db:reset`.
 */

export type Level =
  | 'Diploma First Year'
  | 'Diploma Second Year'
  | 'Advanced Diploma'
  | 'BTech';

export const LEVEL_ORDER: Level[] = [
  'Diploma First Year',
  'Diploma Second Year',
  'Advanced Diploma',
  'BTech',
];

export const MAJORS: { name: string; name_ar: string }[] = [
  { name: 'Common', name_ar: 'السنة التأسيسية / مشترك' },
  { name: 'Cyber and Information Security', name_ar: 'الأمن السيبراني وأمن المعلومات' },
  { name: 'Network Computing', name_ar: 'حوسبة الشبكات' },
  { name: 'Software Engineering', name_ar: 'هندسة البرمجيات' },
  { name: 'Data Science and Artificial Intelligence', name_ar: 'علم البيانات والذكاء الاصطناعي' },
  { name: 'Information Systems', name_ar: 'نظم المعلومات' },
];

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * The accounts below are the only official users in the login-data PDF.
 *
 * Passwords are stored only as salted scrypt hashes so the distributable
 * project never contains the PDF passwords in plaintext. The seeder inserts
 * these hashes unchanged, and the normal login verifier accepts the official
 * PDF password.
 */
export type OfficialRole =
  | 'System Admin'
  | 'Registrar Admin'
  | 'Student Affairs Admin'
  | 'Advisor'
  | 'Student';

export interface StaffRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Exclude<OfficialRole, 'Student'>;
  department: string;
  passwordHash: string;
}

export const STAFF: StaffRecord[] = [
  {
    id: '32e87366',
    name: 'Ahmad Faroq',
    email: '32e87366@utas.edu.om',
    phone: null,
    role: 'System Admin',
    department: 'System Administration',
    passwordHash: 'scrypt$7870bf290ee5f6c51af8c812fdd2c21a$b54e13bb0f32bfca680946ba3481a94f738107755901d848102b75e015cad8c375ea25a52f7fd43573c5e261cef83eb663fd517da2e1cfae05877773b1ade6fe',
  },
  {
    id: '32e87367',
    name: 'Khalid Al-Sarmi',
    email: '32e87367@utas.edu.om',
    phone: null,
    role: 'Registrar Admin',
    department: 'Admissions and Registration',
    passwordHash: 'scrypt$8971b9a48211ed3c35213941ade3e2d8$1449349b3c9b57c092cc5346328ee5adfede46808ed4ecb944750d1e2e46ad3b7280261edc2f84dbe4ce04bc9717dde40c4916da0db62d9692201892d08b0f9c',
  },
  {
    id: '32e87368',
    name: 'Sarah Al-Hinai',
    email: '32e87368@utas.edu.om',
    phone: null,
    role: 'Student Affairs Admin',
    department: 'Student Affairs',
    passwordHash: 'scrypt$989b353988fe2aec22e3836314e3d6d9$900447c0697f9f61deb99d0d5dff51e0d1f0314529c7acb288200b83b284255f73b28c2a2dba97344b4ebd638a4ce8f823512f919334b5d913b01f60a7fba8eb',
  },
  {
    id: '82e29746',
    name: 'Maha Alazri',
    email: '82e29746@utas.edu.om',
    phone: null,
    role: 'Advisor',
    department: 'Information Technology - Cyber and Information Security',
    passwordHash: 'scrypt$b60ddbf55b85e45bc06ddef8ad5884c2$b879a4ca6cfcbe59b8ff2609d631bd999a9c1c3a931001f47b8ecee22ae4f38a6be5dfb7096d20983049fc011adc9c1e33940796d666d31fc00f5a440d55ab67',
  },
  {
    id: '82e29747',
    name: 'Mohamed Al-Balushi',
    email: '82e29747@utas.edu.om',
    phone: null,
    role: 'Advisor',
    department: 'Information Technology - Computer Science',
    passwordHash: 'scrypt$9d61a1481ae2b5c9ed49cc4f9cda9c2b$bec87297e983493d50510176b38dda9030f8888c9f359c5c67a49415c6c81c2e6a3dcbf684700023b0993db986d90cec5dfe3ab4da4ed6e32f62c0b2a1203589',
  },
  {
    id: '82e29748',
    name: 'Fatma Al-Maamari',
    email: '82e29748@utas.edu.om',
    phone: null,
    role: 'Advisor',
    department: 'Information Technology - Software Engineering',
    passwordHash: 'scrypt$7bf30e9ea31609e1e879cf6822f89c69$0c3e14d8b7240a301ca83568f4c0523b2aa85da787f916e0674b35dc1a84c6d7553164875cd19cf81cfaf52d08b969dd7bdb29c6096d5f602e38420b27e30aeb',
  },
  {
    id: '82e29749',
    name: 'Salem Al-Kaabi',
    email: '82e29749@utas.edu.om',
    phone: null,
    role: 'Advisor',
    department: 'Information Technology - Computer Networks',
    passwordHash: 'scrypt$4375f28e83078a61653d07a8bf75eb2b$849bdebd549a2341b8b26115bbdc887c3619ec4cc1d2cca13454f3668c06b26c0b1e377d18cd8199bc3d55f93e7e70242eb1548a17916c836f57b60cc91f5e76',
  },
  {
    id: '82e29750',
    name: 'Nadia Al-Kharusi',
    email: '82e29750@utas.edu.om',
    phone: null,
    role: 'Advisor',
    department: 'Information Technology - Artificial Intelligence',
    passwordHash: 'scrypt$b4b6812cc6bd15686349b77903e165e1$14b92a531044a47cf929c31771dc8635c8859e481656e3f11d3ea89b637457a8d6f7b9e14c5e85db3b38bd07fdaff23fa3d2a25f87548f4dac0e3b560451d0b0',
  },
];

export interface StudentRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  major: string;
  level: Level;
  gpa: number;
  advisorId: string;
  passwordHash: string;
  /** Deterministic demo transcript target; no official GPA source was supplied. */
  completedCredits?: number;
}

// No official GPA source was supplied. These fixed demo values seed derived
// transcript grades for the existing official student accounts; they are never
// presented as official academic records and do not change between resets.
export const STUDENTS: StudentRecord[] = [
  {
    id: 'S26s3216',
    name: 'Azaa Hamed AlHinaii',
    email: '26s3216@utas.edu.om',
    phone: null,
    major: 'Cyber and Information Security',
    level: 'Advanced Diploma',
    gpa: 3.7,
    advisorId: '82e29746',
    passwordHash: 'scrypt$f17b1ed9f7ee13dcdb231f3aedf82d19$bd0dcad2a57d593532bff0f0100204ab7eb0f8874dd02a964b164dcf23e3a1f7905af985864c25aa137afe6fbb0fba4ffaa7362014a2e4ebab1905ee82bc7b60',
    completedCredits: 36,
  },
  {
    id: 'S26s3217',
    name: 'Al-Muhannad Al-Abri',
    email: '26s3217@utas.edu.om',
    phone: null,
    major: 'Software Engineering',
    level: 'BTech',
    gpa: 3.2,
    advisorId: '82e29748',
    passwordHash: 'scrypt$ae9a164a3b90cf915e7b1b6102c5692c$e8cce81f2d546da2ce0fa09b3029ca6fa24aa6fa8f416fcaf283ed4e42df7f5d1e5015e1fde8beb6a42ab6bac3b5465fb2ca51341b17d7bf68f28be09f6162a0',
    completedCredits: 42,
  },
  {
    id: 'S26s3218',
    name: 'Reem Al-Maawali',
    email: '26s3218@utas.edu.om',
    phone: null,
    major: 'Network Computing',
    level: 'Diploma Second Year',
    gpa: 2.8,
    advisorId: '82e29749',
    passwordHash: 'scrypt$bbf85a3a360de4f320c77d0612d17d8e$eb78120e7b2bfb7ed132f78989af9e9296e1dcc472857f9ad5661c950945b8765d0efb42f420f2deed4e3a57b8b481e8656228ef3eddb0ed16e4f2090ce5da50',
    completedCredits: 30,
  },
  {
    id: 'S26s3219',
    name: 'Hussain Al-Zadjali',
    email: '26s3219@utas.edu.om',
    phone: null,
    major: 'Data Science and Artificial Intelligence',
    level: 'BTech',
    gpa: 1.8,
    advisorId: '82e29750',
    passwordHash: 'scrypt$b493969e94545dbda43e342474ade836$992389e75a28473210d662ea9c4823c6b12ec1f8a1d7e32d5d495304061eae82404b38f86ae4797eb909025501cfa6942ff0af6c74bb49f720b26e94277e865a',
    completedCredits: 36,
  },
  {
    id: 'S26s3220',
    name: 'Maryam Al-Housni',
    email: '26s3220@utas.edu.om',
    phone: null,
    major: 'Cyber and Information Security',
    level: 'BTech',
    gpa: 3.5,
    advisorId: '82e29746',
    passwordHash: 'scrypt$80db1675259b5295865cf76ed114b10a$70a28327d02b88f97637be80bb12d6815aaf37093a6799afe47874cbb30d32993e3649cbc4a420de899f051b6ee6f32f2b89933423649fc13405b04eeedcea34',
    completedCredits: 48,
  },
  {
    id: 'S26s3221',
    name: 'Saud Al-Riyami',
    email: '26s3221@utas.edu.om',
    phone: null,
    major: 'Information Systems',
    level: 'Advanced Diploma',
    gpa: 2.6,
    advisorId: '82e29747',
    passwordHash: 'scrypt$c4fcd0ee75a965035407454f84f14628$7b13142c20c5768e4ed283f298fed8f9d001fc251b8151175223cbd0989b5fa403d523af8bbdb4949f5cc8d532c00a9ada8e2b4cac24c82a8d7de06f332cbacd',
    completedCredits: 42,
  },
  {
    id: 'S26s3222',
    name: 'Anwar Al-Balushi',
    email: '26s3222@utas.edu.om',
    phone: null,
    major: 'Software Engineering',
    level: 'Diploma Second Year',
    gpa: 1.9,
    advisorId: '82e29748',
    passwordHash: 'scrypt$e7619c2c5fae635c1808fce4e7a62ce2$7a06a2201b70040974c73c31fffeee8ebdacee58ac8f29b8b6c5d711a5aad71fdcd38c28b5d7dc6e6d1e5dda8d430a465ecd6d601f57cb781948c1d4500f0799',
    completedCredits: 30,
  },
  {
    id: 'S26s3223',
    name: 'Abdulaziz Al-Shehhi',
    email: '26s3223@utas.edu.om',
    phone: null,
    major: 'Network Computing',
    level: 'Advanced Diploma',
    gpa: 3.0,
    advisorId: '82e29749',
    passwordHash: 'scrypt$6f2ad220450111bf37194509dd1beb61$04ccfcce9a4f9d69e2a99a1a54c027c7cc819faae3a68c6953886e217e7858cfc3351f1721c27d7a1ed1a4000d1a04b9607812005b0ed7954c7cba133ae0f192',
    completedCredits: 36,
  },
];

// ---------------------------------------------------------------------------
// Course catalogue
// ---------------------------------------------------------------------------

/**
 * Official course titles. Codes that appear in a study plan but have no entry
 * here are seeded with the code as a placeholder title and reported during
 * `npm run db:reset` so they can be filled in from the official handbook.
 */
export const COURSE_TITLES: Record<string, string> = {
  // General First Year (common to all majors)
  UNEN1102: 'English I',
  CSCM1101: 'Fundamentals of Computing and Information Systems',
  CSDB1102: 'Introduction to Database',
  CSWD1103: 'Web Development I',
  CSCN1104: 'Computer Networking Fundamentals',
  MATH1202: 'Calculus I',
  UNEN1203: 'English II',
  CSPG1205: 'Introduction to Programming',
  CSOP1207: 'Principles of Operating Systems',
  CSSY1208: 'Introduction to Information Security',

  // Level 2
  CSNW2101: 'Internet of Things (IoT)',
  CSNW2102: 'Introduction to Routing and Switching',
  CSWD2101: 'Web Development II',
  CSSE2101: 'Introduction to Software Engineering',
  CSSY2101: 'Advanced Information Security',
  MATH2101: 'Mathematics for Computing',
  CSDS2101: 'Database Systems',
  CSIS2101: 'Systems Analysis & Design',
  BSFB2101: 'Fundamentals of Business',
  BSHR2102: 'Organizational Behavior',
  UNEP2109: 'Entrepreneurship',
  CSSE2202: 'Object Oriented Programming',
  CSSY2201: 'Introduction to Cryptography',
  CSSE2203: 'Data Structures and Algorithms',
  CSSE2204: 'Special Topics',
  CSSE2205: 'Diploma Course Project',
  CSIS2202: 'Diploma Course Project',

  // Level 3
  CSNW3101: 'Advanced Routing and Switching',
  CSNW3102: 'Network Programming',
  STAT3101: 'Probability and Statistics',
  CSSE3101: 'Advanced Web Technologies',
  CSSE3102: 'Object Oriented Analysis and Design',
  CSDS3101: 'Fundamentals of Big Data',
  CSIS3101: 'Business Process Management',
  CSIS3102: 'IS Management and Strategy',
  CSIS3103: 'User Experience Design',
  CSSY3105: 'Authentication and Access Control',
  CSSY3106: 'Network Security and Management',
  CSIS3105: 'IS Special Topics',
  CSDS3105: 'Database Programming',
  UNEN3104: 'English III (Public Speaking)',
  CSSE3104: 'Computer Graphics and Games Development',
  CSNW3203: 'System Administration',
  CSNW3204: 'Cloud Computing Fundamentals',
  CSPM3201: 'Project Management and Acquisition',
  CSRM3202: 'Research Methodology',
  // The handbook lists CSSY3201 twice with different titles: "Advanced Topics
  // in Information Security" in the Cyber core plan, and "Authentication and
  // Access Control" in two elective pools. The core-plan title is used, since
  // Authentication and Access Control has its own code (CSSY3105).
  CSSY3201: 'Advanced Topics in Information Security',
  CSSY3202: 'Web Application Security',
  CSSY3203: 'Ethical Hacking',
  CSDS3202: 'Introduction to Data Science',
  CSDS3203: 'Introduction to Artificial Intelligence',
  CSDS3204: 'Data Warehouse Design',
  CSDS3205: 'Data Visualization',
  CSSE3203: 'Mobile Application Development',
  CSSE3205: 'Fundamentals of Robotics',
  CSIS3204: 'Fundamentals of Digital Marketing',
  BSHR3206: 'Teamwork Management',
  BSHR3207: 'Employee Relation',
  BSHR3215: 'Total Quality Management',
  MATH3202: 'Discrete Structures',
  MATH3203: 'Mathematics for Machine Learning',

  // Level 4
  CSNW4101: 'Advanced Cloud Computing',
  CSNW4102: 'Wireless Communication',
  CSNW4103: 'B-Tech Course Project I',
  CSSY4101: 'B-Tech Course Project I',
  CSSY4102: 'Advanced Cryptography',
  CSSY4103: 'Security Operations Centre (SOC)',
  CSSY4104: 'Digital Forensics',
  CSSE4101: 'Software Design and Testing',
  CSSE4102: 'B-Tech Course Project I',
  CSSE4103: 'Full-Stack Web Development',
  CSDS4101: 'Big Data Analytics',
  CSDS4102: 'Natural Language Processing',
  CSDS4103: 'Business Intelligence',
  CSDS4104: 'Applied Machine Learning',
  CSDS4105: 'B-Tech Course Project I',
  CSIS4101: 'Enterprise Systems',
  CSIS4102: 'B-Tech Course Project I',
  UNAB4105: 'Arabic Language Skills',
  BSSM4104: 'Strategic Management',
  CSNW4204: 'B-Tech Course Project II',
  CSNW4205: 'Virtual Systems and Services',
  CSSY4201: 'B-Tech Course Project II',
  CSSY4202: 'IT Control and Audit',
  CSSY4203: 'Malware Analysis and Reverse Engineering',
  CSSE4104: 'B-Tech Course Project II',
  CSSE4205: 'Computer Architecture and Organization',
  CSDS4206: 'Computer Vision',
  CSDS4207: 'Data Mining',
  CSDS4208: 'Deep Learning',
  CSDS4209: 'B-Tech Course Project II',
  CSIS4203: 'IS Auditing and Control',
  CSIS4204: 'B-Tech Course Project II',
  CSIS4205: 'IT for Management Decision Making',
  CSIS4206: 'Knowledge Management System',
  CSSE4106: 'DevOps and Continuous Delivery',
  CSSE4107: 'Theory of Computation',
  CSSE4208: 'Innovation and Emerging Technologies',
  CSSE4209: 'Advanced Mobile Application Development',
  CSDS4111: 'Introduction to Blockchain',
  CSDS4210: 'Pattern Recognition',
  CSDS4212: 'Information Retrieval',
  BSBL4211: 'Business Law',

  // Elective placeholders. These are slots in the plan, not real courses; the
  // student picks an actual course from the elective pool for each slot.
  GENELEC1: 'General Elective',
  MAJELEC1: 'Major Elective I',
  MAJELEC2: 'Major Elective II',
  MAJELEC3: 'Major Elective III',
  MAJELEC4: 'Major Elective IV',
  MAJELEC5: 'Major Elective V',
  MAJELEC6: 'Major Elective VI',
};

export const ELECTIVE_CODES = new Set([
  'GENELEC1', 'MAJELEC1', 'MAJELEC2', 'MAJELEC3', 'MAJELEC4', 'MAJELEC5', 'MAJELEC6',
]);

/**
 * Study plans, transcribed from section 5 of the source document.
 * Each entry lists the course codes for that major at that level.
 *
 * Semester is derived from the course code (see `semesterOf`), except for
 * elective placeholders which are positioned explicitly by the seeder.
 */
export const STUDY_PLANS: Record<string, Partial<Record<Level, string[]>>> = {
  Common: {
    'Diploma First Year': [
      'UNEN1102', 'CSCM1101', 'CSDB1102', 'CSWD1103', 'CSCN1104',
      'MATH1202', 'UNEN1203', 'CSPG1205', 'CSOP1207', 'CSSY1208',
    ],
  },

  'Network Computing': {
    'Diploma Second Year': [
      'CSNW2102', 'CSWD2101', 'CSNW2101', 'CSSE2101', 'CSSY2101',
      'GENELEC1', 'UNEP2109', 'CSSY2201', 'MATH2101',
    ],
    'Advanced Diploma': [
      'CSNW3101', 'STAT3101', 'UNEN3104', 'CSNW3102', 'CSSE2203', 'MAJELEC1',
      'CSNW3203', 'CSPM3201', 'CSRM3202', 'CSSY3106', 'CSNW3204', 'MAJELEC2',
    ],
    BTech: [
      'CSNW4101', 'CSSY3201', 'CSNW4103', 'CSNW4102', 'MAJELEC3', 'MAJELEC4',
      'MAJELEC5', 'CSNW4204', 'CSSE4205', 'UNAB4105', 'MATH3202', 'CSNW4205',
    ],
  },

  // NOTE: the source document does not list a Diploma Second Year plan for
  // Cyber and Information Security. This level is intentionally unavailable
  // until an official plan is supplied.
  'Cyber and Information Security': {
    'Advanced Diploma': [
      'CSNW3204', 'CSSY3106', 'STAT3101', 'UNEN3104', 'CSPM3201', 'MAJELEC1',
      'MAJELEC2', 'CSRM3202', 'CSSY3201', 'CSSY3105', 'CSSY3202', 'CSSY3203',
    ],
    BTech: [
      'CSSY4101', 'CSSY4102', 'CSSY4103', 'CSSY4104', 'MAJELEC3', 'MAJELEC4',
      'MAJELEC5', 'MAJELEC6', 'CSSY4201', 'CSSY4202', 'UNAB4105', 'CSSY4203',
    ],
  },

  'Software Engineering': {
    'Diploma Second Year': [
      'GENELEC1', 'CSWD2101', 'CSDS2101', 'CSSE2101', 'MATH2101',
      'CSSE2202', 'UNEP2109', 'CSSE2203', 'CSSE2204', 'CSSE2205',
    ],
    'Advanced Diploma': [
      'CSSE3101', 'STAT3101', 'UNEN3104', 'CSSE3102', 'CSDS3203', 'MAJELEC1',
      'MAJELEC2', 'CSDS3202', 'CSPM3201', 'CSRM3202', 'CSSE3203', 'CSIS3103',
    ],
    BTech: [
      'CSSE4101', 'CSDS4104', 'CSSE4102', 'CSSE4103', 'MAJELEC3', 'MAJELEC4',
      'MAJELEC5', 'MAJELEC6', 'CSSE4104', 'CSSE4205', 'UNAB4105', 'MATH3202',
    ],
  },

  // NOTE: no Diploma Second Year plan is given for Data Science and AI either.
  // This level is intentionally unavailable until an official plan is supplied.
  'Data Science and Artificial Intelligence': {
    'Advanced Diploma': [
      'CSDS3101', 'STAT3101', 'UNEN3104', 'MATH3202', 'CSPM3201', 'MAJELEC1',
      'MAJELEC2', 'CSDS3202', 'CSDS3203', 'CSDS3204', 'CSRM3202', 'MATH3203',
    ],
    BTech: [
      'CSDS4101', 'CSDS4102', 'CSDS4103', 'CSDS4104', 'CSDS4105', 'MAJELEC3',
      'MAJELEC4', 'CSDS4209', 'CSDS4206', 'UNAB4105', 'CSDS4207', 'CSDS4208',
    ],
  },

  'Information Systems': {
    'Diploma Second Year': [
      'BSFB2101', 'CSIS2101', 'CSWD2101', 'CSDS2101', 'GENELEC1',
      'UNEP2109', 'CSSE2202', 'CSSE2204', 'BSHR2102', 'CSIS2202',
    ],
    'Advanced Diploma': [
      'UNEN3104', 'STAT3101', 'CSIS3101', 'CSIS3102', 'CSIS3103', 'MAJELEC1',
      'MAJELEC2', 'CSPM3201', 'CSDS3101', 'CSIS3204', 'CSSE3101', 'CSRM3202',
    ],
    BTech: [
      'CSIS4101', 'BSBL4211', 'CSIS4102', 'CSDS4103', 'MAJELEC3', 'MAJELEC4',
      'MAJELEC5', 'MAJELEC6', 'UNAB4105', 'BSSM4104', 'CSIS4203', 'CSIS4204',
    ],
  },
};

/** Resolve the authoritative plan owner for one major/level combination. */
export function studyPlanSourceFor(major: string, level: Level): string | undefined {
  if (level === 'Diploma First Year') return 'Common';
  if (STUDY_PLANS[major]?.[level]) return major;
  return undefined;
}

/**
 * Course type and requirement category, from the handbook's "Course Type" and
 * "University / College / Specialization Requirement" columns.
 * Anything not listed defaults to Core / Specialization.
 */
export const COURSE_META: Record<string, { type?: 'Core' | 'Elective'; req?: 'University' | 'College' | 'Specialization' }> = {
  UNEN1102: { req: 'University' }, UNEN1203: { req: 'University' }, UNEN3104: { req: 'University' },
  UNEP2109: { req: 'University' }, UNAB4105: { req: 'University' },
  CSCM1101: { req: 'College' }, CSDB1102: { req: 'College' }, CSWD1103: { req: 'College' },
  MATH1202: { req: 'College' }, CSPG1205: { req: 'College' }, CSCN1104: { req: 'College' },
  CSOP1207: { req: 'College' }, CSSY1208: { req: 'College' }, CSWD2101: { req: 'College' },
  STAT3101: { req: 'College' }, CSPM3201: { req: 'College' }, CSRM3202: { req: 'College' },
};

/**
 * Prerequisites, transcribed from the handbook.
 *
 * `group` encodes the boolean structure: entries sharing a group are
 * alternatives (OR); every distinct group must be satisfied (AND). Omitting
 * group means group 0.
 *
 * Where the handbook is self-contradictory or references a code that does not
 * exist, the relationship is left out and reported by `npm run db:reset`
 * rather than guessed — a wrong prerequisite silently blocks a student from a
 * course they are entitled to take.
 */
export const PREREQUISITES: { course: string; prereq: string; group?: number }[] = [
  // --- General First Year ---
  { course: 'UNEN1203', prereq: 'UNEN1102' },
  { course: 'CSPG1205', prereq: 'CSCM1101' },
  { course: 'CSOP1207', prereq: 'CSCM1101' },

  // --- Level 2 ---
  { course: 'CSNW2102', prereq: 'CSCN1104' },
  { course: 'CSWD2101', prereq: 'CSWD1103' },
  { course: 'CSNW2101', prereq: 'CSCN1104', group: 0 },
  { course: 'CSNW2101', prereq: 'CSPG1205', group: 1 },
  { course: 'CSSE2101', prereq: 'CSCM1101' },
  { course: 'CSSY2101', prereq: 'CSSY1208' },
  { course: 'CSSY2201', prereq: 'CSSY1208' },
  { course: 'MATH2101', prereq: 'MATH1202' },
  { course: 'CSDS2101', prereq: 'CSDB1102' },
  { course: 'CSSE2202', prereq: 'CSPG1205' },
  { course: 'CSSE2203', prereq: 'CSPG1205' },
  { course: 'UNEP2109', prereq: 'UNEN1203' },
  { course: 'BSHR2102', prereq: 'BSFB2101' },
  { course: 'CSIS2101', prereq: 'CSDB1102', group: 0 },
  { course: 'CSIS2101', prereq: 'CSCM1101', group: 1 },
  { course: 'CSIS2202', prereq: 'CSIS2101', group: 0 },
  { course: 'CSIS2202', prereq: 'CSWD2101', group: 1 },
  // CSSE2101 AND (CSWD2101 OR CSPG1205)
  { course: 'CSSE2205', prereq: 'CSSE2101', group: 0 },
  { course: 'CSSE2205', prereq: 'CSWD2101', group: 1 },
  { course: 'CSSE2205', prereq: 'CSPG1205', group: 1 },

  // --- Level 3 ---
  { course: 'UNEN3104', prereq: 'UNEN1203' },
  { course: 'STAT3101', prereq: 'MATH1202' },
  { course: 'CSNW3101', prereq: 'CSNW2102' },
  { course: 'CSNW3102', prereq: 'CSPG1205' },
  { course: 'CSNW3203', prereq: 'CSOP1207' },
  { course: 'CSSY3106', prereq: 'CSCN1104' },
  { course: 'CSSY3105', prereq: 'CSSY1208' },
  { course: 'CSSY3201', prereq: 'CSSY2101' },
  { course: 'CSSY3202', prereq: 'CSWD2101' },
  { course: 'CSSY3203', prereq: 'CSSY2101' },
  { course: 'CSRM3202', prereq: 'STAT3101' },
  { course: 'CSSE3101', prereq: 'CSWD1103' },
  { course: 'CSSE3104', prereq: 'CSPG1205' },
  { course: 'CSSE3203', prereq: 'CSSE2202' },
  { course: 'CSSE3205', prereq: 'CSPG1205' },
  { course: 'CSDS3101', prereq: 'CSDS2101' },
  { course: 'CSDS3105', prereq: 'CSDS2101' },
  { course: 'CSDS3203', prereq: 'CSSE2203' },
  { course: 'CSDS3204', prereq: 'CSDS2101' },
  { course: 'CSIS3102', prereq: 'CSCM1101' },
  { course: 'MATH3202', prereq: 'MATH2101' },
  { course: 'MATH3203', prereq: 'MATH2101' },
  // CSPG1205 AND STAT3101
  { course: 'CSDS3202', prereq: 'CSPG1205', group: 0 },
  { course: 'CSDS3202', prereq: 'STAT3101', group: 1 },
  // CSSE2101 OR CSIS2101
  { course: 'CSPM3201', prereq: 'CSSE2101', group: 0 },
  { course: 'CSPM3201', prereq: 'CSIS2101', group: 0 },
  { course: 'CSIS3101', prereq: 'CSSE2101', group: 0 },
  { course: 'CSIS3101', prereq: 'CSIS2101', group: 0 },
  // CSSE2202 AND (CSSE2101 OR CSIS2101)
  { course: 'CSSE3102', prereq: 'CSSE2202', group: 0 },
  { course: 'CSSE3102', prereq: 'CSSE2101', group: 1 },
  { course: 'CSSE3102', prereq: 'CSIS2101', group: 1 },

  // --- Level 4 ---
  { course: 'CSNW4101', prereq: 'CSNW3204' },
  { course: 'CSNW4102', prereq: 'CSNW3101' },
  { course: 'CSNW4204', prereq: 'CSNW4103' },
  { course: 'CSNW4205', prereq: 'CSNW3204' },
  { course: 'CSSE4101', prereq: 'CSSE3102' },
  { course: 'CSSE4103', prereq: 'CSSE3101' },
  { course: 'CSSE4104', prereq: 'CSSE4102' },
  { course: 'CSSE4106', prereq: 'CSPM3201' },
  { course: 'CSSE4107', prereq: 'MATH3202' },
  { course: 'CSSE4205', prereq: 'CSCM1101' },
  { course: 'CSSE4209', prereq: 'CSSE3203' },
  { course: 'CSSY4101', prereq: 'CSPM3201' },
  { course: 'CSSY4102', prereq: 'CSSY2201' },
  { course: 'CSSY4103', prereq: 'CSSY3106' },
  { course: 'CSSY4104', prereq: 'CSSY2101' },
  { course: 'CSSY4201', prereq: 'CSSY4101' },
  { course: 'CSSY4202', prereq: 'CSSY2101' },
  { course: 'CSSY4203', prereq: 'CSSY3203' },
  { course: 'CSDS4101', prereq: 'CSDS3101' },
  { course: 'CSDS4102', prereq: 'CSDS3203' },
  { course: 'CSDS4103', prereq: 'CSDS3101' },
  { course: 'CSDS4206', prereq: 'CSDS4104' },
  { course: 'CSDS4207', prereq: 'CSDS3202' },
  { course: 'CSDS4208', prereq: 'CSDS4104' },
  { course: 'CSDS4209', prereq: 'CSDS4105' },
  { course: 'CSDS4210', prereq: 'CSDS4104' },
  { course: 'CSDS4212', prereq: 'CSDS3202' },
  { course: 'CSIS4101', prereq: 'CSIS3102' },
  { course: 'CSIS4102', prereq: 'CSRM3202' },
  { course: 'CSIS4204', prereq: 'CSIS4102' },
  { course: 'CSIS4205', prereq: 'CSIS3102' },
  { course: 'CSIS4206', prereq: 'CSIS3102' },
  // CSDS3203 AND CSDS3202
  { course: 'CSDS4104', prereq: 'CSDS3203', group: 0 },
  { course: 'CSDS4104', prereq: 'CSDS3202', group: 1 },
  // CSNW3101 AND CSRM3202
  { course: 'CSNW4103', prereq: 'CSNW3101', group: 0 },
  { course: 'CSNW4103', prereq: 'CSRM3202', group: 1 },
  // CSSE3102 AND CSRM3202 AND CSIS3103
  { course: 'CSSE4102', prereq: 'CSSE3102', group: 0 },
  { course: 'CSSE4102', prereq: 'CSRM3202', group: 1 },
  { course: 'CSSE4102', prereq: 'CSIS3103', group: 2 },
];

/**
 * Contradictions and dangling references in the handbook, surfaced by
 * `npm run db:reset` instead of being silently resolved.
 */
export const SOURCE_CONFLICTS: string[] = [
  'CSDS4105 lists prerequisite CSIS3609, which does not exist. Left unset.',
  'MATH1202 lists prerequisite FPMP0003, a foundation-programme course outside this catalogue.',
  'CSCM1101 lists prerequisite "Computer Skills", which is not a course code.',
  'CSSY3201 appears as both "Advanced Topics in Information Security" (Cyber core plan) and ' +
    '"Authentication and Access Control" (elective pools). The core-plan title is used.',
  'CSSE4101 appears as "Software Design and Testing" (SE core plan) and as ' +
    '"Computer Graphics and Games Development" (Cyber elective pool, which elsewhere uses ' +
    'CSSE3104 for that title). The SE core-plan title is used.',
  'CSNW3202 and CSNW3204 are both titled "Cloud Computing Fundamentals"; ' +
    'CSIS3507 and CSIS3204 are both "Fundamentals of Digital Marketing"; ' +
    'CSSY3205 and CSSY3105 are both "Authentication and Access Control".',
];

/**
 * Elective pools, per specialization. A student fills each "Major Elective"
 * slot in their plan with a course from their major's pool.
 */
export const ELECTIVE_POOLS: Record<string, string[]> = {
  'Network Computing': [
    'BSFB2101', 'CSDS3202', 'CSDS3203', 'CSIS3101', 'CSIS3102', 'CSIS3204',
    'CSSE3101', 'CSSE3104', 'CSSE3205', 'CSSE4103', 'CSSE4106', 'CSSE4107',
    'CSSE4208', 'CSDS2101', 'CSDS3101', 'CSDS3205', 'CSDS4111', 'CSIS3103',
    'CSSY3202', 'CSSY4102', 'CSSY4103', 'CSSY4202', 'CSSY4104', 'CSSY3203',
    'CSSY4203',
  ],
  'Cyber and Information Security': [
    'CSNW3102', 'CSNW3101', 'CSDS3203', 'CSSE2203', 'CSDS4111', 'CSDS3205',
    'CSSE3104', 'CSSE3205', 'CSIS3204', 'CSNW3203', 'MATH3202', 'BSSM4104',
  ],
  'Software Engineering': [
    'CSSE3104', 'CSSE3205', 'CSSE4106', 'CSSE4107', 'CSSE4208', 'CSSE4209',
    'CSNW3203', 'CSNW3204', 'CSIS3101', 'CSIS3102', 'CSIS3204', 'BSFB2101',
    'CSSY3202', 'CSSY3105', 'CSDS4111', 'CSDS4208', 'CSDS3205', 'CSDS3105',
    'CSDS3101', 'CSDS4102',
  ],
  'Data Science and Artificial Intelligence': [
    'CSSE3104', 'CSSE3205', 'CSSE4106', 'CSSE4107', 'CSSE4208', 'CSNW3203',
    'CSNW3204', 'CSIS3101', 'CSIS3103', 'CSIS3102', 'CSSE3101', 'CSSY3202',
    'CSSY3105', 'CSDS4111', 'CSDS3205', 'CSDS3105', 'CSDS4212', 'CSDS4210',
  ],
  'Information Systems': [
    'CSIS3105', 'CSIS4206', 'CSIS4205', 'BSHR3206', 'BSHR3207', 'BSHR3215',
    'CSDS3202', 'CSDS3205', 'CSDS3204', 'CSDS4111', 'CSDS3105', 'CSSE3102',
    'CSSE2203', 'CSSE3203', 'CSSE4103', 'CSSE4101', 'CSSY3201', 'CSSY3202',
    'CSNW3204', 'CSNW3203',
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Courses whose code digit disagrees with their real position in the plan.
 *
 * CSSE4104 is "B-Tech Course Project II" but is numbered 41xx, which the digit
 * rule reads as semester 1 — putting it alongside Project I. Every other
 * major numbers its Project II course 42xx.
 */
const SEMESTER_OVERRIDES: Record<string, 1 | 2> = {
  CSSE4104: 2,
};

/**
 * UTAS course codes encode level and semester: the first digit of the numeric
 * part is the academic level, the second is the semester. CSNW3203 -> level 3,
 * semester 2. Elective placeholders carry no such information.
 */
export function semesterOf(code: string): 1 | 2 {
  const override = SEMESTER_OVERRIDES[code];
  if (override) return override;

  const digits = code.match(/(\d+)/)?.[1];
  if (!digits || digits.length < 2) return 1;
  return digits[1] === '2' ? 2 : 1;
}

export function levelIndex(level: Level): number {
  return LEVEL_ORDER.indexOf(level);
}
