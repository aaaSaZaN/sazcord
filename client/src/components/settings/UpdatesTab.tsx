// Таб «Обновления». Виден на всех платформах — в отличие от прежней
// реализации, где проверка обновлений жила ссылкой в подвале сайдбара и
// рендерилась только в Electron. Владелец APK и веб-юзер до этого не
// могли ни узнать версию, ни запустить проверку.
//
// Что именно делает кнопка, зависит от канала (см. utils/updates):
//   desktop — electron-updater качает в фоне, «Перезапустить и обновить»
//             применяет; на macOS без Developer ID вместо этого
//             открывается .dmg.
//   android — дёргаем нативную обёртку, она качает APK и отдаёт его
//             PackageInstaller.
//   web/PWA — сравниваем версию бандла с версией сервера, применяем
//             перезагрузкой страницы.
//
// Внизу — «Выйти с сервера». Живёт именно здесь, потому что доступен
// только оболочкам (десктоп/APK): в браузере адрес сервера — это адрес
// вкладки, выходить некуда.

import { useCallback, useEffect, useState } from 'react';
import { Download, LogOut, RefreshCw, Server } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { isDesktop, getDesktopVersion, leaveServer } from '../../utils/desktop';
import { isAndroidShell, androidLeaveServer } from '../../utils/mobile';
import {
  subscribeUpdates,
  checkNow,
  applyUpdate,
  currentVersion,
  updateChannel,
  type UpdateStatus,
} from '../../utils/updates';

const CHANNEL_LABEL: Record<string, string> = {
  desktop: 'Десктоп-приложение',
  android: 'Android-приложение',
  web: 'Браузер / PWA',
};

export function UpdatesTab() {
  const toast = useToast();
  const channel = updateChannel();
  const [status, setStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const [checking, setChecking] = useState(false);
  // В Electron версия оболочки приходит из main-процесса и может
  // отличаться от версии веб-бандла (клиент обновился, приложение — нет).
  const [shellVersion, setShellVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (isDesktop()) {
      void getDesktopVersion().then((v) => {
        if (alive) setShellVersion(v);
      });
    } else {
      setShellVersion(currentVersion());
    }
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    return subscribeUpdates((s) => {
      setStatus(s);
      // Снимаем «проверяю» только на терминальном статусе, иначе кнопка
      // разблокируется раньше, чем придёт результат.
      if (s.kind !== 'checking') setChecking(false);
    });
  }, []);

  const onCheck = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    setStatus({ kind: 'checking' });
    const res = await checkNow();
    // 'checking' означает «результат придёт подпиской» — не трогаем UI.
    if (res.kind !== 'checking') {
      setStatus(res);
      setChecking(false);
    }
  }, [checking]);

  const onLeave = useCallback(async () => {
    if (isAndroidShell()) {
      if (!androidLeaveServer()) {
        toast.error('Обнови приложение, чтобы выйти с сервера');
      }
      return;
    }
    if (!(await leaveServer())) toast.error('Не удалось выйти с сервера');
  }, [toast]);

  const ready = status.kind === 'downloaded';
  const available = status.kind === 'available';
  const inFlight = checking || status.kind === 'checking' || status.kind === 'progress';

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm">Версия</div>
            <div className="text-xs text-slate-500">{CHANNEL_LABEL[channel] || channel}</div>
          </div>
          <div className="text-sm tabular-nums text-slate-300 select-text shrink-0">
            {shellVersion || '—'}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-ghost h-9 px-3 text-sm disabled:opacity-50 flex items-center gap-2"
            onClick={onCheck}
            disabled={inFlight}
          >
            <RefreshCw size={14} className={inFlight ? 'animate-spin' : ''} />
            {inFlight ? 'Проверяю…' : 'Проверить обновления'}
          </button>

          {(ready || (available && channel !== 'desktop')) && (
            <button
              type="button"
              className="h-9 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors flex items-center gap-2"
              onClick={() => void applyUpdate()}
            >
              <Download size={14} />
              {applyLabel(channel, status)}
            </button>
          )}
        </div>

        <StatusLine status={status} />
      </section>

      {channel !== 'web' && (
        <section className="flex flex-col gap-3 pt-4 border-t border-border">
          <div className="flex items-center gap-3 min-w-0">
            <span className="opacity-70 shrink-0">
              <Server size={16} />
            </span>
            <div className="min-w-0">
              <div className="text-sm">Сервер</div>
              <div className="text-xs text-slate-500">
                Выход сотрёт адрес сервера и сессию. Приложение вернётся к экрану
                подключения — адрес можно будет ввести заново.
              </div>
            </div>
          </div>
          <button
            type="button"
            className="btn-ghost h-9 px-3 text-sm self-start flex items-center gap-2 text-danger"
            onClick={() => void onLeave()}
          >
            <LogOut size={14} />
            Выйти с сервера
          </button>
        </section>
      )}
    </div>
  );
}

function applyLabel(channel: string, status: UpdateStatus): string {
  if (status.kind === 'downloaded' && status.manual) return 'Скачать';
  if (channel === 'android') return 'Обновить';
  if (channel === 'web') return 'Перезагрузить';
  return 'Перезапустить и обновить';
}

function StatusLine({ status }: { status: UpdateStatus }) {
  if (status.kind === 'idle' || status.kind === 'checking') return null;

  if (status.kind === 'none') {
    return <div className="text-xs text-slate-500">Установлена последняя версия.</div>;
  }
  if (status.kind === 'error') {
    return <div className="text-xs text-danger break-words">{status.message}</div>;
  }
  if (status.kind === 'progress') {
    const pct = Math.max(0, Math.min(100, Math.round(status.percent)));
    return <div className="text-xs text-slate-500 tabular-nums">Скачивание… {pct}%</div>;
  }
  if (status.kind === 'available') {
    return (
      <div className="text-xs text-slate-500 break-words">
        Доступна версия {status.version || '—'}
        {status.notes ? ` — ${status.notes}` : ''}
      </div>
    );
  }
  return (
    <div className="text-xs text-slate-500">
      Обновление {status.version || ''} готово к установке.
    </div>
  );
}
