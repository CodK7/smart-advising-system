import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import Dashboard from '../src/components/Dashboard';
import type { User } from '../src/data';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>();
  return { ...actual, api: { ...actual.api, unread: vi.fn().mockResolvedValue([]) } };
});

vi.mock('../src/components/StudentDashboard', () => ({ default: () => <div>Student surface</div> }));
vi.mock('../src/components/AdvisorDashboard', () => ({ default: () => <div>Advisor surface</div> }));
vi.mock('../src/components/SystemAdminDashboard', () => ({ default: () => <div>System admin surface</div> }));
vi.mock('../src/components/RegistrarAdminDashboard', () => ({ default: () => <div>Registrar admin surface</div> }));
vi.mock('../src/components/StudentAffairsAdminDashboard', () => ({ default: () => <div>Student affairs admin surface</div> }));

const student: User = {
  id: 'S26s3216',
  name: 'Azaa Hamed',
  email: '26s3216@utas.edu.om',
  department: 'Information Technology',
  role: 'Student',
};

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  Reflect.deleteProperty(document, 'visibilityState');
  vi.useRealTimers();
  vi.mocked(api.unread).mockClear();
});

describe('dashboard navigation accessibility', () => {
  it('focuses the mobile drawer, closes it with Escape, and restores the menu trigger', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const user = userEvent.setup();
    render(<Dashboard currentUser={student} language="en" onLogout={vi.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Toggle menu' });
    expect(screen.queryByRole('dialog', { name: 'Primary navigation' })).not.toBeInTheDocument();

    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Primary navigation' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps administrator-only and messaging tabs out of the wrong role surfaces', () => {
    const admin: User = { ...student, id: '32e87366', role: 'System Admin' };
    const { unmount } = render(<Dashboard currentUser={admin} language="en" onLogout={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'University settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Messages' })).not.toBeInTheDocument();
    unmount();

    render(<Dashboard currentUser={student} language="en" onLogout={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Message Advisor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'University settings' })).not.toBeInTheDocument();
  });

  it('pauses unread polling while hidden and refreshes once when visible again', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    render(<Dashboard currentUser={student} language="en" onLogout={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(api.unread).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.unread).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => { await Promise.resolve(); });
    expect(api.unread).toHaveBeenCalledTimes(2);
  });
});
