import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { X, UserPlus, UserMinus, Check } from 'lucide-react';
import Avatar from './Avatar';
import { getAvatarUrl, getDisplayName } from '../utils/user';
import { useToast } from '../context/ToastContext';
import { modalVariants, overlayVariants, reducedVariants } from '../utils/motion';

const MEMBER_LIMIT = 10;

export default function InviteMembersModal({ group, users = [], onClose, onInvite }) {
  const toast = useToast();
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const candidates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const existingIds = new Set(group.members.map((m) => m.id));
    const list = users.filter((u) => !existingIds.has(u.id));
    if (!needle) return list;
    return list.filter(
      (u) =>
        u.username.toLowerCase().includes(needle) ||
        (u.displayName || '').toLowerCase().includes(needle),
    );
  }, [users, search, group.members]);

  const toggleMember = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size + group.members.length < MEMBER_LIMIT) next.add(id);
      else toast.info(`Максимум ${MEMBER_LIMIT} участников`);
      return next;
    });
  };

  const submit = async () => {
    if (selectedIds.size === 0) return;
    setBusy(true);
    try {
      await onInvite([...selectedIds]);
      toast.info('Участники добавлены');
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Не удалось добавить участников');
    } finally {
      setBusy(false);
    }
  };

  const reduce = useReducedMotion();
  const overlayV = reduce ? reducedVariants(overlayVariants) : overlayVariants;
  const panelV = reduce ? reducedVariants(modalVariants) : modalVariants;

  return (
    <motion.div
      className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm grid place-items-center p-4"
      variants={overlayV}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <motion.div
        className="w-full max-w-md bg-bg-1 border border-border rounded-2xl shadow-soft overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        variants={panelV}
      >
        <header className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Пригласить участников</h2>
          <button className="btn-ghost" onClick={onClose} title="Закрыть">
            <X size={18} />
          </button>
        </header>

        <div className="p-4 space-y-4">
          <input
            className="input"
            placeholder="Поиск…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {candidates.map((u) => {
              const sel = selectedIds.has(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleMember(u.id)}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left ${
                    sel ? 'bg-accent/20 border border-accent/40' : 'hover:bg-bg-2'
                  }`}
                >
                  <Avatar
                    name={getDisplayName(u)}
                    src={getAvatarUrl(u)}
                    size={28}
                    online={u.online}
                    showStatus
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-100 truncate">{getDisplayName(u)}</div>
                    <div className="text-xs text-slate-500 truncate">@{u.username}</div>
                  </div>
                  {sel ? (
                    <UserMinus size={14} className="text-accent" />
                  ) : (
                    <UserPlus size={14} className="text-slate-500" />
                  )}
                </button>
              );
            })}
            {candidates.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-4">
                {search ? 'Никого не найдено' : 'Все пользователи уже в группе'}
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 p-4 border-t border-border bg-bg-0/40">
          <div className="text-xs text-slate-500">{selectedIds.size} выбрано</div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={busy} className="btn-ghost" type="button">
              Отмена
            </button>
            <button
              onClick={submit}
              disabled={busy || selectedIds.size === 0}
              className="btn-primary"
              type="button"
            >
              <Check size={14} />
              Добавить
            </button>
          </div>
        </footer>
      </motion.div>
    </motion.div>
  );
}
