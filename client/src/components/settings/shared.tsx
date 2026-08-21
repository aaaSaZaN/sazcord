// Общие атомы для всех табов настроек: PermissionRow, SliderRow,
// ToggleRow, Switch. Раньше жили в самом конце SettingsPanel.tsx.
// Вынесены в отдельный файл, чтобы не плодить циклические импорты,
// когда табы будут в собственных файлах.

import type { CSSProperties, ReactNode } from 'react';

// Подписи для статусов permissions API. Раньше были в AudioTab,
// но логически они общие — оставим тут вместе с PermissionRow,
// который их использует.
export const PERMISSION_TEXT: Record<string, string> = {
  granted: 'Разрешено',
  denied: 'Запрещено',
  prompt: 'Нужно разрешение',
  unknown: 'Неизвестно',
};

export function permissionClass(status: string) {
  if (status === 'granted') return 'text-emerald-400';
  if (status === 'denied') return 'text-red-400';
  return 'text-amber-300';
}

export function PermissionRow({
  icon,
  title,
  description,
  status,
  busy,
  onRequest,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status: string;
  busy: boolean;
  onRequest: () => void;
}) {
  const label = PERMISSION_TEXT[status] || PERMISSION_TEXT.unknown;
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="opacity-70 shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm">{title}</div>
          <div className="text-xs text-slate-500">{description}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-xs tabular-nums ${permissionClass(status)}`}>{label}</span>
        <button
          type="button"
          className="btn-ghost h-8 px-2 text-xs disabled:opacity-50"
          onClick={onRequest}
          disabled={busy}
        >
          {busy ? '…' : 'Разрешить'}
        </button>
      </div>
    </div>
  );
}

export function SliderRow({
  icon,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
  disabled = false,
}: {
  icon: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 pt-1 ${disabled ? 'opacity-50' : ''}`}>
      {icon}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="range flex-1"
        style={{ '--range-progress': `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
      <span className="text-xs text-slate-400 w-16 text-right tabular-nums">
        {value}
        {unit}
      </span>
    </div>
  );
}

export function ToggleRow({
  title,
  description,
  icon,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${disabled ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className="opacity-70 shrink-0">{icon}</span>
        <div className="min-w-0">
          <div className="text-sm">{title}</div>
          {description && <div className="text-xs text-slate-500">{description}</div>}
        </div>
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
        checked ? 'bg-accent' : 'bg-bg-3'
      } ${disabled ? 'cursor-not-allowed' : ''}`}
      role="switch"
      aria-checked={checked}
      type="button"
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
          checked ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </button>
  );
}
