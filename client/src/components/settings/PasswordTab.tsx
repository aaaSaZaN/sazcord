// Таб «Пароль»: смена пароля. Простая форма с тремя полями + клиентская
// валидация (длина, совпадение, не равен текущему). Серверные проверки
// дублируются (POST /api/me/password) — клиент тут только для UX.

import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api';
import PasswordInput from '../PasswordInput';

export function PasswordTab() {
  const { auth } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  // Простая валидация формы — всё на клиенте, чтобы кнопка disabled'илась
  // и пользователь видел очевидные ошибки до запроса. На сервере те же
  // проверки повторяются (POST /api/me/password).
  const tooShort = next.length > 0 && next.length < 6;
  const mismatch = confirm.length > 0 && confirm !== next;
  const sameAsCurrent = next.length > 0 && next === current;

  const canSubmit =
    current.length > 0 && next.length >= 6 && confirm === next && next !== current && !busy;

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      await api.changePassword(auth.token, current, next);
      toast.success('Пароль обновлён');
      reset();
    } catch (err: any) {
      const msg = err?.message;
      if (err?.status === 403) {
        toast.error('Текущий пароль введён неверно');
      } else {
        toast.error(msg || 'Не удалось сменить пароль');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5 max-w-md">
      <p className="text-xs text-slate-400">
        После смены пароля уже выпущенные токены остаются действительными до своего срока (14 дней)
        — но злоумышленник без нового пароля не сможет войти заново.
      </p>

      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 uppercase tracking-wider">Старый пароль</label>
        <PasswordInput
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          required
          name="current-password"
          ariaLabel="Текущий пароль"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 uppercase tracking-wider">Новый пароль</label>
        <PasswordInput
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
          name="new-password"
          ariaLabel="Новый пароль"
        />
        {tooShort && <div className="text-[11px] text-amber-400">Минимум 6 символов</div>}
        {sameAsCurrent && !tooShort && (
          <div className="text-[11px] text-amber-400">Должен отличаться от старого</div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 uppercase tracking-wider">Повторить пароль</label>
        <PasswordInput
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          name="new-password-confirm"
          ariaLabel="Подтверждение нового пароля"
        />
        {mismatch && <div className="text-[11px] text-amber-400">Пароли не совпадают</div>}
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="btn-primary h-10 px-4 disabled:opacity-50"
        >
          {busy ? 'Сохранение…' : 'Сменить пароль'}
        </button>
      </div>
    </form>
  );
}
