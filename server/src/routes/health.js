// Health-эндпоинт для production-мониторинга (UptimeRobot, Healthchecks.io,
// liveness-пробы systemd и т.д.).
//
// Что проверяем:
//   - DB: SELECT 1, чтобы убедиться что SQLite не залочен/не повреждён.
//     SQLite через better-sqlite3 синхронный, поэтому проверка дешёвая
//     (микросекунды), но всё-таки настоящая (не просто `db !== null`).
//
//   - Uploads-директория: writable. Самая частая проблема в проде —
//     папка существует, но юзер node не имеет прав записи (после
//     неаккуратного chown'а или systemd-сервиса под другим юзером).
//     Проверяем через fs.accessSync(W_OK) — это noop по производительности,
//     но даёт раннюю сигнализацию.
//
//   - Disk space (опционально): сколько свободного места в uploads-FS.
//     Использует statfs — есть с Node 18.15+, выдаёт в байтах.
//     Если свободного < 200 MB — статус 'degraded' (не fail, но тревога).
//
// Формат ответа:
//   200 OK    { ok: true, db: true, uploads: true, diskFreeMb: 12345, uptime: 3600 }
//   503       { ok: false, db: false|true, uploads: false|true, error: '...' }
//
// 503 (а не 500) — потому что это «не могу обслуживать в текущем состоянии»,
// что семантически соответствует Service Unavailable. Балансер/мониторинг
// корректно интерпретируют это как «оторви от роутинга, проверяй дальше».
//
// Производительность: цель — ответ за <10ms. Поэтому никаких HEAD-запросов
// к внешним сервисам (TURN, SMTP), никаких read-ов больших файлов.

import { Router } from 'express';
import fs from 'node:fs';
import db from '../db.js';
import { UPLOADS_DIR } from '../uploads.js';

const router = Router();

// Порог свободного места, ниже которого статус 'degraded'. 200 МБ —
// эмпирически достаточно на ~2-3 голосовых сообщения и пару аватарок,
// чтобы успеть отреагировать алертом до полного заполнения диска.
// Крутится через HEALTH_LOW_DISK_MB: на маленьком VPS 200 МБ — это уже
// «пора паниковать», а на телефоне в Termux или на хосте с большим
// оборотом вложений порог хочется поднять.
const LOW_DISK_THRESHOLD_BYTES = (() => {
  const mb = Number(process.env.HEALTH_LOW_DISK_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
})();

router.get('/', (_req, res) => {
  const result = {
    ok: true,
    db: false,
    uploads: false,
    uptime: Math.round(process.uptime()),
  };
  const errors = [];

  // 1) DB ping
  try {
    const row = db.prepare('SELECT 1 as one').get();
    result.db = row?.one === 1;
    if (!result.db) errors.push('db: select returned wrong value');
  } catch (e) {
    errors.push(`db: ${e?.message || e}`);
  }

  // 2) Uploads writable
  try {
    fs.accessSync(UPLOADS_DIR, fs.constants.W_OK);
    result.uploads = true;
  } catch (e) {
    errors.push(`uploads: ${e?.code || e?.message || 'not writable'}`);
  }

  // 3) Disk space (best-effort — fs.statfs может отсутствовать на старых нодах)
  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(UPLOADS_DIR);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      result.diskFreeMb = Math.round(freeBytes / (1024 * 1024));
      if (freeBytes < LOW_DISK_THRESHOLD_BYTES) {
        result.degraded = true;
        errors.push(`disk: low space (${result.diskFreeMb} MB)`);
      }
    }
  } catch {
    // Не считаем фейлом — некоторые ФС/окружения не поддерживают statfs.
    // Главное — db и uploads-write проверки.
  }

  // Здоровый только если БД и uploads ОК. degraded по диску — не fail.
  result.ok = result.db && result.uploads;
  if (errors.length) result.errors = errors;

  // 503 при реальной проблеме, 200 даже с degraded (мониторинг увидит флаг).
  res.status(result.ok ? 200 : 503).json(result);
});

export default router;
