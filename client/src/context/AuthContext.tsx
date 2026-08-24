import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError, setAuthExpiredHandler } from '../api';
import { connectSocket, disconnectSocket } from '../socket';
import { useToast } from './ToastContext';

const AuthContext = createContext(null);

const STORAGE_KEY = 'sazcord.auth';

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.user) return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

function writeStored(auth) {
  if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
  else localStorage.removeItem(STORAGE_KEY);
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => readStored());
  const [ready, setReady] = useState(false);
  const [socket, setSocket] = useState(() => {
    const stored = readStored();
    return stored?.token ? connectSocket(stored.token) : null;
  });
  const toast = useToast();

  // При монтировании проверяем токен (если есть) через /me
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readStored();
      if (!stored) {
        setReady(true);
        return;
      }
      try {
        const { user } = await api.me(stored.token);
        if (cancelled) return;
        const next = { token: stored.token, user };
        setAuth(next);
        writeStored(next);
      } catch (e) {
        if (!cancelled) {
          // Сетевая ошибка/таймаут (status 0) — НЕ разлогиниваем: токен
          // может быть валиден, просто сервер сейчас недостижен (обрыв,
          // кривой hairpin NAT). Оставляем сохранённую сессию, иначе
          // любой сбой сети выкидывал бы юзера на экран логина.
          const networkish = e instanceof ApiError && e.status === 0;
          if (!networkish) {
            setAuth(null);
            writeStored(null);
          }
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Управляем жизненным циклом сокета
  useEffect(() => {
    if (auth?.token) {
      const sock = connectSocket(auth.token);
      setSocket(sock);
      // Сервер присылает `account:deleted`, если аккаунт удалили из
      // другой вкладки или админом. Мгновенно гасим текущую сессию.
      const onDeleted = () => {
        try {
          toast?.info?.('Аккаунт удалён', { ttl: 8000 });
        } catch {
          /* */
        }
        setAuth(null);
        writeStored(null);
        setSocket(null);
        try {
          disconnectSocket();
        } catch {
          /* */
        }
      };
      sock.on?.('account:deleted', onDeleted);
      return () => {
        try {
          sock.off?.('account:deleted', onDeleted);
        } catch {
          /* */
        }
      };
    }
    setSocket(null);
    disconnectSocket();
    return undefined;
  }, [auth?.token, toast]);

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password);
    const next = { token: res.token, user: res.user };
    setAuth(next);
    writeStored(next);
    return next;
  }, []);

  const register = useCallback(async (username, password, invite, opts = {}) => {
    const res = await api.register(username, password, invite, opts);
    const next = { token: res.token, user: res.user };
    setAuth(next);
    writeStored(next);
    return next;
  }, []);

  const logout = useCallback(() => {
    disconnectSocket();
    setAuth(null);
    writeStored(null);
  }, []);

  // Когда любой /api/* возвращает 401 (кроме /auth/*) — это означает, что
  // JWT истёк или аккаунт был удалён. Глобально выкидываем пользователя
  // на форму логина и показываем тост.
  useEffect(() => {
    setAuthExpiredHandler((body) => {
      const reason = (body as { error?: string } | null)?.error || 'session-expired';
      try {
        toast?.info?.(
          reason === 'account-deleted' ? 'Аккаунт удалён' : 'Сессия истекла, войдите снова',
          { ttl: 6000 },
        );
      } catch {
        /* */
      }
      logout();
    });
    return () => setAuthExpiredHandler(null);
  }, [logout, toast]);

  const updateUser = useCallback((user) => {
    setAuth((prev) => {
      if (!prev) return prev;
      const next = { ...prev, user: { ...prev.user, ...user } };
      writeStored(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ auth, ready, socket, login, register, logout, updateUser }),
    [auth, ready, socket, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
