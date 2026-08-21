// Тесты для POST /api/messages/:id/forward.
//
// Покрываем сценарии:
//   1) DM → DM: переслать текст бобу от кэрол, проверить, что:
//      - сервер вернул новое сообщение с forwardedFrom.senderId = alice
//        (исходный автор), но sender_id самой записи = carol (кто
//        переслал);
//      - в БД есть новая строка; оригинал alice→bob цел.
//   2) DM → group: переслать тот же текст в группу. У новой записи
//      group_id = gid, receiver_id = null.
//   3) Цепочка пересылок: пересылаем уже переслыное сообщение — поле
//      forwarded_from_user_id должно указывать на ИЗНАЧАЛЬНОГО автора
//      (alice), а не на промежуточное звено (carol).
//   4) Отказы: deleted / kind='system' / kind='call' / kind='groupcall' —
//      400. Не-участник группы как target — 403. Нет доступа к оригиналу
//      (чужой DM) — 403. Оба/ни одного target — 400.

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import db from '../src/db.js';
import { buildTestApp } from './appFactory.js';

let app;
const U = {};

async function registerUser(username) {
  const r = await request(app).post('/api/auth/register').send({ username, password: 'secret123' });
  return { token: r.body.token, id: r.body.user.id };
}

function auth(u) {
  return { Authorization: `Bearer ${u.token}` };
}

function insertText({ from, to, content = 'hello' }) {
  const info = db
    .prepare(
      `INSERT INTO messages (sender_id, receiver_id, content, created_at, kind)
       VALUES (?, ?, ?, ?, 'text')`,
    )
    .run(from, to, content, Date.now());
  return info.lastInsertRowid;
}

function insertKind({ from, to = null, groupId = null, kind, content = '' }) {
  const info = db
    .prepare(
      `INSERT INTO messages (sender_id, receiver_id, group_id, content, created_at, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(from, to, groupId, content, Date.now(), kind);
  return info.lastInsertRowid;
}

let groupId;
let outsideGroupId;

beforeAll(async () => {
  app = buildTestApp();
  U.alice = await registerUser('alice_fwd');
  U.bob = await registerUser('bob_fwd');
  U.carol = await registerUser('carol_fwd');
  U.dave = await registerUser('dave_fwd');

  // Группа с alice + bob, в которую carol не входит — для проверки 403
  // на «переслать в чужую группу».
  const g = await request(app)
    .post('/api/groups')
    .set(auth(U.alice))
    .send({ name: 'ForwardTarget', memberIds: [U.bob.id] });
  groupId = g.body.group.id;

  // Отдельная группа без alice — для проверки, что alice не может
  // переслать В неё (нет участия).
  const g2 = await request(app)
    .post('/api/groups')
    .set(auth(U.dave))
    .send({ name: 'DavesGroup', memberIds: [U.carol.id] });
  outsideGroupId = g2.body.group.id;
});

describe('message forwarding', () => {
  it('DM → DM: forwards preserving origin author', async () => {
    // alice пишет бобу.
    const origId = insertText({ from: U.alice.id, to: U.bob.id, content: 'original' });
    // bob видит это сообщение у себя и пересылает кэрол.
    const res = await request(app)
      .post(`/api/messages/${origId}/forward`)
      .set(auth(U.bob))
      .send({ to: U.carol.id });
    expect(res.status).toBe(200);
    const msg = res.body.message;
    expect(msg.senderId).toBe(U.bob.id); // пересылает bob
    expect(msg.receiverId).toBe(U.carol.id);
    expect(msg.groupId).toBeNull();
    expect(msg.content).toBe('original');
    expect(msg.forwardedFrom).toBeTruthy();
    expect(msg.forwardedFrom.senderId).toBe(U.alice.id); // оригинальный автор
    expect(msg.forwardedFrom.messageId).toBe(origId);
    // Оригинал не трогается.
    const orig = db.prepare('SELECT deleted FROM messages WHERE id = ?').get(origId);
    expect(orig.deleted).toBeFalsy();
  });

  it('DM → group: forwards into a group the sender belongs to', async () => {
    const origId = insertText({ from: U.alice.id, to: U.bob.id, content: 'hello group fwd' });
    const res = await request(app)
      .post(`/api/messages/${origId}/forward`)
      .set(auth(U.alice))
      .send({ groupId });
    expect(res.status).toBe(200);
    const msg = res.body.message;
    expect(msg.senderId).toBe(U.alice.id);
    expect(msg.groupId).toBe(groupId);
    expect(msg.receiverId).toBeNull();
    expect(msg.forwardedFrom?.senderId).toBe(U.alice.id);
  });

  it('keeps origin across re-forwards (chain collapses to first author)', async () => {
    const origId = insertText({ from: U.alice.id, to: U.bob.id, content: 'chain me' });
    // bob → carol
    const first = await request(app)
      .post(`/api/messages/${origId}/forward`)
      .set(auth(U.bob))
      .send({ to: U.carol.id });
    expect(first.status).toBe(200);
    const firstId = first.body.message.id;
    // carol → dave (пересылает уже пересланное)
    const second = await request(app)
      .post(`/api/messages/${firstId}/forward`)
      .set(auth(U.carol))
      .send({ to: U.dave.id });
    expect(second.status).toBe(200);
    // Origin должен указывать на alice, а не на bob.
    expect(second.body.message.forwardedFrom?.senderId).toBe(U.alice.id);
    expect(second.body.message.forwardedFrom?.messageId).toBe(origId);
  });

  it('rejects forwarding a deleted message', async () => {
    const id = insertText({ from: U.alice.id, to: U.bob.id, content: 'rm' });
    db.prepare("UPDATE messages SET deleted = 1, content = '' WHERE id = ?").run(id);
    const res = await request(app)
      .post(`/api/messages/${id}/forward`)
      .set(auth(U.alice))
      .send({ to: U.carol.id });
    expect(res.status).toBe(400);
  });

  it('rejects forwarding a system message', async () => {
    const id = insertKind({ from: U.alice.id, groupId, kind: 'system', content: '' });
    const res = await request(app)
      .post(`/api/messages/${id}/forward`)
      .set(auth(U.alice))
      .send({ to: U.bob.id });
    expect(res.status).toBe(400);
  });

  it('rejects forwarding a call message', async () => {
    const id = insertKind({ from: U.alice.id, to: U.bob.id, kind: 'call' });
    const res = await request(app)
      .post(`/api/messages/${id}/forward`)
      .set(auth(U.alice))
      .send({ to: U.carol.id });
    expect(res.status).toBe(400);
  });

  it('rejects forwarding a groupcall message', async () => {
    const id = insertKind({ from: U.alice.id, groupId, kind: 'groupcall' });
    const res = await request(app)
      .post(`/api/messages/${id}/forward`)
      .set(auth(U.alice))
      .send({ to: U.bob.id });
    expect(res.status).toBe(400);
  });

  it('rejects forwarding to a group the user is not a member of', async () => {
    const id = insertText({ from: U.alice.id, to: U.bob.id, content: 'nope' });
    const res = await request(app)
      .post(`/api/messages/${id}/forward`)
      .set(auth(U.alice))
      .send({ groupId: outsideGroupId });
    expect(res.status).toBe(403);
  });

  it('rejects forwarding when user has no access to the source message', async () => {
    // Сообщение alice→bob, пересылать пытается dave (ни sender, ни receiver).
    const id = insertText({ from: U.alice.id, to: U.bob.id, content: 'secret' });
    const res = await request(app)
      .post(`/api/messages/${id}/forward`)
      .set(auth(U.dave))
      .send({ to: U.carol.id });
    expect(res.status).toBe(403);
  });

  it('rejects body with both to and groupId', async () => {
    const id = insertText({ from: U.alice.id, to: U.bob.id });
    const res = await request(app)
      .post(`/api/messages/${id}/forward`)
      .set(auth(U.alice))
      .send({ to: U.carol.id, groupId });
    expect(res.status).toBe(400);
  });

  it('rejects body with neither to nor groupId', async () => {
    const id = insertText({ from: U.alice.id, to: U.bob.id });
    const res = await request(app)
      .post(`/api/messages/${id}/forward`)
      .set(auth(U.alice))
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for missing message id', async () => {
    const res = await request(app)
      .post('/api/messages/9999999/forward')
      .set(auth(U.alice))
      .send({ to: U.bob.id });
    expect(res.status).toBe(404);
  });

  it('returns 400 for bad message id', async () => {
    const res = await request(app)
      .post('/api/messages/not-a-number/forward')
      .set(auth(U.alice))
      .send({ to: U.bob.id });
    expect(res.status).toBe(400);
  });
});
