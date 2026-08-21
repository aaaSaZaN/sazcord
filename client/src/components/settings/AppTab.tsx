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
import { isDesktop, relaunchAsAdmin } from '../../utils/desktop';

export function AppTab() {
  const toast = useToast();
  const [autoStart, setAutoStart] = useState(false);
  const [closeToTray, setCloseToTray] = useState(true);
  // loaded: ждём первого getConfig() прежде чем разрешить toggle'и —
  // иначе пользователь успеет щёлкнуть по умолчанию, и его реальное
  // значение перетрётся.
  const [loaded, setLoaded] = useState(false);

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
          // closeToTray: дефолт true, undefined считаем как true (старые
          // профили без этого поля должны получить новое поведение).
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

  // Run-as-admin: defensive busy-flag, чтобы юзер не нажал кнопку
  // дважды и не получил два UAC-prompt'а подряд. После 800 мс main-
  // процесс закроется сам, и весь UI исчезнет вместе с этим стейтом.
  const [restartBusy, setRestartBusy] = useState(false);
  const onRestartAsAdmin = async () => {
    if (restartBusy) return;
    setRestartBusy(true);
    const result = await relaunchAsAdmin();
    if (!result.ok) {
      // Если ok=true — приложение через ~800 мс закроется само, и юзер
      // увидит UAC-prompt; никаких toast'ов показывать не нужно.
      toast.error?.('Не удалось перезапустить: ' + (result.error || 'неизвестная ошибка'));
      setRestartBusy(false);
    }
    // Безопасный fallback: если quit не случился через 3 с (юзер отказался
    // от UAC, новый процесс не запустился, и main передумал quit'ить), разблокируем кнопку.
    setTimeout(() => setRestartBusy(false), 3000);
  };

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-border bg-bg-2 p-4 space-y-4">
        <ToggleRow
          icon={<Power size={18} />}
          title="Запускать при старте Windows"
          description="Приложение будет автоматически запускаться при входе в систему и сворачиваться в трей. Удобно, чтобы не пропускать звонки и сообщения сразу после загрузки ПК."
          checked={autoStart}
          onChange={onAutoStartChange}
          disabled={!loaded}
        />
        <div className="h-px bg-border" />
        <ToggleRow
          icon={<MinusSquare size={18} />}
          title="Сворачивать в трей при закрытии"
          description="Крестик скрывает окно в трей вместо завершения приложения — звонки и уведомления продолжают работать в фоне. Чтобы выйти полностью, используйте «Выход» в меню трея."
          checked={closeToTray}
          onChange={onCloseToTrayChange}
          disabled={!loaded}
        />
        <div className="h-px bg-border" />
        {/* Run-as-admin — стилизовано под ToggleRow, но вместо тогла — кнопка,
            потому что elevation нельзя хранить в состоянии; это всегда action «сейчас же». */}
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
      </div>
    </section>
  );
}
