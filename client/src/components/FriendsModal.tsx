// Экран «Друзья»: заявки и список контактов.
//
// Имеет смысл только при socialMode === 'private' — в local-режиме все и
// так видят всех, а роуты /api/friends отвечают 409. Открывается кнопкой
// в шапке сайдбара, которая при 'local' не рендерится вовсе.
//
// Заявка отправляется по ТОЧНОМУ username: сервер намеренно не умеет
// искать по подстроке (иначе приватный режим сводился бы на нет), поэтому
// здесь обычное поле ввода, а не автодополнение по списку.

import { useCallback, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X, UserPlus, Check, UserMinus, Users as UsersIcon } from 'lucide-react';
import Avatar from './Avatar';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useT } from '../i18n';
import { getAvatarUrl } from '../utils/user';
import { modalVariants, overlayVariants, reducedVariants } from '../utils/motion';

const EMPTY = { friends: [], incoming: [], outgoing: [] };

function Row({ entry, children, fallbackName }) {
  const name = entry.displayName || entry.username || fallbackName;
  return (
    <li className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-bg-3">
      <Avatar name={name} src={getAvatarUrl(entry)} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{name}</div>
        {entry.username && entry.displayName && entry.displayName !== entry.username && (
          <div className="truncate text-xs text-slate-500">@{entry.username}</div>
        )}
      </div>
      {entry.online && <span className="w-2 h-2 rounded-full bg-success shrink-0" />}
      <div className="flex items-center gap-1 shrink-0">{children}</div>
    </li>
  );
}

function Section({ title, count, children }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold px-2">
        {title}
        {count > 0 ? ` — ${count}` : ''}
      </div>
      {children}
    </div>
  );
}

export default function FriendsModal({ onClose, onChanged = null }) {
  const { auth, socket } = useAuth();
  const token = auth?.token;
  const toast = useToast();
  const t = useT();
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    api
      .listFriends(token)
      .then((r) => setData({ ...EMPTY, ...r }))
      .catch(() => {
        /* при 409 (local-режим) просто останемся с пустыми списками */
      })
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  // Сервер шлёт обеим сторонам «перечитай список» — и когда заявку принял
  // кто-то другой, пока окно открыто, тоже.
  useEffect(() => {
    if (!socket) return undefined;
    socket.on('friends:update', load);
    return () => {
      socket.off('friends:update', load);
    };
  }, [socket, load]);

  // Любое изменение дружбы меняет видимость: в приватном режиме контакт
  // появляется или исчезает из общего списка пользователей.
  const after = (message) => {
    load();
    onChanged?.();
    if (message) toast.info(message);
  };

  const add = async (e) => {
    e.preventDefault();
    const name = username.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const r = await api.addFriend(token, name);
      setUsername('');
      after(r.status === 'friends' ? t('friends.nowFriends') : t('friends.requestSent'));
    } catch (err) {
      toast.error(err?.message || t('friends.addFailed'));
    } finally {
      setBusy(false);
    }
  };

  const accept = async (id) => {
    try {
      await api.acceptFriend(token, id);
      after(t('friends.requestAccepted'));
    } catch (err) {
      toast.error(err?.message || t('friends.acceptFailed'));
    }
  };

  const remove = async (id, message) => {
    try {
      await api.removeFriend(token, id);
      after(message);
    } catch (err) {
      toast.error(err?.message || t('friends.removeFailed'));
    }
  };

  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;

  const nothing =
    !loading && !data.friends.length && !data.incoming.length && !data.outgoing.length;

  return (
    <motion.div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
      variants={overlayV}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="w-full max-w-md bg-bg-1 border border-border rounded-2xl shadow-soft overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
        variants={panelV}
      >
        <header className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <UsersIcon size={18} /> {t('friends.title')}
          </h2>
          <button className="btn-ghost" onClick={onClose} title={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        <form onSubmit={add} className="p-4 border-b border-border space-y-2">
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder={t('common.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
            />
            <button
              type="submit"
              className="btn-primary shrink-0"
              disabled={busy}
              title={t('friends.add')}
            >
              <UserPlus size={16} />
            </button>
          </div>
          <p className="text-xs text-slate-500">{t('friends.exactNameHint')}</p>
        </form>

        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-4">
          {loading && <div className="p-4 text-sm text-slate-400">{t('common.loading')}</div>}

          {data.incoming.length > 0 && (
            <Section title={t('friends.incoming')} count={data.incoming.length}>
              <ul>
                {data.incoming.map((f) => (
                  <Row key={f.id} entry={f} fallbackName={t('common.deletedUser')}>
                    <button
                      className="btn-ghost text-success"
                      title={t('friends.accept')}
                      onClick={() => accept(f.id)}
                      type="button"
                    >
                      <Check size={16} />
                    </button>
                    <button
                      className="btn-ghost text-danger"
                      title={t('friends.reject')}
                      onClick={() => remove(f.id, t('friends.requestRejected'))}
                      type="button"
                    >
                      <X size={16} />
                    </button>
                  </Row>
                ))}
              </ul>
            </Section>
          )}

          {data.outgoing.length > 0 && (
            <Section title={t('friends.outgoing')} count={data.outgoing.length}>
              <ul>
                {data.outgoing.map((f) => (
                  <Row key={f.id} entry={f} fallbackName={t('common.deletedUser')}>
                    <button
                      className="btn-ghost text-slate-400"
                      title={t('friends.cancel')}
                      onClick={() => remove(f.id, t('friends.requestCancelled'))}
                      type="button"
                    >
                      <X size={16} />
                    </button>
                  </Row>
                ))}
              </ul>
            </Section>
          )}

          {data.friends.length > 0 && (
            <Section title={t('friends.list')} count={data.friends.length}>
              <ul>
                {data.friends.map((f) => (
                  <Row key={f.id} entry={f} fallbackName={t('common.deletedUser')}>
                    <button
                      className="btn-ghost text-danger"
                      title={t('friends.remove')}
                      onClick={() => remove(f.id, t('friends.removed'))}
                      type="button"
                    >
                      <UserMinus size={16} />
                    </button>
                  </Row>
                ))}
              </ul>
            </Section>
          )}

          {nothing && <div className="p-4 text-sm text-slate-400">{t('friends.empty')}</div>}
        </div>
      </motion.div>
    </motion.div>
  );
}
