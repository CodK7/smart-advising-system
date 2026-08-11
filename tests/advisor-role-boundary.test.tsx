import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api';
import AdminDashboard from '../src/components/AdminDashboard';
import type { User } from '../src/data';

vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      students: vi.fn(),
      advisors: vi.fn(),
      staff: vi.fn(),
      stats: vi.fn(),
      chatHistory: vi.fn(),
      contacts: vi.fn(),
    },
  };
});

const advisor: User = {
  id: '82e29746',
  name: 'Maha Alazri',
  email: '82e29746@utas.edu.om',
  department: 'Information Technology',
  role: 'Advisor',
};

describe('advisor role boundary', () => {
  beforeEach(() => {
    vi.mocked(api.students).mockReset().mockResolvedValue([]);
    vi.mocked(api.advisors).mockReset();
    vi.mocked(api.staff).mockReset();
    vi.mocked(api.stats).mockReset();
    vi.mocked(api.chatHistory).mockReset().mockResolvedValue([]);
    vi.mocked(api.contacts).mockReset().mockResolvedValue([]);
  });

  it('does not request administrator-only staff or institution metrics for advisor messaging', async () => {
    render(<AdminDashboard activeTab="messages" language="en" currentUser={advisor} />);

    expect(await screen.findByText('No one to message yet.')).toBeInTheDocument();
    await waitFor(() => expect(api.students).toHaveBeenCalledOnce());
    expect(api.advisors).not.toHaveBeenCalled();
    expect(api.staff).not.toHaveBeenCalled();
    expect(api.stats).not.toHaveBeenCalled();
  });
});
