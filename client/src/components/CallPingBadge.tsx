import { useState } from 'react';
import { Activity, Wifi, ChevronDown, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export type CallStats = {
  ping: number | null;
  packetLoss: number | null;
  quality: 'good' | 'fair' | 'poor' | 'unknown';
  bitrateInKbps?: number | null;
  bitrateOutKbps?: number | null;
  codec?: string | null;
  protocol?: string | null;
  /** Реальные адреса выбранного ICE-пары: «srflx 203.0.113.7/udp». */
  routeLocal?: string | null;
  routeRemote?: string | null;
};

type CallPingBadgeProps = {
  stats?: CallStats | null;
  className?: string;
};

export default function CallPingBadge({ stats, className = '' }: CallPingBadgeProps) {
  const [open, setOpen] = useState(false);

  const ping = stats?.ping ?? null;
  const loss = stats?.packetLoss ?? 0;
  const quality = stats?.quality ?? 'unknown';

  let colorClass = 'text-slate-400 border-white/10 bg-black/30';
  let dotClass = 'bg-slate-400';
  let qualityText = 'Определение…';
  let QualityIcon = Activity;

  if (quality === 'good' || (ping !== null && ping < 100 && loss < 2)) {
    colorClass = 'text-emerald-400 border-emerald-500/30 bg-emerald-950/40 hover:bg-emerald-950/60';
    dotClass = 'bg-emerald-400';
    qualityText = 'Отличное качество';
    QualityIcon = CheckCircle2;
  } else if (quality === 'fair' || (ping !== null && ping < 250 && loss < 6)) {
    colorClass = 'text-amber-400 border-amber-500/30 bg-amber-950/40 hover:bg-amber-950/60';
    dotClass = 'bg-amber-400';
    qualityText = 'Среднее качество';
    QualityIcon = AlertTriangle;
  } else if (quality === 'poor' || (ping !== null && (ping >= 250 || loss >= 6))) {
    colorClass = 'text-rose-400 border-rose-500/30 bg-rose-950/40 hover:bg-rose-950/60';
    dotClass = 'bg-rose-400 animate-pulse';
    qualityText = 'Нестабильная связь';
    QualityIcon = XCircle;
  }

  return (
    <div className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className={`interactive-scale inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border backdrop-blur-md transition-colors ${colorClass}`}
        title="Статистика соединения"
      >
        <span className={`w-2 h-2 rounded-full ${dotClass}`} />
        <Wifi size={12} className="opacity-80" />
        <span>{ping !== null ? `${ping} мс` : '…'}</span>
        {loss > 0 && <span className="text-[10px] opacity-75">({loss}%)</span>}
        <ChevronDown size={10} className={`opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 w-56 p-3 rounded-xl bg-slate-900/95 border border-white/10 shadow-2xl backdrop-blur-xl text-left text-xs space-y-2 animate-in fade-in zoom-in-95 pointer-events-auto">
          <div className="flex items-center gap-1.5 font-semibold text-slate-200 border-b border-white/10 pb-1.5">
            <QualityIcon size={14} className={dotClass.replace('bg-', 'text-')} />
            <span>{qualityText}</span>
          </div>

          <div className="space-y-1 text-slate-300">
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Задержка (RTT):</span>
              <span className="font-mono font-medium">{ping !== null ? `${ping} мс` : '—'}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-slate-400">Потеря пакетов:</span>
              <span className={`font-mono font-medium ${loss > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {loss}%
              </span>
            </div>

            {stats?.bitrateInKbps != null && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Входящий поток:</span>
                <span className="font-mono">{stats.bitrateInKbps} кбит/с</span>
              </div>
            )}

            {stats?.bitrateOutKbps != null && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Исходящий поток:</span>
                <span className="font-mono">{stats.bitrateOutKbps} кбит/с</span>
              </div>
            )}

            {stats?.codec && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Аудио кодек:</span>
                <span className="font-mono uppercase">{stats.codec}</span>
              </div>
            )}

            {stats?.protocol && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Маршрут:</span>
                <span className="font-mono text-[11px]">
                  {stats.protocol === 'relay' ? 'TURN Relay' : 'Direct (P2P)'}
                </span>
              </div>
            )}

            {(stats?.routeLocal || stats?.routeRemote) && (
              <div className="border-t border-white/10 pt-1.5 space-y-1">
                {stats?.routeLocal && (
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-slate-400 shrink-0">Мой адрес:</span>
                    <span className="font-mono text-[10px] break-all text-right">
                      {stats.routeLocal}
                    </span>
                  </div>
                )}
                {stats?.routeRemote && (
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-slate-400 shrink-0">Адрес пира:</span>
                    <span className="font-mono text-[10px] break-all text-right">
                      {stats.routeRemote}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
