import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Inbox } from 'lucide-react';
import { api, ApiError, isAbortError } from '../api';
import type { Contact, Message, User } from '../data';
import { formatDateTime } from '../utils';

interface MessagesViewProps {
  currentUser: User;
  language: 'ar' | 'en';
}

/**
 * The old version filtered the user directory to `role === 'Advisor'`, a role
 * that never existed, so a student's recipient list was always empty and the
 * "Message Advisor" tab could not send anything. Contacts now come from
 * /api/contacts, which resolves the real advisor relationship server-side.
 */
export default function MessagesView({ currentUser, language }: MessagesViewProps) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [contactsError, setContactsError] = useState('');
  const [conversationError, setConversationError] = useState('');
  const [contactsReload, setContactsReload] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedIdRef = useRef(selectedId);
  const messageRequestRef = useRef(0);
  const markingReadRef = useRef(new Set<string>());
  const sendAbortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  selectedIdRef.current = selectedId;

  const errorText = useCallback(
    (error: unknown, action: 'contacts' | 'messages' | 'send' | 'read') => {
      if (language === 'ar') {
        if (action === 'contacts') return 'تعذّر تحميل جهات الاتصال. تحقق من اتصال الخادم ثم حاول مرة أخرى.';
        if (action === 'send') return 'تعذّر إرسال الرسالة. بقي النص محفوظاً لتتمكن من المحاولة مرة أخرى.';
        if (action === 'read') return 'تعذّر تحديث حالة قراءة الرسائل.';
        return 'تعذّر تحميل المحادثة. حاول مرة أخرى.';
      }
      if (error instanceof ApiError && error.message) return error.message;
      if (action === 'contacts') return 'Could not load contacts. Check the server connection and try again.';
      if (action === 'send') return 'The message could not be sent. Your text was kept so you can try again.';
      if (action === 'read') return 'Could not update the message read status.';
      return 'Could not load this conversation. Please try again.';
    },
    [language],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sendAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setContactsError('');
    api
      .contacts(controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return;
        setContacts(rows);
        setSelectedId((current) =>
          current && rows.some((contact) => contact.id === current) ? current : rows[0]?.id || '',
        );
      })
      .catch((e: unknown) => {
        if (!isAbortError(e)) setContactsError(errorText(e, 'contacts'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [contactsReload, currentUser.id, errorText]);

  const loadMessages = useCallback(async (withId: string, signal?: AbortSignal) => {
    if (!withId) return false;
    const requestId = ++messageRequestRef.current;
    try {
      const rows = await api.messages(withId, signal);
      if (
        !mountedRef.current ||
        signal?.aborted ||
        requestId !== messageRequestRef.current ||
        selectedIdRef.current !== withId
      ) {
        return false;
      }
      setMessages(rows);
      setConversationError('');

      if (
        rows.some((message) => message.sender_id === withId && message.is_read === 0) &&
        !markingReadRef.current.has(withId)
      ) {
        markingReadRef.current.add(withId);
        api.markRead(withId, signal).catch((error: unknown) => {
          if (!isAbortError(error) && mountedRef.current && selectedIdRef.current === withId) {
            setConversationError(errorText(error, 'read'));
          }
        }).finally(() => {
          markingReadRef.current.delete(withId);
        });
      }
      return true;
    } catch (e: unknown) {
      if (
        !isAbortError(e) &&
        mountedRef.current &&
        requestId === messageRequestRef.current &&
        selectedIdRef.current === withId
      ) {
        setConversationError(errorText(e, 'messages'));
      }
      return false;
    }
  }, [errorText]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setConversationLoading(false);
      return;
    }
    const controller = new AbortController();
    setMessages([]);
    setConversationError('');
    setConversationLoading(true);
    let interval: ReturnType<typeof setInterval> | undefined;
    const stopPolling = () => {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
    };
    const refresh = () => {
      void loadMessages(selectedId, controller.signal).finally(() => {
        if (!controller.signal.aborted && selectedIdRef.current === selectedId) setConversationLoading(false);
      });
    };
    const startPolling = () => {
      stopPolling();
      if (document.visibilityState === 'hidden') return;
      refresh();
      interval = setInterval(refresh, 5000);
    };
    const handleVisibilityChange = () => startPolling();

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      messageRequestRef.current += 1;
      controller.abort();
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedId, loadMessages]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      container.scrollTo({ top: container.scrollHeight, behavior: reduceMotion ? 'auto' : 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || !selectedId || sendingRef.current) return;

    sendingRef.current = true;
    setSending(true);
    setConversationError('');
    const controller = new AbortController();
    sendAbortRef.current = controller;
    try {
      await api.sendMessage(selectedId, text, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      setInputText('');
      await loadMessages(selectedId, controller.signal);
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => inputRef.current?.focus());
      } else {
        inputRef.current?.focus();
      }
    } catch (e: unknown) {
      if (!isAbortError(e) && mountedRef.current) setConversationError(errorText(e, 'send'));
    } finally {
      if (sendAbortRef.current === controller) sendAbortRef.current = null;
      sendingRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  };

  const selected = contacts.find((c) => c.id === selectedId);

  if (loading) {
    return <p className="text-slate-500 text-center py-10" role="status">{language === 'ar' ? 'جارٍ التحميل…' : 'Loading…'}</p>;
  }

  if (contacts.length === 0) {
    if (contactsError) {
      return (
        <div className="bg-red-50 rounded-xl border border-red-200 p-8 text-center" role="alert">
          <p className="text-sm text-red-700">{contactsError}</p>
          <button
            type="button"
            onClick={() => setContactsReload((value) => value + 1)}
            className="mt-3 px-3 py-1.5 rounded-lg border border-red-300 text-sm font-semibold text-red-700 hover:bg-red-100 transition"
          >
            {language === 'ar' ? 'إعادة المحاولة' : 'Try again'}
          </button>
        </div>
      );
    }
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
        <Inbox className="mx-auto text-slate-300 mb-3" size={40} />
        <p className="text-slate-600 font-medium">
          {language === 'ar' ? 'لا يوجد مراسلون متاحون.' : 'No one to message yet.'}
        </p>
        <p className="text-sm text-slate-500 mt-1">
          {currentUser.role === 'Student'
            ? language === 'ar'
              ? 'لم يتم تعيين مرشد أكاديمي لحسابك بعد.'
              : 'No academic advisor has been assigned to your account yet.'
            : language === 'ar'
              ? 'لا يوجد طلاب مسندون إليك حالياً.'
              : 'No students are currently assigned to you.'}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
        <h3 className="font-bold text-[#1A365D]">{language === 'ar' ? 'المراسلات' : 'Messages'}</h3>

        {contacts.length === 1 ? (
          <span className="text-sm font-medium text-slate-700 bg-white px-3 py-1.5 rounded-lg border border-slate-200">
            {selected?.name}
          </span>
        ) : (
          <select
            className="border border-slate-300 rounded-lg px-3 py-1.5 bg-white text-sm focus:outline-none focus:border-[#1A365D] max-w-[60%]"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={sending}
            aria-label={language === 'ar' ? 'اختر المستلم' : 'Select recipient'}
          >
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {conversationError && (
        <div className="px-4 py-2 bg-red-50 text-red-700 text-sm border-b border-red-100 flex items-center justify-between gap-3" role="alert">
          <span>{conversationError}</span>
          <button
            type="button"
            onClick={() => void loadMessages(selectedId)}
            className="font-semibold underline underline-offset-2 shrink-0"
          >
            {language === 'ar' ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50"
        role="log"
        aria-live="polite"
        aria-busy={conversationLoading}
        aria-label={language === 'ar' ? 'سجل المحادثة' : 'Conversation history'}
      >
        {conversationLoading ? (
          <p className="text-center text-slate-500 text-sm mt-10" role="status">
            {language === 'ar' ? 'جارٍ تحميل المحادثة…' : 'Loading conversation…'}
          </p>
        ) : messages.length === 0 ? (
          <p className="text-center text-slate-500 text-sm mt-10">
            {language === 'ar' ? 'لا توجد رسائل بعد.' : 'No messages yet.'}
          </p>
        ) : (
          messages.map((msg) => {
            const mine = msg.sender_id === currentUser.id;
            return (
              <div key={msg.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm ${
                    mine
                      ? 'bg-[#1A365D] text-white rounded-ee-sm'
                      : 'bg-white border border-slate-200 text-slate-700 rounded-es-sm'
                  }`}
                >
                  {/* React escapes this, so message content cannot inject markup. */}
                  {msg.content}
                  <div className={`text-[10px] mt-1 ${mine ? 'text-blue-200' : 'text-slate-400'}`}>
                    {formatDateTime(msg.created_at, language)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSend} className="p-3 border-t border-slate-200 bg-white flex w-full items-center gap-2 shrink-0">
        <input
          ref={inputRef}
          aria-label={language === 'ar' ? 'نص الرسالة' : 'Message text'}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={language === 'ar' ? 'اكتب رسالة…' : 'Type a message…'}
          className="h-11 min-h-11 flex-1 min-w-0 px-3.5 py-0 border border-slate-300 rounded-lg focus:outline-none focus:border-[#1A365D] focus:ring-2 focus:ring-[#1A365D]/15 text-sm"
          autoComplete="off"
          maxLength={2000}
          disabled={sending}
        />
        <button
          type="submit"
          disabled={!inputText.trim() || sending}
          className="h-11 min-h-11 bg-[#1A365D] hover:bg-[#132845] disabled:opacity-40 text-white px-4 py-0 rounded-lg transition inline-flex items-center justify-center gap-2 shrink-0"
          aria-label={language === 'ar' ? 'إرسال الرسالة' : 'Send message'}
        >
          <span className="hidden sm:inline text-sm font-medium">{language === 'ar' ? 'إرسال' : 'Send'}</span>
          <Send size={16} className="rtl:-scale-x-100" />
        </button>
      </form>
    </div>
  );
}
