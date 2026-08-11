import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * A floating "what is this page?" helper.
 *
 * The trigger is deliberately minimalist: a thin pencil-sketch circle outline
 * with an "!" inside and a transparent centre — no solid fill, no heavy shadow —
 * so it sits quietly in the corner and never competes with the page content.
 * Clicking it opens a modal that explains the view and how it differs from the
 * related ones. Used by every role (student, advisor, admin) on the Schedule,
 * Study Plan and Suggested Courses surfaces.
 */

type Page = 'schedule' | 'plan' | 'suggested';

interface Section {
  title: string;
  body: string[];
  diffTitle: string;
  diff: string;
}

const content: Record<Page, { ar: Section; en: Section }> = {
  schedule: {
    ar: {
      title: 'ما هو «الجدول الدراسي»؟',
      body: [
        'يعرض هذا القسم مقررات الفصل الحالي المسجّلة كما هي في بيانات النظام.',
        'لا يتضمّن مصدر البيانات مواعيد أو قاعات رسمية؛ لذلك لا ينشئ النظام أياماً أو أوقاتاً أو قاعات غير معتمدة.',
      ],
      diffTitle: 'الفرق عن «الخطة الدراسية»',
      diff: 'الجدول الدراسي يخصّ الفصل الحالي فقط، بينما الخطة الدراسية تعرض خارطة الطريق الكاملة للتخصص عبر جميع السنوات الدراسية.',
    },
    en: {
      title: 'What is “Class Schedule”?',
      body: [
        'This view lists the current semester’s enrolled courses from the system data.',
        'The source data contains no official meeting times or rooms, so the system does not invent days, times, or room assignments.',
      ],
      diffTitle: 'How it differs from “Study Plan”',
      diff: 'The Class Schedule is only the current term, whereas the Study Plan is the full multi-year roadmap for the whole degree.',
    },
  },
  plan: {
    ar: {
      title: 'ما هي «الخطة الدراسية»؟',
      body: [
        'تعرض الخطة الدراسية خارطة الطريق الكاملة للدرجة العلمية موزّعة على المستويات: دبلوم السنة الأولى، ودبلوم السنة الثانية، والدبلوم المتقدم، والبكالوريوس التقني.',
        'تُميّز المقررات المكتملة بعلامة صح (✔)، والمقررات الجارية، والمقررات المحجوبة بمتطلباتها السابقة، مع عرض نسبة الساعات المعتمدة المنجزة من إجمالي ساعات الخطة.',
      ],
      diffTitle: 'الفرق عن «الجدول الدراسي»',
      diff: 'الخطة الدراسية تشمل كامل سنوات الدراسة من الدبلوم حتى البكالوريوس التقني ومتطلبات كل مقرر، بينما الجدول الدراسي يقتصر على مواعيد مقررات الفصل الحالي فقط.',
    },
    en: {
      title: 'What is “Study Plan”?',
      body: [
        'The Study Plan is the complete degree roadmap, organised by level: Diploma Year 1, Diploma Year 2, Advanced Diploma, and BTech.',
        'It marks completed courses with a check (✔), courses in progress, and courses locked behind prerequisites, alongside the share of credit hours completed out of the plan total.',
      ],
      diffTitle: 'How it differs from “Class Schedule”',
      diff: 'The Study Plan spans the entire degree from Diploma to BTech and each course’s prerequisites, whereas the Class Schedule is only the current term’s registered courses.',
    },
  },
  suggested: {
    ar: {
      title: 'كيف تُحسب «المقررات المقترحة»؟',
      body: [
        'تُختار المقررات المقترحة للفصل القادم تلقائياً بناءً على خطتك الدراسية وسجلك الأكاديمي: تُعرَض المقررات التي أكملتَ جميع متطلباتها السابقة ولم تدرسها بعد.',
        'تُقدَّم المقررات التي تحتاج إلى إعادة (بسبب الرسوب) أولاً، ثم تُملأ بقية التوصيات حتى الحد الأقصى المسموح من الساعات المعتمدة لهذا الفصل — ويُخفَّض هذا الحد تلقائياً عند وجود إنذار أكاديمي.',
      ],
      diffTitle: 'المقررات المحجوبة',
      diff: 'المقررات التي لم تُستوفَ متطلباتها السابقة تظهر ضمن «غير متاحة بعد» مع بيان المتطلب الناقص، ولا تُدرَج في التوصيات حتى تُكملها.',
    },
    en: {
      title: 'How are “Recommended courses” chosen?',
      body: [
        'Next-semester recommendations are computed automatically from your study plan and record: courses whose prerequisites you have all completed, and which you have not taken yet.',
        'Courses that need repeating (after a fail) come first, then the rest fill up to the credit-hour cap for the term — which is lowered automatically while you are on academic probation.',
      ],
      diffTitle: 'Blocked courses',
      diff: 'Courses whose prerequisites are unmet appear under “Not yet available” with the missing requirement shown, and are excluded from recommendations until you complete them.',
    },
  },
};

export default function PageInfo({ page, language }: { page: Page; language: 'ar' | 'en' }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const c = content[page][language];
  const ar = language === 'ar';

  useEffect(() => {
    if (!open) return;
    const returnFocus = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusable()[0]?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label={ar ? 'ما هذه الصفحة؟' : 'What is this page?'}
        title={ar ? 'ما هذه الصفحة؟' : 'What is this page?'}
        // Sized to sit alongside the 15px lock icon used in prerequisite
        // warnings: a small ~18px outlined circle, transparent centre, thin
        // border — deliberately minimal, not a heavy floating action button.
// Nudged down (bottom-4) and inward off the corner (end-10) so it sits on the layout margin rather than jammed against the very corner.
        // layout it anchors to the LEFT edge, so raising it moves the icon
        // rightwards; in English it stays mirrored on the right.
        className="fixed bottom-4 end-10 z-40 w-[18px] h-[18px] rounded-full grid place-items-center
          bg-transparent border border-slate-400/80 text-slate-500
          hover:border-[#1A365D] hover:text-[#1A365D] focus:outline-none focus:ring-2 focus:ring-slate-300
          transition-colors"
      >
        {/* Thin outline + transparent centre; the exclamation is the whole mark. */}
        <span className="text-[11px] font-bold leading-none select-none" aria-hidden>
          !
        </span>
      </button>

      {open && (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label={c.title}
        >
          <button
            type="button"
            tabIndex={-1}
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setOpen(false)}
            aria-label={ar ? 'إغلاق نافذة المساعدة' : 'Close help dialog'}
          />

          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            <div className="flex items-start gap-3 p-5 border-b border-slate-100">
              <span className="w-9 h-9 rounded-full border border-[#1A365D]/40 text-[#1A365D] grid place-items-center shrink-0 font-bold">
                !
              </span>
              <h3 className="font-bold text-[#1A365D] text-base leading-snug flex-1 mt-1">{c.title}</h3>
              <button
                onClick={() => setOpen(false)}
                aria-label={ar ? 'إغلاق' : 'Close'}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-3 text-sm text-slate-700 leading-relaxed">
              {c.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}

              <div className="mt-2 rounded-lg bg-slate-50 border border-slate-200 p-3.5">
                <p className="font-semibold text-[#1A365D] text-xs mb-1">{c.diffTitle}</p>
                <p className="text-slate-600">{c.diff}</p>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm font-semibold bg-[#1A365D] text-white rounded-lg hover:bg-[#132845] transition"
              >
                {ar ? 'حسناً، فهمت' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
