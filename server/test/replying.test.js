// Тесты для функции «Ответить» (reply).
//
// Покрытие:
//   1) DM: ответ на сообщение в текущем чате — replyTo превью отдаётся
//      сервером с senderId, content, kind, deleted, attachmentPath.
//   2) Группа: ответ в групповом чате через POST /:id/messages/text.
//   3) Voice / file ответ через HTTP endpoints с replyToId.
//   4) Отказы: reply на сообщение из ДРУГОГО чата → 400.
//   5) Отказы: reply на несуществующее сообщение → 400.
//   6) Отказы: ответ на удалённое — replyTo указывает на оригинал, но
//      content в превью пустой, флаг deleted=true.
//   7) История возвращает replyTo для сообщений, у которых он есть.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import path from 'node:path';
import fs from 'node:fs';
import db from '../src/db.js';
import { buildTestApp } from './appFactory.js';

let app;
const U = {};
let groupId;
let outsideDmMessageId;

async function registerUser(username) {
  const r = await request(app).post('/api/auth/register').send({ username, password: 'secret123' });
  return { token: r.body.token, id: r.body.user.id };
}

function auth(u) {
  return { Authorization: `Bearer ${u.token}` };
}

function insertText({ from, to = null, groupId = null, content = 'hello', deleted = 0 }) {
  const info = db
    .prepare(
      `INSERT INTO messages (sender_id, receiver_id, group_id, content, created_at, kind, deleted)
       VALUES (?, ?, ?, ?, ?, 'text', ?)`,
    )
    .run(from, to, groupId, content, Date.now(), deleted);
  return info.lastInsertRowid;
}

beforeAll(async () => {
  app = buildTestApp();
  U.alice = await registerUser('alice_reply');
  U.bob = await registerUser('bob_reply');
  U.carol = await registerUser('carol_reply');

  // Группа c alice + bob — для reply в групповом чате.
  const g = await request(app)
    .post('/api/groups')
    .set(auth(U.alice))
    .send({ name: 'ReplyChat', memberIds: [U.bob.id] });
  groupId = g.body.group.id;

  // «Чужое» сообщение в DM alice→carol — нужно для проверки 400
  // на reply из другого чата.
  outsideDmMessageId = insertText({
    from: U.alice.id,
    to: U.carol.id,
    content: 'in alice-carol',
  });
});

describe('message reply', () => {
  it('DM history exposes replyTo preview for reply messages', async () => {
    // alice пишет бобу.
    const origId = insertText({ from: U.alice.id, to: U.bob.id, content: 'original' });
    // bob отвечает alice через прямой INSERT (имитация socket dm:send).
    db.prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind, reply_to_message_id)
       VALUES (?, ?, ?, ?, 'text', ?)`,
    ).run(U.bob.id, U.alice.id, 'reply', Date.now(), origId);

    const res = await request(app).get(`/api/messages/${U.bob.id}`).set(auth(U.alice));
    expect(res.status).toBe(200);
    const replyMsg = res.body.messages.find((m) => m.content === 'reply');
    expect(replyMsg).toBeTruthy();
    expect(replyMsg.replyTo).toBeTruthy();
    expect(replyMsg.replyTo.id).toBe(origId);
    expect(replyMsg.replyTo.senderId).toBe(U.alice.id);
    expect(replyMsg.replyTo.content).toBe('original');
    expect(replyMsg.replyTo.kind).toBe('text');
    expect(replyMsg.replyTo.deleted).toBe(false);
  });

  it('group text reply: POST /:id/messages/text with replyToId works', async () => {
    // alice пишет в группу.
    const first = await request(app)
      .post(`/api/groups/${groupId}/messages/text`)
      .set(auth(U.alice))
      .send({ content: 'group orig' });
    expect(first.status).toBe(200);
    const origId = first.body.message.id;

    // bob отвечает.
    const res = await request(app)
      .post(`/api/groups/${groupId}/messages/text`)
      .set(auth(U.bob))
      .send({ content: 'group reply', replyToId: origId });
    expect(res.status).toBe(200);
    const msg = res.body.message;
    expect(msg.replyTo).toBeTruthy();
    expect(msg.replyTo.id).toBe(origId);
    expect(msg.replyTo.senderId).toBe(U.alice.id);
    expect(msg.replyTo.content).toBe('group orig');
  });

  it('DM file reply: POST /messages/file with replyToId works', async () => {
    // alice пишет бобу.
    const origId = insertText({ from: U.alice.id, to: U.bob.id, content: 'pre-file' });
    // bob прикрепляет файл-ответ.
    const tmp = path.join(require('node:os').tmpdir(), `sazcord-reply-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'tiny');
    const res = await request(app)
      .post('/api/messages/file')
      .set(auth(U.bob))
      .field('to', U.alice.id)
      .field('content', 'file caption')
      .field('replyToId', String(origId))
      .attach('files', tmp);
    fs.unlinkSync(tmp);
    expect(res.status).toBe(200);
    const msg = res.body.message;
    expect(msg.replyTo).toBeTruthy();
    expect(msg.replyTo.id).toBe(origId);
    expect(msg.replyTo.senderId).toBe(U.alice.id);
    expect(msg.attachmentPath).toBeTruthy();
  });

  it('rejects reply to a message in a different chat', async () => {
    // bob пытается ответить в DM с alice на сообщение из alice↔carol.
    const res = await request(app)
      .post(`/api/groups/${groupId}/messages/text`)
      .set(auth(U.alice))
      .send({ content: 'cross-chat reply', replyToId: outsideDmMessageId });
    expect(res.status).toBe(400);
  });

  it('rejects reply to a non-existent message', async () => {
    const res = await request(app)
      .post(`/api/groups/${groupId}/messages/text`)
      .set(auth(U.alice))
      .send({ content: 'ghost reply', replyToId: 9999999 });
    expect(res.status).toBe(400);
  });

  it('rejects reply with bad replyToId type', async () => {
    const res = await request(app)
      .post(`/api/groups/${groupId}/messages/text`)
      .set(auth(U.alice))
      .send({ content: 'bad', replyToId: 'oops' });
    expect(res.status).toBe(400);
  });

  it('allows reply to a soft-deleted message; preview shows deleted=true', async () => {
    // alice пишет бобу и удаляет сообщение (soft-delete: hide_on_delete=0).
    db.prepare('UPDATE users SET hide_on_delete = 0 WHERE id = ?').run(U.alice.id);
    const origId = insertText({ from: U.alice.id, to: U.bob.id, content: 'will be soft-deleted' });
    const del = await request(app).delete(`/api/messages/${origId}`).set(auth(U.alice));
    expect(del.status).toBe(200);
    expect(del.body.message.deleted).toBe(true);

    // bob отвечает на удалённое.
    db.prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind, reply_to_message_id)
       VALUES (?, ?, ?, ?, 'text', ?)`,
    ).run(U.bob.id, U.alice.id, 'reply-to-deleted', Date.now(), origId);

    const res = await request(app).get(`/api/messages/${U.bob.id}`).set(auth(U.alice));
    expect(res.status).toBe(200);
    const replyMsg = res.body.messages.find((m) => m.content === 'reply-to-deleted');
    expect(replyMsg).toBeTruthy();
    expect(replyMsg.replyTo).toBeTruthy();
    expect(replyMsg.replyTo.id).toBe(origId);
    expect(replyMsg.replyTo.deleted).toBe(true);
    // content в превью пустой, потому что сообщение soft-deleted.
    expect(replyMsg.replyTo.content).toBe('');
  });

  it('reply_to becomes null after hard-delete of the origin (ON DELETE SET NULL)', async () => {
    // Сначала alice пишет, bob отвечает — REPLY успешно создан.
    const origId = insertText({ from: U.alice.id, to: U.bob.id, content: 'hard-delete me' });
    const replyInfo = db
      .prepare(
        `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind, reply_to_message_id)
         VALUES (?, ?, ?, ?, 'text', ?)`,
      )
      .run(U.bob.id, U.alice.id, 'reply-before-delete', Date.now(), origId);
    const replyId = replyInfo.lastInsertRowid;

    // Затем alice жёстко удаляет оригинал (hide_on_delete=1).
    db.prepare('UPDATE users SET hide_on_delete = 1 WHERE id = ?').run(U.alice.id);
    const del = await request(app).delete(`/api/messages/${origId}`).set(auth(U.alice));
    expect(del.status).toBe(200);
    expect(del.body.removed).toBe(true);

    // FK ON DELETE SET NULL обнулил reply_to_message_id у нашего ответа.
    const row = db
      .prepare('SELECT reply_to_message_id FROM messages WHERE id = ?')
      .get(replyId);
    expect(row.reply_to_message_id).toBeNull();

    // И rowToMessage отдаёт replyTo: null в API-ответе.
    const res = await request(app).get(`/api/messages/${U.bob.id}`).set(auth(U.alice));
    const replyMsg = res.body.messages.find((m) => m.id === replyId);
    expect(replyMsg).toBeTruthy();
    expect(replyMsg.replyTo).toBeNull();
  });
});
