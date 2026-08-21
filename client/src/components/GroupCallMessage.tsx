import { Phone, Video as VideoIcon } from 'lucide-react';

/**
 * Системное сообщение о групповом звонке (kind='groupcall').
 * payload: { type: 'groupcall', status: 'active'|'ended', callId, startedBy,
 *            startedAt, withVideo, endedAt? }
 *
 * Пока status='active' — рендерится с кнопкой «Подключиться».
 * После status='ended' — просто строчка «звонок завершён».
 */
export default function GroupCallMessage({ message, sendersById, onJoin, isJoined }) {
  const payload = message.payload || {};
  const status = payload.status || 'ended';
  const withVideo = !!payload.withVideo;
  const Icon = withVideo ? VideoIcon : Phone;

  const nameOf = (id) => {
    const u = sendersById?.get?.(id) || sendersById?.[id];
    if (!u) return `#${id}`;
    return u.displayName || u.username || `#${id}`;
  };

  const actor = nameOf(payload.startedBy);
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  let title;
  let tone;
  if (status === 'active') {
    title = `${actor} начал(а) ${withVideo ? 'видеозвонок' : 'звонок'}`;
    tone = 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';
  } else {
    title = 'Групповой звонок завершён';
    tone = 'bg-bg-2 border-border text-slate-300';
  }

  const canJoin = status === 'active' && typeof onJoin === 'function' && !isJoined;

  return (
    <div className="flex justify-center my-1.5">
      <div
        className={`max-w-[90%] flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs ${tone}`}
        title={new Date(message.createdAt).toLocaleString()}
      >
        <Icon size={12} className="opacity-80 shrink-0" />
        <span className="truncate">{title}</span>
        {canJoin && (
          <button
            type="button"
            onClick={() => onJoin(message)}
            className="btn-primary h-6 px-2 text-[11px]"
          >
            Подключиться
          </button>
        )}
        {isJoined && status === 'active' && (
          <span className="text-[10px] opacity-70">— вы в звонке</span>
        )}
        <span className="text-[10px] opacity-50 shrink-0">{time}</span>
      </div>
    </div>
  );
}
