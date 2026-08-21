import fs from 'node:fs';
import db from './db.js';
import { absolutePathFor } from './uploads.js';

// История переписок и звонков хранится ограниченное время. После
// истечения сообщения удаляются из БД, а связанные файлы (голосовые,
// вложения) — с диска. Аватары и сами группы/пользователи не трогаем:
// они привязаны к актуальным аккаунтам, а не к истории.
//
// Окно задаётся переменной RETENTION с суффиксом единицы — тот же формат,
// что уже понимает JWT_TTL:
//
//   RETENTION=30m   — 30 минут (эфемерный чат)
//   RETENTION=12h   — 12 часов
//   RETENTION=10d   — 10 дней
//   RETENTION=90    — без суффикса читается как дни
//
// Старое имя RETENTION_DAYS продолжает работать и всегда означает дни;
// если заданы обе, побеждает RETENTION.
//
// Сам прогон дёшев: один SELECT по индексу `created_at` плюс N unlink'ов.
// Транзакцию для DELETE не используем — сценарий идемпотентный, при
// падении сервера добьём на следующем тике.

const DEFAULT_MS = 90 * 24 * 60 * 60 * 1000; // 90 дней

const UNIT_MS = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Разбор окна хранения в миллисекунды. Возвращает null на мусоре, чтобы
 * вызывающий мог откатиться на дефолт: пустое/битое значение не должно
 * означать «удалять всё немедленно».
 */
export function parseRetention(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*([mhd])?$/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  // Без суффикса — дни: так вела себя прежняя RETENTION_DAYS, и молча
  // переинтерпретировать её как минуты означало бы стереть историю.
  const unit = m[2] || 'd';
  return Math.floor(value * UNIT_MS[unit]);
}

/** Окно хранения в миллисекундах. */
export function retentionMs() {
  return (
    parseRetention(process.env.RETENTION) ??
    parseRetention(process.env.RETENTION_DAYS) ??
    DEFAULT_MS
  );
}

/** Человекочитаемое окно — для логов и /api/health. */
export function retentionLabel(ms = retentionMs()) {
  if (ms % UNIT_MS.d === 0) return `${ms / UNIT_MS.d}d`;
  if (ms % UNIT_MS.h === 0) return `${ms / UNIT_MS.h}h`;
  return `${Math.round(ms / UNIT_MS.m)}m`;
}

function plural(n, one, few, many) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * То же окно прописью по-русски — для страницы политики обработки ПДн,
 * где «0 дней» при RETENTION=30m читалось бы как «не храним вовсе».
 */
export function retentionHuman(ms = retentionMs()) {
  if (ms % UNIT_MS.d === 0) {
    const n = ms / UNIT_MS.d;
    return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
  }
  if (ms % UNIT_MS.h === 0) {
    const n = ms / UNIT_MS.h;
    return `${n} ${plural(n, 'час', 'часа', 'часов')}`;
  }
  const n = Math.round(ms / UNIT_MS.m);
  return `${n} ${plural(n, 'минуту', 'минуты', 'минут')}`;
}

/**
 * Как часто подметать. При окне в 90 дней хватает часа, но при
 * RETENTION=30m часовой тик означал бы, что сообщения живут до полутора
 * часов вместо получаса. Берём четверть окна, зажимая в [30 сек, 1 час]:
 * снизу — чтобы не молотить БД, сверху — чтобы не терять точность.
 */
export function tickMs(windowMs = retentionMs()) {
  return Math.min(60 * 60 * 1000, Math.max(30 * 1000, Math.floor(windowMs / 4)));
}

export function runRetentionOnce() {
  const windowMs = retentionMs();
  const label = retentionLabel(windowMs);
  const cutoff = Date.now() - windowMs;

  // Сначала собираем пути файлов, чтобы удалить их после успешного DELETE.
  const stale = db
    .prepare(`SELECT id, attachment_path FROM messages WHERE created_at < ?`)
    .all(cutoff);

  if (!stale.length) return { deleted: 0 };

  const ids = stale.map((r) => r.id);
  // Удаляем пачкой. SQLite ограничивает число параметров (по умолчанию 999),
  // на всякий случай чанкуем.
  const CHUNK = 500;
  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const info = db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...chunk);
    removed += info.changes;
  }

  // Файлы — best-effort, не валим процесс при I/O ошибках.
  for (const r of stale) {
    if (!r.attachment_path) continue;
    const abs = absolutePathFor(r.attachment_path);
    if (!abs) continue;
    fs.promises.unlink(abs).catch(() => {
      /* ignore */
    });
  }

  return { deleted: removed, window: label };
}

let timer = null;
export function startRetention() {
  // В тестах — не запускаем планировщик, чтобы не «жил» процесс.
  if (process.env.NODE_ENV === 'test') return;
  // Один прогон сразу при старте (на случай простоя).
  try {
    const r = runRetentionOnce();
    if (r.deleted) {
      console.log(
        `[retention] startup sweep: removed ${r.deleted} messages older than ${r.window}`,
      );
    }
  } catch (e) {
    console.warn('[retention] startup sweep failed:', e?.message || e);
  }
  if (timer) return;
  timer = setInterval(() => {
    try {
      const r = runRetentionOnce();
      if (r.deleted) {
        console.log(`[retention] removed ${r.deleted} messages older than ${r.window}`);
      }
    } catch (e) {
      console.warn('[retention] sweep failed:', e?.message || e);
    }
  }, tickMs());
  if (typeof timer.unref === 'function') timer.unref();
}

export function stopRetention() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
