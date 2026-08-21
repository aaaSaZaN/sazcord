import { useEffect, useState } from 'react';
import { Phone, Video, PhoneIncoming, PhoneOutgoing, PhoneMissed, PhoneOff } from 'lucide-react';
import { formatDuration } from '../utils/user';

/**
 * Системное сообщение о звонке (kind='call').
 * payload: { callId, withVideo, status, startedAt?, endedAt?, durationMs?, outcome?, reconnectUntil? }
 *
 * status: 'pending' | 'active' | 'waiting' | 'ended'
 * outcome: 'completed' | 'missed' | 'rejected' | 'cancelled' | 'expired'
 *
 * Для статуса 'waiting' — показывает кнопку "Подключиться" и таймер до истечения.
 */
export default function CallMessage({ message, selfId, onRejoin = null }) {
  const payload = message.payload || {};
  const mine = message.senderId === selfId;
  const withVideo = !!payload.withVideo;

  const Icon = withVideo ? Video : Phone;

  const status = payload.status;
  const outcome = payload.outcome;
  const durationMs = payload.durationMs;
  const reconnectUntil = payload.reconnectUntil;

  // Тикаем секундный таймер для отображения оставшегося окна реконнекта.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== 'waiting' || !reconnectUntil) return undefined;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [status, reconnectUntil]);

  const title = withVideo ? 'Видеозвонок' : 'Звонок';
  let subtitle = '';
  let tone = 'neutral'; // neutral | success | danger | warn

  if (status === 'pending') {
    subtitle = mine ? 'исходящий — соединение…' : 'входящий…';
    tone = 'neutral';
  } else if (status === 'active') {
    subtitle = 'идёт сейчас';
    tone = 'success';
  } else if (status === 'waiting') {
    const left = Math.max(0, (reconnectUntil || 0) - now);
    subtitle = `ждём собеседника · ${formatDuration(left)}`;
    tone = 'warn';
  } else if (status === 'ended') {
    if (outcome === 'completed') {
      subtitle = `длительность ${formatDuration(durationMs || 0)}`;
      tone = 'neutral';
    } else if (outcome === 'missed') {
      subtitle = mine ? 'не отвечен' : 'пропущенный';
      tone = 'danger';
    } else if (outcome === 'rejected') {
      subtitle = mine ? 'отклонён' : 'отклонён вами';
      tone = 'danger';
    } else if (outcome === 'cancelled') {
      subtitle = mine ? 'отменён' : 'отменён';
      tone = 'neutral';
    } else if (outcome === 'expired') {
      subtitle = 'время для переподключения вышло';
      tone = 'danger';
    } else {
      subtitle = 'завершён';
    }
  }

  // Иконка в зависимости от роли и итога
  let IconRole = Icon;
  if (status === 'ended' && outcome === 'missed') IconRole = PhoneMissed;
  else if (
    status === 'ended' &&
    (outcome === 'rejected' || outcome === 'cancelled' || outcome === 'expired')
  )
    IconRole = PhoneOff;
  else if (status !== 'active' && status !== 'waiting')
    IconRole = mine ? PhoneOutgoing : PhoneIncoming;

  const tones = {
    neutral: 'text-slate-300 border-border bg-bg-2',
    success: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
    danger: 'text-red-300 border-red-500/30 bg-red-500/10',
    warn: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  };

  // Кнопка «Подключиться» в чат-плашке убрана — она дублирует кнопку
  // в самом окне звонка (CallView в waiting-состоянии у leaver'а) и
  // плодила путаницу: статус 'waiting' пишется в чат для обоих, и
  // у того, кто остался в звонке, тоже появлялась кнопка, которую он
  // не должен видеть. Реджойн теперь только через окно звонка.
  void onRejoin;

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="flex justify-center">
      <div
        className={`max-w-[90%] flex items-center gap-3 px-3 py-2 rounded-xl border text-sm ${tones[tone]}`}
        title={new Date(message.createdAt).toLocaleString()}
      >
        <IconRole size={16} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium leading-tight">{title}</div>
          <div className="text-xs opacity-80 truncate">{subtitle}</div>
        </div>
        <span className="text-[10px] opacity-60 shrink-0">{time}</span>
      </div>
    </div>
  );
}
