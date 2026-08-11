/**
 * A handful of course codes appear in the study plans but have no official
 * title in the source document, so the seeder stores the code as a
 * placeholder. Rendering "CSSE2202 — CSSE2202" reads as a bug; show the gap
 * instead, so it is obvious a title is genuinely missing rather than wrong.
 */
export const courseTitle = (code: string, title: string, lang: 'ar' | 'en') =>
  title === code ? (lang === 'ar' ? 'مقرر بانتظار الاسم الرسمي' : 'Title pending from course handbook') : title;

export const translateMajor = (major: string | undefined, lang: 'ar' | 'en') => {
  if (!major) return '';
  if (lang === 'en') return major;
  
  const translations: Record<string, string> = {
    'Cyber and Information Security': 'الأمن السيبراني وأمن المعلومات',
    'Cyber & Info Security': 'الأمن السيبراني وأمن المعلومات',
    'Network Computing': 'حوسبة الشبكات',
    'Software Engineering': 'هندسة البرمجيات',
    'Data Science and Artificial Intelligence': 'علم البيانات والذكاء الاصطناعي',
    'Data & AI': 'علم البيانات والذكاء الاصطناعي',
    'Information Systems': 'نظم المعلومات',
    'Common': 'السنة التأسيسية / مشترك',
  };
  
  return translations[major] || major;
};

export const translateLevel = (level: string, lang: 'ar' | 'en') => {
  if (lang === 'en') return level;
  
  const translations: Record<string, string> = {
    'Diploma First Year': 'دبلوم السنة الأولى',
    'Diploma Second Year': 'دبلوم السنة الثانية',
    'Advanced Diploma': 'دبلوم متقدم',
    'BTech': 'بكالوريوس تقني',
    'Bachelor': 'بكالوريوس',
    'Year 1': 'السنة الأولى',
    'Diploma 2': 'دبلوم السنة الثانية',
    'Advanced': 'متقدم'
  };
  return translations[level] || level;
};

/** Keep server-derived percentages safe for both text and CSS widths. */
export const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
};

/**
 * SQLite timestamps are returned without an explicit UTC suffix, while other
 * deployments may return a complete ISO timestamp. Append `Z` only to the
 * former; blindly appending it turns an existing offset into an invalid date.
 */
export const formatDateTime = (value: string, lang: 'ar' | 'en'): string => {
  const trimmed = value.trim();
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = hasZone ? trimmed : `${trimmed.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-OM' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};
