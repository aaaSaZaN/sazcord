// Установка Sazcord как PWA.
//
// Поведение:
//   - Если приложение уже открыто в standalone-режиме (после Add-to-Home-Screen
//     на iOS / Install в Chrome/Edge) — показываем «установлено» как успех.
//   - Если в десктоп/мобильный Chrome пришёл `beforeinstallprompt` — рисуем
//     кнопку «Установить приложение», которая дёргает сохранённый prompt.
//   - На iOS Safari `beforeinstallprompt` НЕТ — показываем инструкцию
//     «Share → Add to Home Screen».
//   - На всех остальных движках без поддержки install — ничего не рендерим.
//
// Карточка стилизована под PushBlock в NotificationsTab.tsx, чтобы оба
// контрола в табе «Уведомления» выглядели одинаково.

import { useEffect, useState } from 'react';
import { Smartphone, Download, CheckCircle2, Share } from 'lucide-react';

// Тип события beforeinstallprompt не во всех движках в @types/dom — даём
// свой минимальный shape, достаточный для prompt() и userChoice.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Современные браузеры используют media query.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // Safari на iOS до недавнего времени выставлял navigator.standalone.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent);
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(isStandalone());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Гасим встроенный mini-infobar, чтобы показать свою кнопку.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const onInstall = async () => {
    if (!deferred || busy) return;
    setBusy(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* ignore */
    } finally {
      setDeferred(null);
      setBusy(false);
    }
  };

  // Уже стоит как PWA — поздравим, чтобы юзер понял.
  if (installed) {
    return (
      <div className="rounded-lg border border-border bg-bg-2 p-3">
        <div className="flex items-center gap-3">
          <CheckCircle2 size={16} className="text-success flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium">Приложение установлено</div>
            <div className="text-xs text-slate-500">
              Sazcord запущен в standalone-режиме. Включи push, чтобы получать уведомления
              даже когда приложение свёрнуто.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Android Chrome / Edge / Samsung Internet — есть beforeinstallprompt.
  if (deferred) {
    return (
      <div className="rounded-lg border border-border bg-bg-2 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Download size={16} className="opacity-70" />
            <div className="min-w-0">
              <div className="text-sm font-medium">Установить как приложение</div>
              <div className="text-xs text-slate-500">
                Sazcord появится на главном экране как обычное приложение.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onInstall}
            disabled={busy}
            className="btn btn-primary h-8 px-3 text-xs whitespace-nowrap"
          >
            <Download size={12} />
            <span>Установить</span>
          </button>
        </div>
      </div>
    );
  }

  // iOS Safari — beforeinstallprompt не существует, рисуем инструкцию.
  // В standalone сюда не доходим (см. ранний return), так что показ
  // инструкции уместен только пока юзер в обычном Safari.
  if (isIos()) {
    return (
      <div className="rounded-lg border border-border bg-bg-2 p-3">
        <div className="flex items-start gap-3">
          <Smartphone size={16} className="opacity-70 mt-0.5 flex-shrink-0" />
          <div className="min-w-0 text-sm">
            <div className="font-medium">Установить на iPhone/iPad</div>
            <div className="text-xs text-slate-500 mt-1 leading-relaxed">
              Откройте меню «Поделиться» (
              <Share size={11} className="inline align-middle" />) → «На экран “Домой”»
              (Add to Home Screen). Иконка появится на главном экране, и приложение будет
              запускаться без адресной строки.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Десктоп / неподдерживаемый браузер — ничего не показываем.
  return null;
}
