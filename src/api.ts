import { ApiError } from './apiError';
import type {
  AdminStats,
  AdvisingReport,
  AdvisorNote,
  Contact,
  CurriculumOverview,
  Message,
  StaffMember,
  StudentDetail,
  StudentProfile,
  StudentSummary,
  StudyPlanRow,
  Transcript,
  UniversitySettings,
  User,
} from './data';

export { ApiError };

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' && error instanceof DOMException && error.name === 'AbortError')
  );
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, 'Unable to reach the application server.', 'NETWORK_ERROR');
  }

  const text = await response.text();
  let payload: unknown = null;
  let invalidJson = false;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      invalidJson = true;
      payload = { error: text };
    }
  }

  if (!response.ok) {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const retryValue = record.retryAfter ?? response.headers.get('Retry-After');
    const parsedRetry = typeof retryValue === 'number' || typeof retryValue === 'string'
      ? Number(retryValue)
      : Number.NaN;
    const retryAfter = Number.isFinite(parsedRetry) && parsedRetry > 0 && parsedRetry <= 86_400
      ? Math.ceil(parsedRetry)
      : undefined;
    const error = new ApiError(
      response.status,
      typeof record.error === 'string' ? record.error : `Request failed (${response.status}).`,
      typeof record.code === 'string' ? record.code : undefined,
      retryAfter,
    );
    if (response.status === 401 && !path.endsWith('/login') && !path.endsWith('/me')) {
      window.dispatchEvent(new CustomEvent('sas:auth-expired'));
    }
    throw error;
  }

  if (invalidJson || !text) {
    throw new ApiError(response.status, 'The server returned an invalid response.', 'INVALID_RESPONSE');
  }

  return payload as T;
}

const get = <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal });
const post = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>(path, { method: 'POST', body, signal });

const serverApi = {
  health: (signal?: AbortSignal) => get<{ ok: true; mode: 'server'; aiConfigured: boolean }>('/api/health', signal),
  me: (signal?: AbortSignal) => get<{ user: User }>('/api/me', signal),
  login: (identifier: string, password: string, signal?: AbortSignal) =>
    post<{ user: User }>('/api/login', { identifier, password }, signal),
  logout: (signal?: AbortSignal) => post<{ success: true }>('/api/logout', undefined, signal),

  profile: (studentId: string, signal?: AbortSignal) =>
    get<StudentProfile>(`/api/student/${encodeURIComponent(studentId)}/profile`, signal),
  advising: (studentId: string, signal?: AbortSignal) =>
    get<AdvisingReport>(`/api/student/${encodeURIComponent(studentId)}/advising`, signal),
  transcript: (studentId: string, signal?: AbortSignal) =>
    get<Transcript>(`/api/student/${encodeURIComponent(studentId)}/transcript`, signal),
  studyPlan: (studentId: string, signal?: AbortSignal) =>
    get<StudyPlanRow[]>(`/api/student/${encodeURIComponent(studentId)}/study-plan`, signal),

  students: (signal?: AbortSignal) => get<StudentSummary[]>('/api/admin/students', signal),
  advisors: (signal?: AbortSignal) => get<StaffMember[]>('/api/admin/advisors', signal),
  staff: (signal?: AbortSignal) => get<StaffMember[]>('/api/admin/staff', signal),
  stats: (signal?: AbortSignal) => get<AdminStats>('/api/admin/stats', signal),
  curriculum: (signal?: AbortSignal) => get<CurriculumOverview>('/api/admin/curriculum', signal),
  staffAdvising: (studentId: string, signal?: AbortSignal) =>
    get<AdvisingReport>(`/api/admin/student/${encodeURIComponent(studentId)}/advising`, signal),
  studentDetail: (studentId: string, signal?: AbortSignal) =>
    get<StudentDetail>(`/api/admin/student/${encodeURIComponent(studentId)}/detail`, signal),
  updateStudent: (
    payload: { id: string; major?: string; level?: string; advisor_id?: string },
    signal?: AbortSignal,
  ) => post<{ success: true }>('/api/admin/update-student', payload, signal),
  assignAdvisor: (studentId: string, advisorId: string, signal?: AbortSignal) =>
    post<{ success: true }>('/api/admin/assign-advisor', { student_id: studentId, advisor_id: advisorId }, signal),

  settings: (signal?: AbortSignal) => get<UniversitySettings>('/api/settings', signal),
  updateSettings: (settings: Partial<UniversitySettings>, signal?: AbortSignal) =>
    post<{ success: true }>('/api/admin/settings', settings, signal),

  notes: (studentId: string, signal?: AbortSignal) =>
    get<AdvisorNote[]>(`/api/advisor/notes/${encodeURIComponent(studentId)}`, signal),
  addNote: (studentId: string, content: string, signal?: AbortSignal) =>
    post<{ success: true }>('/api/advisor/notes', { student_id: studentId, content }, signal),
  deleteNote: (id: number, signal?: AbortSignal) =>
    post<{ success: true }>('/api/advisor/notes/delete', { id }, signal),

  contacts: (signal?: AbortSignal) => get<Contact[]>('/api/contacts', signal),
  messages: (withUser: string, signal?: AbortSignal) =>
    get<Message[]>(`/api/messages?with=${encodeURIComponent(withUser)}`, signal),
  unread: (signal?: AbortSignal) => get<{ sender_id: string; count: number }[]>('/api/messages/unread', signal),
  sendMessage: (receiverId: string, content: string, signal?: AbortSignal) =>
    post<{ success: true }>('/api/messages', { receiver_id: receiverId, content }, signal),
  markRead: (senderId: string, signal?: AbortSignal) =>
    post<{ success: true }>('/api/messages/read', { senderId }, signal),

  chat: (message: string, signal?: AbortSignal) =>
    post<{ reply: string; fallback: boolean }>('/api/chat', { message }, signal),
  chatHistory: (signal?: AbortSignal) => get<{ id: number; role: 'user' | 'assistant'; content: string; created_at: string }[]>('/api/chat/history', signal),
  clearChatHistory: (signal?: AbortSignal) =>
    request<{ success: true }>('/api/chat/history', { method: 'DELETE', signal }),
};

export async function initializeApi(signal?: AbortSignal): Promise<void> {
  await serverApi.health(signal);
}

/**
 * Production and development both use the authenticated backend. There is no
 * automatic mock fallback: a missing server is surfaced as NETWORK_ERROR.
 */
export const api = serverApi;
