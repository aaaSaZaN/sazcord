import crypto from 'node:crypto';
import db from './db.js';

// Генерация безопасного кода: 16 hex-символов = 64 бита, читаемо и достаточно.
// Можно сделать короче (12), но при компромиссе.
export function generateCode(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

// Кто может выпускать коды: INVITE_WHO_CAN_CREATE=admins (по умолчанию)
// либо members. Живёт здесь, а не в routes/invites.js, потому что ответ
// нужен и публичному /api/config: без него клиент не знает, показывать ли
// обычному участнику раздел «Приглашения».
export function membersMayInvite() {
  return (process.env.INVITE_WHO_CAN_CREATE || 'admins').trim().toLowerCase() === 'members';
}

// Проверить и атомарно «списать» одно использование.
// Возвращает { ok: true } если ок, или { ok: false, reason } иначе.
// reason ∈ 'not_found' | 'revoked' | 'expired' | 'exhausted'.
export function consumeCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return { ok: false, reason: 'not_found' };

  const row = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(code);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (row.expires_at && row.expires_at <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (row.max_uses != null && row.uses_count >= row.max_uses) {
    return { ok: false, reason: 'exhausted' };
  }

  // Атомарный инкремент с защитой от гонок.
  const upd = db
    .prepare(
      `
    UPDATE invite_codes
       SET uses_count = uses_count + 1
     WHERE code = ?
       AND (max_uses IS NULL OR uses_count < max_uses)
       AND (revoked_at IS NULL)
       AND (expires_at IS NULL OR expires_at > ?)
  `,
    )
    .run(code, Date.now());

  if (upd.changes === 0) {
    // Кто-то успел списать последнее использование между SELECT и UPDATE.
    return { ok: false, reason: 'exhausted' };
  }
  // createdBy нужен вызывающему: по ссылке-приглашению новичок сразу
  // связывается с тем, кто его позвал (см. routes/auth.js).
  return { ok: true, createdBy: row.created_by || null };
}

/**
 * Проверить код, НЕ списывая использование.
 *
 * Нужен странице приглашения: она открывается до регистрации и должна
 * показать, кто позвал. Списывать код на простом открытии ссылки нельзя —
 * иначе одноразовое приглашение сгорало бы от превью в мессенджере или
 * от случайного обновления страницы.
 *
 * Наружу отдаём минимум: факт валидности и имя пригласившего. Ни счётчик
 * использований, ни срок, ни заметку — это внутренняя кухня, а эндпоинт
 * публичный.
 */
export function codeInfo(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) return { valid: false };
  const row = db
    .prepare(
      `SELECT c.max_uses, c.uses_count, c.expires_at, c.revoked_at,
              u.username AS inviter, u.display_name AS inviter_display
         FROM invite_codes c
         LEFT JOIN users u ON u.id = c.created_by
        WHERE c.code = ?`,
    )
    .get(code);
  if (!row) return { valid: false };
  if (row.revoked_at) return { valid: false };
  if (row.expires_at && row.expires_at <= Date.now()) return { valid: false };
  if (row.max_uses != null && row.uses_count >= row.max_uses) return { valid: false };
  return {
    valid: true,
    invitedBy: row.inviter_display || row.inviter || null,
  };
}

export function listCodes() {
  return db
    .prepare(
      `
      SELECT c.code, c.note, c.created_by, c.created_at, c.max_uses,
             c.uses_count, c.expires_at, c.revoked_at,
             u.username AS created_by_username
        FROM invite_codes c
        LEFT JOIN users u ON u.id = c.created_by
       ORDER BY c.created_at DESC
    `,
    )
    .all()
    .map(serializeRow);
}

export function createCode({ createdBy, note, maxUses, expiresAt, code }) {
  const finalCode = (code && String(code).trim()) || generateCode();
  db.prepare(
    `
    INSERT INTO invite_codes (code, note, created_by, max_uses, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(
    finalCode,
    note ? String(note).slice(0, 200) : null,
    createdBy || null,
    maxUses == null ? null : Math.max(1, Number(maxUses)),
    expiresAt == null ? null : Number(expiresAt),
  );
  const row = db
    .prepare(
      `
      SELECT c.code, c.note, c.created_by, c.created_at, c.max_uses,
             c.uses_count, c.expires_at, c.revoked_at,
             u.username AS created_by_username
        FROM invite_codes c
        LEFT JOIN users u ON u.id = c.created_by
       WHERE c.code = ?
    `,
    )
    .get(finalCode);
  return serializeRow(row);
}

export function revokeCode(rawCode) {
  const code = String(rawCode || '').trim();
  const upd = db
    .prepare('UPDATE invite_codes SET revoked_at = ? WHERE code = ? AND revoked_at IS NULL')
    .run(Date.now(), code);
  return upd.changes > 0;
}

function serializeRow(row) {
  if (!row) return null;
  const remaining = row.max_uses == null ? null : Math.max(0, row.max_uses - row.uses_count);
  return {
    code: row.code,
    note: row.note,
    createdBy: row.created_by,
    createdByUsername: row.created_by_username,
    createdAt: row.created_at,
    maxUses: row.max_uses,
    usesCount: row.uses_count,
    remaining,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    active:
      !row.revoked_at &&
      (row.expires_at == null || row.expires_at > Date.now()) &&
      (row.max_uses == null || row.uses_count < row.max_uses),
  };
}
