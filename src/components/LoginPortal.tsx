import React, { useEffect, useRef, useState } from 'react';
import { GraduationCap, AlertCircle } from 'lucide-react';
import { api } from '../api';
import type { User } from '../data';
import { withRetryWindow } from '../loginErrors';

interface LoginPortalProps {
  onAuthenticated: (user: User) => void;
  language: 'ar' | 'en';
}

const copy = {
  ar: {
    university: 'جامعة التقنية والعلوم التطبيقية — نزوى',
    system: 'النظام الأكاديمي الذكي للإرشاد',
    identifier: 'الرقم الجامعي / الوظيفي أو البريد الإلكتروني',
    password: 'كلمة المرور',
    hint: 'استخدم كلمة مرور حسابك الآمنة. تواصل مع مسؤول النظام إذا لم تكن لديك بيانات الدخول.',
    submit: 'تسجيل الدخول',
    submitting: 'جارٍ تسجيل الدخول…',
    generic: 'تعذّر الاتصال بالخادم. حاول مرة أخرى.',
  },
  en: {
    university: 'University of Technology and Applied Sciences — Nizwa',
    system: 'Smart Academic Advising System',
    identifier: 'Student / Staff ID or Email',
    password: 'Password',
    hint: 'Use your secure account password. Contact an administrator if you do not have your sign-in details.',
    submit: 'Sign in',
    submitting: 'Signing in…',
    generic: 'Could not reach the server. Please try again.',
  },
} as const;

/**
 * Server error codes -> localised text. The API returns a stable `code`
 * ('INVALID_CREDENTIALS', …) plus an English fallback message; previously the
 * component rendered that English message directly, so an Arabic user entering
 * bad credentials saw "Invalid credentials." in English.
 */
const errorCopy: Record<string, { ar: string; en: string }> = {
  MISSING_FIELDS: {
    ar: 'يرجى إدخال الرقم الجامعي / الوظيفي أو البريد الإلكتروني وكلمة المرور.',
    en: 'Please enter your Student / Staff ID or email, and your password.',
  },
  INVALID_CREDENTIALS: {
    ar: 'الرقم الجامعي / الوظيفي أو البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    en: 'Invalid ID / email or password.',
  },
  RATE_LIMITED: {
    ar: 'عدد محاولات تسجيل الدخول كبير جدًا. يرجى المحاولة لاحقًا.',
    en: 'Too many login attempts. Please try again later.',
  },
  AUTH_REQUIRED: {
    ar: 'انتهت الجلسة. يرجى تسجيل الدخول مرة أخرى.',
    en: 'Your session has expired. Please sign in again.',
  },
  FORBIDDEN: {
    ar: 'ليس لديك صلاحية للوصول إلى هذه الصفحة.',
    en: 'You do not have permission to access this page.',
  },
};

/** Resolve a thrown error to a message in the active language. */
function localiseError(err: unknown, language: 'ar' | 'en', fallback: string): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const apiError = err as { code?: unknown; retryAfter?: unknown };
    const code = typeof apiError.code === 'string' ? apiError.code : '';
    const retryAfter = typeof apiError.retryAfter === 'number' && Number.isFinite(apiError.retryAfter)
      ? apiError.retryAfter
      : undefined;
    const entry = errorCopy[code];
    if (entry) {
      if (code === 'RATE_LIMITED' && retryAfter) {
        return withRetryWindow(entry[language], language, retryAfter);
      }
      return entry[language];
    }
    // An unmapped code (or an older server) must not leak English into the
    // Arabic UI, so fall back to the generic localised message.
    return language === 'ar'
      ? 'تعذّر تسجيل الدخول. يرجى المحاولة مرة أخرى.'
      : 'Sign-in failed. Please try again.';
  }
  return fallback;
}

export default function LoginPortal({ onAuthenticated, language }: LoginPortalProps) {
  const t = copy[language];
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const languageRef = useRef(language);
  languageRef.current = language;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  const performLogin = async () => {
    setError('');

    const id = identifier.trim();
    if (!id || !password) {
      setError(errorCopy.MISSING_FIELDS[language]);
      (id ? passwordRef : identifierRef).current?.focus();
      return;
    }
    if (loadingRef.current) return;

    loadingRef.current = true;
    setLoading(true);
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const { user } = await api.login(id, password, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      // Straight to the dashboard — App no longer interposes a password change.
      onAuthenticated(user);
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return;
      // Translate the server's error code; never leak whether the account
      // exists, and never render the server's English prose in an Arabic UI.
      const currentLanguage = languageRef.current;
      setError(localiseError(err, currentLanguage, copy[currentLanguage].generic));
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      loadingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); // never let the form issue a native POST
    void performLogin().catch(() => undefined);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-[#1A365D] text-white grid place-items-center mx-auto mb-4">
              <GraduationCap size={24} />
            </div>
            <h1 className="text-lg font-bold text-[#1A365D] leading-snug">{t.university}</h1>
            <p className="text-slate-500 mt-1">{t.system}</p>
          </div>

          {error && (
            <div
              role="alert"
              id="login-error"
              className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm"
            >
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} autoComplete="on" noValidate>
            <div className="mb-4">
              <label className="block text-slate-700 text-sm font-semibold mb-1.5" htmlFor="identifier">
                {t.identifier}
              </label>
              <input
                ref={identifierRef}
                id="identifier"
                name="identifier"
                type="text"
                dir="ltr"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:border-[#1A365D] focus:ring-2 focus:ring-[#1A365D]/15 transition"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value);
                  if (error) setError('');
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                maxLength={120}
                required
              />
            </div>

            <div className="mb-2">
              <label className="block text-slate-700 text-sm font-semibold mb-1.5" htmlFor="password">
                {t.password}
              </label>
              <input
                ref={passwordRef}
                id="password"
                name="password"
                type="password"
                dir="ltr"
                autoComplete="current-password"
                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:border-[#1A365D] focus:ring-2 focus:ring-[#1A365D]/15 transition"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError('');
                }}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'login-error' : undefined}
                maxLength={200}
                required
              />
            </div>

            <p className="text-xs text-slate-500 mb-6 leading-relaxed">{t.hint}</p>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#1A365D] hover:bg-[#132845] disabled:bg-slate-400 text-white font-semibold py-2.5 px-4 rounded-lg transition focus:outline-none focus:ring-2 focus:ring-[#1A365D]/40"
            >
              {loading ? t.submitting : t.submit}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
