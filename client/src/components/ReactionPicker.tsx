import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { menuVariants } from '../utils/motion';
import { Heart, Zap, Trophy, Flame, ThumbsUp, ThumbsDown, Laugh, Smile } from 'lucide-react';

// Привлекательные реакции с иконками lucide-react (не смайлы)
const DEFAULT_REACTIONS = [
  { id: 'heart', icon: Heart, label: 'Нравится' },
  { id: 'thumbsUp', icon: ThumbsUp, label: 'Лайк' },
  { id: 'thumbsDown', icon: ThumbsDown, label: 'Дизлайк' },
  { id: 'laugh', icon: Laugh, label: 'Смех' },
  { id: 'smile', icon: Smile, label: 'Улыбка' },
  { id: 'flame', icon: Flame, label: 'Огонь' },
  { id: 'trophy', icon: Trophy, label: 'Победа' },
  { id: 'zap', icon: Zap, label: 'Энергия' },
];

interface ReactionPickerProps {
  anchor: { x: number; y: number } | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export default function ReactionPicker({ anchor, onSelect, onClose }: ReactionPickerProps) {
  const ref = useRef(null);

  useEffect(() => {
    if (!anchor) return undefined;
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) {
        onClose();
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);

  if (!anchor) return null;

  return (
    <motion.div
      ref={ref}
      className="fixed z-[85] bg-bg-2 border border-border rounded-lg shadow-soft p-2 grid grid-cols-4 gap-1"
      style={{ left: anchor.x, top: anchor.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      variants={menuVariants}
      initial="initial"
      animate="animate"
    >
      {DEFAULT_REACTIONS.map((reaction) => {
        const Icon = reaction.icon;
        return (
          <button
            key={reaction.id}
            type="button"
            onClick={() => {
              onSelect(reaction.id);
              onClose();
            }}
            className="w-10 h-10 text-slate-200 hover:text-accent hover:bg-bg-3 rounded-md flex items-center justify-center transition-colors"
            title={reaction.label}
          >
            <Icon size={20} />
          </button>
        );
      })}
    </motion.div>
  );
}
