import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';
import db from '../src/db.js';

let app;
let admin;
let member1;
let member2;
let member3;

beforeAll(async () => {
  app = buildTestApp();
  // Первый зарегистрированный (id=1) считается админом, когда
  // ADMIN_USERNAMES не задан.
  admin = await register('inv_admin');
  // Всех подопытных заводим ЗДЕСЬ, пока в базе нет ни одного активного
  // кода: как только он появляется, регистрация начинает требовать
  // приглашение (см. hasActiveDbCodes в routes/auth.js).
  member1 = await register('inv_member1');
  member2 = await register('inv_member2');
  member3 = await register('inv_member3');
});

afterEach(() => {
  delete process.env.INVITE_WHO_CAN_CREATE;
  delete process.env.SAZCORD_SOCIAL_MODE;
});

async function register(username, extra = {}) {
  const r = await request(app)
    .post('/api/auth/register')
    .send({ username, password: 'secret123', ...extra });
  expect(r.status).toBe(200);
  return { token: r.body.token, user: r.body.user };
}

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

async function makeCode(as, body = {}) {
  const r = await request(app).post('/api/invites').set(auth(as)).send(body);
  expect(r.status).toBe(200);
  return r.body.code.code;
}

describe('invite link info (public)', () => {
  it('reports who invited you, without a token', async () => {
    const code = await makeCode(admin, { maxUses: 1 });
    // Страницу открывает человек, у которого аккаунта ещё нет —
    // авторизации тут быть не может.
    const r = await request(app).get(`/api/invites/${code}/info`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ valid: true, invitedBy: 'inv_admin' });
  });

  it('does not consume a use when the link is merely opened', async () => {
    // Иначе одноразовое приглашение сгорало бы от превью в мессенджере
    // или от обновления страницы.
    const code = await makeCode(admin, { maxUses: 1 });
    await request(app).get(`/api/invites/${code}/info`);
    await request(app).get(`/api/invites/${code}/info`);
    const still = await request(app).get(`/api/invites/${code}/info`);
    expect(still.body.valid).toBe(true);
  });

  it('says only "invalid" for an unknown code, leaking nothing else', async () => {
    const r = await request(app).get('/api/invites/deadbeefdeadbeef/info');
    expect(r.body).toEqual({ valid: false });
  });

  it('reports a used-up single-use code as invalid', async () => {
    const code = await makeCode(admin, { maxUses: 1 });
    await register('inv_used', { invite: code });
    const r = await request(app).get(`/api/invites/${code}/info`);
    expect(r.body.valid).toBe(false);
  });
});

describe('who may create invites', () => {
  it('keeps members out by default', async () => {
    const member = member1;
    const r = await request(app).post('/api/invites').set(auth(member)).send({});
    expect(r.status).toBe(403);
    const list = await request(app).get('/api/invites').set(auth(member));
    expect(list.status).toBe(403);
  });

  it('lets members create single-use links when enabled', async () => {
    process.env.INVITE_WHO_CAN_CREATE = 'members';
    const member = member2;

    // Просят многоразовый и бессрочный — получают одноразовый со сроком.
    const r = await request(app)
      .post('/api/invites')
      .set(auth(member))
      .send({ maxUses: 100, expiresAt: null });
    expect(r.status).toBe(200);
    expect(r.body.code.maxUses).toBe(1);
    expect(r.body.code.expiresAt).toBeGreaterThan(Date.now());
  });

  it('shows a member only their own codes', async () => {
    process.env.INVITE_WHO_CAN_CREATE = 'members';
    const member = member3;
    await makeCode(admin, { maxUses: 1 });
    const mine = await makeCode(member);

    const list = await request(app).get('/api/invites').set(auth(member));
    expect(list.status).toBe(200);
    expect(list.body.codes.map((c) => c.code)).toEqual([mine]);
  });
});

describe('registering through an invite link', () => {
  it('records the inviter and the profile fields', async () => {
    const code = await makeCode(admin, { maxUses: 1 });
    const joined = await register('inv_newbie', {
      invite: code,
      displayName: 'Новичок',
      bio: 'привет',
    });

    const row = db
      .prepare('SELECT display_name, bio, invited_by FROM users WHERE id = ?')
      .get(joined.user.id);
    expect(row.display_name).toBe('Новичок');
    expect(row.bio).toBe('привет');
    expect(row.invited_by).toBe(admin.user.id);
  });

  it('befriends the inviter in private mode, so the newcomer is not alone', async () => {
    process.env.SAZCORD_SOCIAL_MODE = 'private';
    const code = await makeCode(admin, { maxUses: 1 });
    const joined = await register('inv_private', { invite: code });

    // Без этого новичок в private-режиме не увидел бы даже того, кто его
    // позвал, и ссылка теряла бы смысл.
    const seen = await request(app).get('/api/users').set(auth(joined));
    expect(seen.body.users.map((u) => u.id)).toEqual(
      expect.arrayContaining([admin.user.id, joined.user.id]),
    );
  });

  it('creates no friendship in local mode, where it would mean nothing', async () => {
    const code = await makeCode(admin, { maxUses: 1 });
    const joined = await register('inv_local', { invite: code });
    const link = db
      .prepare(
        `SELECT 1 FROM friendships
          WHERE (requester_id = ? AND addressee_id = ?)
             OR (requester_id = ? AND addressee_id = ?)`,
      )
      .get(admin.user.id, joined.user.id, joined.user.id, admin.user.id);
    expect(link).toBeUndefined();
  });
});
