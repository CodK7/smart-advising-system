import { describe, expect, it } from 'vitest';
import {
  cleanText,
  optionalAcademicLevel,
  optionalEmail,
  optionalGpa,
  optionalMajor,
  requireUserId,
  requiredMessage,
  ValidationError,
} from '../server/validation.js';
import { validatePasswordStrength } from '../server/crypto.js';

describe('runtime validation', () => {
  it('normalizes text and strips unsafe control characters', () => {
    expect(cleanText('  hello\u0000 world  ', 20)).toBe('hello world');
    expect(cleanText('safe\u202E\u200B text', 20)).toBe('safe text');
    expect(() => cleanText(42, 20)).toThrow(ValidationError);
  });

  it('rejects oversized input instead of silently truncating it', () => {
    expect(() => cleanText('x'.repeat(11), 10)).toThrow(ValidationError);
  });

  it.each(['32e87366', '82e29746', 'S26s3216'])('accepts official user ID shape %s', (id) => {
    expect(requireUserId(id)).toBe(id);
  });

  it.each(['../admin', 'x', 'S 12345', '<script>', 'S12\u202E345'])('rejects invalid user ID %s', (id) => {
    expect(() => requireUserId(id)).toThrow(ValidationError);
  });

  it('validates academic fields and messages', () => {
    expect(optionalGpa('3.499')).toBe(3.5);
    expect(optionalAcademicLevel('Advanced Diploma')).toBe('Advanced Diploma');
    expect(optionalEmail(' Student@UTAS.edu.om ')).toBe('student@utas.edu.om');
    expect(requiredMessage(' مرحباً ', 20)).toBe('مرحباً');
    expect(() => optionalGpa(4.01)).toThrow(ValidationError);
    expect(() => optionalGpa(true)).toThrow(ValidationError);
    expect(() => optionalGpa('0x4')).toThrow(ValidationError);
    expect(() => optionalEmail('student\u200B@utas.edu.om')).toThrow(ValidationError);
    expect(() => optionalAcademicLevel('Professor')).toThrow(ValidationError);
    expect(() => optionalMajor('Network\u202E Computing')).toThrow(ValidationError);
    expect(() => requiredMessage('   ', 20)).toThrow(ValidationError);
  });

  it('supports strong Unicode passwords and rejects whitespace-only symbols', () => {
    expect(validatePasswordStrength('كلمةمرورآمنة2026!')).toBeNull();
    expect(validatePasswordStrength('SecurePassword2026 ')).toMatchObject({
      code: 'PASSWORD_COMPLEXITY',
    });
  });
});
