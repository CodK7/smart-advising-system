export const ACADEMIC_LEVELS = [
  'Diploma First Year',
  'Diploma Second Year',
  'Advanced Diploma',
  'BTech',
] as const;

export type AcademicLevel = (typeof ACADEMIC_LEVELS)[number];

const USER_ID = /^[A-Za-z0-9]{5,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{7,15}$/;
// eslint-disable-next-line no-control-regex -- deliberately strips unsafe C0 controls while preserving tabs/newlines.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// Direction overrides/isolate marks and zero-width format characters can make
// an identifier or message render differently from the value being validated.
// None is required to render ordinary Arabic or English text.
const INVISIBLE_FORMATTING = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const HAS_INVISIBLE_FORMATTING = /[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/;
const LINE_BREAKS = /[\r\n\t\u2028\u2029]/;

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new ValidationError('Text value must be a string.', 'INVALID_TEXT');
  }
  const cleaned = value
    .normalize('NFKC')
    .replace(CONTROL_CHARACTERS, '')
    .replace(INVISIBLE_FORMATTING, '')
    .trim();
  if (cleaned.length > maxLength) {
    throw new ValidationError(`Text must be at most ${maxLength} characters.`, 'TEXT_TOO_LONG');
  }
  return cleaned;
}

export function requireUserId(value: unknown, field = 'User id'): string {
  if (typeof value !== 'string' || HAS_INVISIBLE_FORMATTING.test(value)) {
    throw new ValidationError(`${field} is invalid.`, 'INVALID_USER_ID');
  }
  const id = cleanText(value, 20);
  if (!USER_ID.test(id)) throw new ValidationError(`${field} is invalid.`, 'INVALID_USER_ID');
  return id;
}

export function optionalName(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const name = cleanText(value, 100);
  if (name.length < 2 || LINE_BREAKS.test(name)) {
    throw new ValidationError('Name must be a single line between 2 and 100 characters.', 'INVALID_NAME');
  }
  return name;
}

export function optionalEmail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || HAS_INVISIBLE_FORMATTING.test(value)) {
    throw new ValidationError('Invalid email address.', 'INVALID_EMAIL');
  }
  const email = cleanText(value, 120).toLowerCase();
  if (!EMAIL.test(email)) throw new ValidationError('Invalid email address.', 'INVALID_EMAIL');
  return email;
}

export function optionalPhone(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string' || HAS_INVISIBLE_FORMATTING.test(value)) {
    throw new ValidationError('Invalid phone number.', 'INVALID_PHONE');
  }
  const phone = cleanText(value, 20);
  if (!phone) return null;
  if (!PHONE.test(phone)) throw new ValidationError('Invalid phone number.', 'INVALID_PHONE');
  return phone;
}

export function optionalDepartment(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const department = cleanText(value, 100);
  if (department.length < 2 || LINE_BREAKS.test(department)) {
    throw new ValidationError(
      'Department must be a single line between 2 and 100 characters.',
      'INVALID_DEPARTMENT',
    );
  }
  return department;
}

export function optionalMajor(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'string' ||
    HAS_INVISIBLE_FORMATTING.test(value) ||
    LINE_BREAKS.test(value)
  ) {
    throw new ValidationError('Major is invalid.', 'UNKNOWN_MAJOR');
  }
  const major = cleanText(value, 100);
  if (major.length < 2) throw new ValidationError('Major is invalid.', 'UNKNOWN_MAJOR');
  return major;
}

export function optionalGpa(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new ValidationError('GPA must be a number.', 'INVALID_GPA');
  }
  if (typeof value === 'string' && HAS_INVISIBLE_FORMATTING.test(value)) {
    throw new ValidationError('GPA must be a decimal number.', 'INVALID_GPA');
  }
  const normalized = typeof value === 'string' ? cleanText(value, 16) : value;
  if (typeof normalized === 'string' && !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new ValidationError('GPA must be a decimal number.', 'INVALID_GPA');
  }
  const gpa = typeof normalized === 'number' ? normalized : Number(normalized);
  if (!Number.isFinite(gpa) || gpa < 0 || gpa > 4) {
    throw new ValidationError('GPA must be between 0.0 and 4.0.', 'INVALID_GPA');
  }
  return Math.round(gpa * 100) / 100;
}

export function optionalAcademicLevel(value: unknown): AcademicLevel | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || HAS_INVISIBLE_FORMATTING.test(value)) {
    throw new ValidationError('Unknown academic level.', 'UNKNOWN_LEVEL');
  }
  const level = cleanText(value, 40);
  if (!ACADEMIC_LEVELS.includes(level as AcademicLevel)) {
    throw new ValidationError('Unknown academic level.', 'UNKNOWN_LEVEL');
  }
  return level as AcademicLevel;
}

export function requiredMessage(value: unknown, maxLength: number): string {
  const message = cleanText(value, maxLength);
  if (!message) throw new ValidationError('Message content is required.', 'MISSING_FIELDS');
  return message;
}
