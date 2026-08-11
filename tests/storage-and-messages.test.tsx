import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { api } from '../src/api';
import { ApiError } from '../src/apiError';
import MessagesView from '../src/components/MessagesView';
import type { User } from '../src/data';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      me: vi.fn(),
      contacts: vi.fn(),
      messages: vi.fn(),
      markRead: vi.fn(),
      sendMessage: vi.fn(),
    },
  };
});

const student: User = {
  id: 'S26s3216',
  name: 'Azaa Hamed',
  email: '26s3216@utas.edu.om',
  department: 'Information Technology',
  role: 'Student',
};

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
  vi.useRealTimers();
});

describe('safe browser state and message rendering', () => {
  beforeEach(() => {
    vi.mocked(api.me).mockReset();
    vi.mocked(api.contacts).mockReset();
    vi.mocked(api.messages).mockReset();
    vi.mocked(api.markRead).mockReset();
  });

  it('recovers from an invalid cached language without restoring identity', async () => {
    localStorage.setItem('sas_language', '{not-json');
    localStorage.setItem('currentUser', JSON.stringify({ role: 'System Admin', id: 'attacker' }));
    vi.mocked(api.me).mockRejectedValue(new ApiError(401, 'Authentication required.', 'AUTH_REQUIRED'));
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('attacker')).not.toBeInTheDocument();
    expect(localStorage.getItem('currentUser')).toBeNull();
  });

  it('renders untrusted message text without creating executable markup', async () => {
    vi.mocked(api.contacts).mockResolvedValue([{ id: '82e29746', name: 'Maha Alazri', email: '82e29746@utas.edu.om', department: 'IT', role: 'Advisor' }]);
    vi.mocked(api.messages).mockResolvedValue([{
      id: 1,
      sender_id: '82e29746',
      receiver_id: student.id,
      content: '<img src=x onerror=alert(1)>',
      created_at: '2026-01-01 10:00:00',
      is_read: 0,
    }]);
    vi.mocked(api.markRead).mockResolvedValue({ success: true });
    render(<MessagesView currentUser={student} language="en" />);
    await waitFor(() => expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument());
    expect(document.querySelector('img')).toBeNull();
  });

  it('distinguishes a server outage from a signed-out session and retries explicitly', async () => {
    vi.mocked(api.me)
      .mockRejectedValueOnce(new ApiError(0, 'Unable to reach the application server.', 'NETWORK_ERROR'))
      .mockRejectedValueOnce(new ApiError(401, 'Authentication required.', 'AUTH_REQUIRED'));

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'The server is currently unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(api.me).toHaveBeenCalledTimes(2);
  });

  it('ignores an older conversation response after the recipient changes', async () => {
    type MessageRows = Awaited<ReturnType<typeof api.messages>>;
    let resolveFirst: (rows: MessageRows) => void = () => {};
    let resolveSecond: (rows: MessageRows) => void = () => {};
    const first = new Promise<MessageRows>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<MessageRows>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(api.contacts).mockResolvedValue([
      { id: '82e29746', name: 'Maha Alazri', email: '82e29746@utas.edu.om', department: 'IT', role: 'Advisor' },
      { id: '82e29747', name: 'Mohamed Al-Balushi', email: '82e29747@utas.edu.om', department: 'IT', role: 'Advisor' },
    ]);
    vi.mocked(api.messages).mockImplementation((withUser) =>
      withUser === '82e29746' ? first : second,
    );

    const user = userEvent.setup();
    render(<MessagesView currentUser={student} language="en" />);
    const picker = await screen.findByRole('combobox', { name: 'Select recipient' });
    await user.selectOptions(picker, '82e29747');
    resolveSecond([{
      id: 2,
      sender_id: '82e29747',
      receiver_id: student.id,
      content: 'Current conversation',
      created_at: '2026-01-01 11:00:00',
      is_read: 1,
    }]);
    expect(await screen.findByText('Current conversation')).toBeInTheDocument();

    resolveFirst([{
      id: 1,
      sender_id: '82e29746',
      receiver_id: student.id,
      content: 'Stale conversation',
      created_at: '2026-01-01 10:00:00',
      is_read: 1,
    }]);
    await waitFor(() => expect(screen.queryByText('Stale conversation')).not.toBeInTheDocument());
  });

  it('pauses message polling while hidden, refreshes on return, and coalesces read updates', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.mocked(api.contacts).mockResolvedValue([
      { id: '82e29746', name: 'Maha Alazri', email: '82e29746@utas.edu.om', department: 'IT', role: 'Advisor' },
    ]);
    vi.mocked(api.messages).mockResolvedValue([{
      id: 1,
      sender_id: '82e29746',
      receiver_id: student.id,
      content: 'Unread message',
      created_at: '2026-01-01 10:00:00',
      is_read: 0,
    }]);
    vi.mocked(api.markRead).mockImplementation(() => new Promise(() => {}));
    render(<MessagesView currentUser={student} language="en" />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(api.messages).toHaveBeenCalledTimes(1);
    expect(api.markRead).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(api.messages).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await Promise.resolve(); });
    expect(api.messages).toHaveBeenCalledTimes(2);
    expect(api.markRead).toHaveBeenCalledTimes(1);
  });
});
