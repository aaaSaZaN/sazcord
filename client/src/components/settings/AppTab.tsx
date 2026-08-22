// Таб «Приложение»: десктоп-специфичные настройки оболочки Electron.
//
// На вебе вкладка не показывается (desktopOnly в SettingsPanel.ALL_TABS).
//
// Поля в desktop config'е (см. desktop/config.js):
//   autoStart   — boolean, регистрировать ли Sazcord в Windows login items.
//                 При включении на следующий вход в Windows приложение
//                 запустится с флагом --hidden (см. desktop/main.js
//                 startHidden), то есть сразу сядет в трей без всплытия
//                 окна. Юзер раскрывает его кликом по tray-иконке.
//   closeToTray — boolean, по дефолту true. Крестик прячет окно в трей,
//                 а не завершает приложение. Полезно для голосового
//                 мессенджера: звонки/уведомления остаются живы. Можно
//                 отключить, если хочется классического поведения.
//
// Чтение/запись через window.electronAPI.getConfig / setConfig — это
// уже существующий generic IPC. Главный процесс при изменении autoStart
// синкает с ОС-уровнем (setLoginItemSettings), при изменении
// closeToTray — просто перечитывает поле в close-handler'е.

import { useEffect, useState } from 'react';
import { Power, MinusSquare, ShieldAlert } from 'lucide-react';
import { ToggleRow } from './shared';
import { useToast } from '../../context/ToastContext';
import { isDesktop, relaunchAsAdmin, getDesktopPlatform } from '../../utils/desktop';

export function AppTab() {
  const toast = useToast();
  const [autoStart, setAutoStart] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const platform = getDesktopPlatform();
  const isMac = platform === 'darwin' || (/Mac|iPhone|iPad/i.test(navigator.platform || '') && !platform);
  const isLinux = platform === 'linux';
  const isWin = platform === 'win32' || (!isMac && !isLinux);

  const autoStartTitle = isMac
    ? 'Запускать при входе в macOS'
    : isLinux
      ? 'Запускать при старте системы'
      : 'Запускать при старте Windows';

  const autoStartDesc = isMac
    ? 'Приложение будет автоматически запускаться при входе пользователя в систему.'
    : 'Приложение будет автоматически запускаться при входе в систему и работать в фоне. Удобно, чтобы не пропускать звонки и сообщения.';

  useEffect(() => {
    if (!isDesktop()) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cfg = await window.electronAPI?.getConfig?.();
        if (cancelled) return;
        if (cfg) {
          setAutoStart(!!cfg.autoStart);
          setCloseToTray(cfg.closeToTray !== false);
        }
      } catch (e) {
        console.warn('[AppTab] load config failed:', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateCfg = async (patch: { autoStart?: boolean; closeToTray?: boolean }) => {
    if (!isDesktop()) return;
    try {
      await window.electronAPI?.setConfig?.(patch);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error?.('Не удалось сохранить настройку: ' + msg);
    }
  };

  const onAutoStartChange = (v: boolean) => {
    setAutoStart(v);
    updateCfg({ autoStart: v });
  };

  const onCloseToTrayChange = (v: boolean) => {
    setCloseToTray(v);
    updateCfg({ closeToTray: v });
  };

  const [restartBusy, setRestartBusy] = useState(false);
  const onRestartAsAdmin = async () => {
    if (restartBusy) return;
    setRestartBusy(true);
    const result = await relaunchAsAdmin();
    if (!result.ok) {
      toast.error?.('Не удалось перезапустить: ' + (result.error || 'неизвестная ошибка'));
      setRestartBusy(false);
    }
    setTimeout(() => setRestartBusy(false), 3000);
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-2 p-4 space-y-4">
        <ToggleRow
          icon={<Power size={18} />}
          title={autoStartTitle}
          description={autoStartDesc}
          checked={autoStart}
          onChange={onAutoStartChange}
          disabled={!loaded}
        />
        <div className="h-px bg-border" />
        <ToggleRow
          icon={<MinusSquare size={18} />}
          title={isMac ? 'Оставаться в фоне при закрытии окна' : 'Сворачивать в трей при закрытии'}
          description={
            isMac
              ? 'Крестик закрывает окно, но оставляет приложение активным в строке меню — звонки и уведомления продолжают работать.'
              : 'Крестик скрывает окно в трей вместо завершения приложения — звонки и уведомления продолжают работать в фоне. Чтобы выйти полностью, используйте «Выход» в меню трея.'
          }
          checked={closeToTray}
          onChange={onCloseToTrayChange}
          disabled={!loaded}
        />
        {isWin && (
          <>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="opacity-70 shrink-0">
                  <ShieldAlert size={18} />
                </span>
                <div className="min-w-0">
                  <div className="text-sm">Перезапустить от имени администратора</div>
                  <div className="text-xs text-slate-500">
                    Нужно, если хоткеи не работают в играх с античитами
                    (Battleye/EAC/Vanguard). Windows покажет UAC-окно
                    подтверждения. Текущая сессия будет закрыта.
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="btn-ghost h-8 px-3 text-xs whitespace-nowrap disabled:opacity-50"
                onClick={onRestartAsAdmin}
                disabled={restartBusy || !loaded}
              >
                {restartBusy ? '…' : 'Перезапустить'}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
