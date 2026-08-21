import { UserPlus, UserMinus, LogOut as LogOutIcon, Users as UsersIcon } from 'lucide-react';

/**
 * Системное сообщение в групповом чате (kind='system').
 * payload: { type, actorId, targetIds[] }
 *
 * type:
 *   'group_created'   — кто-то создал группу
 *   'member_added'    — actor добавил targetIds в группу
 *   'member_removed'  — actor исключил targetIds
 *   'member_left'     — actor сам вышел
 */
export default function SystemMessage({ message, sendersById }) {
  const payload = message.payload || {};
  const { type, actorId, targetIds = [] } = payload;

  const nameOf = (id) => {
    const u = sendersById?.get?.(id) || sendersById?.[id];
    if (!u) return `#${id}`;
    return u.displayName || u.username || `#${id}`;
  };

  const actor = nameOf(actorId);
  const targets = (targetIds || []).map(nameOf).join(', ');

  let Icon = UsersIcon;
  let text = '';

  if (type === 'group_created') {
    Icon = UsersIcon;
    text = `${actor} создал(а) группу`;
  } else if (type === 'member_added') {
    Icon = UserPlus;
    text = `${actor} добавил(а) ${targets}`;
  } else if (type === 'member_removed') {
    Icon = UserMinus;
    text = `${actor} исключил(а) ${targets}`;
  } else if (type === 'member_left') {
    Icon = LogOutIcon;
    text = `${actor} вышел(а) из группы`;
  } else {
    text = '';
  }

  if (!text) return null;

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex justify-center my-1">
      <div
        className="max-w-[90%] flex items-center gap-2 px-3 py-1.5 rounded-full
                   bg-bg-2 border border-border text-xs text-slate-300"
        title={new Date(message.createdAt).toLocaleString()}
      >
        <Icon size={12} className="opacity-70 shrink-0" />
        <span className="truncate">{text}</span>
        <span className="text-[10px] opacity-50 shrink-0">{time}</span>
      </div>
    </div>
  );
}
