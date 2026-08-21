import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, RefreshCw, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  subscribeUpdates,
  applyUpdate,
  updateChannel,
  type UpdateChannel,
  type UpdateStatus,
} from '../utils/updates';

/**
 * Плашка обновления.
 *
 * Раньше рендерилась только в Electron: всё было закрыто isDesktop(),
 * потому что единственным источником событий был IPC от electron-updater.
 * Владелец APK и веб-юзер про новые версии не узнавали вообще никак.
 * Теперь источник общий (utils/updates), а от канала зависит только текст
 * и то, что делает кнопка:
 *
 *   desktop — качается в фоне, кнопка появляется на 'downloaded' и
 *             перезапускает приложение (на macOS без Developer ID —
 *             открывает .dmg, см. manual).
 *   android — качает и ставит нативная обёртка, кнопка её дёргает.
 *   web/PWA — кнопка перезагружает страницу.
 *
 * 'checking' и 'none' молчат: сообщать не о чем. Закрытую крестиком
 * версию повторно не показываем.
 */
export default function UpdateToast() {
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const channel = updateChannel();

  useEffect(() => {
    return subscribeUpdates((s) => {
      if (s.kind === 'checking' || s.kind === 'none' || s.kind === 'idle') return;
      setStatus(s);
    });
  }, []);

  if (status.kind === 'idle' || status.kind === 'checking' || status.kind === 'none') return null;

  const version =
    status.kind === 'available' || status.kind === 'downloaded' ? status.version : undefined;

  if (version && dismissedVersion === version) return null;

  const dismiss = () => {
    setDismissedVersion(version || '__error__');
    setStatus({ kind: 'idle' });
  };

  return (
    <AnimatePresence>
      <motion.div
        key="update-toast"
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        className="fixed bottom-4 right-4 z-[70] w-[min(92vw,360px)] rounded-xl border border-border bg-bg-2/95 backdrop-blur shadow-soft text-sm text-slate-100"
        role="status"
        aria-live="polite"
      >
        <div className="px-4 py-3 pr-9 relative">
          <button
            onClick={dismiss}
            className="absolute top-2 right-2 opacity-60 hover:opacity-100 transition-opacity rounded p-1 hover:bg-black/20"
            title="Скрыть"
            aria-label="Скрыть уведомление"
          >
            <X size={14} />
          </button>

          {status.kind === 'available' && (
            <AvailableBody
              channel={channel}
              version={status.version}
              notes={status.notes}
              onApply={() => void applyUpdate()}
            />
          )}

          {status.kind === 'progress' && (
            <ProgressBody
              percent={status.percent}
              transferred={status.transferred}
              total={status.total}
              bytesPerSecond={status.bytesPerSecond}
            />
          )}

          {status.kind === 'downloaded' && (
            <DownloadedBody
              version={status.version}
              manual={status.manual}
              onInstall={() => void applyUpdate()}
            />
          )}

          {status.kind === 'error' && <ErrorBody message={status.message} />}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// ---------------- Подпанели разных стейтов ----------------------------

function AvailableBody({
  channel,
  version,
  notes,
  onApply,
}: {
  channel: UpdateChannel;
  version?: string;
  notes?: string | null;
  onApply: () => void;
}) {
  // В десктопе на этой стадии апдейтер уже качает installer в фоне —
  // кнопка появится сама на 'downloaded'. В остальных каналах действие
  // требуется от пользователя прямо сейчас.
  const isDesktop = channel === 'desktop';
  const hint = isDesktop
    ? 'Скачивается в фоне…'
    : channel === 'android'
      ? 'Скачается и установится в приложении.'
      : 'Перезагрузи страницу, чтобы применить.';

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2.5">
        <Download size={18} className="mt-0.5 text-accent flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-medium leading-tight">
            {version ? `Доступно обновление ${version}` : 'Доступно обновление'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{hint}</div>
          {notes && <div className="text-xs text-slate-500 mt-1 break-words">{notes}</div>}
        </div>
      </div>

      {!isDesktop && (
        <button
          onClick={onApply}
          className="self-end flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
        >
          {channel === 'android' ? <Download size={13} /> : <RefreshCw size={13} />}
          {channel === 'android' ? 'Обновить' : 'Перезагрузить'}
        </button>
      )}
    </div>
  );
}

function ProgressBody({
  percent,
  transferred,
  total,
  bytesPerSecond,
}: {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <Download size={18} className="text-accent flex-shrink-0 animate-pulse" />
        <div className="font-medium leading-tight">Скачивание обновления…</div>
      </div>

      <div className="h-1.5 rounded-full bg-bg-3 overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
        <span>{pct}%</span>
        <span>
          {formatBytes(transferred)} / {formatBytes(total)} • {formatBytes(bytesPerSecond)}/с
        </span>
      </div>
    </div>
  );
}

function DownloadedBody({
  version,
  manual,
  onInstall,
}: {
  version?: string;
  manual?: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-2.5">
        <CheckCircle2 size={18} className="mt-0.5 text-success flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-medium leading-tight">
            {manual
              ? version
                ? `Доступна версия ${version}`
                : 'Доступно обновление'
              : version
                ? `Обновление ${version} готово`
                : 'Обновление готово'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {manual
              ? 'Скачай .dmg и перетащи Sazcord в «Программы».'
              : 'Перезапусти приложение, чтобы установить.'}
          </div>
        </div>
      </div>

      <button
        onClick={onInstall}
        className="self-end flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
      >
        {manual ? <Download size={13} /> : <RefreshCw size={13} />}
        {manual ? 'Скачать' : 'Перезапустить и обновить'}
      </button>
    </div>
  );
}

function ErrorBody({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <AlertCircle size={18} className="mt-0.5 text-danger flex-shrink-0" />
      <div className="min-w-0">
        <div className="font-medium leading-tight">Ошибка обновления</div>
        <div className="text-xs text-slate-400 mt-0.5 break-words">{message}</div>
      </div>
    </div>
  );
}

// ---------------- helpers --------------------------------------------

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
