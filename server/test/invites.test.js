import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';
import db from '../src/db.js';

let app;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(() => {
  db.exec('DELETE FROM invite_codes');
});

afterEach(() => {
  delete process.env.REGISTRATION_CODE;
  delete process.env.REGISTRATION_DISABLED;
  delete process.env.ADMIN_USERNAMES;
});

async function registerAndLogin(username) {
  // Без env REGISTRATION_CODE и без записей в invite_codes — регистрация
  // открыта (см. логику hasActiveDbCodes/inviteNeeded в auth.js).
  const r = await request(app).post('/api/auth/register').send({ username, password: 'secret123' });
  expect(r.status).toBe(200);
  return { token: r.body.token, user: r.body.user };
}

// Делает username админом через ADMIN_USERNAMES. Не зависит от порядка
// id'шников в общей тестовой БД.
async function registerAsAdmin(username) {
  const u = await registerAndLogin(username);
  process.env.ADMIN_USERNAMES = username;
  // Перезаходим — токен переиспользуем, но isAdmin определяется на каждом
  // запросе по env. Просто возвращаем уже выданный токен.
  return u;
}

describe('invites — admin API', () => {
  it('non-admin gets 403, admin (id=1 by default) gets 200', async () => {
    const first = await registerAndLogin('rootuser');
    const second = await registerAndLogin('peon');

    expect(first.user.isAdmin).toBe(true);
    expect(second.user.isAdmin).toBe(false);

    const a = await request(app).get('/api/invites').set('Authorization', `Bearer ${second.token}`);
    expect(a.status).toBe(403);

    const b = await request(app).get('/api/invites').set('Authorization', `Bearer ${first.token}`);
    expect(b.status).toBe(200);
    expect(Array.isArray(b.body.codes)).toBe(true);
  });

  it('ADMIN_USERNAMES env overrides id=1 fallback', async () => {
    const first = await registerAndLogin('alpha');
    const second = await registerAndLogin('beta');

    process.env.ADMIN_USERNAMES = 'beta';

    const a = await request(app).get('/api/invites').set('Authorization', `Bearer ${first.token}`);
    expect(a.status).toBe(403);

    const b = await request(app).get('/api/invites').set('Authorization', `Bearer ${second.token}`);
    expect(b.status).toBe(200);
  });

  it('create / list / revoke flow', async () => {
    const admin = await registerAsAdmin('boss');

    // Создаём
    const created = await request(app)
      .post('/api/invites')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ note: 'для Васи', maxUses: 1 });
    expect(created.status).toBe(200);
    const code = created.body.code.code;
    expect(code).toBeTruthy();
    expect(created.body.code.note).toBe('для Васи');
    expect(created.body.code.maxUses).toBe(1);
    expect(created.body.code.active).toBe(true);

    // Список
    const list = await request(app)
      .get('/api/invites')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(list.body.codes).toHaveLength(1);

    // Отзыв
    const rv = await request(app)
      .delete(`/api/invites/${code}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(rv.status).toBe(200);

    const list2 = await request(app)
      .get('/api/invites')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(list2.body.codes[0].active).toBe(false);
    expect(list2.body.codes[0].revokedAt).toBeTruthy();
  });
});

describe('invites — registration with DB codes', () => {
  it('one-time code allows exactly one registration', async () => {
    const admin = await registerAsAdmin('master');
    const created = await request(app)
      .post('/api/invites')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ maxUses: 1 });
    const code = created.body.code.code;

    // info теперь говорит, что нужен инвайт.
    const info = await request(app).get('/api/auth/registration-info');
    expect(info.body.inviteRequired).toBe(true);

    // Без кода — 400.
    const noInvite = await request(app)
      .post('/api/auth/register')
      .send({ username: 'guest1', password: 'secret123' });
    expect(noInvite.status).toBe(400);

    // С правильным кодом — успех.
    const ok1 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'guest2', password: 'secret123', invite: code });
    expect(ok1.status).toBe(200);

    // Повторное использование — 403 (исчерпан).
    const ok2 = await request(app)
      .post('/api/auth/register')
      .send({ username: 'guest3', password: 'secret123', invite: code });
    expect(ok2.status).toBe(403);
  });

  it('revoked code is rejected immediately', async () => {
    const admin = await registerAsAdmin('overlord');
    const created = await request(app)
      .post('/api/invites')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ maxUses: 5 });
    const code = created.body.code.code;

    await request(app).delete(`/api/invites/${code}`).set('Authorization', `Bearer ${admin.token}`);

    const r = await request(app)
      .post('/api/auth/register')
      .send({ username: 'rejected', password: 'secret123', invite: code });
    expect(r.status).toBe(403);
  });

  it('shared ENV code and DB codes work side by side', async () => {
    const admin = await registerAsAdmin('chief');
    const created = await request(app)
      .post('/api/invites')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ maxUses: 1 });
    const dbCode = created.body.code.code;

    process.env.REGISTRATION_CODE = 'shared-secret';

    // Через общий код.
    const a = await request(app)
      .post('/api/auth/register')
      .send({ username: 'viaShared', password: 'secret123', invite: 'shared-secret' });
    expect(a.status).toBe(200);

    // Через DB-код.
    const b = await request(app)
      .post('/api/auth/register')
      .send({ username: 'viaDb', password: 'secret123', invite: dbCode });
    expect(b.status).toBe(200);

    // Произвольная строка не подходит.
    const c = await request(app)
      .post('/api/auth/register')
      .send({ username: 'viaJunk', password: 'secret123', invite: 'random' });
    expect(c.status).toBe(403);
  });
});
