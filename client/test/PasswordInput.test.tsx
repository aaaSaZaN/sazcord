import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import PasswordInput from '../src/components/PasswordInput';

function Harness() {
  const [v, setV] = useState('');
  return <PasswordInput value={v} onChange={(e) => setV(e.target.value)} />;
}

describe('PasswordInput', () => {
  it('toggles visibility when clicking the eye button', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const input = container.querySelector('input');
    expect(input.type).toBe('password');

    await user.type(input, 'secret123');
    expect(input.value).toBe('secret123');

    const toggle = screen.getByRole('button', { name: /Показать пароль/i });
    await user.click(toggle);
    expect(input.type).toBe('text');

    const toggle2 = screen.getByRole('button', { name: /Скрыть пароль/i });
    await user.click(toggle2);
    expect(input.type).toBe('password');
  });
});
