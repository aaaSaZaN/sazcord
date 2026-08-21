import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type PasswordInputProps = {
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  id?: string;
  name?: string;
  ariaLabel?: string;
};

/**
 * Текстовое поле с постоянной кнопкой "глазок" для показа/скрытия пароля.
 * Кнопка отрисована поверх поля абсолютно — не зависит от состояния
 * (фокус/hover/наличие текста).
 */
export default function PasswordInput({
  value,
  onChange,
  autoComplete = 'current-password',
  minLength,
  required = false,
  autoFocus = false,
  placeholder,
  id,
  name,
  ariaLabel,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        className="input pr-10"
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 px-3 flex items-center text-slate-400 hover:text-slate-100 transition-colors"
        title={visible ? 'Скрыть пароль' : 'Показать пароль'}
        aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
        tabIndex={-1}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
