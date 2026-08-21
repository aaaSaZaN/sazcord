import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { reducedVariants, toastVariants } from '../utils/motion';

const ToastContext = createContext(null);

const DEFAULT_TTL = 5000;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map()); // id -> timeout

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const t = timersRef.current.get(id);
    if (t) clearTimeout(t);
    timersRef.current.delete(id);
  }, []);

  const scheduleDismiss = useCallback(
    (id, ttl) => {
      const existing = timersRef.current.get(id);
      if (existing) clearTimeout(existing);
      if (!ttl) return;
      timersRef.current.set(
        id,
        setTimeout(() => dismiss(id), ttl),
      );
    },
    [dismiss],
  );

  const show = useCallback(
    (message, { type = 'info', ttl = DEFAULT_TTL } = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((list) => [...list, { id, message, type, ttl }]);
      scheduleDismiss(id, ttl);
      return id;
    },
    [scheduleDismiss],
  );

  const api = useMemo(
    () => ({
      show,
      info: (msg, opts) => show(msg, { ...opts, type: 'info' }),
      success: (msg, opts) => show(msg, { ...opts, type: 'success' }),
      error: (msg, opts) => show(msg, { ...opts, type: 'error' }),
      dismiss,
    }),
    [show, dismiss],
  );

  const onMouseEnter = (id) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
  };
  const onMouseLeave = (id, ttl) => {
    scheduleDismiss(id, ttl || DEFAULT_TTL);
  };

  const reduce = useReducedMotion();
  const variants = reduce ? reducedVariants(toastVariants) : toastVariants;

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[80] flex flex-col gap-2 pointer-events-none w-[min(92vw,360px)]">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout={!reduce}
              variants={variants}
              initial="initial"
              animate="animate"
              exit="exit"
              className={`pointer-events-auto group relative rounded-lg border px-3 py-2 pr-8 text-sm shadow-soft backdrop-blur
                ${
                  t.type === 'error'
                    ? 'bg-danger/90 border-red-700 text-white'
                    : t.type === 'success'
                      ? 'bg-success/90 border-green-700 text-white'
                      : 'bg-bg-2/95 border-border text-slate-100'
                }`}
              onMouseEnter={() => onMouseEnter(t.id)}
              onMouseLeave={() => onMouseLeave(t.id, t.ttl)}
            >
              <span className="block leading-snug">{t.message}</span>
              <button
                onClick={() => dismiss(t.id)}
                className="absolute top-1.5 right-1.5 opacity-60 hover:opacity-100 transition-opacity rounded p-1 hover:bg-black/20"
                title="Закрыть"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
