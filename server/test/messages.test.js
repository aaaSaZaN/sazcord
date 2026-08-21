import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import db from '../src/db.js';
import { buildTestApp } from './appFactory.js';

let app;
let aliceToken;
let aliceId;
let bobToken;
let bobId;

beforeAll(async () => {
  app = buildTestApp();
  const a = await request(app)
    .post('/api/auth/register')
    .send({ username: 'alice_msg', password: 'secret123' });
  aliceToken = a.body.token;
  aliceId = a.body.user.id;
  const b = await request(app)
    .post('/api/auth/register')
    .send({ username: 'bob_msg', password: 'secret123' });
  bobToken = b.body.token;
  bobId = b.body.user.id;
});

function insertText({ from, to, content }) {
  const info = db
    .prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, ?, ?, 'text')`,
    )
    .run(from, to, content, Date.now());
  return info.lastInsertRowid;
}

describe('messages', () => {
  it('GET history returns text messages between two users in order', async () => {
    insertText({ from: aliceId, to: bobId, content: 'привет' });
    insertText({ from: bobId, to: aliceId, content: 'и тебе' });
    const res = await request(app)
      .get(`/api/messages/${bobId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    const list = res.body.messages;
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[list.length - 2].content).toBe('привет');
    expect(list[list.length - 1].content).toBe('и тебе');
  });

  it('PATCH edits own text message', async () => {
    const id = insertText({ from: aliceId, to: bobId, content: 'старое' });
    const res = await request(app)
      .patch(`/api/messages/${id}`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ content: 'новое' });
    expect(res.status).toBe(200);
    expect(res.body.message.content).toBe('новое');
    expect(res.body.message.editedAt).toBeTruthy();
  });

  it('PATCH rejects editing someone else’s message', async () => {
    const id = insertText({ from: aliceId, to: bobId, content: 'мое' });
    const res = await request(app)
      .patch(`/api/messages/${id}`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ content: 'хак' });
    expect(res.status).toBe(403);
  });

  it('DELETE soft-deletes when hide_on_delete is false', async () => {
    const id = insertText({ from: aliceId, to: bobId, content: 'удалить меня' });
    db.prepare('UPDATE users SET hide_on_delete = 0 WHERE id = ?').run(aliceId);
    const res = await request(app)
      .delete(`/api/messages/${id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.removed).toBeUndefined();
    expect(res.body.message.deleted).toBe(true);
    expect(res.body.message.content).toBe('');
  });

  it('DELETE hard-removes when hide_on_delete is true', async () => {
    const id = insertText({ from: aliceId, to: bobId, content: 'снести' });
    db.prepare('UPDATE users SET hide_on_delete = 1 WHERE id = ?').run(aliceId);
    const res = await request(app)
      .delete(`/api/messages/${id}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(true);
    const row = db.prepare('SELECT id FROM messages WHERE id = ?').get(id);
    expect(row).toBeUndefined();
  });
});
