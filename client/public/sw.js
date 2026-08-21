/* eslint-disable no-restricted-globals */
//
// Sazcord — service worker. Минимальный, без кеширования: только Web Push.
// Кеширование намеренно НЕ включено, чтобы не ловить «старая версия»
// после деплоя — Vite-сборка и так с хешированными именами файлов.

self.addEventListener('install', (event) => {
  // Активируемся сразу, не ждём пока закроются все вкладки.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// --- Push ---------------------------------------------------------------
// Сервер шлёт JSON со полями: { title, body, tag, url, icon, badge,
//   requireInteraction, renotify, kind }.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Sazcord', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Sazcord';
  const options = {
    body: data.body || '',
    tag: data.tag || 'sazcord',
    icon: data.icon || '/favicon.svg',
    badge: data.badge || '/favicon.svg',
    data: { url: data.url || '/', kind: data.kind || null },
    requireInteraction: !!data.requireInteraction,
    renotify: !!data.renotify,
  };

  event.waitUntil((async () => {
    // Если у пользователя уже открыто приложение и оно в фокусе —
    // системное уведомление часто избыточно (он и так увидит). Но т.к.
    // он мог сидеть на другой вкладке/окне, лучше показать.
    // Если приложение ВИДИМО (visibilityState === 'visible') в одном из
    // окон — НЕ показываем, чтобы не дублировать с in-app-уведомлением.
    const allClients = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true,
    });
    const someVisible = allClients.some((c) => c.visibilityState === 'visible');
    if (someVisible && data.kind !== 'call') {
      // Звонки показываем всегда (важно), остальное гасим.
      return;
    }
    await self.registration.showNotification(title, options);
  })());
});

// --- Notification click --------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: 'window', includeUncontrolled: true,
    });

    // Если приложение уже открыто — фокусируем существующее окно и
    // отправляем сообщение, чтобы клиентский код мог открыть нужный чат.
    for (const client of allClients) {
      if ('focus' in client) {
        try {
          await client.focus();
          client.postMessage({ type: 'notificationclick', url: targetUrl });
          return;
        } catch { /* ignore */ }
      }
    }
    // Иначе открываем новое окно.
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
