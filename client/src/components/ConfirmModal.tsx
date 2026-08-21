// Универсальная модалка подтверждения. Используется для деструктивных
// действий вроде «Выйти из аккаунта» — сценариев, где случайный клик
// должен быть пойман, но дополнительное поле ввода (как в DeleteAccountModal)
// избыточно.
//
// Дизайн:
//   - Иконка слева (контекстная, передаём props.icon — обычно из lucide).
//   - Заголовок (title) и подзаголовок (description) — оба обязательны
//     или сильно желательны: подсказка снизу описывает последствия.
//   - Две кнопки: Cancel и Confirm. Confirm красная, если danger=true,
//     иначе нейтральная primary.
//   - Esc закрывает модалку (через клик по подложке).
//
// Используется в Home.tsx для logout. Ничто не мешает переиспользовать
// для других подтверждений (например, выход из группы — но там пока
// confirm() стоит).

import { useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { modalVariants, overlayVariants, reducedVariants } from '../utils/motion';
import type { ReactNode } from 'react';

export default function ConfirmModal({
  open,
  title,
  description,
  icon,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;

  // Esc по умолчанию AnimatePresence + onClick onClose не закроют, т.к.
  // фокус не на overlay'е. Вешаем глобальный listener, пока модалка
  // открыта. Enter не делаем confirm-shortcut'ом намеренно: confirm
  // должен быть осознанным действием, особенно для danger=true.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="confirm-modal"
          className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
          onClick={onClose}
          variants={overlayV}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            className="card w-full max-w-md p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
            variants={panelV}
          >
            <div className="flex items-start gap-3">
              {icon && (
                <div
                  className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${
                    danger ? 'bg-red-500/15 text-red-400' : 'bg-accent/15 text-accent'
                  }`}
                >
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-base font-semibold">{title}</div>
                {description && (
                  <div className="text-xs text-slate-400 mt-1 leading-snug">{description}</div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn-ghost h-9 px-3" onClick={onClose}>
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                autoFocus
                className={`h-9 px-4 rounded-lg text-sm font-medium ${
                  danger
                    ? 'bg-red-500/80 hover:bg-red-500 text-white'
                    : 'bg-accent hover:bg-accent/90 text-white'
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
