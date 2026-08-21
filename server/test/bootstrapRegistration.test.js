import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';

// Этот файл получает собственный файл БД (см. test/setup.js), поэтому
// здесь можно проверить поведение именно ПУСТОГО сервера — того самого,
// который получает человек сразу после установки.

let app;
const OPEN = process.env.REGISTRATION_OPEN;

beforeAll(() => {
  app = buildTestApp();
});

beforeEach(() => {
  delete process.env.REGISTRATION_OPEN;
});

afterAll(() => {
  if (OPEN !== undefined) process.env.REGISTRATION_OPEN = OPEN;
});

describe('bootstrap owner', () => {
  it('lets the first account in without an invite, then closes the door', async () => {
    const info = await request(app).get('/api/auth/registration-info');
    expect(info.body).toMatchObject({ inviteRequired: false, bootstrap: true });

    const owner = await request(app)
      .post('/api/auth/register')
      .send({ username: 'owner', password: 'secret123' });
    expect(owner.status).toBe(200);
    // id=1 — это админ по соглашению (см. admin.js).
    expect(owner.body.user.id).toBe(1);

    const after = await request(app).get('/api/auth/registration-info');
    expect(after.body).toMatchObject({ inviteRequired: true, bootstrap: false });

    const stranger = await request(app)
      .post('/api/auth/register')
      .send({ username: 'stranger', password: 'secret123' });
    expect(stranger.status).toBe(400);
  });
});
