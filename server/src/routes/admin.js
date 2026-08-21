// Панель сервера. Заготовка: только те цифры, которые стоят один
// индексный запрос или системный вызов.
//
// Отдельного логина тут нет намеренно — авторизация уже есть. Роут висит
// за authRequired + adminRequired (см. src/admin.js: список
// ADMIN_USERNAMES, либо пользователь с id=1, если список не задан).
// Городить вторую пару логин/пароль означало бы завести ещё один секрет,
// который надо где-то хранить и ротировать.
//
// Чего здесь СОЗНАТЕЛЬНО нет:
//   * размер каталога uploads. Это рекурсивный обход тысяч файлов на
//     каждый запрос; на телефоне в Termux заметно. Объём вложений и так
//     виден через attachmentBytes — он берётся из SUM(attachment_size),
//     то есть из индекса, а не с диска.
//   * история/графики. Для них нужен сбор во времени и хранение рядов;
//     это уже не «заглушка», а отдельная задача.

import os from 'node:os';
import fs from 'node:fs';
import { Router } from 'express';
import db from '../db.js';
import { authRequired } from '../auth.js';
import { adminRequired } from '../admin.js';
import { getOnlineUserIds, getAwayUserIds } from '../presence.js';
import { SERVER_VERSION } from '../updates.js';
import { socialMode } from '../social.js';
import { usedBytes, quotaConfig, freeDiskBytes } from '../quota.js';
import { retentionLabel } from '../retention.js';

const router = Router();

function count(sql, ...args) {
  try {
    return Number(db.prepare(sql).get(...args)?.n) || 0;
  } catch {
    return 0;
  }
}

function dbFileBytes() {
  try {
    const file =
      process.env.SAZCORD_DB_FILE || new URL('../../data/sazcord.sqlite', import.meta.url).pathname;
    // WAL живёт отдельным файлом и на активном сервере бывает заметным,
    // поэтому считаем оба — иначе цифра врёт в меньшую сторону.
    let total = 0;
    for (const suffix of ['', '-wal']) {
      try {
        total += fs.statSync(file + suffix).size;
      } catch {
        /* файла может не быть */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

router.get('/stats', authRequired, adminRequired, (_req, res) => {
  const online = getOnlineUserIds();
  const cfg = quotaConfig();

  res.json({
    server: {
      version: SERVER_VERSION,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      socialMode: socialMode(),
      retention: retentionLabel(),
    },
    // loadavg на Windows всегда [0,0,0] — там эта метрика просто не
    // существует, и рисовать её как ноль было бы враньём.
    host: {
      loadavg: os.platform() === 'win32' ? null : os.loadavg().map((n) => Number(n.toFixed(2))),
      cpus: os.cpus().length,
      memTotalBytes: os.totalmem(),
      memFreeBytes: os.freemem(),
    },
    process: {
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
    },
    storage: {
      diskFreeBytes: freeDiskBytes(),
      dbBytes: dbFileBytes(),
      attachmentBytes: usedBytes(),
      quotaTotalBytes: cfg.totalBytes || null,
      quotaPerUserBytes: cfg.perUserBytes || null,
      minFreeBytes: cfg.minFreeBytes || null,
    },
    counts: {
      users: count('SELECT COUNT(*) n FROM users WHERE deleted_at IS NULL'),
      usersDeleted: count('SELECT COUNT(*) n FROM users WHERE deleted_at IS NOT NULL'),
      online: online.size,
      away: getAwayUserIds().size,
      messages: count('SELECT COUNT(*) n FROM messages WHERE deleted = 0'),
      groups: count('SELECT COUNT(*) n FROM groups'),
      attachments: count(
        'SELECT COUNT(*) n FROM messages WHERE attachment_path IS NOT NULL AND deleted = 0',
      ),
      pushSubscriptions: count('SELECT COUNT(*) n FROM push_subscriptions'),
    },
  });
});

export default router;
