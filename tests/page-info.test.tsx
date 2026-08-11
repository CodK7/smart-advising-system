import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import PageInfo from '../src/components/PageInfo';

describe('PageInfo dialog accessibility', () => {
  it('moves focus into the dialog, traps Tab, and restores focus on Escape', async () => {
    const user = userEvent.setup();
    render(<PageInfo page="schedule" language="en" />);

    const trigger = screen.getByRole('button', { name: 'What is this page?' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'What is “Class Schedule”?' });
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const done = within(dialog).getByRole('button', { name: 'Got it' });
    expect(close).toHaveFocus();

    done.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
