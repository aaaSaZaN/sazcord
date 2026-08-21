import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { menuVariants, reducedVariants } from '../utils/motion';

/**
 * Плавающее контекстное меню по координатам курсора.
 * Закрывается при клике вне, Escape и скролле.
 *
 * Использование:
 *   <ContextMenu anchor={{x, y}} onClose={...} items={[
 *     { label: 'Показать профиль', onClick, icon },
 *     { label: 'Замутить', onClick, danger: false },
 *     { divider: true },
 *     { label: 'Удалить', onClick, danger: true, disabled: false },
 *   ]} />
 */
export default function ContextMenu({ anchor, onClose, items }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: anchor?.x || 0, top: anchor?.y || 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.x;
    let top = anchor.y;
    if (left + rect.width + 6 > vw) left = Math.max(6, vw - rect.width - 6);
    if (top + rect.height + 6 > vh) top = Math.max(6, vh - rect.height - 6);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  const reduce = useReducedMotion();
  const variants = reduce ? reducedVariants(menuVariants) : menuVariants;

  if (!anchor) return null;

  return (
    <motion.div
      ref={ref}
      className="fixed z-[80] min-w-[200px] bg-bg-2 border border-border rounded-lg shadow-soft py-1"
      style={{ left: pos.left, top: pos.top, transformOrigin: 'top left' }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      variants={variants}
      initial="initial"
      animate="animate"
    >
      {items.map((it, idx) => {
        if (it.divider) return <div key={`d-${idx}`} className="h-px bg-border my-1" />;
        return (
          <button
            key={idx}
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              it.onClick?.();
              onClose();
            }}
            className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2
              ${it.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-bg-3 cursor-pointer'}
              ${it.danger ? 'text-red-400 hover:text-red-300' : 'text-slate-100'}
            `}
          >
            {it.icon && <span className="shrink-0 opacity-80">{it.icon}</span>}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && <span className="text-[11px] text-slate-500">{it.shortcut}</span>}
          </button>
        );
      })}
    </motion.div>
  );
}
