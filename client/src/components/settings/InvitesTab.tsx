// Таб «Приглашения»: создание и отзыв инвайт-кодов.
//
// Виден админу всегда, обычному участнику — при
// INVITE_WHO_CAN_CREATE=members. Участнику сервер выдаёт коды по жёсткой
// рамке (одноразовый, 7 дней, код генерируется), поэтому поля «свой код»
// и «максимум использований» ему не показываем: они всё равно были бы
// молча проигнорированы.
// Работает параллельно с общим REGISTRATION_CODE из .env: те разрешают
// регистрироваться кому угодно, а тут — точечные одноразовые/multi-use коды
// с подписью и сроком жизни. InviteRow — приватный helper, не шейрим.

import { useEffect, useState } from 'react';
import { Trash2, Copy, Check, RefreshCw, Link2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api } from '../../api';

type InviteCode = {
  code: string;
  note?: string;
  maxUses?: number | null;
  usesCount: number;
  expiresAt?: number | null;
  revokedAt?: number | null;
};

export function InvitesTab() {
  const { auth } = useAuth();
  const toast = useToast();
  const token = auth?.token;
  const isAdmin = !!auth?.user?.isAdmin;
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Поля формы создания.
  const [note, setNote] = useState('');
  const [maxUses, setMaxUses] = useState('1'); // по умолчанию одноразовый
  const [expiresIn, setExpiresIn] = useState('7'); // дни; пусто = бессрочный
  const [customCode, setCustomCode] = useState('');

  const refresh = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const r = await api.listInvites(token);
      setCodes(r.codes || []);
    } catch (e: any) {
      toast.error(e.message || 'Не удалось загрузить коды');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // refresh замыкает actual token; пересинхронизируемся при логине/логауте.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const body: Record<string, unknown> = {};
      // Участник ничего из ограничений не выбирает — рамку ставит сервер.
      if (!isAdmin) {
        if (note.trim()) body.note = note.trim();
        await api.createInvite(token, body);
        setNote('');
        await refresh();
        toast.success('Код создан');
        return;
      }
      const mu = maxUses.trim();
      if (mu) {
        const n = Number(mu);
        if (!Number.isFinite(n) || n < 1) {
          toast.error('Максимум использований должен быть ≥ 1');
          setCreating(false);
          return;
        }
        body.maxUses = n;
      }
      const ei = expiresIn.trim();
      if (ei) {
        const days = Number(ei);
        if (!Number.isFinite(days) || days <= 0) {
          toast.error('Срок жизни должен быть положительным числом дней');
          setCreating(false);
          return;
        }
        body.expiresAt = Date.now() + Math.floor(days * 24 * 3600 * 1000);
      }
      if (note.trim()) body.note = note.trim();
      if (customCode.trim()) body.code = customCode.trim();
      await api.createInvite(token, body);
      setNote('');
      setCustomCode('');
      await refresh();
      toast.success('Код создан');
    } catch (e: any) {
      toast.error(e.message || 'Не удалось создать код');
    } finally {
      setCreating(false);
    }
  };

  const onRevoke = async (code: string) => {
    if (!confirm(`Отозвать код «${code}»? Зарегистрироваться по нему уже не получится.`)) return;
    try {
      await api.revokeInvite(token, code);
      await refresh();
    } catch (e: any) {
      toast.error(e.message || 'Не удалось отозвать');
    }
  };

  return (
    <section className="space-y-5">
      <div className="text-xs text-slate-400">
        {isAdmin ? (
          <>
            Здесь можно выпускать одноразовые или multi-use коды для регистрации новых
            пользователей. Они работают параллельно с общим кодом из
            <code className="mx-1">REGISTRATION_CODE</code> в <code>.env</code>.
          </>
        ) : (
          <>
            Здесь можно позвать человека на этот сервер. Ваши коды одноразовые и живут 7 дней —
            многоразовые выпускает только администратор.
          </>
        )}
      </div>

      {/* --- Форма создания --- */}
      <form onSubmit={onCreate} className="bg-bg-2 border border-border rounded-lg p-3 space-y-3">
        <div className="text-sm font-semibold">Создать новый код</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Подпись (для себя)</label>
            <input
              className="input"
              placeholder="например: для Васи"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={200}
            />
          </div>
          {isAdmin && (
            <div>
              <label className="text-xs text-slate-400">Свой код (необязательно)</label>
              <input
                className="input"
                placeholder="оставь пустым для авто"
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value)}
                maxLength={64}
              />
            </div>
          )}
          {isAdmin && (
            <div>
              <label className="text-xs text-slate-400">Максимум использований</label>
              <input
                className="input"
                type="number"
                min="1"
                placeholder="без ограничения — оставь пустым"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </div>
          )}
          {isAdmin && (
            <div>
              <label className="text-xs text-slate-400">Срок жизни (дней)</label>
              <input
                className="input"
                type="number"
                min="1"
                placeholder="без ограничения — оставь пустым"
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
              />
            </div>
          )}
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={creating}>
            {creating ? 'Создаём…' : 'Создать код'}
          </button>
        </div>
      </form>

      {/* --- Список кодов --- */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Коды ({codes.length})</div>
          <button className="btn-ghost" onClick={refresh} title="Обновить" type="button">
            <RefreshCw size={14} />
          </button>
        </div>
        {loading && codes.length === 0 ? (
          <div className="text-sm text-slate-500">Загрузка…</div>
        ) : codes.length === 0 ? (
          <div className="text-sm text-slate-500">Пока ни одного кода. Создай первый выше.</div>
        ) : (
          <ul className="space-y-1.5">
            {codes.map((c) => (
              <InviteRow key={c.code} code={c} onRevoke={onRevoke} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function InviteRow({ code, onRevoke }: { code: InviteCode; onRevoke: (code: string) => void }) {
  // Что именно скопировали: код или ссылку. Одно состояние на двоих —
  // галочка должна загораться на нажатой кнопке, а не на обеих.
  const [copied, setCopied] = useState(null as null | 'code' | 'link');
  const copy = async (text: string, what: 'code' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard может быть запрещён */
    }
  };
  // Ссылка строится от origin вкладки: у самораскатываемого сервера
  // «канонического» адреса нет, и вшивать его некуда.
  const link = `${window.location.origin}/invite/${encodeURIComponent(code.code)}`;

  let status = 'активен';
  let statusClass = 'text-emerald-400';
  if (code.revokedAt) {
    status = 'отозван';
    statusClass = 'text-slate-500';
  } else if (code.expiresAt && code.expiresAt <= Date.now()) {
    status = 'истёк';
    statusClass = 'text-amber-400';
  } else if (code.maxUses != null && code.usesCount >= code.maxUses) {
    status = 'исчерпан';
    statusClass = 'text-amber-400';
  }

  const usesLabel =
    code.maxUses == null
      ? `${code.usesCount} использований`
      : `${code.usesCount} / ${code.maxUses}`;
  const expiresLabel = code.expiresAt
    ? `до ${new Date(code.expiresAt).toLocaleDateString()}`
    : 'без срока';

  return (
    <li className="bg-bg-2 border border-border rounded-lg p-2.5 flex items-center gap-2">
      <button
        type="button"
        onClick={() => copy(code.code, 'code')}
        title="Скопировать код"
        className="btn-ghost shrink-0"
      >
        {copied === 'code' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
      </button>
      <button
        type="button"
        onClick={() => copy(link, 'link')}
        title="Скопировать ссылку"
        className="btn-ghost shrink-0"
      >
        {copied === 'link' ? <Check size={14} className="text-emerald-400" /> : <Link2 size={14} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-sm truncate">{code.code}</div>
        <div className="text-xs text-slate-500 truncate">
          <span className={statusClass}>{status}</span>
          {' · '}
          {usesLabel}
          {' · '}
          {expiresLabel}
          {code.note ? ` · ${code.note}` : ''}
        </div>
      </div>
      {!code.revokedAt && (
        <button
          type="button"
          onClick={() => onRevoke(code.code)}
          className="btn-ghost text-danger shrink-0"
          title="Отозвать"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}
