import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Calculator,
  CalendarDays,
  FileText,
  BookOpen,
  Bot,
  LogOut,
  Menu,
  X,
  MessageCircle,
} from 'lucide-react';
import { api } from '../api';
import { isAdminRole, type User } from '../data';

const SystemAdminDashboard = lazy(() => import('./SystemAdminDashboard'));
const RegistrarAdminDashboard = lazy(() => import('./RegistrarAdminDashboard'));
const StudentAffairsAdminDashboard = lazy(() => import('./StudentAffairsAdminDashboard'));
const AdvisorDashboard = lazy(() => import('./AdvisorDashboard'));
const StudentDashboard = lazy(() => import('./StudentDashboard'));

/**
 * Tabs are addressed by a stable id rather than an array index. The previous
 * version hard-coded `index === 6` for the unread badge and `setActiveTab(6)`
 * for navigation, but the staff tab list only had six entries, so the badge
 * could never appear for staff and AdminDashboard's `case 6` was unreachable.
 */
export type TabId = 'overview' | 'gpa' | 'schedule' | 'plan' | 'books' | 'ai' | 'messages';

interface DashboardProps {
  currentUser: User;
  onLogout: () => void;
  language: 'ar' | 'en';
}

interface TabDef {
  id: TabId;
  label: { ar: string; en: string };
  icon: React.ReactNode;
}

const STUDENT_TABS: TabId[] = ['overview', 'gpa', 'schedule', 'plan', 'books', 'ai', 'messages'];
// Advisors message their advisees; students message their advisor.
const ADVISOR_TABS: TabId[] = ['overview', 'gpa', 'schedule', 'plan', 'books', 'ai', 'messages'];
// Admins have NO messaging: messaging is strictly Student <-> assigned Advisor,
// so the tab is absent from the admin surface entirely (not merely disabled).
const SYSTEM_ADMIN_TABS: TabId[] = ['overview', 'gpa', 'schedule', 'plan', 'books', 'ai'];
const REGISTRAR_ADMIN_TABS: TabId[] = ['overview', 'gpa', 'schedule', 'plan', 'books', 'ai'];
const STUDENT_AFFAIRS_ADMIN_TABS: TabId[] = ['overview', 'gpa', 'schedule', 'plan', 'books', 'ai'];

export default function Dashboard({ currentUser, onLogout, language }: DashboardProps) {
  const isAdvisor = currentUser.role === 'Advisor';
  const isAdministrative = isAdminRole(currentUser.role);
  const isStaff = isAdministrative || isAdvisor;

  const allTabs: Record<TabId, TabDef> = useMemo(
    () => ({
      overview: { id: 'overview', label: { ar: 'لوحة التحكم', en: 'Dashboard' }, icon: <LayoutDashboard size={18} /> },
      gpa: {
        id: 'gpa',
        label: isStaff ? { ar: 'المعدلات التراكمية', en: 'Student GPAs' } : { ar: 'المعدل التراكمي', en: 'My GPA' },
        icon: <Calculator size={18} />,
      },
      schedule: {
        id: 'schedule',
        label: isStaff ? { ar: 'الجداول الدراسية', en: 'Schedules' } : { ar: 'الجدول الدراسي', en: 'My Schedule' },
        icon: <CalendarDays size={18} />,
      },
      plan: {
        id: 'plan',
        label: isStaff ? { ar: 'الخطط الدراسية', en: 'Study Plans' } : { ar: 'الخطة الدراسية', en: 'Study Plan' },
        icon: <FileText size={18} />,
      },
      books: { id: 'books', label: { ar: 'مستشار الكتب', en: 'Book Advisor' }, icon: <BookOpen size={18} /> },
      ai: { id: 'ai', label: { ar: 'المستشار الذكي', en: 'AI Advisor' }, icon: <Bot size={18} /> },
      messages: {
        id: 'messages',
        label: isStaff ? { ar: 'الرسائل', en: 'Messages' } : { ar: 'مراسلة المرشد', en: 'Message Advisor' },
        icon: <MessageCircle size={18} />,
      },
    }),
    [isStaff],
  );

  const roleTabs = currentUser.role === 'System Admin'
    ? SYSTEM_ADMIN_TABS
    : currentUser.role === 'Registrar Admin'
      ? REGISTRAR_ADMIN_TABS
      : currentUser.role === 'Student Affairs Admin'
        ? STUDENT_AFFAIRS_ADMIN_TABS
        : isAdvisor
          ? ADVISOR_TABS
          : STUDENT_TABS;
  const tabs = roleTabs.map((id) => allTabs[id]);

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => window.innerWidth >= 1024);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);
  const [unreadCount, setUnreadCount] = useState(0);
  const mobileStateRef = useRef(isMobile);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!roleTabs.includes(activeTab)) setActiveTab('overview');
  }, [activeTab, roleTabs]);

  useEffect(() => {
    if (isAdministrative) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    let requestInFlight = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    const controller = new AbortController();

    const fetchUnread = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const rows = await api.unread(controller.signal);
        if (!cancelled) setUnreadCount(rows.reduce((sum, r) => sum + Number(r.count), 0));
      } catch {
        // A failed poll should not spam the console or clear the badge.
      } finally {
        requestInFlight = false;
      }
    };

    const stopPolling = () => {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState === 'hidden') return;
      void fetchUnread();
      interval = setInterval(fetchUnread, 10000);
    };
    const handleVisibilityChange = () => startPolling();

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      cancelled = true;
      controller.abort();
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser.id, isAdministrative]);

  // The original effect read isSidebarOpen but declared no dependencies, so it
  // closed over the initial value forever.
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleResize = () => {
      const mobile = window.innerWidth < 1024;
      if (mobile === mobileStateRef.current) return;
      mobileStateRef.current = mobile;
      setIsMobile(mobile);
      setIsSidebarOpen(!mobile);
    };

    const throttled = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleResize, 120);
    };

    window.addEventListener('resize', throttled);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', throttled);
    };
  }, []);

  const closeSidebarOnMobile = useCallback(() => {
    if (!isMobile) return;
    setIsSidebarOpen(false);
    sidebarToggleRef.current?.focus();
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile || !isSidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarCloseRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSidebarOnMobile();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeSidebarOnMobile, isMobile, isSidebarOpen]);

  const activeLabel = allTabs[activeTab].label[language];

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {isSidebarOpen && isMobile && (
        <div className="fixed inset-0 bg-slate-900/40 z-40" onClick={closeSidebarOnMobile} aria-hidden />
      )}

      <aside
        ref={sidebarRef}
        aria-hidden={!isSidebarOpen}
        aria-label={language === 'ar' ? 'التنقل الرئيسي' : 'Primary navigation'}
        aria-modal={isMobile && isSidebarOpen ? 'true' : undefined}
        inert={!isSidebarOpen}
        role={isMobile && isSidebarOpen ? 'dialog' : undefined}
        className={`${isMobile ? 'fixed inset-y-0 start-0' : 'relative'}
          z-50 bg-[#1A365D] text-white flex flex-col shrink-0
          transition-all duration-300 ease-in-out overflow-hidden
          ${isSidebarOpen ? 'w-[280px] sm:w-64' : 'w-0'}`}
      >
        <div className="p-4 border-b border-white/10 mt-12 flex justify-between items-start w-[280px] sm:w-64">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">
              {language === 'ar' ? 'نظام الإرشاد الذكي' : 'Smart Advising'}
            </h2>
            <p className="text-xs text-blue-200/80 mt-0.5 truncate">
              {language === 'ar' ? 'جامعة التقنية والعلوم التطبيقية' : 'UTAS Nizwa'}
            </p>
          </div>
          {isMobile && (
            <button
              ref={sidebarCloseRef}
              type="button"
              className="text-blue-200 hover:text-white shrink-0"
              onClick={closeSidebarOnMobile}
              aria-label={language === 'ar' ? 'إغلاق القائمة' : 'Close menu'}
            >
              <X size={20} />
            </button>
          )}
        </div>

        <nav className="flex-1 py-4 overflow-y-auto w-[280px] sm:w-64">
          <ul className="space-y-0.5 px-2">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <li key={tab.id}>
                  <button
                    onClick={() => {
                      setActiveTab(tab.id);
                      closeSidebarOnMobile();
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm transition
                      ${isActive ? 'bg-white/15 font-semibold' : 'hover:bg-white/10 text-blue-100'}`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="shrink-0">{tab.icon}</span>
                      <span className="truncate">{tab.label[language]}</span>
                    </span>
                    {tab.id === 'messages' && unreadCount > 0 && (
                      <span
                        className="bg-red-500 text-white text-[11px] font-bold min-w-5 h-5 px-1.5 grid place-items-center rounded-full shrink-0"
                        role="status"
                        aria-label={
                          language === 'ar'
                            ? `${unreadCount} رسالة غير مقروءة`
                            : `${unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}`
                        }
                      >
                        <span aria-hidden>{unreadCount}</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-4 border-t border-white/10 w-[280px] sm:w-64">
          <p className="text-xs text-blue-200/80">{language === 'ar' ? 'مرحباً،' : 'Signed in as'}</p>
          <p className="font-semibold truncate">{currentUser.name}</p>
          <p className="text-xs text-blue-200/70 mb-3">
            {currentUser.role === 'Student'
              ? language === 'ar' ? 'طالب' : 'Student'
              : currentUser.role === 'Advisor'
                ? language === 'ar' ? 'مرشد أكاديمي' : 'Academic Advisor'
                : currentUser.role === 'System Admin'
                  ? language === 'ar' ? 'مدير النظام' : 'System Admin'
                  : currentUser.role === 'Registrar Admin'
                    ? language === 'ar' ? 'مسؤول القبول والتسجيل' : 'Registrar Admin'
                    : language === 'ar' ? 'مسؤول شؤون الطلاب' : 'Student Affairs Admin'}
          </p>
          <button
            onClick={onLogout}
            className="flex items-center gap-2 text-sm text-red-300 hover:text-red-200 transition"
          >
            <LogOut size={16} className="shrink-0" />
            <span>{language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 flex items-center gap-3 shrink-0">
          <button
            ref={sidebarToggleRef}
            type="button"
            onClick={() => setIsSidebarOpen((v) => !v)}
            className="p-1.5 text-slate-500 hover:text-[#1A365D] rounded-lg hover:bg-slate-100 transition"
            aria-label={language === 'ar' ? 'تبديل القائمة' : 'Toggle menu'}
          >
            <Menu size={20} />
          </button>
          <h1 className="text-lg sm:text-xl font-bold text-[#1A365D] flex-1 truncate">{activeLabel}</h1>
          <div className="w-20 shrink-0" aria-hidden />
        </header>

        <main className="p-4 sm:p-6 flex-1 overflow-y-auto overflow-x-hidden flex flex-col min-h-0">
          {/*
            Three roles, three surfaces. The advisor's overview is its own
            component rather than a variant of the admin one: the two answer
            different questions ("who in my caseload needs me?" vs "is the
            institution configured correctly?") and sharing a component made
            every panel in it conditional on role.

            On the non-overview tabs the advisor keeps the existing staff views,
            which are already scoped to their advisees by the API.
          */}
          <Suspense
            fallback={
              <div
                className="h-36 rounded-xl bg-slate-200/70 animate-pulse"
                role="status"
                aria-label={language === 'ar' ? 'جارٍ تحميل لوحة التحكم' : 'Loading dashboard'}
              />
            }
          >
            {currentUser.role === 'System Admin' ? (
              <SystemAdminDashboard activeTab={activeTab} language={language} currentUser={currentUser} />
            ) : currentUser.role === 'Registrar Admin' ? (
              <RegistrarAdminDashboard activeTab={activeTab} language={language} currentUser={currentUser} />
            ) : currentUser.role === 'Student Affairs Admin' ? (
              <StudentAffairsAdminDashboard activeTab={activeTab} language={language} currentUser={currentUser} />
            ) : isAdvisor ? (
              activeTab === 'overview' ? (
                <AdvisorDashboard language={language} currentUser={currentUser} />
              ) : (
                <RegistrarAdminDashboard activeTab={activeTab} language={language} currentUser={currentUser} />
              )
            ) : (
              <StudentDashboard
                activeTab={activeTab}
                currentUser={currentUser}
                language={language}
                onNavigateToMessages={() => setActiveTab('messages')}
              />
            )}
          </Suspense>
        </main>
      </div>
    </div>
  );
}
