import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath =
  process.env.SAZCORD_DB_FILE || path.resolve(__dirname, '..', 'data', 'sazcord.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const rawDb = new DatabaseSync(dbPath);
rawDb.exec('PRAGMA journal_mode = WAL;');
rawDb.exec('PRAGMA foreign_keys = ON;');

const db = {
  exec(sql) {
    return rawDb.exec(sql);
  },
  pragma(sql) {
    return rawDb.exec(`PRAGMA ${sql};`);
  },
  prepare(sql) {
    const stmt = rawDb.prepare(sql);
    return {
      all(...args) {
        return stmt.all(...args);
      },
      get(...args) {
        return stmt.get(...args);
      },
      run(...args) {
        const result = stmt.run(...args);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
    };
  },
  transaction(fn) {
    return (...args) => {
      rawDb.exec('BEGIN IMMEDIATE;');
      try {
        const res = fn(...args);
        rawDb.exec('COMMIT;');
        return res;
      } catch (err) {
        try {
          rawDb.exec('ROLLBACK;');
        } catch {
          /* ignore */
        }
        throw err;
      }
    };
  },
  close() {
    return rawDb.close();
  },
};

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_pair
    ON messages (sender_id, receiver_id, created_at);
`);

// Идемпотентные миграции для уже существующих БД.
function hasColumn(table, col) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === col);
}

function addColumn(table, col, def) {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

addColumn('users', 'display_name', 'TEXT');
addColumn('users', 'avatar_path', 'TEXT');
addColumn('users', 'hide_on_delete', 'INTEGER NOT NULL DEFAULT 0');
addColumn('users', 'deleted_at', 'INTEGER');
addColumn('users', 'privacy_consent_at', 'INTEGER');
// «О себе» — заполняется при регистрации по ссылке-приглашению и в профиле.
addColumn('users', 'bio', 'TEXT');
// Кто позвал. Нужен, чтобы в private-режиме сразу связать новичка с
// пригласившим, и чтобы админ видел, по чьей ссылке кто пришёл.
addColumn('users', 'invited_by', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');

addColumn('messages', 'kind', "TEXT NOT NULL DEFAULT 'text'");
addColumn('messages', 'attachment_path', 'TEXT');
addColumn('messages', 'duration_ms', 'INTEGER');
addColumn('messages', 'edited_at', 'INTEGER');
addColumn('messages', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
addColumn('messages', 'attachment_name', 'TEXT');
addColumn('messages', 'attachment_size', 'INTEGER');
addColumn('messages', 'attachment_mime', 'TEXT');
addColumn('messages', 'payload', 'TEXT');
addColumn('messages', 'read_at', 'INTEGER');
addColumn('messages', 'forwarded_from_user_id', 'INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumn('messages', 'forwarded_from_message_id', 'INTEGER');
addColumn('messages', 'forwarded_from_created_at', 'INTEGER');
addColumn('messages', 'reply_to_message_id', 'INTEGER REFERENCES messages(id) ON DELETE SET NULL');
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages (reply_to_message_id);`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mutes (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    PRIMARY KEY (user_id, target_id)
  );
  CREATE INDEX IF NOT EXISTS idx_mutes_user ON mutes (user_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    avatar_path TEXT,
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member',
    joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    PRIMARY KEY (group_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id);
`);

// Миграция для обновления роли создателя до 'owner' если она ещё 'member'
const ownerRoleUpdate = db.prepare(`
  UPDATE group_members
  SET role = 'owner'
  WHERE role = 'member'
    AND group_id IN (SELECT id FROM groups WHERE owner_id = group_members.user_id)
`);
ownerRoleUpdate.run();
console.log('[db] Updated owner roles in group_members');

addColumn('messages', 'group_id', 'INTEGER REFERENCES groups(id) ON DELETE CASCADE');
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id, created_at);`);

function receiverIsNotNull() {
  const row = db
    .prepare('PRAGMA table_info(messages)')
    .all()
    .find((c) => c.name === 'receiver_id');
  return !!row && row.notnull === 1;
}

if (receiverIsNotNull()) {
  db.exec(`
    BEGIN;
    CREATE TABLE messages_new (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      group_id        INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      content         TEXT NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      edited_at       INTEGER,
      deleted         INTEGER NOT NULL DEFAULT 0,
      kind            TEXT NOT NULL DEFAULT 'text',
      attachment_path TEXT,
      duration_ms     INTEGER,
      attachment_name TEXT,
      attachment_size INTEGER,
      attachment_mime TEXT,
      payload         TEXT
    );
    INSERT INTO messages_new (id, sender_id, receiver_id, group_id, content,
      created_at, edited_at, deleted, kind, attachment_path, duration_ms,
      attachment_name, attachment_size, attachment_mime, payload)
    SELECT id, sender_id, receiver_id, group_id, content,
      created_at, edited_at, deleted, kind, attachment_path, duration_ms,
      attachment_name, attachment_size, attachment_mime, payload
    FROM messages;
    DROP TABLE messages;
    ALTER TABLE messages_new RENAME TO messages;
    CREATE INDEX idx_messages_pair ON messages (sender_id, receiver_id, created_at);
    CREATE INDEX idx_messages_group ON messages (group_id, created_at);
    COMMIT;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    last_used  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS invite_codes (
    code        TEXT PRIMARY KEY COLLATE NOCASE,
    note        TEXT,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    max_uses    INTEGER,
    uses_count  INTEGER NOT NULL DEFAULT 0,
    expires_at  INTEGER,
    revoked_at  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes (created_by);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(message_id, user_id, emoji)
  );
  CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions (message_id);
  CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions (user_id);
`);

// --- Дружбы ----------------------------------------------------------------
// Используются только при SAZCORD_SOCIAL_MODE=private (см. src/social.js).
// В режиме local таблица просто пустует и ни на что не влияет — так
// переключение режима туда-обратно не требует миграций.
//
// Пара хранится ОДНОЙ строкой, направление задаёт requester_id: это нужно,
// чтобы отличать входящую заявку от исходящей. Уникальный индекс по
// упорядоченной паре (least/greatest) не даёт создать встречную заявку-
// дубликат, когда двое одновременно добавили друг друга.
db.exec(`
  CREATE TABLE IF NOT EXISTS friendships (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   INTEGER NOT NULL,
    responded_at INTEGER
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_friendships_pair
    ON friendships (
      MIN(requester_id, addressee_id),
      MAX(requester_id, addressee_id)
    );

  CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_id, status);
  CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id, status);
`);

try {
  const stale = db.prepare(`SELECT id, payload FROM messages WHERE kind = 'groupcall'`).all();
  const upd = db.prepare('UPDATE messages SET payload = ? WHERE id = ?');
  for (const r of stale) {
    let p = {};
    try {
      p = JSON.parse(r.payload || '{}');
    } catch {
      /* */
    }
    if (p.status === 'active') {
      p.status = 'ended';
      p.endedAt = p.endedAt || Date.now();
      upd.run(JSON.stringify(p), r.id);
    }
  }
} catch {
  /* ignore */
}

export default db;
