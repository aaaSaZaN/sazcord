import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';
import db from '../src/db.js';
import { runRetentionOnce } from '../src/retention.js';
import { UPLOADS_DIR, publicPathFor } from '../src/uploads.js';

let app;
const originalDays = process.env.RETENTION_DAYS;

beforeAll(() => {
  app = buildTestApp();
  // Ужимаем окно ретеншна до 1 дня для теста.
  process.env.RETENTION_DAYS = '1';
});

afterAll(() => {
  if (originalDays === undefined) delete process.env.RETENTION_DAYS;
  else process.env.RETENTION_DAYS = originalDays;
});

async function register(username, password = 'secret123') {
  const r = await request(app).post('/api/auth/register').send({ username, password });
  expect(r.status).toBe(200);
  return { token: r.body.token, user: r.body.user };
}

describe('history retention', () => {
  it('deletes messages older than RETENTION_DAYS and keeps recent ones', async () => {
    const a = await register('ret_a');
    const b = await register('ret_b');

    const now = Date.now();
    const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000; // старше окна
    const anHourAgo = now - 60 * 60 * 1000; // свежее

    const oldMsg = db
      .prepare(
        `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, 'old', ?, 'text')`,
      )
      .run(a.user.id, b.user.id, twoDaysAgo);

    const newMsg = db
      .prepare(
        `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, 'fresh', ?, 'text')`,
      )
      .run(a.user.id, b.user.id, anHourAgo);

    const r = runRetentionOnce();
    expect(r.deleted).toBeGreaterThanOrEqual(1);

    const old = db.prepare('SELECT id FROM messages WHERE id = ?').get(oldMsg.lastInsertRowid);
    const fresh = db.prepare('SELECT id FROM messages WHERE id = ?').get(newMsg.lastInsertRowid);
    expect(old).toBeUndefined();
    expect(fresh).toBeTruthy();
  });

  it('removes attachment files from disk when message is purged', async () => {
    const a = await register('ret_c');
    const b = await register('ret_d');

    // Эмулируем загруженный файл — создаём его прямо в UPLOADS_DIR/files.
    const filesDir = path.join(UPLOADS_DIR, 'files');
    fs.mkdirSync(filesDir, { recursive: true });
    const filePath = path.join(filesDir, `retention-${Date.now()}.bin`);
    fs.writeFileSync(filePath, 'payload');
    const pub = publicPathFor(filePath);

    const old = Date.now() - 100 * 24 * 60 * 60 * 1000;
    db.prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind,
         attachment_path, attachment_name, attachment_size, attachment_mime)
       VALUES (?, ?, '', ?, 'file', ?, 'payload.bin', 7, 'application/octet-stream')`,
    ).run(a.user.id, b.user.id, old, pub);

    expect(fs.existsSync(filePath)).toBe(true);
    runRetentionOnce();
    // Даём best-effort unlink мгновение отработать.
    await new Promise((r) => setTimeout(r, 30));
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('is a no-op when everything is fresh', async () => {
    // Все оставшиеся сообщения в этой БД уже свежие — ничего не удалится.
    const r = runRetentionOnce();
    expect(r.deleted).toBe(0);
  });
});
