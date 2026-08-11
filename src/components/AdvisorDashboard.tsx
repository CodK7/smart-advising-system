import type { ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, isAbortError } from '../api';
import { formatDateTime, translateLevel, translateMajor } from '../utils';
import type { AdvisorNote, StudentDetail, StudentSummary, User } from '../data';

/**
 * The academic advisor's control surface.
 *
 * Scope is decided by the SERVER: `api.students()`
 * returns only the caller's advisees when the caller is an Advisor. This
 * component therefore never filters by advisor id itself — doing so client-side
 * would imply the full roster had been sent to the browser in the first place.
 */

const AT_RISK_GPA = 2.0;

interface Props {
  language: 'ar' | 'en';
  currentUser: User;
}

const copy = {
  en: {
    assigned: 'Assigned Students',
    atRisk: 'At Risk',
    good: 'Good Standing',
    atRiskSub: 'GPA below 2.0',
    goodSub: 'GPA 2.0 and above',
    name: 'Student',
    id: 'ID',
    major: 'Major',
    level: 'Level',
    gpa: 'GPA',
    email: 'Email',
    status: 'Status',
    actions: '',
    view: 'View',
    none: 'No students are assigned to you.',
    loading: 'Loading…',
    statusAtRisk: 'At Risk',
    statusGood: 'Regular',
    profile: 'Academic Profile',
    completed: 'Completed',
    remaining: 'Remaining',
    recommendations: 'Recommended next semester',
    blocked: 'Blocked by prerequisites',
    notes: 'Advisor Notes',
    notePlaceholder: 'Record a counselling note for this student…',
    save: 'Save note',
    saving: 'Saving…',
    noNotes: 'No notes recorded yet.',
    close: 'Close',
    credits: 'credits',
    creditCap: 'Credit cap',
    nextTerm: 'Next term',
    of: 'of',
  },
  ar: {
    assigned: 'الطلبة المسندون',
    atRisk: 'الطلبة المتعثرون',
    good: 'الوضع الأكاديمي جيد',
    atRiskSub: 'المعدل أقل من 2.0',
    goodSub: 'المعدل 2.0 فأعلى',
    name: 'الطالب',
    id: 'الرقم',
    major: 'التخصص',
    level: 'المستوى',
    gpa: 'المعدل',
    email: 'البريد الإلكتروني',
    status: 'الحالة',
    actions: '',
    view: 'عرض',
    none: 'لا يوجد طلبة مسندون إليك.',
    loading: 'جارٍ التحميل…',
    statusAtRisk: 'متعثر',
    statusGood: 'منتظم',
    profile: 'الملف الأكاديمي',
    completed: 'مكتملة',
    remaining: 'متبقية',
    recommendations: 'المقررات المقترحة للفصل القادم',
    blocked: 'محجوبة بسبب المتطلبات السابقة',
    notes: 'ملاحظات المرشد',
    notePlaceholder: 'سجّل ملاحظة إرشادية لهذا الطالب…',
    save: 'حفظ الملاحظة',
    saving: 'جارٍ الحفظ…',
    noNotes: 'لا توجد ملاحظات مسجلة.',
    close: 'إغلاق',
    credits: 'ساعة',
    creditCap: 'الحد الأقصى للساعات',
    nextTerm: 'الفصل القادم',
    of: 'من',
  },
} as const;

export default function AdvisorDashboard({ language, currentUser }: Props) {
  const t = copy[language];
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [openStudent, setOpenStudent] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api
      .students(controller.signal)
      .then((rows) => {
        if (!cancelled) setStudents(rows);
      })
      .catch((err) => {
        if (!cancelled && !isAbortError(err)) setError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [currentUser.id, reload]);

  const atRisk = students.filter((s) => s.gpa < AT_RISK_GPA).length;
  const good = students.length - atRisk;

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        {currentUser.department} · {currentUser.email}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          icon={<Users size={18} />}
          label={t.assigned}
          value={students.length}
          tone="brand"
        />
        <MetricCard
          icon={<AlertTriangle size={18} />}
          label={t.atRisk}
          sub={t.atRiskSub}
          value={atRisk}
          tone="danger"
        />
        <MetricCard
          icon={<CheckCircle2 size={18} />}
          label={t.good}
          sub={t.goodSub}
          value={good}
          tone="success"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <p className="p-8 text-center text-sm text-slate-500" role="status">{t.loading}</p>
        ) : error ? (
          <div className="p-8 text-center text-sm text-red-600" role="alert">
            <p>{language === 'ar' ? 'تعذّر تحميل قائمة الطلبة المسندين. تحقق من اتصال الخادم.' : error}</p>
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
              className="mt-3 font-semibold underline underline-offset-2"
            >
              {language === 'ar' ? 'إعادة المحاولة' : 'Try again'}
            </button>
          </div>
        ) : students.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">
            {t.none}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[11px] uppercase tracking-wide">
                  <th className="text-start font-semibold px-3 py-2">{t.name}</th>
                  <th className="text-start font-semibold px-3 py-2 hidden sm:table-cell">{t.id}</th>
                  <th className="text-start font-semibold px-3 py-2 hidden md:table-cell">{t.major}</th>
                  <th className="text-start font-semibold px-3 py-2 hidden lg:table-cell">{t.level}</th>
                  <th className="text-start font-semibold px-3 py-2">{t.gpa}</th>
                  <th className="text-start font-semibold px-3 py-2">{t.status}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((s) => {
                  const risk = s.gpa < AT_RISK_GPA;
                  return (
                    <tr
                      key={s.id}
                      className="hover:bg-slate-50/70 transition"
                    >
                      <td className="px-3 py-2.5 font-medium text-slate-800">
                        <span className="block truncate max-w-[180px]">{s.name}</span>
                        <span className="sm:hidden text-[11px] text-slate-400 font-mono">{s.id}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500 hidden sm:table-cell">
                        {s.id}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 hidden md:table-cell">
                        <span className="block truncate max-w-[200px]">
                          {translateMajor(s.major, language)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 hidden lg:table-cell whitespace-nowrap">
                        {translateLevel(s.level, language)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`font-bold tabular-nums ${risk ? 'text-red-600' : 'text-emerald-600'}`}
                        >
                          {s.gpa.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={risk ? 'danger' : 'success'}>
                          {risk ? t.statusAtRisk : t.statusGood}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-end">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenStudent(s.id);
                          }}
                          className="text-xs font-semibold text-[#1A365D] hover:underline whitespace-nowrap"
                        >
                          {t.view}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openStudent && (
        <StudentDrawer
          studentId={openStudent}
          language={language}
          onClose={() => setOpenStudent(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MetricCard({
  icon,
  label,
  sub,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  value: number;
  tone: 'brand' | 'danger' | 'success';
}) {
  const tones = {
    brand: 'text-[#1A365D] bg-[#1A365D]/10',
    danger: 'text-red-600 bg-red-50',
    success: 'text-emerald-600 bg-emerald-50',
  } as const;
  const values = {
    brand: 'text-[#1A365D]',
    danger: 'text-red-600',
    success: 'text-emerald-600',
  } as const;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
      <span className={`w-10 h-10 rounded-lg grid place-items-center shrink-0 ${tones[tone]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-500 truncate">{label}</p>
        {sub && <p className="text-[10px] text-slate-400 truncate">{sub}</p>}
      </div>
      <p className={`ms-auto text-2xl font-bold tabular-nums ${values[tone]}`}>{value}</p>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'danger' | 'success'; children: ReactNode }) {
  const cls =
    tone === 'danger'
      ? 'bg-red-50 text-red-700 border-red-200'
      : 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${cls}`}
    >
      {children}
    </span>
  );
}

/**
 * The per-student drawer.
 *
 * Detail and notes are fetched separately: notes change while the drawer is
 * open (the advisor writes them), the academic record does not, so re-fetching
 * one must not re-fetch the other.
 */
function StudentDrawer({
  studentId,
  language,
  onClose,
}: {
  studentId: string;
  language: 'ar' | 'en';
  onClose: () => void;
}) {
  const t = copy[language];
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [notes, setNotes] = useState<AdvisorNote[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailReload, setDetailReload] = useState(0);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState('');
  const [actionError, setActionError] = useState('');
  const dialogTitleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const mutationAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      mutationAbortRef.current?.abort();
    };
  }, []);

  const loadNotes = useCallback(async (signal?: AbortSignal, showLoading = true) => {
    if (showLoading) setNotesLoading(true);
    setNotesError('');
    try {
      const rows = await api.notes(studentId, signal);
      if (!signal?.aborted && mountedRef.current) setNotes(rows as AdvisorNote[]);
    } catch (notesLoadError: unknown) {
      if (!isAbortError(notesLoadError) && mountedRef.current) {
        setNotesError(
          language === 'ar'
            ? 'تعذّر تحميل ملاحظات الإرشاد.'
            : notesLoadError instanceof ApiError
              ? notesLoadError.message
              : 'Could not load advisor notes.',
        );
      }
    } finally {
      if (!signal?.aborted && mountedRef.current) setNotesLoading(false);
    }
  }, [language, studentId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setDetail(null);
    api
      .studentDetail(studentId, controller.signal)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled && !isAbortError(err)) setError(err instanceof ApiError ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [detailReload, studentId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadNotes(controller.signal);
    return () => controller.abort();
  }, [loadNotes]);

  // Escape closes the drawer — a drawer that can only be dismissed by hitting a
  // small × is a common accessibility complaint.
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
      }
      if (e.key !== 'Tab') return;
      const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  const submit = async () => {
    const content = draft.trim();
    if (!content || saving || deletingNoteId !== null) return;
    setActionError('');
    setSaving(true);
    const controller = new AbortController();
    mutationAbortRef.current = controller;
    try {
      await api.addNote(studentId, content, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      setDraft('');
      await loadNotes(controller.signal, false);
    } catch (noteError: unknown) {
      if (!isAbortError(noteError) && mountedRef.current) {
        setActionError(
          language === 'ar'
            ? 'تعذّر حفظ الملاحظة. بقي النص محفوظاً لتتمكن من المحاولة مرة أخرى.'
            : noteError instanceof ApiError
              ? noteError.message
              : 'Could not save this note. Your draft was kept.',
        );
      }
    } finally {
      if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
      if (mountedRef.current) setSaving(false);
    }
  };

  const removeNote = async (id: number) => {
    if (saving || deletingNoteId !== null) return;
    const confirmed = window.confirm(
      language === 'ar' ? 'هل تريد حذف هذه الملاحظة؟ لا يمكن التراجع عن هذا الإجراء.' : 'Delete this note? This cannot be undone.',
    );
    if (!confirmed) return;
    setActionError('');
    setDeletingNoteId(id);
    const controller = new AbortController();
    mutationAbortRef.current = controller;
    try {
      await api.deleteNote(id, controller.signal);
      if (!controller.signal.aborted && mountedRef.current) {
        setNotes((current) => current.filter((note) => note.id !== id));
      }
    } catch (deleteError: unknown) {
      if (!isAbortError(deleteError) && mountedRef.current) {
        setActionError(
          language === 'ar'
            ? 'تعذّر حذف الملاحظة. حاول مرة أخرى.'
            : deleteError instanceof ApiError
              ? deleteError.message
              : 'Could not delete this note. Please try again.',
        );
      }
    } finally {
      if (mutationAbortRef.current === controller) mutationAbortRef.current = null;
      if (mountedRef.current) setDeletingNoteId(null);
    }
  };

  const plan = detail?.studyPlan ?? [];
  const completed = plan.filter((r) => r.status === 'completed');
  const remaining = plan.filter((r) => r.status !== 'completed');

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>
      <button type="button" className="flex-1 bg-slate-900/40 cursor-default" onClick={onClose} aria-label={t.close} />
      <aside ref={drawerRef} className="w-full max-w-xl bg-slate-50 h-full overflow-y-auto shadow-xl">
        <header className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-3 z-10">
          <div className="min-w-0 flex-1">
            <h2 id={dialogTitleId} className="font-bold text-[#1A365D] truncate">
              {detail?.profile.name ?? t.loading}
            </h2>
            <p className="text-xs text-slate-500 font-mono">{studentId}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </header>

        <div className="p-5 space-y-5">
          {loading ? (
            <p className="text-sm text-slate-500 flex items-center gap-2" role="status">
              <Loader2 size={14} className="animate-spin" /> {t.loading}
            </p>
          ) : error ? (
            <div className="text-sm text-red-600" role="alert">
              <p>{language === 'ar' ? 'تعذّر تحميل الملف الأكاديمي لهذا الطالب.' : error}</p>
              <button
                type="button"
                onClick={() => setDetailReload((value) => value + 1)}
                className="mt-2 font-semibold underline underline-offset-2"
              >
                {language === 'ar' ? 'إعادة المحاولة' : 'Try again'}
              </button>
            </div>
          ) : detail ? (
            <>
              <section className="bg-white rounded-xl border border-slate-200 p-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <Field label={t.major} value={translateMajor(detail.profile.major, language)} />
                  <Field label={t.level} value={translateLevel(detail.profile.level, language)} />
                  <Field
                    label={t.gpa}
                    value={detail.profile.gpa.toFixed(2)}
                    tone={detail.profile.gpa < AT_RISK_GPA ? 'danger' : 'success'}
                  />
                  <Field label={t.email} value={detail.profile.email} mono />
                </dl>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-500">{t.completed}</p>
                  <p className="text-2xl font-bold text-emerald-600 tabular-nums">
                    {completed.length}
                    <span className="text-sm text-slate-400 font-normal">
                      {' '}
                      {t.of} {plan.length}
                    </span>
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-xs font-semibold text-slate-500">{t.remaining}</p>
                  <p className="text-2xl font-bold text-[#1A365D] tabular-nums">{remaining.length}</p>
                </div>
              </section>

              {detail.advising && (
                <section className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-[#1A365D]">{t.recommendations}</h3>
                    <span className="text-[11px] text-slate-500">
                      {t.nextTerm}: {detail.advising.nextTerm} · {t.creditCap}:{' '}
                      {detail.advising.creditCap}
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {detail.advising.recommended.map((c) => (
                      <li
                        key={c.code}
                        className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2"
                      >
                        <span className="font-mono text-xs text-[#1A365D] shrink-0">{c.code}</span>
                        <span className="text-slate-700 truncate flex-1">{c.title}</span>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {c.credits} {t.credits}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {detail.advising.blocked.length > 0 && (
                    <>
                      <h4 className="text-xs font-bold text-amber-700 mt-4 mb-2">{t.blocked}</h4>
                      <ul className="space-y-1">
                        {detail.advising.blocked.slice(0, 6).map((c) => (
                          <li key={c.code} className="text-xs text-slate-600">
                            <span className="font-mono text-slate-500">{c.code}</span> —{' '}
                            <span className="text-amber-700">{c.blockedBy.join(', ')}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}

              <section className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-[#1A365D] flex items-center gap-2 mb-3">
                  <ClipboardList size={15} /> {t.notes}
                </h3>
                {actionError && (
                  <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700" role="alert">
                    {actionError}
                  </p>
                )}
                <textarea
                  aria-label={t.notePlaceholder}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t.notePlaceholder}
                  rows={3}
                  maxLength={2000}
                  disabled={saving}
                  className="w-full text-sm border border-slate-200 rounded-lg p-2.5 resize-y focus:outline-none focus:border-[#1A365D] focus:ring-2 focus:ring-[#1A365D]/10"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={saving || deletingNoteId !== null || !draft.trim()}
                  className="mt-2 px-3 py-1.5 text-sm font-semibold bg-[#1A365D] text-white rounded-lg disabled:bg-slate-300 hover:bg-[#132845] transition"
                >
                  {saving ? t.saving : t.save}
                </button>

                {notesError && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700" role="alert">
                    <p>{notesError}</p>
                    <button
                      type="button"
                      onClick={() => void loadNotes()}
                      className="mt-1 font-semibold underline underline-offset-2"
                    >
                      {language === 'ar' ? 'إعادة المحاولة' : 'Try again'}
                    </button>
                  </div>
                )}
                <ul className="mt-4 space-y-2" aria-busy={notesLoading}>
                  {notesLoading ? (
                    <li className="text-xs text-slate-400" role="status">{t.loading}</li>
                  ) : notes.length === 0 && !notesError ? (
                    <li className="text-xs text-slate-400">{t.noNotes}</li>
                  ) : null}
                  {notes.map((n) => (
                    <li key={n.id} className="bg-slate-50 rounded-lg p-3 text-sm">
                      <div className="flex items-start gap-2">
                        <p className="flex-1 text-slate-700 whitespace-pre-wrap break-words">
                          {n.content}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeNote(n.id)}
                          disabled={saving || deletingNoteId !== null}
                          className="text-slate-300 hover:text-red-500 shrink-0"
                          aria-label={language === 'ar' ? 'حذف الملاحظة' : 'Delete note'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        {n.advisor_name} · {formatDateTime(n.created_at, language)}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: 'danger' | 'success';
}) {
  const color =
    tone === 'danger' ? 'text-red-600' : tone === 'success' ? 'text-emerald-600' : 'text-slate-800';
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">{label}</dt>
      <dd className={`font-semibold truncate ${mono ? 'font-mono text-xs' : ''} ${color}`}>
        {value}
      </dd>
    </div>
  );
}
