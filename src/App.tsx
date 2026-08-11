/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import LoginPortal from './components/LoginPortal';
import Dashboard from './components/Dashboard';
import { api, ApiError, isAbortError } from './api';
import type { User } from './data';

type Language = 'ar' | 'en';

const LANGUAGE_KEY = 'sas_language';

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [sessionReload, setSessionReload] = useState(0);
  const [logoutError, setLogoutError] = useState('');

  const [language, setLanguage] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(LANGUAGE_KEY);
      if (stored === 'ar' || stored === 'en') return stored;
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
    return navigator.language.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  });

  /**
   * Identity comes from the server session, not from localStorage. The old
   * code restored a full user object — role included — from localStorage and
   * trusted it, so editing one key in devtools granted an admin dashboard.
   */

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setSessionError(false);
    try {
      localStorage.removeItem('currentUser');
    } catch {
      // Identity is server-only; inability to remove a legacy key is harmless.
    }
    api
      .me(controller.signal)
      .then(({ user }) => {
        setCurrentUser(user);
        setSessionError(false);
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        if (error instanceof ApiError && error.status === 401) {
          setCurrentUser(null);
          setSessionError(false);
          return;
        }
        setSessionError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [sessionReload]);

  useEffect(() => {
    const handleExpiredSession = () => {
      setLogoutError('');
      setCurrentUser(null);
    };
    window.addEventListener('sas:auth-expired', handleExpiredSession);
    return () => window.removeEventListener('sas:auth-expired', handleExpiredSession);
  }, []);

  // Keep <html lang/dir> in step with the toggle so screen readers, font
  // selection and text shaping all follow the active language.
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // The language still works for the current page when storage is blocked.
    }
  }, [language]);

  const handleLogout = useCallback(async () => {
    setLogoutError('');
    try {
      await api.logout();
      // Clear any state the old build may have left behind.
      try {
        localStorage.removeItem('currentUser');
      } catch {
        // The server session is already invalidated.
      }
      setCurrentUser(null);
    } catch {
      // Keep the authenticated screen visible: pretending to be signed out
      // after a network failure would leave the HTTP-only session active and
      // a reload would unexpectedly sign the user back in.
      setLogoutError(
        language === 'ar'
          ? 'تعذّر تسجيل الخروج بأمان. تحقق من اتصال الخادم ثم حاول مرة أخرى.'
          : 'Secure sign-out failed. Check the server connection and try again.',
      );
    }
  }, [language]);

  const toggleLanguage = () => setLanguage((l) => (l === 'ar' ? 'en' : 'ar'));

  const languageToggle = (
    <button
      type="button"
      onClick={toggleLanguage}
      className="fixed top-4 end-4 z-[60] bg-white/90 backdrop-blur px-3 py-1.5 rounded-lg shadow-sm text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-white transition"
      aria-label={language === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
    >
      {language === 'ar' ? 'English' : 'العربية'}
    </button>
  );


  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-500" role="status" aria-live="polite">
          <span className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" aria-hidden />
          <span>{language === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</span>
        </div>
      </div>
    );
  }

  if (sessionError) {
    return (
      <>
        {languageToggle}
        <main className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm" role="alert">
            <h1 className="font-bold text-[#1A365D]">
              {language === 'ar' ? 'الخادم غير متاح حالياً' : 'The server is currently unavailable'}
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              {language === 'ar'
                ? 'تعذّر التحقق من جلستك بأمان. تحقق من تشغيل الخادم ثم أعد المحاولة.'
                : 'Your session could not be checked securely. Make sure the server is running, then try again.'}
            </p>
            <button
              type="button"
              onClick={() => setSessionReload((value) => value + 1)}
              className="mt-4 rounded-lg bg-[#1A365D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#132845] transition"
            >
              {language === 'ar' ? 'إعادة المحاولة' : 'Try again'}
            </button>
          </div>
        </main>
      </>
    );
  }

  if (!currentUser) {
    return (
      <>
        {languageToggle}
        <LoginPortal onAuthenticated={setCurrentUser} language={language} />
      </>
    );
  }

  // The mandatory password change that used to sit here has been removed.
  // A successful sign-in goes directly to the role's dashboard (Dashboard
  // renders the student, advisor, or admin view from currentUser.role).
  return (
    <>
      {languageToggle}
      <Dashboard currentUser={currentUser} onLogout={handleLogout} language={language} />
      {logoutError && (
        <div
          className="fixed bottom-4 start-1/2 -translate-x-1/2 z-[70] max-w-[calc(100%-2rem)] rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg flex items-center gap-3"
          role="alert"
        >
          <span>{logoutError}</span>
          <button
            type="button"
            onClick={() => setLogoutError('')}
            className="font-bold text-red-700 hover:text-red-900"
            aria-label={language === 'ar' ? 'إغلاق التنبيه' : 'Dismiss alert'}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
