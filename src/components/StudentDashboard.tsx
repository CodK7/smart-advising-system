import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  RotateCcw,
  Send,
  TrendingUp,
} from 'lucide-react';
import MessagesView from './MessagesView';
import Markdown from './Markdown';
import PageInfo from './PageInfo';
import { api, ApiError, isAbortError } from '../api';
import { clampPercent, courseTitle, translateLevel, translateMajor } from '../utils';
import type { TabId } from './Dashboard';
import type { Book } from '../books';
import type { AdvisingReport, StudentProfile, StudyPlanRow, Transcript, User } from '../data';

interface StudentDashboardProps {
  activeTab: TabId;
  currentUser: User;
  language: 'ar' | 'en';
  onNavigateToMessages?: () => void;
}

const Card: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({
  title,
  children,
  className = '',
}) => (
  <section className={`bg-white rounded-xl border border-slate-200 p-5 sm:p-6 ${className}`}>
    {title && <h3 className="text-base font-bold text-[#1A365D] mb-4 pb-3 border-b border-slate-100">{title}</h3>}
    {children}
  </section>
);

export default function StudentDashboard({
  activeTab,
  currentUser,
  language,
  onNavigateToMessages,
}: StudentDashboardProps) {
  const ar = language === 'ar';

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [advising, setAdvising] = useState<AdvisingReport | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [studyPlan, setStudyPlan] = useState<StudyPlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dataReload, setDataReload] = useState(0);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [booksError, setBooksError] = useState('');
  const [booksReload, setBooksReload] = useState(0);

  // AI chat
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<ChatEntry[]>([]);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(true);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const lastChatSendRef = useRef(0);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatMountedRef = useRef(true);
  const chatBusyRef = useRef(false);
  const chatSequenceRef = useRef(0);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const languageRef = useRef(language);
  languageRef.current = language;

  useEffect(() => {
    chatMountedRef.current = true;
    return () => {
      chatMountedRef.current = false;
      chatAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setChatHistoryLoading(true);
    api.chatHistory(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setChatLog(rows.map((row) => ({
          id: `server-${row.id}`,
          sender: row.role === 'user' ? 'user' : 'system',
          text: row.content,
        })));
      })
      .catch((chatHistoryError: unknown) => {
        if (isAbortError(chatHistoryError)) return;
        setChatError(
          languageRef.current === 'ar'
            ? 'تعذّر تحميل سجل المحادثة السابق. يمكنك بدء محادثة جديدة.'
            : 'Previous chat history could not be loaded. You can still start a new conversation.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setChatHistoryLoading(false);
      });
    return () => controller.abort();
  }, [currentUser.id]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');

    Promise.all([
      api.profile(currentUser.id, controller.signal),
      api.advising(currentUser.id, controller.signal),
      api.transcript(currentUser.id, controller.signal),
      api.studyPlan(currentUser.id, controller.signal),
    ])
      .then(([p, a, t, sp]) => {
        if (cancelled) return;
        setProfile(p);
        setAdvising(a);
        setTranscript(t);
        setStudyPlan(sp);
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentUser.id, dataReload]);

  useEffect(() => {
    if (activeTab !== 'books' || books) return;
    let cancelled = false;
    setBooksError('');
    import('../books')
      .then(({ BOOKS }) => {
        if (!cancelled) setBooks(BOOKS);
      })
      .catch(() => {
        if (!cancelled) {
          setBooksError(languageRef.current === 'ar' ? 'تعذّر تحميل قائمة المصادر.' : 'Could not load the resource list.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, books, booksReload]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [chatHistoryLoading, chatLog.length, isChatLoading]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const message = chatInput.trim();
    if (!message || chatBusyRef.current || chatHistoryLoading) return;

    const now = Date.now();
    if (now - lastChatSendRef.current < 1500) {
      setChatError(
        ar ? 'يرجى الانتظار لحظة قبل إرسال رسالة أخرى.' : 'Please wait a moment before sending another message.',
      );
      return;
    }

    const localId = `local-${++chatSequenceRef.current}`;
    lastChatSendRef.current = now;
    chatBusyRef.current = true;
    setChatLog((prev) => [...prev, { id: localId, sender: 'user', text: message }]);
    setChatInput('');
    setIsChatLoading(true);
    setChatError('');
    const controller = new AbortController();
    chatAbortRef.current = controller;
    try {
      const { reply } = await api.chat(message, controller.signal);
      if (!chatMountedRef.current || controller.signal.aborted) return;
      setChatLog((prev) => [
        ...prev,
        { id: `${localId}-reply`, sender: 'system', text: reply },
      ]);
    } catch (sendError: unknown) {
      if (isAbortError(sendError) || !chatMountedRef.current) return;
      // The server stores a user/assistant pair atomically. If the request
      // failed, remove the optimistic bubble so retrying cannot duplicate it.
      setChatLog((prev) => prev.filter((entry) => entry.id !== localId));
      setChatError(
        languageRef.current === 'ar'
          ? 'تعذّر إرسال الرسالة. حاول مرة أخرى.'
          : sendError instanceof ApiError
            ? sendError.message
            : 'The message could not be sent. Please try again.',
      );
      setChatInput(message);
    } finally {
      if (chatAbortRef.current === controller) chatAbortRef.current = null;
      chatBusyRef.current = false;
      if (chatMountedRef.current) setIsChatLoading(false);
    }
  };

  if (loading) {
    return <p className="text-center text-slate-500 py-10" role="status">{ar ? 'جارٍ تحميل بياناتك…' : 'Loading your records…'}</p>;
  }
  if (error || !profile || !advising || !transcript) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6" role="alert">
        <p>{ar ? 'تعذّر تحميل بياناتك الأكاديمية. تحقق من اتصال الخادم ثم حاول مرة أخرى.' : error || 'Could not load your records.'}</p>
        <button
          type="button"
          onClick={() => setDataReload((value) => value + 1)}
          className="mt-3 px-3 py-1.5 rounded-lg border border-red-300 text-sm font-semibold hover:bg-red-100 transition"
        >
          {ar ? 'إعادة المحاولة' : 'Try again'}
        </button>
      </div>
    );
  }

  switch (activeTab) {
    // -----------------------------------------------------------------------
    case 'overview': {
      const gpaTone =
        profile.gpa >= 3.0 ? 'text-emerald-600' : profile.gpa >= 2.0 ? 'text-amber-600' : 'text-red-600';

      return (
        <div className="space-y-5">
          {/* Explains the "Recommended for next semester" card on this page. */}
          <PageInfo page="suggested" language={language} />
          <div className="bg-[#1A365D] text-white p-6 rounded-xl">
            <h2 className="text-xl sm:text-2xl font-bold">
              {ar ? 'مرحباً، ' : 'Welcome, '}
              {profile.name}
            </h2>
            <p className="text-blue-200 text-sm mt-1">
              <span dir="ltr">{profile.id}</span> · {translateMajor(profile.major, language)} ·{' '}
              {translateLevel(profile.level, language)}
            </p>
          </div>

          {advising.onProbation && (
            <div className="bg-red-50 border border-red-200 p-4 rounded-xl flex items-start gap-3">
              <AlertTriangle className="text-red-600 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="text-red-800 font-bold text-sm">
                  {ar ? 'إنذار أكاديمي: المعدل التراكمي أقل من 2.0' : 'Academic alert: GPA below 2.0'}
                </h4>
                <p className="text-red-700 text-sm mt-1 leading-relaxed">
                  {ar
                    ? `أنت تحت الملاحظة الأكاديمية. يقتصر العبء الدراسي للفصل القادم على ${advising.creditCap} ساعة معتمدة. يرجى مراجعة مرشدك${profile.advisor_name ? ` (${profile.advisor_name})` : ''}.`
                    : `You are under academic probation. Your load for next semester is capped at ${advising.creditCap} credits. Please contact your advisor${profile.advisor_name ? ` (${profile.advisor_name})` : ''}.`}
                </p>
              </div>
            </div>
          )}

          {advising.retakes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3">
              <RotateCcw className="text-amber-600 shrink-0 mt-0.5" size={20} />
              <div>
                <h4 className="text-amber-800 font-bold text-sm">
                  {ar ? 'مقررات يجب إعادتها' : 'Courses to repeat'}
                </h4>
                <p className="text-amber-700 text-sm mt-1">
                  {advising.retakes.map((c) => c.code).join('، ')}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <p className="text-xs text-slate-500 mb-1">{ar ? 'المعدل التراكمي' : 'Cumulative GPA'}</p>
              <p data-testid="student-overview-gpa" className={`text-2xl font-bold ${gpaTone}`}>{profile.gpa.toFixed(2)}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500 mb-1">{ar ? 'الساعات المنجزة' : 'Credits earned'}</p>
              <p className="text-2xl font-bold text-[#1A365D]">{advising.completedCredits}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500 mb-1">{ar ? 'ساعات جارية' : 'In progress'}</p>
              <p className="text-2xl font-bold text-[#1A365D]">{advising.inProgressCredits}</p>
            </Card>
            <Card>
              <p className="text-xs text-slate-500 mb-1">{ar ? 'الفصل القادم' : 'Next term'}</p>
              <p className="text-base font-bold text-[#1A365D] mt-1.5">{advising.nextTerm}</p>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title={ar ? 'مقررات مقترحة للفصل القادم' : 'Recommended for next semester'}>
              {advising.recommended.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {ar ? 'لا توجد مقررات مقترحة حالياً.' : 'No recommendations available yet.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {advising.recommended.map((c) => (
                    <li
                      key={c.code}
                      className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100 bg-slate-50/60"
                    >
                      {c.reason === 'retake' ? (
                        <RotateCcw size={16} className="text-amber-600 shrink-0" />
                      ) : (
                        <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                      )}
                      <span className="font-mono text-xs font-bold text-[#1A365D] shrink-0" dir="ltr">
                        {c.code}
                      </span>
                      <span className="text-sm text-slate-700 truncate flex-1">{courseTitle(c.code, c.title, language)}</span>
                      <span className="text-xs text-slate-400 shrink-0">{c.credits}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-slate-400 mt-4">
                {ar
                  ? `الحد الأقصى للعبء الدراسي: ${advising.creditCap} ساعة معتمدة.`
                  : `Credit cap for next semester: ${advising.creditCap}.`}
              </p>
            </Card>

            <Card title={ar ? 'المرشد الأكاديمي' : 'Academic advisor'}>
              {profile.advisor_name ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-full bg-[#1A365D] text-white grid place-items-center font-bold">
                      {profile.advisor_name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{profile.advisor_name}</p>
                      <p className="text-xs text-slate-500">{ar ? 'مرشد أكاديمي' : 'Academic Advisor'}</p>
                    </div>
                  </div>

                  {profile.advisor_email && (
                    <p className="flex items-center gap-2 text-sm text-slate-600">
                      <Mail size={15} className="shrink-0" />
                      <span dir="ltr" className="truncate">
                        {profile.advisor_email}
                      </span>
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    {profile.advisor_phone && (
                      <a
                        href={`tel:${profile.advisor_phone}`}
                        className="flex-1 flex items-center justify-center gap-2 bg-[#1A365D] text-white py-2 rounded-lg hover:bg-[#132845] transition text-sm"
                      >
                        <Phone size={15} />
                        {ar ? 'اتصال' : 'Call'}
                      </a>
                    )}
                    {onNavigateToMessages && (
                      <button
                        onClick={onNavigateToMessages}
                        className="flex-1 flex items-center justify-center gap-2 border border-[#1A365D] text-[#1A365D] py-2 rounded-lg hover:bg-slate-50 transition text-sm"
                      >
                        <MessageCircle size={15} />
                        {ar ? 'مراسلة' : 'Message'}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">{ar ? 'لم يتم تعيين مرشد بعد.' : 'No advisor assigned yet.'}</p>
              )}
            </Card>
          </div>
        </div>
      );
    }

    // -----------------------------------------------------------------------
    case 'gpa': {
      const history = transcript.history;
      const max = 4;

      return (
        <div className="space-y-5">
          <Card title={ar ? 'تطور المعدل التراكمي' : 'GPA progression'}>
            {history.length === 0 ? (
              <p className="text-sm text-slate-500">{ar ? 'لا يوجد سجل بعد.' : 'No completed terms yet.'}</p>
            ) : (
              <>
                {/*
                  Cumulative GPA per term. Labels scaled up for legibility on both
                  desktop and mobile: the value sits above each bar at a readable
                  size and the term label below it no longer truncates to nothing.
                  The 4.0 gridline references sit behind the bars so the height of
                  each bar reads against the scale.
                */}
                <div className="relative h-56 sm:h-64 mb-8 ps-8">
                  {/* Y-axis reference labels + gridlines at 0..4 */}
                  {[4, 3, 2, 1, 0].map((g) => (
                    <div
                      key={g}
                      className="absolute inset-x-8 flex items-center gap-2"
                      style={{ bottom: `${(g / max) * 100}%` }}
                    >
                      <span className="absolute -start-8 -translate-y-1/2 text-sm font-semibold text-slate-400 w-6 text-end">
                        {g.toFixed(1)}
                      </span>
                      <div
                        className={`w-full border-t ${g === 2 ? 'border-red-300 border-dashed' : 'border-slate-100'}`}
                      />
                    </div>
                  ))}
                  <div className="absolute inset-0 ps-8 flex items-end gap-3 sm:gap-4">
                    {history.map((h) => (
                      <div key={h.term} className="flex-1 flex flex-col items-center justify-end min-w-0 h-full">
                        <span
                          className={`text-base sm:text-lg font-extrabold mb-1 tabular-nums ${
                            h.cumulativeGpa >= 2 ? 'text-[#1A365D]' : 'text-red-600'
                          }`}
                        >
                          {h.cumulativeGpa.toFixed(2)}
                        </span>
                        <div
                          className={`w-full max-w-[64px] rounded-t-lg transition-all ${
                            h.cumulativeGpa >= 2 ? 'bg-[#1A365D]' : 'bg-red-500'
                          }`}
                          style={{ height: `${Math.max(3, clampPercent((h.cumulativeGpa / max) * 100))}%` }}
                          title={`${h.term}: ${h.cumulativeGpa}`}
                        />
                        <span className="text-xs sm:text-sm font-medium text-slate-600 mt-2 w-full text-center truncate">
                          {h.term}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 bg-slate-50">
                        <th className="px-4 py-2.5 text-start font-semibold">{ar ? 'الفصل' : 'Term'}</th>
                        <th className="px-4 py-2.5 text-start font-semibold">{ar ? 'معدل الفصل' : 'Term GPA'}</th>
                        <th className="px-4 py-2.5 text-start font-semibold">{ar ? 'التراكمي' : 'Cumulative'}</th>
                        <th className="px-4 py-2.5 text-start font-semibold">{ar ? 'الساعات المعتمدة' : 'Credit Hours'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {history.map((h) => (
                        <tr key={h.term} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5 font-medium text-slate-700">{h.term}</td>
                          <td className="px-4 py-2.5">{h.termGpa.toFixed(2)}</td>
                          <td className="px-4 py-2.5 font-bold text-[#1A365D]">{h.cumulativeGpa.toFixed(2)}</td>
                          <td className="px-4 py-2.5 text-slate-500">{h.credits}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Card title={ar ? 'كشف الدرجات' : 'Transcript'}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 bg-slate-50">
                    <th className="px-4 py-2.5 text-start font-semibold">{ar ? 'الرمز' : 'Code'}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{ar ? 'المقرر' : 'Course'}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{ar ? 'الفصل' : 'Term'}</th>
                    <th className="px-4 py-2.5 text-start font-semibold">{ar ? 'التقدير' : 'Grade'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {transcript.enrollments.map((e) => (
                    <tr key={e.course_code} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 font-mono text-xs font-bold text-[#1A365D]" dir="ltr">
                        {e.course_code}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{courseTitle(e.course_code, e.title, language)}</td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{e.term}</td>
                      <td className="px-4 py-2.5">
                        {e.status === 'in_progress' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">
                            {ar ? 'جارٍ' : 'In progress'}
                          </span>
                        ) : (
                          <span
                            className={`font-bold ${(e.grade_points ?? 0) === 0 ? 'text-red-600' : 'text-slate-700'}`}
                          >
                            {e.grade}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      );
    }

    // -----------------------------------------------------------------------
    case 'schedule': {
      const current = transcript.enrollments.filter((e) => e.status === 'in_progress');
      const term = current[0]?.term ?? '';

      return (
        <div className="space-y-5">
          <PageInfo page="schedule" language={language} />
          <Card title={ar ? `المقررات المسجّلة — ${term}` : `Current registration — ${term}`}>
            {current.length === 0 ? (
              <p className="text-sm text-slate-500">
                {ar ? 'لا توجد مقررات مسجّلة حالياً.' : 'No courses currently registered.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="text-start py-2 px-3 font-semibold">{ar ? 'رمز المقرر' : 'Course'}</th>
                      <th className="text-start py-2 px-3 font-semibold">{ar ? 'اسم المقرر' : 'Title'}</th>
                      <th className="text-start py-2 px-3 font-semibold">{ar ? 'الساعات' : 'Credits'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {current.map((course) => (
                      <tr key={course.course_code} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 px-3 font-mono font-bold text-[#1A365D]" dir="ltr">
                          {course.course_code}
                        </td>
                        <td className="py-3 px-3 text-slate-700">
                          {courseTitle(course.course_code, course.title ?? '', language)}
                        </td>
                        <td className="py-3 px-3 text-slate-600">{course.credits}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

        </div>
      );
    }

    // -----------------------------------------------------------------------
    case 'plan': {
      const byLevel = new Map<string, StudyPlanRow[]>();
      for (const row of studyPlan) {
        byLevel.set(row.level, [...(byLevel.get(row.level) ?? []), row]);
      }

      const totalCredits = advising.totalPlanCredits;
      const pct = clampPercent(advising.progressPercent);

      return (
        <div className="space-y-5">
          <PageInfo page="plan" language={language} />
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-[#1A365D]">{ar ? 'الخطة الدراسية' : 'Study plan'}</h3>
                <p className="text-sm text-slate-600 mt-0.5">
                  {ar ? 'خطتك الدراسية: ' : 'Your study plan: '}
                  <span className="font-medium text-slate-800">{profile.name}</span>
                  {' · '}
                  <span className="font-mono text-xs" dir="ltr">{profile.id}</span>
                </p>
                <p className="text-sm text-slate-500 mt-0.5">
                  {translateMajor(profile.major, language)} · {translateLevel(profile.level, language)}
                </p>
              </div>
              <div className="text-end">
                <p className="text-2xl font-bold text-[#1A365D]">{pct}%</p>
                <p className="text-xs text-slate-500">
                  {advising.planCompletedCredits} / {totalCredits} {ar ? 'ساعة' : 'credits'}
                </p>
              </div>
            </div>
            <div
              className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden"
              role="progressbar"
              aria-label={ar ? 'نسبة إنجاز الخطة الدراسية' : 'Study plan completion'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div className="h-full bg-[#1A365D] rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          </Card>

          {[...byLevel.entries()].map(([level, rows]) => (
            <Card key={level} title={translateLevel(level, language)}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {rows.map((r) => {
                  const done = r.status === 'completed';
                  const active = r.status === 'in_progress';
                  return (
                    <div
                      key={`${level}-${r.code}`}
                      className={`rounded-lg border p-3.5 transition ${
                        done
                          ? 'border-emerald-200 bg-emerald-50/50'
                          : active
                            ? 'border-blue-200 bg-blue-50/50'
                            : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-[#1A365D]" dir="ltr">
                          {r.code}
                        </span>
                        {done && <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />}
                        {active && <TrendingUp size={15} className="text-blue-600 shrink-0" />}
                      </div>
                      <p className="text-sm text-slate-700 mt-1.5 leading-snug">{courseTitle(r.code, r.title, language)}</p>
                      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-slate-100 text-xs text-slate-500">
                        <span>
                          {ar ? 'فصل' : 'Sem'} {r.semester}
                        </span>
                        {done && r.grade && <span className="font-bold text-emerald-700">{r.grade}</span>}
                        {r.is_elective === 1 && <span className="text-slate-400">{ar ? 'اختياري' : 'Elective'}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}

          {advising.blocked.length > 0 && (
            <Card title={ar ? 'مقررات غير متاحة بعد' : 'Not yet available'}>
              <ul className="space-y-2">
                {advising.blocked.map((c) => (
                  <li key={c.code} className="flex items-start gap-3 text-sm p-2.5 rounded-lg bg-slate-50">
                    <Lock size={15} className="text-slate-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-bold text-[#1A365D]" dir="ltr">
                        {c.code}
                      </span>
                      <span className="text-slate-700"> — {courseTitle(c.code, c.title, language)}</span>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {ar ? 'يتطلب: ' : 'Requires: '}
                        <span dir="ltr">{c.blockedBy.join(', ')}</span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      );
    }

    case 'books': {
      const recommended = (books ?? []).filter((book) => book.majors.includes(profile.major));
      return (
        <Card title={ar ? 'مصادر مقترحة' : 'Recommended resources'}>
          <div className="space-y-5">
            <div className="pb-3 border-b border-slate-100">
              <p className="text-sm text-slate-600">
                {ar ? 'بناءً على تخصصك: ' : 'Based on your major: '}
                <strong className="text-[#1A365D]">{translateMajor(profile.major, language)}</strong>
              </p>
            </div>
            {!books && !booksError && (
              <p className="text-sm text-slate-500" role="status">
                {ar ? 'جارٍ تحميل المصادر…' : 'Loading resources…'}
              </p>
            )}
            {booksError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                <p>{booksError}</p>
                <button
                  type="button"
                  onClick={() => setBooksReload((value) => value + 1)}
                  className="mt-2 font-semibold underline underline-offset-2"
                >
                  {ar ? 'إعادة المحاولة' : 'Try again'}
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recommended.map((book) => (
                <a
                  key={book.title}
                  href={book.link}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex gap-4 border border-slate-200 rounded-xl p-4 hover:border-[#1A365D] hover:shadow-md transition-all duration-200 bg-white group"
                >
                  <div className="w-12 h-16 bg-slate-100 rounded-lg grid place-items-center text-2xl shrink-0 group-hover:scale-105 transition-transform">📚</div>
                  <div className="min-w-0 flex-1 flex flex-col justify-between">
                    <div>
                      <h4 className="font-semibold text-[#1A365D] leading-snug group-hover:text-blue-700 transition-colors">{book.title}</h4>
                      <p className="text-sm text-slate-500 mt-0.5">{book.author}</p>
                    </div>
                    <div>
                      <span className={`text-xs mt-2 inline-block px-2.5 py-1 rounded-md font-medium ${book.color}`}>
                        {ar ? book.tagAr : book.tagEn}
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </Card>
      );
    }

    // -----------------------------------------------------------------------
    case 'ai':
      return (
        <div className="bg-white rounded-xl border border-slate-200 flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-3 shrink-0">
            <div className="bg-[#1A365D] p-2 rounded-lg text-white">
              <Bot size={18} />
            </div>
            <div>
              <h3 className="font-bold text-[#1A365D] text-sm">
                {ar ? 'المستشار الأكاديمي الذكي' : 'AI Academic Advisor'}
              </h3>
              <p className="text-xs text-slate-500">
                {ar ? 'يرى سجلك الأكاديمي فقط' : 'Sees only your own academic record'}
              </p>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            className="flex-1 p-4 overflow-y-auto space-y-3 bg-slate-50"
            role="log"
            aria-live="polite"
            aria-busy={chatHistoryLoading || isChatLoading}
            aria-label={ar ? 'محادثة المستشار الذكي' : 'AI advisor conversation'}
          >
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-es-sm text-sm bg-white border border-slate-200 text-slate-700">
                {ar
                  ? `مرحباً ${currentUser.name}. يمكنني مساعدتك في اختيار مقررات الفصل القادم ومتابعة تقدمك الأكاديمي.`
                  : `Hello ${currentUser.name}. I can help you choose next semester's courses and track your academic progress.`}
              </div>
            </div>
            {chatHistoryLoading && (
              <p className="text-center text-xs text-slate-500" role="status">
                {ar ? 'جارٍ تحميل المحادثة السابقة…' : 'Loading previous conversation…'}
              </p>
            )}
            {chatLog.map((msg) => (
              <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                    msg.sender === 'user'
                      ? 'bg-[#1A365D] text-white rounded-ee-sm'
                      : 'bg-white border border-slate-200 text-slate-700 rounded-es-sm'
                  }`}
                >
                  {msg.sender === 'system' ? <Markdown text={msg.text} /> : msg.text}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex justify-start" role="status" aria-label={ar ? 'المستشار يكتب' : 'Advisor is typing'}>
                <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-es-sm flex gap-1.5">
                  {[0, 0.2, 0.4].map((d) => (
                    <span
                      key={d}
                      className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse"
                      style={{ animationDelay: `${d}s` }}
                      aria-hidden
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {chatError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 text-center shrink-0" role="alert">
              {chatError}
            </div>
          )}

          <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-200 flex w-full items-center gap-2 shrink-0">
            <input
              aria-label={ar ? 'رسالة إلى المستشار الذكي' : 'Message the AI advisor'}
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={ar ? 'اسأل عن مقررات الفصل القادم…' : 'Ask about next semester…'}
              className="h-11 min-h-11 flex-1 min-w-0 px-3.5 py-0 border border-slate-300 rounded-lg focus:outline-none focus:border-[#1A365D] focus:ring-2 focus:ring-[#1A365D]/15 text-sm"
              autoComplete="off"
              maxLength={2000}
              disabled={isChatLoading || chatHistoryLoading}
            />
            <button
              type="submit"
              disabled={isChatLoading || chatHistoryLoading || !chatInput.trim()}
              className="h-11 min-h-11 bg-[#1A365D] hover:bg-[#132845] disabled:opacity-40 text-white px-4 py-0 rounded-lg transition inline-flex items-center justify-center gap-2 shrink-0"
              aria-label={ar ? 'إرسال الرسالة' : 'Send message'}
            >
              <span className="hidden sm:inline text-sm font-medium">{ar ? 'إرسال' : 'Send'}</span>
              <Send size={16} className="rtl:-scale-x-100" />
            </button>
          </form>
        </div>
      );

    // -----------------------------------------------------------------------
    case 'messages':
      return <MessagesView currentUser={currentUser} language={language} />;

    default:
      return null;
  }
}
interface ChatEntry {
  id: string;
  sender: 'user' | 'system';
  text: string;
}
