import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { getSocket } from '../socket';
import { useAuth } from './AuthContext';

const MutesContext = createContext(null);

/**
 * Серверный список мьютов (источник истины — БД через /api/mutes и
 * событие 'mutes:update' по сокету). На клиенте держим Set из id'шников.
 *
 * При изменении используем оптимистичные обновления + REST,
 * сервер пришлёт mutes:update всем сокетам пользователя.
 */
export function MutesProvider({ children }) {
  const { auth } = useAuth();
  const token = auth?.token;
  const [ids, setIds] = useState(() => new Set<number>());

  // Начальная загрузка при логине
  useEffect(() => {
    if (!token) {
      setIds(new Set());
      return undefined;
    }
    let cancelled = false;
    api
      .listMutes(token)
      .then((r) => {
        if (!cancelled) setIds(new Set(r.ids || []));
      })
      .catch(() => {
        /* silent */
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Подписка на серверные апдейты по сокету.
  // Сокет создаётся в AuthProvider; его эффект может выполниться позже,
  // чем у нашего провайдера, поэтому ждём появления через polling.
  useEffect(() => {
    if (!token) return undefined;
    let socket = null;
    let cancelled = false;
    let pollTimer = null;
    const onUpdate = ({ ids: list }) => {
      if (Array.isArray(list)) setIds(new Set(list));
    };
    const trySubscribe = () => {
      if (cancelled) return;
      const s = getSocket();
      if (s) {
        socket = s;
        s.on('mutes:update', onUpdate);
      } else {
        pollTimer = setTimeout(trySubscribe, 50);
      }
    };
    trySubscribe();
    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (socket) socket.off('mutes:update', onUpdate);
    };
  }, [token]);

  const isMuted = useCallback((userId) => ids.has(userId), [ids]);

  const toggle = useCallback(
    async (userId) => {
      if (!token) return;
      const wasMuted = ids.has(userId);
      // Оптимистичное обновление
      setIds((prev) => {
        const next = new Set(prev);
        if (wasMuted) next.delete(userId);
        else next.add(userId);
        return next;
      });
      try {
        const res = wasMuted
          ? await api.removeMute(token, userId)
          : await api.addMute(token, userId);
        if (Array.isArray(res?.ids)) setIds(new Set(res.ids));
      } catch {
        // откат
        setIds((prev) => {
          const next = new Set(prev);
          if (wasMuted) next.add(userId);
          else next.delete(userId);
          return next;
        });
      }
    },
    [ids, token],
  );

  // Карта { id: true } для совместимости с компонентами, которым удобнее
  // быстрый булев lookup.
  const mutes = useMemo(() => {
    const m: Record<number, boolean> = {};
    for (const id of ids) m[id] = true;
    return m;
  }, [ids]);

  const value = useMemo(() => ({ mutes, ids, isMuted, toggle }), [mutes, ids, isMuted, toggle]);
  return <MutesContext.Provider value={value}>{children}</MutesContext.Provider>;
}

export function useMutes() {
  const ctx = useContext(MutesContext);
  if (!ctx) throw new Error('useMutes must be used inside MutesProvider');
  return ctx;
}
