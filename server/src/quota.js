// Квоты на дисковое место под вложения.
//
// До этого ограничений по объёму не было вообще: MAX_UPLOAD_MB режет
// размер ОДНОГО файла, RETENTION_DAYS чистит по времени, а
// HEALTH_LOW_DISK_MB только меняет статус в /api/health и ничего не
// блокирует. То есть на дефолтах один пользователь мог залить 500 МБ
// сколько угодно раз, и это лежало 90 дней.
//
// Заполненный диск роняет не только загрузки: SQLite перестаёт дописывать
// WAL, и встаёт весь сервер — сообщения, логин, всё. Поэтому
// UPLOADS_MIN_FREE_DISK_MB здесь не про справедливый делёж места, а про
// то, чтобы инстанс не убил сам себя.
//
// Переменные (пустое значение или 0 = ограничение выключено):
//   UPLOADS_MAX_TOTAL_MB     — потолок на все вложения разом
//   UPLOADS_MAX_PER_USER_MB  — потолок на одного отправителя
//   UPLOADS_MIN_FREE_DISK_MB — жёсткий стоп по свободному месту (дефолт 500)
//   UPLOADS_OVER_QUOTA       — reject (по умолчанию) | evict
//
// Считать объём дёшево: в messages уже есть колонка attachment_size, так
// что это индексный SUM, а не обход файловой системы.

import fs from 'node:fs';
import db from './db.js';
import { UPLOADS_DIR, absolutePathFor } from './uploads.js';

const MB = 1024 * 1024;

function envMb(name, fallback = 0) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  // Отрицательное/мусор трактуем как «выключено», а не как «ноль байт»:
  // опечатка в конфиге не должна запрещать загрузки полностью.
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function quotaConfig() {
  const mode = String(process.env.UPLOADS_OVER_QUOTA || 'reject')
    .trim()
    .toLowerCase();
  return {
    totalBytes: envMb('UPLOADS_MAX_TOTAL_MB') * MB,
    perUserBytes: envMb('UPLOADS_MAX_PER_USER_MB') * MB,
    minFreeBytes: envMb('UPLOADS_MIN_FREE_DISK_MB', 500) * MB,
    evict: mode === 'evict',
  };
}

/** Суммарный размер вложений во всех живых сообщениях. */
export function usedBytes() {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(attachment_size), 0) AS n
         FROM messages
        WHERE attachment_path IS NOT NULL AND deleted = 0`,
    )
    .get();
  return Number(row?.n) || 0;
}

/** То же, но по одному отправителю. */
export function usedBytesByUser(userId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(attachment_size), 0) AS n
         FROM messages
        WHERE attachment_path IS NOT NULL AND deleted = 0 AND sender_id = ?`,
    )
    .get(userId);
  return Number(row?.n) || 0;
}

/** Свободно на разделе с uploads. null, если посчитать не удалось. */
export function freeDiskBytes() {
  try {
    if (typeof fs.statfsSync !== 'function') return null;
    const st = fs.statfsSync(UPLOADS_DIR);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

/**
 * Освободить место под `needBytes`, удаляя самые старые вложения.
 *
 * Режим evict: ведём себя как кольцевой буфер — старое вытесняется новым.
 * Удаляем только сообщения С вложением; текстовая переписка не страдает,
 * ей занимается ретеншн по времени. Возвращает освобождённые байты.
 */
function evictOldest(needBytes) {
  if (needBytes <= 0) return 0;
  const rows = db
    .prepare(
      `SELECT id, attachment_path, attachment_size
         FROM messages
        WHERE attachment_path IS NOT NULL AND deleted = 0
        ORDER BY created_at ASC`,
    )
    .all();

  let freed = 0;
  const victims = [];
  for (const r of rows) {
    if (freed >= needBytes) break;
    victims.push(r);
    freed += Number(r.attachment_size) || 0;
  }
  if (!victims.length) return 0;

  const ids = victims.map((r) => r.id);
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...chunk);
  }
  // Файлы — best-effort, как в retention.js: I/O-ошибка не должна валить запрос.
  for (const r of victims) {
    const abs = absolutePathFor(r.attachment_path);
    if (!abs) continue;
    fs.promises.unlink(abs).catch(() => {
      /* ignore */
    });
  }
  console.log(`[quota] evicted ${victims.length} attachments, freed ${freed} bytes`);
  return freed;
}

/**
 * Пустит ли квота ещё `incomingBytes`.
 *
 * Вызывается дважды: до multer'а по Content-Length (оценка сверху, чтобы
 * не тратить диск и время на заведомо лишнюю запись) и после записи по
 * фактическому размеру. Второй вызов обязателен — Content-Length клиент
 * контролирует и может соврать.
 *
 * Возвращает { ok: true } либо { ok: false, error, status }.
 */
export function checkQuota({ userId, incomingBytes }) {
  const cfg = quotaConfig();
  const incoming = Math.max(0, Number(incomingBytes) || 0);

  // 1) Свободное место на диске. Проверяем всегда и первым: это защита
  //    сервера от самоубийства, её нельзя обойти настройкой квот.
  if (cfg.minFreeBytes > 0) {
    const free = freeDiskBytes();
    if (free != null && free - incoming < cfg.minFreeBytes) {
      return {
        ok: false,
        status: 507,
        error: 'на сервере закончилось место',
      };
    }
  }

  // 2) Общий потолок.
  if (cfg.totalBytes > 0) {
    const used = usedBytes();
    if (used + incoming > cfg.totalBytes) {
      if (!cfg.evict) {
        return { ok: false, status: 507, error: 'хранилище сервера заполнено' };
      }
      evictOldest(used + incoming - cfg.totalBytes);
      // Перепроверяем: вытеснять могло быть нечего (например, весь объём
      // занимает один файл, который больше самой квоты).
      if (usedBytes() + incoming > cfg.totalBytes) {
        return { ok: false, status: 413, error: 'файл больше, чем квота хранилища' };
      }
    }
  }

  // 3) Персональный потолок. Вытеснением НЕ лечим: чужие файлы удалять
  //    из-за того, что этот юзер исчерпал свою квоту, неправильно.
  if (cfg.perUserBytes > 0 && userId != null) {
    const mine = usedBytesByUser(userId);
    if (mine + incoming > cfg.perUserBytes) {
      return { ok: false, status: 507, error: 'исчерпана личная квота на файлы' };
    }
  }

  return { ok: true };
}

/**
 * Middleware ПЕРЕД multer'ом: грубая отсечка по Content-Length.
 *
 * Точный размер тут неизвестен (тело ещё не прочитано, а multipart несёт
 * накладные расходы), поэтому это именно предфильтр: он экономит запись
 * на диск в очевидных случаях. Финальное слово — за enforceQuota ниже.
 */
export function quotaPrecheck(req, res, next) {
  const declared = Number(req.headers['content-length']) || 0;
  const r = checkQuota({ userId: req.user?.id, incomingBytes: declared });
  if (r.ok) return next();
  rejectPending(req, res, r.status, r.error);
}

/**
 * Отказать по запросу, тело которого ещё не прочитано.
 *
 * Ответить сразу нельзя: клиент в этот момент продолжает писать
 * multipart, сервер закрывает соединение, и вместо нашего JSON клиент
 * получает EPIPE/ECONNRESET — то есть «сеть отвалилась» вместо внятного
 * «нет места». Поэтому дочитываем тело и выбрасываем его: на диск при
 * этом не попадает ничего, а объём трафика и так ограничен сверху
 * MAX_UPLOAD_MB.
 */
function rejectPending(req, res, status, error) {
  let sent = false;
  const send = () => {
    if (sent || res.headersSent) return;
    sent = true;
    res.status(status).json({ error });
  };

  req.resume(); // сливаем в никуда
  req.on('end', send);
  req.on('error', send);
  req.on('aborted', send);

  // Страховка на случай, если клиент замолчал на середине тела.
  const bail = setTimeout(send, 10000);
  if (typeof bail.unref === 'function') bail.unref();
  res.on('finish', () => clearTimeout(bail));
}

/**
 * Middleware ПОСЛЕ multer'а: проверка по фактически записанным байтам.
 *
 * При отказе удаляем только что залитые файлы — иначе они осели бы на
 * диске без строки в БД, то есть навсегда (ретеншн ходит по messages).
 */
export function enforceQuota(req, res, next) {
  const files = collectFiles(req);
  if (!files.length) return next();
  const bytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);

  const r = checkQuota({ userId: req.user?.id, incomingBytes: bytes });
  if (r.ok) return next();

  for (const f of files) {
    if (!f.path) continue;
    fs.promises.unlink(f.path).catch(() => {
      /* ignore */
    });
  }
  res.status(r.status).json({ error: r.error });
}

function collectFiles(req) {
  const out = [];
  if (req.file) out.push(req.file);
  if (Array.isArray(req.files)) out.push(...req.files);
  else if (req.files && typeof req.files === 'object') {
    for (const arr of Object.values(req.files)) {
      if (Array.isArray(arr)) out.push(...arr);
    }
  }
  return out;
}
