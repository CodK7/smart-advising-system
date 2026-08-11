import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import LoginPortal from '../src/components/LoginPortal';
import { withRetryWindow } from '../src/loginErrors';
import type { User } from '../src/data';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>();
  return { ...actual, api: { ...actual.api, login: vi.fn() } };
});

const student: User = {
  id: 'S26s3216',
  name: 'Azaa Hamed',
  email: '26s3216@utas.edu.om',
  department: 'Information Technology',
  role: 'Student',
};

describe('login workflow', () => {
  beforeEach(() => vi.mocked(api.login).mockReset());

  it('uses accessible account fields and never labels a civil ID as a password', () => {
    render(<LoginPortal language="en" onAuthenticated={vi.fn()} />);
    expect(screen.getByLabelText('Student / Staff ID or Email')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.queryByText(/civil id/i)).not.toBeInTheDocument();
  });

  it('submits credentials and hands the trusted server user to App', async () => {
    vi.mocked(api.login).mockResolvedValue({ user: student });
    const authenticated = vi.fn();
    const user = userEvent.setup();
    render(<LoginPortal language="en" onAuthenticated={authenticated} />);
    await user.type(screen.getByLabelText('Student / Staff ID or Email'), student.id);
    await user.type(screen.getByLabelText('Password'), 'Unit-Test-Password!');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(api.login).toHaveBeenCalledWith(student.id, 'Unit-Test-Password!', expect.any(AbortSignal));
    expect(authenticated).toHaveBeenCalledWith(student);
  });

  it('shows a localized validation error without sending an empty request', async () => {
    const user = userEvent.setup();
    render(<LoginPortal language="ar" onAuthenticated={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'تسجيل الدخول' }));
    expect(screen.getByRole('alert')).toHaveTextContent('يرجى إدخال');
    expect(api.login).not.toHaveBeenCalled();
  });

  it('formats the validated retry window returned for a rate-limited login', () => {
    expect(withRetryWindow('Too many login attempts.', 'en', 4)).toContain('Try again in 4 seconds');
  });
});
