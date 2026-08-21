// Модалка пересылки сообщения(й). Открывается из контекстного меню или
// из bottom-bar мульти-выбора в ChatPanel'е. Позволяет:
//   1) Выбрать целевой чат (DM-собеседник или группа).
//   2) На втором шаге — добавить комментарий (caption) к пересылке, как
//      в Telegram. Caption отправляется отдельным текстовым сообщением
//      ПОСЛЕ всех пересылок (см. Home.tsx::handleForwardTo).
//
// Принимает массив `messages` для поддержки multi-select: длиной 1
// (обычная пересылка) или больше (мульти-пересылка).
//
// Стиль выровнен с ConfirmModal: motion overlay/panel, Esc закрывает.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Search,
  Send,
  X,
  Forward as ForwardIcon,
  UsersRound,
  ArrowLeft,
} from 'lucide-react';
import Avatar from './Avatar';
import { getDisplayName, getAvatarUrl, isDeletedUser } from '../utils/user';
import { modalVariants, overlayVariants, reducedVariants } from '../utils/motion';
import type { Message, User, Group } from '../types';

type ForwardTarget =
  | { kind: 'user'; id: number; label: string; subtitle?: string; avatar?: string | null }
  | { kind: 'group'; id: number; label: string; subtitle?: string; avatar?: string | null };

function previewOf(message: Message): string {
  if (message.deleted) return 'удалённое сообщение';
  if (message.kind === 'voice') return '🎤 голосовое сообщение';
  if (message.kind === 'image') return '🖼 изображение';
  if (message.kind === 'video') return '🎬 видео';
  if (message.kind === 'file') return '📎 ' + (message.attachmentName || 'файл');
  const t = (message.content || '').trim();
  if (!t) return 'сообщение';
  return t.length > 80 ? t.slice(0, 80) + '…' : t;
}

// Слово "сообщение" в нужном падеже для счётчика "N сообщений".
function pluralMessages(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сообщение';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сообщения';
  return 'сообщений';
}

export default function ForwardModal({
  open,
  messages,
  users,
  groups,
  selfId,
  lastActivityByChat,
  onClose,
  onForward,
}: {
  open: boolean;
  messages: Message[];
  users: User[];
  groups: Group[];
  selfId: number;
  // chatKey -> timestamp последнего сообщения. Используется для сортировки
  // списка по «недавности» — чтобы обычные собеседники были сверху.
  lastActivityByChat: Record<string, number>;
  onClose: () => void;
  onForward: (
    target: { kind: 'user'; id: number } | { kind: 'group'; id: number },
    caption?: string,
  ) => Promise<void> | void;
}) {
  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;

  // Два шага: 'pick' — выбор чата, 'compose' — добавление caption.
  const [step, setStep] = useState<'pick' | 'compose'>('pick');
  const [picked, setPicked] = useState<ForwardTarget | null>(null);
  const [query, setQuery] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const captionRef = useRef<HTMLTextAreaElement | null>(null);

  // Сброс всех временных состояний при открытии. Иначе закрытие+открытие
  // на других сообщениях будет показывать старый caption и старый picked.
  useEffect(() => {
    if (open) {
      setStep('pick');
      setPicked(null);
      setQuery('');
      setCaption('');
      setBusy(false);
      // Автофокус поиска с задержкой: motion-анимация appear иначе
      // перехватывает фокус.
      const t = window.setTimeout(() => inputRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  // Автофокус на caption при переходе на второй шаг.
  useEffect(() => {
    if (step === 'compose') {
      const t = window.setTimeout(() => captionRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [step]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // На втором шаге Esc возвращает на первый, а не закрывает совсем —
      // чтобы случайный Esc после ввода caption'а не выкинул из модалки.
      if (step === 'compose') {
        setStep('pick');
        setPicked(null);
        e.stopPropagation();
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, step]);

  const targets: ForwardTarget[] = useMemo(() => {
    const items: ForwardTarget[] = [];
    for (const u of users || []) {
      if (u.id === selfId) continue;
      if (isDeletedUser(u)) continue;
      items.push({
        kind: 'user',
        id: u.id,
        label: getDisplayName(u),
        subtitle: u.username ? `@${u.username}` : undefined,
        avatar: getAvatarUrl(u),
      });
    }
    for (const g of groups || []) {
      items.push({
        kind: 'group',
        id: g.id,
        label: g.name || 'Группа',
        subtitle: 'Группа',
        avatar: g.avatarPath || null,
      });
    }
    // Сортировка: сначала по убыванию last activity (если есть), потом
    // алфавитно. lastActivityByChat хранит unix-ms — чем больше, тем выше.
    items.sort((a, b) => {
      const ka = a.kind === 'group' ? `g:${a.id}` : `u:${a.id}`;
      const kb = b.kind === 'group' ? `g:${b.id}` : `u:${b.id}`;
      const ta = lastActivityByChat[ka] || 0;
      const tb = lastActivityByChat[kb] || 0;
      if (ta !== tb) return tb - ta;
      return a.label.localeCompare(b.label, 'ru');
    });
    return items;
  }, [users, groups, selfId, lastActivityByChat]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets;
    return targets.filter((t) => {
      if (t.label.toLowerCase().includes(q)) return true;
      if (t.subtitle && t.subtitle.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [targets, query]);

  // Шаг 1: выбран чат — переходим к compose. НЕ отправляем сразу.
  const handlePick = (t: ForwardTarget) => {
    if (busy) return;
    setPicked(t);
    setStep('compose');
  };

  // Шаг 2: пользователь нажал «Отправить» (с caption'ом или без). Шлём всё.
  const handleConfirm = async () => {
    if (!picked || busy) return;
    setBusy(true);
    try {
      const trimmed = caption.trim();
      await onForward(
        picked.kind === 'user'
          ? { kind: 'user', id: picked.id }
          : { kind: 'group', id: picked.id },
        trimmed || undefined,
      );
      onClose();
    } catch {
      // Ошибка уже показана в тосте (см. Home.tsx::handleForwardTo).
      // Остаёмся на втором шаге, чтобы пользователь мог попробовать снова.
      setBusy(false);
    }
  };

  // Enter в textarea (без shift) — submit; Shift+Enter — перенос строки.
  const onCaptionKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleConfirm();
    }
  };

  const totalCount = messages?.length || 0;
  const firstMessage = totalCount > 0 ? messages[0] : null;
  const headerSubtitle = (() => {
    if (totalCount === 0) return '';
    if (totalCount === 1 && firstMessage) return previewOf(firstMessage);
    return `${totalCount} ${pluralMessages(totalCount)}`;
  })();

  return (
    <AnimatePresence>
      {open && totalCount > 0 && (
        <motion.div
          key="forward-modal"
          className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
          variants={overlayV}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            className="card w-full max-w-md p-4 space-y-3 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
            variants={panelV}
          >
            <div className="flex items-center gap-2">
              {step === 'compose' ? (
                <button
                  type="button"
                  aria-label="Назад"
                  onClick={() => {
                    setStep('pick');
                    setPicked(null);
                  }}
                  className="btn-icon bg-white/5 hover:bg-white/10 text-slate-200 shrink-0"
                  style={{ width: 36, height: 36 }}
                  disabled={busy}
                >
                  <ArrowLeft size={16} />
                </button>
              ) : (
                <div className="w-9 h-9 rounded-xl grid place-items-center bg-accent/15 text-accent shrink-0">
                  <ForwardIcon size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-base font-semibold leading-tight">
                  {step === 'compose' && picked
                    ? `Переслать → ${picked.label}`
                    : totalCount > 1
                      ? `Переслать ${totalCount} ${pluralMessages(totalCount)}`
                      : 'Переслать сообщение'}
                </div>
                <div className="text-xs text-slate-400 mt-0.5 truncate" title={headerSubtitle}>
                  {headerSubtitle}
                </div>
              </div>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={onClose}
                className="btn-icon bg-white/5 hover:bg-white/10 text-slate-300"
                style={{ width: 32, height: 32 }}
                disabled={busy}
              >
                <X size={16} />
              </button>
            </div>

            {step === 'pick' ? (
              <>
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
                  />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Найти чат…"
                    className="w-full h-9 pl-8 pr-3 rounded-lg bg-bg-3 border border-border text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-accent/50"
                  />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
                  {filtered.length === 0 ? (
                    <div className="text-center text-sm text-slate-500 py-6">
                      {query ? 'ничего не нашлось' : 'нет доступных чатов'}
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {filtered.map((t) => {
                        const key = `${t.kind}:${t.id}`;
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              onClick={() => handlePick(t)}
                              className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left transition-colors hover:bg-white/5"
                            >
                              {t.kind === 'group' && !t.avatar ? (
                                <div
                                  className="w-9 h-9 rounded-xl grid place-items-center bg-bg-3 text-slate-300 shrink-0"
                                  aria-hidden
                                >
                                  <UsersRound size={18} />
                                </div>
                              ) : (
                                <Avatar name={t.label} src={t.avatar || null} size={36} />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-white truncate">{t.label}</div>
                                {t.subtitle && (
                                  <div className="text-[11px] text-slate-500 truncate">
                                    {t.subtitle}
                                  </div>
                                )}
                              </div>
                              <ForwardIcon size={16} className="text-slate-500" aria-hidden />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Превью того, что пересылаем — компактный список первых
                    3-х сообщений с типом/контентом. Если их больше — в
                    конце «и ещё N». */}
                <div className="rounded-lg bg-bg-3/50 border border-white/5 p-2 space-y-1 max-h-32 overflow-y-auto">
                  {messages.slice(0, 3).map((m) => (
                    <div key={m.id} className="text-xs text-slate-300 truncate">
                      <span className="text-slate-500">·</span> {previewOf(m)}
                    </div>
                  ))}
                  {messages.length > 3 && (
                    <div className="text-[11px] text-slate-500 italic">
                      и ещё {messages.length - 3} {pluralMessages(messages.length - 3)}…
                    </div>
                  )}
                </div>

                {/* Caption composer. Опционально — можно пересылать и без
                    текста, тогда отправится только сама пересылка. */}
                <textarea
                  ref={captionRef}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  onKeyDown={onCaptionKey}
                  placeholder="Добавить сообщение (необязательно)…"
                  rows={3}
                  maxLength={4000}
                  disabled={busy}
                  className="w-full px-3 py-2 rounded-lg bg-bg-3 border border-border text-sm text-white placeholder:text-slate-500 resize-none focus:outline-none focus:ring-1 focus:ring-accent/50"
                />

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep('pick');
                      setPicked(null);
                    }}
                    disabled={busy}
                    className="btn-ghost h-9 px-3 text-sm"
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={busy}
                    className="btn-primary h-9 px-4 text-sm flex items-center gap-2"
                  >
                    <Send size={14} />
                    <span>{busy ? 'Отправка…' : 'Отправить'}</span>
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
