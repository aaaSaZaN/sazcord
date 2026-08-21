import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webPush from 'web-push';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// VAPID ключи. Можно задать через env:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:... или https://...)
//
// Если ENV не задан, при первом старте генерим пару и кладём в файл
// server/data/vapid.json. Это удобно для self-hosted: ничего настраивать
// руками не надо. Файл — секрет, не коммитить (он лежит рядом с data.sqlite,
// которая и так в .gitignore через `data/`).
const VAPID_FILE = path.resolve(__dirname, '..', 'data', 'vapid.json');

let publicKey = null;
let privateKey = null;
let subject = null;
let enabled = false;

function loadVapid() {
  publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  subject = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:admin@sazcord.local';

  if (!publicKey || !privateKey) {
    if (fs.existsSync(VAPID_FILE)) {
      try {
        const j = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf8'));
        publicKey = j.publicKey;
        privateKey = j.privateKey;
        subject = subject || j.subject || subject;
      } catch {
        // Битый файл — перегенерим.
        publicKey = privateKey = '';
      }
    }
  }

  if (!publicKey || !privateKey) {
    // В тестах не генерируем и не пишем файл — push здесь не нужен,
    // а лишний vapid.json мусорил бы каталог data/.
    if (process.env.NODE_ENV === 'test') {
      enabled = false;
      return;
    }
    try {
      const keys = webPush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      const dir = path.dirname(VAPID_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(VAPID_FILE, JSON.stringify({ publicKey, privateKey, subject }, null, 2));

      console.log(`[push] generated VAPID keys, saved to ${VAPID_FILE}`);
    } catch (e) {
      console.warn('[push] failed to generate VAPID keys:', e?.message || e);
      enabled = false;
      return;
    }
  }

  try {
    webPush.setVapidDetails(subject, publicKey, privateKey);
    enabled = true;
  } catch (e) {
    console.warn('[push] invalid VAPID config:', e?.message || e);
    enabled = false;
  }
}

loadVapid();

export function pushEnabled() {
  return enabled;
}

export function publicVapidKey() {
  return publicKey || null;
}

// --- CRUD подписок --------------------------------------------------------
export function saveSubscription({ userId, sub, ua }) {
  if (!sub || !sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new Error('invalid subscription payload');
  }
  db.prepare(
    `
    INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id    = excluded.user_id,
      p256dh     = excluded.p256dh,
      auth       = excluded.auth,
      user_agent = excluded.user_agent
  `,
  ).run(sub.endpoint, userId, sub.keys.p256dh, sub.keys.auth, ua ? String(ua).slice(0, 256) : null);
}

export function deleteSubscription(endpoint) {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function deleteUserSubscriptions(userId) {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(userId);
}

function getSubscriptionsForUser(userId) {
  return db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId);
}

// --- Отправка -------------------------------------------------------------
//
// payload: произвольный JSON, который SW получит в push-event и
// превратит в `Notification`. Поля, которые мы используем:
//   { title, body, tag, url, icon, badge, requireInteraction, renotify }
//
// Возвращает Promise, который не реджектится — все ошибки доставки логируем,
// «мёртвые» подписки удаляем (404/410).
export async function pushToUser(userId, payload) {
  if (!enabled) return;
  const subs = getSubscriptionsForUser(userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  await Promise.allSettled(
    subs.map(async (s) => {
      const subscription = {
        endpoint: s.endpoint,
        keys: { p256dh: s.p256dh, auth: s.auth },
      };
      try {
        await webPush.sendNotification(subscription, body, { TTL: 60 });
        db.prepare('UPDATE push_subscriptions SET last_used = ? WHERE endpoint = ?').run(
          Date.now(),
          s.endpoint,
        );
      } catch (e) {
        const status = e?.statusCode;
        if (status === 404 || status === 410) {
          // Подписка устарела — снимаем.
          deleteSubscription(s.endpoint);
        } else {
          console.warn('[push] send failed:', status || e?.message || e);
        }
      }
    }),
  );
}

export function pushToUsers(userIds, payload) {
  if (!enabled) return Promise.resolve();
  return Promise.allSettled(userIds.map((id) => pushToUser(id, payload)));
}
