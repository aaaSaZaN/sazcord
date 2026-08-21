// Таб «Уведомления»: web push (sub/unsub), мастер-тумблер UI-звуков,
// громкость UI, и пер-событийные тумблеры (с превью звука для каждого).
// PushBlock — приватный helper того же таба, выносить в отдельный файл
// смысла нет.

import { useEffect, useState } from 'react';
import { Bell, BellOff, Volume2, Play, Smartphone } from 'lucide-react';
import { pushSupported, getPushStatus, enablePush, disablePush } from '../../utils/push';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useSounds } from '../../hooks/useSounds';
import { ToggleRow, SliderRow, Switch } from './shared';
import InstallPrompt from '../InstallPrompt';

type PushStatus = {
  configured?: boolean;
  subscribed?: boolean;
  permission?: NotificationPermission;
} | null;

export function NotificationsTab() {
  const { settings, update } = useSettings();
  const { auth } = useAuth();
  const toast = useToast();
  const sounds = useSounds(settings);
  const [pushStatus, setPushStatus] = useState<PushStatus>(null);
  const [pushBusy, setPushBusy] = useState(false);

  const refreshPush = async () => {
    const s = await getPushStatus(auth?.token);
    setPushStatus(s);
  };

  useEffect(() => {
    refreshPush();
    // refreshPush сам читает токен — пересинхронизируемся при логине/логауте.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token]);

  const onTogglePush = async (next: boolean) => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (next) {
        await enablePush(auth?.token);
      } else {
        await disablePush(auth?.token);
      }
      await refreshPush();
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось изменить настройку push');
    } finally {
      setPushBusy(false);
    }
  };

  const items = [
    { key: 'soundMessage', label: 'Новое сообщение', preview: 'message' },
    { key: 'soundIncoming', label: 'Входящий звонок', preview: 'incoming' },
    { key: 'soundOutgoing', label: 'Гудки исходящего', preview: 'outgoing' },
    { key: 'soundConnect', label: 'Соединение установлено', preview: 'connect' },
    { key: 'soundDisconnect', label: 'Завершение звонка', preview: 'disconnect' },
    // Превью этих двух проигрывает обе половинки (mute → unmute), чтобы
    // юзер услышал, как звучит каждое направление переключения. Сами
    // тумблеры — общие на пару (см. useSounds.ts, разделение на 2 флага).
    { key: 'soundMicMute', label: 'Микрофон вкл/выкл', preview: 'micMute' },
    { key: 'soundDeafen', label: 'Звук собеседников вкл/выкл', preview: 'deafen' },
  ];

  return (
    <section className="space-y-5">
      {/* PWA install (выше push: сначала устанавливаем, потом подписываемся) */}
      <InstallPrompt />

      {/* Web Push */}
      <PushBlock status={pushStatus} busy={pushBusy} onToggle={onTogglePush} />

      <div className="h-px bg-border" />

      {/* Master switch */}
      <ToggleRow
        title="Звуки интерфейса"
        description="Главный переключатель UI-звуков"
        icon={settings.soundsEnabled ? <Bell size={16} /> : <BellOff size={16} />}
        checked={settings.soundsEnabled}
        onChange={(v) => update({ soundsEnabled: v })}
      />

      {/* UI volume */}
      <div className="space-y-1.5">
        <label className="text-xs text-slate-400 uppercase tracking-wider">
          Громкость UI-звуков
        </label>
        <SliderRow
          icon={<Volume2 size={14} className="text-slate-400" />}
          value={Math.round((settings.uiVolume ?? 0.8) * 100)}
          min={0}
          max={100}
          step={1}
          unit="%"
          disabled={!settings.soundsEnabled}
          onChange={(v) => update({ uiVolume: v / 100 })}
        />
      </div>

      <div className="h-px bg-border" />

      {/* Granular toggles */}
      <div className="space-y-1.5">
        <div className="text-xs text-slate-400 uppercase tracking-wider">События</div>
        <div className="rounded-lg border border-border divide-y divide-border bg-bg-2">
          {items.map((it) => (
            <div
              key={it.key}
              className={`flex items-center gap-3 px-3 py-2.5 ${
                !settings.soundsEnabled ? 'opacity-50' : ''
              }`}
            >
              <div className="flex-1 min-w-0 text-sm">{it.label}</div>
              <button
                type="button"
                onClick={() => sounds.preview(it.preview)}
                disabled={!settings.soundsEnabled}
                className="btn-ghost h-7 px-2 text-xs"
                title="Прослушать"
              >
                <Play size={12} className="mr-1" />
                <span>Тест</span>
              </button>
              <Switch
                checked={settings[it.key] !== false}
                onChange={(v) => update({ [it.key]: v })}
                disabled={!settings.soundsEnabled}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PushBlock({
  status,
  busy,
  onToggle,
}: {
  status: PushStatus;
  busy: boolean;
  onToggle: (v: boolean) => void;
}) {
  if (!pushSupported()) {
    return (
      <div className="rounded-lg border border-border bg-bg-2 p-3 text-sm text-slate-400">
        <div className="flex items-center gap-2 mb-1">
          <Smartphone size={16} />
          <span className="font-medium text-slate-200">Системные уведомления</span>
        </div>
        Ваш браузер не поддерживает Web Push. На iOS Safari это работает только в режиме PWA
        (Добавить на главный экран).
      </div>
    );
  }
  if (status && status.configured === false) {
    return (
      <div className="rounded-lg border border-border bg-bg-2 p-3 text-sm text-slate-400">
        <div className="flex items-center gap-2 mb-1">
          <Smartphone size={16} />
          <span className="font-medium text-slate-200">Системные уведомления</span>
        </div>
        Push не настроен на сервере (отсутствует VAPID-конфигурация). Свяжитесь с администратором.
      </div>
    );
  }
  const subscribed = !!status?.subscribed;
  const denied = status?.permission === 'denied';
  return (
    <div className="rounded-lg border border-border bg-bg-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Smartphone size={16} className="opacity-70" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Системные уведомления</div>
            <div className="text-xs text-slate-500">
              {denied
                ? 'Разрешение запрещено в браузере. Включите в настройках сайта.'
                : subscribed
                  ? 'Включены на этом устройстве. Вы будете получать уведомления о звонках и сообщениях.'
                  : 'Получайте уведомления, даже когда вкладка закрыта.'}
            </div>
          </div>
        </div>
        <Switch checked={subscribed} onChange={(v) => onToggle(v)} disabled={busy || denied} />
      </div>
    </div>
  );
}
