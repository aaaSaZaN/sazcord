import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import messageRoutes from './routes/messages.js';
import meRoutes from './routes/me.js';
import muteRoutes from './routes/mutes.js';
import groupRoutes from './routes/groups.js';
import inviteRoutes from './routes/invites.js';
import pushRoutes from './routes/push.js';
import friendRoutes from './routes/friends.js';
import adminRoutes from './routes/admin.js';
import healthRoutes from './routes/health.js';
import { attachSocket } from './socket.js';
import { UPLOADS_DIR, MAX_UPLOAD_BYTES } from './uploads.js';
import { UPDATES_DIR, SERVER_VERSION, versionManifest } from './updates.js';
import { startRetention } from './retention.js';
import { buildCorsOptions, buildHelmet, apiLimiter, authLimiter, isProd } from './security.js';
import { socialMode } from './social.js';
import { membersMayInvite } from './invites.js';
import cors from 'cors';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// --- Доверие к X-Forwarded-* ----------------------------------------------
//
// Без этого express-rate-limit видит все запросы пришедшими с одного IP
// (loopback от nginx) и режет всех разом. С этим — берёт настоящий адрес
// клиента из X-Forwarded-For.
//
// Подделать заголовок и обойти лимит нельзя ровно при двух условиях:
//
//   1. Прокси ДОПИСЫВАЕТ реальный адрес в конец цепочки, а не подставляет
//      её целиком из запроса. У nginx это `$proxy_add_x_forwarded_for`
//      (см. deploy/nginx.conf.example), у Caddy — поведение по умолчанию.
//      Express с trust proxy = 1 берёт последний элемент, то есть тот,
//      который дописал прокси. Всё, что клиент насочинял левее, отбрасывается.
//
//   2. До node нельзя достучаться в обход прокси. Если он слушает
//      0.0.0.0, любой в той же сети шлёт запрос напрямую с любым
//      X-Forwarded-For — и этот адрес будет принят на веру.
//
// Поэтому в production при HOST=0.0.0.0 ниже выводится предупреждение:
// сочетание «слушаем везде» + «верим заголовку» и есть дыра.
//
// TRUST_PROXY: число хопов, либо false — если node смотрит в интернет
// напрямую, без прокси. Тогда req.ip берётся из сокета и подделать его
// нельзя в принципе.
const TRUST_PROXY = (() => {
  const raw = (process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (raw === 'false' || raw === '0') return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
})();
app.set('trust proxy', TRUST_PROXY);
app.use(buildHelmet());
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: '1mb' }));

// /api/health — настоящие проверки (БД + uploads + диск). См. routes/health.js.
// Регистрируем ДО apiLimiter, чтобы мониторинг (UptimeRobot и т.п.) мог
// пинговать его раз в минуту без риска получить 429.
app.use('/api/health', healthRoutes);

// Глобальный мягкий rate-limit на /api/* как защита от случайных циклов.
app.use('/api', apiLimiter());

// Статика для загруженных файлов (аватары, голосовые).
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800'),
  }),
);

// --- Канал автообновления клиентов ------------------------------------
//
// Раздаём инсталляторы и манифесты обновлений для всех платформ:
//
//   /updates/windows/  — latest.yml + «Sazcord Setup X.Y.Z.exe» (+ .blockmap)
//   /updates/mac/      — latest-mac.yml + Sazcord-X.Y.Z-arm64.zip / .dmg
//   /updates/linux/    — latest-linux.yml + Sazcord-X.Y.Z.AppImage
//   /updates/android/  — latest.json + sazcord-X.Y.Z.apk
//
// Десктоп ходит сюда через electron-updater (generic provider), Android —
// через собственный чек latest.json. Каталог задаётся UPDATES_DIR, по
// умолчанию — <repo>/updates.
//
// Range-запросы нужны обязательно: electron-updater качает differential
// куски по blockmap'у. express.static их поддерживает из коробки.
//
// Сам каталог и разбор манифестов живут в ./updates.js — оттуда же берёт
// данные GET /api/version.
if (!fs.existsSync(UPDATES_DIR)) {
  try {
    fs.mkdirSync(UPDATES_DIR, { recursive: true });
  } catch {
    /* не критично: если каталога нет, отдастся 404 */
  }
}
app.use(
  '/updates',
  express.static(UPDATES_DIR, {
    // Манифесты (.yml/.json) кешировать нельзя — иначе клиент неделю
    // будет видеть старую версию. Сами бинарники именованы с версией,
    // поэтому их можно держать в кеше долго.
    setHeaders: (res, filePath) => {
      if (/\.(yml|yaml|json)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    },
  }),
);

// STUN-серверы. Дефолт — публичные гугловые: работают везде, где Google
// вообще доступен. Там, где не доступен (или просто не хочется зависеть
// от чужого сервиса), список переопределяется через STUN_URLS — CSV из
// stun:host:port. Пустое значение = вообще без STUN: осмысленно только
// когда задан TURN и весь трафик всё равно идёт через него.
const STUN_URLS = (
  process.env.STUN_URLS ??
  'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302,stun:stun2.l.google.com:19302,stun:stun.cloudflare.com:3478,stun:openrelay.metered.ca:80'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Отдаём ICE-серверы клиенту, чтобы секреты TURN не хранились во фронте.
app.get('/api/ice', (_req, res) => {
  const iceServers = STUN_URLS.length ? [{ urls: STUN_URLS }] : [];
  if (process.env.TURN_URL || process.env.TURN_URLS) {
    const turnUrls = (process.env.TURN_URLS || process.env.TURN_URL)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    iceServers.push({
      urls: turnUrls,
      username: process.env.TURN_USERNAME || undefined,
      credential: process.env.TURN_PASSWORD || undefined,
    });
  }
  res.json({ iceServers });
});

// Жёсткий лимит на login/register — защита от перебора паролей
// и enumerate'а username'ов. Применяется только к POST.
app.use('/api/auth', authLimiter(), authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/me', meRoutes);
app.use('/api/mutes', muteRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/admin', adminRoutes);

// Публичный конфиг клиента (лимиты, фичи).
app.get('/api/config', (_req, res) => {
  res.json({
    maxUploadBytes: MAX_UPLOAD_BYTES,
    // 'local' — все видят всех; 'private' — только друзья и соучастники
    // групп. Клиент по этому полю решает, показывать ли раздел «Друзья»
    // и заявки (см. server/src/social.js).
    socialMode: socialMode(),
    // Может ли обычный участник выпускать приглашения (INVITE_WHO_CAN_CREATE).
    // Клиенту нужно, чтобы решить, показывать ли ему раздел «Приглашения»:
    // сам эндпоинт всё равно проверяет право на каждый запрос.
    invitesByMembers: membersMayInvite(),
  });
});

// Версия сервера и доступные сборки клиентов по платформам.
app.get('/api/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.json(versionManifest());
});

// Глобальный обработчик ошибок (multer/прочее) — возвращает JSON вместо HTML.
// Внимание на скобки: раньше тут было
//   err?.status || err?.code === 'LIMIT_FILE_SIZE' ? 413 : 400
// что по приоритету операторов означает (status || isTooLarge) ? 413 : 400,
// и ЛЮБАЯ ошибка с полем status отдавалась как 413 Payload Too Large.
app.use((err, _req, res, _next) => {
  console.error('[api-error]', err?.message || err);
  const status =
    err?.code === 'LIMIT_FILE_SIZE' ? 413 : Number(err?.status) || Number(err?.statusCode) || 400;
  res.status(status).json({ error: err?.message || 'bad request' });
});

// В production раздаём собранный клиент с того же порта.
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = http.createServer(app);
const io = attachSocket(server);

const PORT = Number(process.env.PORT || 3001);
// HOST=127.0.0.1 — слушать только loopback. Это правильный режим, когда
// перед нодой стоит nginx/caddy с TLS: иначе голый HTTP-API торчит в LAN
// и в интернет мимо прокси. По умолчанию 0.0.0.0, чтобы `npm start` на
// свежей машине работал без настройки.
const HOST = process.env.HOST || '0.0.0.0';
// «Слушаем на всех интерфейсах» + «верим X-Forwarded-For» = обход
// rate-limit'а: кто угодно в той же сети шлёт запрос мимо прокси с любым
// адресом в заголовке, и он принимается на веру. По отдельности каждое
// безопасно, вместе — нет. Ругаемся только в production: в dev это
// нормальная конфигурация для отладки с телефона в той же Wi-Fi.
if (isProd && TRUST_PROXY !== false && (HOST === '0.0.0.0' || HOST === '::')) {
  console.warn(
    `[sazcord] ВНИМАНИЕ: HOST=${HOST} вместе с TRUST_PROXY=${TRUST_PROXY}. ` +
      'Node доступен в обход прокси, а X-Forwarded-For принимается на веру — ' +
      'значит rate-limit обходится подделкой заголовка. Поставь HOST=127.0.0.1, ' +
      'если перед сервером стоит nginx/Caddy, либо TRUST_PROXY=false, если нет.',
  );
}

server.listen(PORT, HOST, () => {
  console.log(`[sazcord] v${SERVER_VERSION} listening on http://${HOST}:${PORT}`);
});

// Фоновая чистка старых сообщений и файлов (см. RETENTION_DAYS в .env).
startRetention();

// --- Graceful shutdown -----------------------------------------------------
// SIGTERM (от systemd / docker stop) и SIGINT (Ctrl-C) — закрываем io,
// дожидаем активных HTTP-запросов, флашим SQLite и выходим. Без этого
// SIGTERM рвёт активные WS-соединения и может оставить недописанный WAL.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[sazcord] ${signal} received, shutting down…`);
  // Принудительно отвалим клиентов через 8 сек, если кто-то завис на запросе.
  const killTimer = setTimeout(() => {
    console.warn('[sazcord] forced exit after timeout');
    process.exit(1);
  }, 8000);
  // io.close() умеет дожидаться разъединения. server.close() ждёт keep-alive.
  Promise.allSettled([
    new Promise((resolve) => io.close(() => resolve())),
    new Promise((resolve) => server.close(() => resolve())),
  ]).finally(() => {
    try {
      db.close();
    } catch {
      /* */
    }
    clearTimeout(killTimer);
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Если нужно явно проверить флаг production снаружи (например, тесты).
export { isProd };
