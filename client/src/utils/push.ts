// Утилита для работы с Web Push на клиенте.
//
// Разделена на две части:
//   - capability-проверка (поддерживает ли браузер вообще?),
//   - subscribe / unsubscribe / status — поверх browser API.

import { api } from '../api';

const SW_URL = '/sw.js';

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Регистрируем SW лениво при первом обращении.
let swRegPromise: Promise<ServiceWorkerRegistration> | null = null;
async function ensureRegistration() {
  if (!pushSupported()) throw new Error('Push не поддерживается этим браузером');
  if (!swRegPromise) {
    swRegPromise = navigator.serviceWorker.register(SW_URL, { scope: '/' });
  }
  return swRegPromise;
}

// Проксируем переход по уведомлению в обычный URL.
export function attachNotificationClickHandler() {
  if (!pushSupported()) return;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const { type, url } = event.data || {};
    if (type !== 'notificationclick' || !url) return;
    try {
      const u = new URL(url, window.location.origin);
      // Пробрасываем query (?dm=… / ?group=…) на текущую страницу.
      if (u.pathname === '/' && u.search) {
        const params = new URLSearchParams(u.search);
        const dm = params.get('dm');
        const group = params.get('group');
        const ev = new CustomEvent('sazcord:open-chat', {
          detail: { dm: dm ? Number(dm) : null, group: group ? Number(group) : null },
        });
        window.dispatchEvent(ev);
      }
    } catch {
      /* ignore */
    }
  });
}

// Текущее состояние подписки (для UI).
export async function getPushStatus(token) {
  if (!pushSupported()) return { supported: false };
  const cfg: { enabled: boolean; publicKey?: string } = await api
    .pushConfig()
    .catch(() => ({ enabled: false }));
  if (!cfg.enabled || !cfg.publicKey) {
    return { supported: true, configured: false };
  }
  const permission = Notification.permission;
  let subscribed = false;
  try {
    const reg = await ensureRegistration();
    const sub = await reg.pushManager.getSubscription();
    subscribed = !!sub;
  } catch {
    /* */
  }
  return {
    supported: true,
    configured: true,
    permission,
    subscribed,
    publicKey: cfg.publicKey,
  };
}

// Запрос разрешения + создание подписки + отправка на сервер.
export async function enablePush(token) {
  if (!pushSupported()) throw new Error('Push не поддерживается');
  const cfg = await api.pushConfig();
  if (!cfg.enabled || !cfg.publicKey) {
    throw new Error('Push не настроен на сервере');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Разрешение на уведомления не выдано');
  }
  const reg = await ensureRegistration();
  // Если есть старая подписка с другим публичным ключом — снимаем.
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    try {
      await existing.unsubscribe();
    } catch {
      /* */
    }
  }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(cfg.publicKey),
  });
  await api.pushSubscribe(token, sub.toJSON());
  return true;
}

export async function disablePush(token) {
  if (!pushSupported()) return;
  try {
    const reg = await ensureRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    try {
      await sub.unsubscribe();
    } catch {
      /* */
    }
    await api.pushUnsubscribe(token, endpoint).catch(() => {
      /* */
    });
  } catch {
    /* */
  }
}

// VAPID public key приходит как base64url без padding — приводим к Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
