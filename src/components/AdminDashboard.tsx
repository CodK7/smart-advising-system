import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, RotateCcw, Send, Bot, CheckCircle2, TrendingUp } from 'lucide-react';
import MessagesView from './MessagesView';
import Markdown from './Markdown';
import PageInfo from './PageInfo';
import { api, ApiError, isAbortError } from '../api';
import { clampPercent, courseTitle, translateLevel, translateMajor } from '../utils';
import type { TabId } from './Dashboard';
import type { Book } from '../books';
import { isAdminRole, type AdminStats, type AdvisingReport, type Level, type StudyPlanRow, type StaffMember, type StudentSummary, type User } from '../data';

interface AdminDashboardProps {
  activeTab: TabId;
  language: 'ar' | 'en';
  currentUser: User;
}

interface ChatEntry {
  id: string;
  sender: 'user' | 'system';
  text: string;
}

// ---------------------------------------------------------------------------

const Card: React.FC<{ title?: string; children: React.ReactNode; className?: string }> = ({
  title,
  children,
  className = '',
}) => (
  <section className={`bg-white rounded-xl border border-slate-200 ${className}`}>
    {title && (
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 rounded-t-xl">
        <h3 className="font-bold text-[#1A365D] text-sm">{title}</h3>
      </div>
    )}
    <div className={title ? '' : 'p-5'}>{children}</div>
  </section>
);

export default function AdminDashboard({ activeTab, language, currentUser }: AdminDashboardProps) {
  const ar = language === 'ar';
  const isAdministrative = isAdminRole(currentUser.role);
  const canManageAcademicRecords = currentUser.role === 'System Admin' || currentUser.role === 'Registrar Admin';
  const canViewAdvisorRoster = isAdministrative;
  const canAssignAdvisor = canManageAcademicRecords;

  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [advisors, setAdvisors] = useState<StaffMember[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState('');
  const [selectedAdvising, setSelectedAdvising] = useState<AdvisingReport | null>(null);
  const [advisingLoading, setAdvisingLoading] = useState(false);
  const [advisingError, setAdvisingError] = useState('');
  const [studentDataReload, setStudentDataReload] = useState(0);

  const [editingStudent, setEditingStudent] = useState<StudentSummary | null>(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<ChatEntry[]>([]);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(true);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState('');
  const [bookMajor, setBookMajor] = useState('');
  const [books, setBooks] = useState<Book[] | null>(null);
  const [booksError, setBooksError] = useState('');
  const [booksReload, setBooksReload] = useState(0);
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
      .catch((historyError: unknown) => {
        if (isAbortError(historyError)) return;
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
    const container = chatScrollRef.current;
    if (!container) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [chatHistoryLoading, chatLog.length, isChatLoading]);

  const loadAll = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [s, advisorRows, nextStats] = await Promise.all([
        api.students(signal),
        canViewAdvisorRoster ? api.advisors(signal) : Promise.resolve<StaffMember[]>([]),
        isAdministrative ? api.stats(signal) : Promise.resolve<AdminStats | null>(null),
      ]);
      if (signal?.aborted || !chatMountedRef.current) return;
      setStudents(s);
      setAdvisors(advisorRows);
      setStats(nextStats);
      setSelectedId((current) =>
        current && s.some((student) => student.id === current) ? current : s[0]?.id || '',
      );
    } catch (loadError: unknown) {
      if (!isAbortError(loadError) && chatMountedRef.current) {
        setError(loadError instanceof ApiError ? loadError.message : String(loadError));
      }
    } finally {
      if (!signal?.aborted && chatMountedRef.current) setLoading(false);
    }
  }, [canViewAdvisorRoster, isAdministrative]);

  useEffect(() => {
    const controller = new AbortController();
    void loadAll(controller.signal);
    return () => controller.abort();
  }, [loadAll]);

  // Fetch the advising report for whichever student is selected.
  useEffect(() => {
    if (!selectedId || (activeTab !== 'schedule' && activeTab !== 'plan')) {
      setAdvisingLoading(false);
      return;
    }
    const controller = new AbortController();
    setSelectedAdvising(null);
    setAdvisingLoading(true);
    setAdvisingError('');
    api
      .staffAdvising(selectedId, controller.signal)
      .then((report) => {
        if (!controller.signal.aborted) setSelectedAdvising(report);
      })
      .catch((e: unknown) => {
        if (!isAbortError(e)) {
          setSelectedAdvising(null);
          setAdvisingError(
            ar ? 'تعذّر تحميل بيانات الإرشاد لهذا الطالب.' : e instanceof ApiError ? e.message : 'Could not load advising data for this student.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAdvisingLoading(false);
      });
    return () => controller.abort();
  }, [activeTab, ar, selectedId, studentDataReload]);

  const [studyPlan, setStudyPlan] = useState<StudyPlanRow[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');

  useEffect(() => {
    if (!selectedId || (activeTab !== 'schedule' && activeTab !== 'plan')) {
      setStudyPlan([]);
      setPlanLoading(false);
      return;
    }
    const controller = new AbortController();
    setStudyPlan([]);
    setPlanLoading(true);
    setPlanError('');
    api
      .studyPlan(selectedId, controller.signal)
      .then((rows) => {
        if (!controller.signal.aborted) setStudyPlan(rows);
      })
      .catch((e: unknown) => {
        if (!isAbortError(e)) {
          setStudyPlan([]);
          setPlanError(
            ar ? 'تعذّر تحميل الخطة الدراسية لهذا الطالب.' : e instanceof ApiError ? e.message : 'Could not load this study plan.',
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setPlanLoading(false);
      });
    return () => controller.abort();
  }, [activeTab, ar, selectedId, studentDataReload]);

  useEffect(() => {
    if (activeTab !== 'books' || books) return;
    let cancelled = false;
    setBooksError('');
    import('../books')
      .then(({ BOOKS }) => {
        if (!cancelled) setBooks(BOOKS);
      })
      .catch(() => {
        if (!cancelled) setBooksError(ar ? 'تعذّر تحميل قائمة المصادر.' : 'Could not load the resource list.');
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, ar, books, booksReload]);

  const handleChat = async (event: React.FormEvent) => {
    event.preventDefault();
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
    setChatLog((previous) => [...previous, { id: localId, sender: 'user', text: message }]);
    setChatInput('');
    setIsChatLoading(true);
    setChatError('');
    const controller = new AbortController();
    chatAbortRef.current = controller;
    try {
      const { reply } = await api.chat(message, controller.signal);
      if (!chatMountedRef.current || controller.signal.aborted) return;
      setChatLog((previous) => [
        ...previous,
        { id: `${localId}-reply`, sender: 'system', text: reply },
      ]);
    } catch (sendError: unknown) {
      if (isAbortError(sendError) || !chatMountedRef.current) return;
      setChatLog((previous) => previous.filter((entry) => entry.id !== localId));
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

  const saveStudent = async () => {
    if (!editingStudent) return;
    setSaveError('');
    setSaving(true);
    try {
      await api.updateStudent({
        id: editingStudent.id,
        major: editingStudent.major,
        level: editingStudent.level,
        advisor_id: canAssignAdvisor ? editingStudent.advisor_id ?? undefined : undefined,
      });
      if (!chatMountedRef.current) return;
      setEditingStudent(null);
      await loadAll(); // refresh in place instead of window.location.reload()
    } catch (e) {
      if (chatMountedRef.current) setSaveError(e instanceof ApiError ? e.message : String(e));
    } finally {
      if (chatMountedRef.current) setSaving(false);
    }
  };

  if (loading) return <p className="text-center text-slate-500 py-10" role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>;
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-6" role="alert">
        <p>{ar ? 'تعذّر تحميل بيانات لوحة التحكم. تحقق من اتصال الخادم ثم حاول مرة أخرى.' : error}</p>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="mt-3 px-3 py-1.5 rounded-lg border border-red-300 text-sm font-semibold hover:bg-red-100 transition"
        >
          {ar ? 'إعادة المحاولة' : 'Try again'}
        </button>
      </div>
    );
  }

  const selectedStudent = students.find((student) => student.id === selectedId);
  const studentPicker = (
    <label className="block w-full sm:w-64">
      <span className="mb-1 block text-xs font-medium text-slate-600">{ar ? 'الطالب' : 'Student'}</span>
      <select
        className="w-full border border-slate-300 rounded-lg px-3.5 py-2 bg-white text-sm font-medium text-[#1A365D] focus:outline-none focus:border-[#1A365D]"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        aria-label={ar ? 'اختر طالباً' : 'Select a student'}
      >
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.id})
          </option>
        ))}
      </select>
    </label>
  );

  switch (activeTab) {
    // -----------------------------------------------------------------------
    case 'overview':
      return (
        <div className="space-y-5">
          {saveError && !editingStudent && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
              {saveError}
            </div>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {[
              { label: ar ? 'الطلاب' : 'Students', value: stats?.totalStudents, tone: 'text-[#1A365D]' },
              { label: ar ? 'المرشدون' : 'Advisors', value: stats?.totalAdvisors, tone: 'text-[#1A365D]' },
              { label: ar ? 'المقررات' : 'Courses', value: stats?.totalCourses, tone: 'text-[#1A365D]' },
              {
                label: ar ? 'تحت الملاحظة' : 'On probation',
                value: stats?.atRiskStudents,
                tone: 'text-red-600',
              },
              { label: ar ? 'متوسط المعدل' : 'Average GPA', value: stats?.averageGpa, tone: 'text-emerald-600' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs text-slate-500 mb-1">{s.label}</p>
                <p className={`text-2xl font-bold ${s.tone}`}>{s.value ?? '—'}</p>
              </div>
            ))}
          </div>

          <Card title={ar ? 'قائمة الطلاب' : 'Students'}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 bg-slate-50">
                    <th className="px-4 py-3 text-start font-semibold whitespace-nowrap">{ar ? 'الرقم' : 'ID'}</th>
                    <th className="px-4 py-3 text-start font-semibold whitespace-nowrap">{ar ? 'الاسم' : 'Name'}</th>
                    <th className="px-4 py-3 text-start font-semibold whitespace-nowrap">{ar ? 'التخصص' : 'Major'}</th>
                    <th className="px-4 py-3 text-start font-semibold whitespace-nowrap">{ar ? 'المستوى' : 'Level'}</th>
                    <th className="px-4 py-3 text-start font-semibold whitespace-nowrap">{ar ? 'المرشد' : 'Advisor'}</th>
                    <th className="px-4 py-3 text-start font-semibold whitespace-nowrap">{ar ? 'المعدل' : 'GPA'}</th>
                    <th className="px-4 py-3 text-start font-semibold whitespace-nowrap" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {students.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        {ar ? 'لا يوجد طلاب ضمن نطاق صلاحيتك.' : 'No students are available within your scope.'}
                      </td>
                    </tr>
                  )}
                  {students.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap" dir="ltr">
                        {s.id}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-800">{s.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {translateMajor(s.major, language)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {translateLevel(s.level, language)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">{s.advisor_name ?? '—'}</td>
                      <td
                        className={`px-4 py-3 font-bold whitespace-nowrap ${
                          s.gpa < 2 ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        {s.gpa.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {canManageAcademicRecords ? (
                          <button
                            onClick={() => {
                              setSaveError('');
                              setEditingStudent({ ...s });
                            }}
                            className="text-blue-600 hover:text-blue-800 text-xs font-semibold"
                          >
                            {ar ? 'تعديل السجل الأكاديمي' : 'Edit academic record'}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">{ar ? 'عرض فقط' : 'View only'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {canViewAdvisorRoster && (
            <Card title={ar ? 'المرشدون الأكاديميون' : 'Academic Advisors'}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] table-fixed text-sm">
                  <colgroup>
                    <col className="w-28" />
                    <col className="w-[22%]" />
                    <col className="w-[28%]" />
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="text-xs text-slate-500 bg-slate-50">
                      <th className="px-4 py-3 text-start font-semibold">{ar ? 'الرقم' : 'ID'}</th>
                      <th className="px-4 py-3 text-start font-semibold">{ar ? 'الاسم' : 'Name'}</th>
                      <th className="px-4 py-3 text-start font-semibold">{ar ? 'البريد' : 'Email'}</th>
                      <th className="px-4 py-3 text-start font-semibold">{ar ? 'القسم' : 'Department'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {advisors.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                          {ar ? 'لا توجد حسابات مرشدين.' : 'No advisor accounts are available.'}
                        </td>
                      </tr>
                    )}
                    {advisors.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                          {t.id}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800 truncate">{t.name}</td>
                        <td className="px-4 py-3 text-blue-600 truncate" dir="ltr">
                          {t.email}
                        </td>
                        <td className="px-4 py-3 text-slate-600 break-words">{t.department}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {editingStudent && (
            <Modal
              title={ar ? 'تعديل بيانات الطالب' : 'Edit student'}
              closeLabel={ar ? 'إغلاق نافذة تعديل الطالب' : 'Close student editor'}
              onClose={() => {
                if (!saving) setEditingStudent(null);
              }}
            >
              {saveError && <p className="text-sm text-red-600 mb-3" role="alert">{saveError}</p>}
              <Field label={ar ? 'الاسم' : 'Name'}>
                <output className="input block bg-slate-50 text-slate-600">{editingStudent.name}</output>
                <span className="mt-1 block text-xs text-slate-500">
                  {ar ? 'الهوية الرسمية للطالب للعرض فقط.' : 'Official student identity is read-only.'}
                </span>
              </Field>
              <Field label={ar ? 'المعدل التراكمي' : 'GPA'}>
                <output className="input block bg-slate-50 text-slate-600" aria-live="off">
                  {editingStudent.gpa.toFixed(2)}
                </output>
                <span className="mt-1 block text-xs text-slate-500">
                  {ar
                    ? 'يُحسب المعدل تلقائياً من الدرجات المعتمدة في كشف الدرجات.'
                    : 'GPA is calculated automatically from approved transcript grades.'}
                </span>
              </Field>
              <Field label={ar ? 'التخصص' : 'Major'}>
                <select
                  className="input"
                  value={editingStudent.major}
                  onChange={(e) => setEditingStudent({ ...editingStudent, major: e.target.value })}
                >
                  {[
                    'Cyber and Information Security',
                    'Network Computing',
                    'Software Engineering',
                    'Data Science and Artificial Intelligence',
                    'Information Systems',
                  ].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={ar ? 'المستوى' : 'Level'}>
                <select
                  className="input"
                  value={editingStudent.level}
                  onChange={(e) => setEditingStudent({ ...editingStudent, level: e.target.value as Level })}
                >
                  {['Diploma First Year', 'Diploma Second Year', 'Advanced Diploma', 'BTech'].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              {canAssignAdvisor && (
                <Field label={ar ? 'المرشد الأكاديمي' : 'Academic advisor'}>
                  <select
                    className="input"
                    value={editingStudent.advisor_id ?? ''}
                    onChange={(e) => setEditingStudent({ ...editingStudent, advisor_id: e.target.value })}
                  >
                    <option value="" disabled>{ar ? 'اختر مرشداً' : 'Select an advisor'}</option>
                    {advisors.map((advisor) => (
                      <option key={advisor.id} value={advisor.id}>{advisor.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              <ModalActions
                onCancel={() => setEditingStudent(null)}
                onSave={saveStudent}
                cancelLabel={ar ? 'إلغاء' : 'Cancel'}
                saveLabel={ar ? 'حفظ' : 'Save'}
                saving={saving}
              />
            </Modal>
          )}
        </div>
      );

    // -----------------------------------------------------------------------
    case 'gpa':
      return (
        <Card title={ar ? 'المعدلات التراكمية والحالة الأكاديمية' : 'GPAs and academic standing'}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-500 bg-slate-50">
                  <th className="px-4 py-3 text-start font-semibold">{ar ? 'الرقم' : 'ID'}</th>
                  <th className="px-4 py-3 text-start font-semibold">{ar ? 'الاسم' : 'Name'}</th>
                  <th className="px-4 py-3 text-start font-semibold">{ar ? 'المستوى' : 'Level'}</th>
                  <th className="px-4 py-3 text-start font-semibold">{ar ? 'المعدل' : 'GPA'}</th>
                  <th className="px-4 py-3 text-start font-semibold">{ar ? 'الحالة' : 'Standing'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...students]
                  .sort((a, b) => a.gpa - b.gpa)
                  .map((s) => {
                    const probation = s.gpa < 2;
                    return (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                          {s.id}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{s.name}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {translateLevel(s.level, language)}
                        </td>
                        <td className={`px-4 py-3 font-bold ${probation ? 'text-red-600' : 'text-emerald-600'}`}>
                          {s.gpa.toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          {probation ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-800 text-xs font-semibold rounded-full">
                              <AlertTriangle size={11} /> {ar ? 'ملاحظة أكاديمية' : 'Probation'}
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full">
                              {ar ? 'منتظم' : 'Good standing'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      );

// -----------------------------------------------------------------------
    // Schedule view — weekly grid + recommendations only
    // -----------------------------------------------------------------------
    case 'schedule': {
      return (
        <div className="space-y-5">
          <PageInfo page="schedule" language={language} />
          <Card>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="font-bold text-[#1A365D]">
                {ar ? 'المقررات الحالية' : 'Current registration'}
              </h3>
              {studentPicker}
            </div>
          </Card>

          {advisingLoading || planLoading ? (
            <p className="text-center text-slate-500 py-8" role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
          ) : advisingError || planError || !selectedAdvising ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              <p>{advisingError || planError || (ar ? 'تعذّر تحميل بيانات الطالب.' : 'Could not load this student.')}</p>
              <button
                type="button"
                onClick={() => setStudentDataReload((value) => value + 1)}
                className="mt-2 font-semibold underline underline-offset-2"
              >
                {ar ? 'إعادة المحاولة' : 'Try again'}
              </button>
            </div>
          ) : (
            <>
              <ScheduleGrid courses={studyPlan.filter((row) => row.status === 'in_progress')} language={language} />

              <Card title={ar ? 'مقررات موصى بها للفصل القادم' : 'Recommended for next semester'}>
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {selectedAdvising.recommended.map((c) => (
                    <div key={c.code} className="border border-slate-200 rounded-lg p-3.5">
                      <div className="flex items-center gap-2">
                        {c.reason === 'retake' ? (
                          <RotateCcw size={14} className="text-amber-600 shrink-0" />
                        ) : (
                          <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                        )}
                        <span className="font-mono text-xs font-bold text-[#1A365D]" dir="ltr">
                          {c.code}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 mt-1.5 leading-snug">{courseTitle(c.code, c.title, language)}</p>
                    </div>
                  ))}
                </div>
              </Card>

            </>
          )}
        </div>
      );
    }

    // -----------------------------------------------------------------------
    // Study Plans — original 4-year degree roadmap layout
    // -----------------------------------------------------------------------
    case 'plan': {
      const byLevel = new Map<string, StudyPlanRow[]>();
      for (const row of studyPlan) {
        byLevel.set(row.level, [...(byLevel.get(row.level) ?? []), row]);
      }

      const totalCredits = selectedAdvising?.totalPlanCredits ?? 0;
      const pct = clampPercent(selectedAdvising?.progressPercent ?? 0);
      const planHeader = (
        <Card>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-bold text-[#1A365D]">{ar ? 'الخطة الدراسية' : 'Study plan'}</h3>
              <p className="text-sm text-slate-600 mt-0.5">
                {ar ? 'خطة الطالب: ' : 'Plan for: '}
                <span className="font-medium text-slate-800">{selectedStudent?.name ?? ''}</span>
                {selectedStudent && (
                  <>
                    {' · '}
                    <span className="font-mono text-xs" dir="ltr">{selectedStudent.id}</span>
                  </>
                )}
              </p>
              {selectedAdvising && (
                <p className="text-sm text-slate-500 mt-0.5">
                  {translateMajor(selectedAdvising.major, language)} · {translateLevel(selectedAdvising.level, language)}
                </p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              {selectedAdvising && (
                <div className="text-end">
                  <p className="text-2xl font-bold text-[#1A365D]">{pct}%</p>
                  <p className="text-xs text-slate-500">
                    {selectedAdvising.planCompletedCredits} / {totalCredits} {ar ? 'ساعة' : 'credits'}
                  </p>
                </div>
              )}
              {studentPicker}
            </div>
          </div>
          {selectedAdvising && (
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
          )}
        </Card>
      );

      if (advisingLoading || planLoading) {
        return (
          <div className="space-y-5">
            <PageInfo page="plan" language={language} />
            {planHeader}
            <p className="text-center text-slate-500 py-8" role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
          </div>
        );
      }

      if (advisingError || planError || !selectedAdvising) {
        return (
          <div className="space-y-5">
            <PageInfo page="plan" language={language} />
            {planHeader}
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              <p>{advisingError || planError || (ar ? 'تعذّر تحميل بيانات الطالب.' : 'Could not load this student.')}</p>
              <button
                type="button"
                onClick={() => setStudentDataReload((value) => value + 1)}
                className="mt-2 font-semibold underline underline-offset-2"
              >
                {ar ? 'إعادة المحاولة' : 'Try again'}
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-5">
          <PageInfo page="plan" language={language} />
          {isAdministrative && !selectedAdvising.planDataStatus.available && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
              {ar
                ? `بيانات المصدر الرسمية غير مكتملة للخطة الدراسية: ${selectedAdvising.planDataStatus.unavailableLevels.map((level) => translateLevel(level, language)).join('، ')}. لا يعرض النظام مقررات بديلة من تخصص آخر.`
                : `Official source data is unavailable or incomplete for: ${selectedAdvising.planDataStatus.unavailableLevels.map((level) => translateLevel(level, language)).join(', ')}. The system will not substitute courses from another major.`}
            </div>
          )}
          {planHeader}

          {planLoading ? (
            <p className="text-center text-slate-500 py-8">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>
          ) : (
            <>
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

              {studyPlan.length === 0 && !planLoading && (
                <p className="text-center text-slate-500 py-8">{ar ? 'لا توجد خطة دراسية متاحة.' : 'No study plan available.'}</p>
              )}
            </>
          )}
        </div>
      );
    }

    // -----------------------------------------------------------------------
    case 'books': {
      const majorOptions = [
        { value: '', labelAr: 'جميع التخصصات', labelEn: 'All Majors' },
        { value: 'Cyber and Information Security', labelAr: 'الأمن السيبراني وأمن المعلومات', labelEn: 'Cyber & Info Assurance' },
        { value: 'Network Computing', labelAr: 'حوسبة الشبكات', labelEn: 'Network Computing' },
        { value: 'Software Engineering', labelAr: 'هندسة البرمجيات', labelEn: 'Software Engineering' },
        { value: 'Data Science and Artificial Intelligence', labelAr: 'علم البيانات والذكاء الاصطناعي', labelEn: 'Data Science & AI' },
        { value: 'Information Systems', labelAr: 'نظم المعلومات', labelEn: 'Information Systems' },
      ];
      const recommended = bookMajor
        ? (books ?? []).filter((book) => book.majors.includes(bookMajor))
        : books ?? [];
      return (
        <Card title={ar ? 'مكتبة المصادر' : 'Resource library'}>
          <div className="p-5 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h4 className="font-bold text-[#1A365D] text-base">
                  {ar ? 'تصفح الكتب والمراجع' : 'Browse Recommended Resources'}
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  {ar ? 'المراجع العلمية والكتب المقترحة حسب التخصص الأكاديمي' : 'Recommended academic textbooks filtered by major'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-slate-500 shrink-0">
                  {ar ? 'التصفية حسب التخصص:' : 'Filter by major:'}
                </label>
                <select
                  className="w-full sm:w-auto border border-slate-300 rounded-lg px-3 py-2 bg-white text-sm font-medium text-[#1A365D] focus:outline-none focus:ring-2 focus:ring-[#1A365D]/20 focus:border-[#1A365D] shadow-sm transition"
                  value={bookMajor}
                  onChange={(e) => setBookMajor(e.target.value)}
                  aria-label={ar ? 'اختر تخصصاً لتصفية الكتب' : 'Select a major to filter books'}
                >
                  {majorOptions.map((m) => (
                    <option key={m.value || 'all'} value={m.value}>
                      {ar ? m.labelAr : m.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {bookMajor && (
              <div className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2 text-sm">
                <span className="text-slate-600">{ar ? 'موصى بها بناءً على التخصص:' : 'Recommended for:'}</span>
                <strong className="text-[#1A365D]">
                  {ar
                    ? majorOptions.find((major) => major.value === bookMajor)?.labelAr ?? bookMajor
                    : majorOptions.find((major) => major.value === bookMajor)?.labelEn ?? bookMajor}
                </strong>
              </div>
            )}

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
              <h3 className="font-bold text-[#1A365D] text-sm">{ar ? 'المستشار الذكي' : 'AI Advisor'}</h3>
              <p className="text-xs text-slate-500">
                {isAdministrative
                  ? ar
                    ? 'يشمل جميع الطلاب'
                    : 'Covers all students'
                  : ar
                    ? 'يقتصر على الطلاب المسندين إليك'
                    : 'Limited to your advisees'}
              </p>
            </div>
          </div>

          <div
            ref={chatScrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50"
            role="log"
            aria-live="polite"
            aria-busy={chatHistoryLoading || isChatLoading}
            aria-label={ar ? 'محادثة المستشار الذكي' : 'AI advisor conversation'}
          >
            <div className="flex justify-start">
              <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-es-sm text-sm bg-white border border-slate-200 text-slate-700">
                {ar
                  ? 'يمكنك الاستعلام عن بيانات الطلاب ضمن نطاق صلاحيتك.'
                  : 'Ask about the students within your remit.'}
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
                <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl flex gap-1.5">
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

          <form onSubmit={handleChat} className="p-3 border-t border-slate-200 flex w-full items-center gap-2 shrink-0">
            <input
              aria-label={ar ? 'رسالة إلى المستشار الذكي' : 'Message the AI advisor'}
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={ar ? 'اسأل عن أي طالب أو إحصائيات…' : 'Ask about a student or stats…'}
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
      return isAdministrative ? null : <MessagesView currentUser={currentUser} language={language} />;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block mb-4">
    <span className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</span>
    {children}
  </label>
);

const Modal: React.FC<{ title: string; closeLabel: string; onClose: () => void; children: React.ReactNode }> = ({
  title,
  closeLabel,
  onClose,
  children,
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    focusable?.[0]?.focus();

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== 'Tab' || !focusable?.length) return;
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
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-slate-900/50 grid place-items-center z-50 p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label={closeLabel}
      />
      <div
        ref={dialogRef}
        className="relative z-10 bg-white rounded-xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h3 id={titleId} className="text-lg font-bold text-[#1A365D] mb-5">{title}</h3>
        {children}
      </div>
    </div>
  );
};

const ModalActions: React.FC<{
  onCancel: () => void;
  onSave: () => void;
  cancelLabel: string;
  saveLabel: string;
  saving?: boolean;
}> = ({ onCancel, onSave, cancelLabel, saveLabel, saving = false }) => (
  <div className="flex justify-end gap-2 mt-6">
    <button type="button" onClick={onCancel} disabled={saving} className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition text-sm">
      {cancelLabel}
    </button>
    <button type="button" onClick={onSave} disabled={saving} className="px-4 py-2 bg-[#1A365D] text-white rounded-lg hover:bg-[#132845] disabled:bg-slate-400 transition text-sm font-semibold">
      {saving ? '…' : saveLabel}
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Current registration list
// ---------------------------------------------------------------------------

function ScheduleGrid({
  courses,
  language,
}: {
  courses: StudyPlanRow[];
  language: 'ar' | 'en';
}) {
  const ar = language === 'ar';

  return (
    <Card title={ar ? 'المقررات المسجّلة حالياً' : 'Current registered courses'}>
      {courses.length === 0 ? (
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
              {courses.map((course) => (
                <tr key={course.code} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 px-3 font-mono font-bold text-[#1A365D]" dir="ltr">{course.code}</td>
                  <td className="py-3 px-3 text-slate-700">{courseTitle(course.code, course.title, language)}</td>
                  <td className="py-3 px-3 text-slate-600">{course.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
