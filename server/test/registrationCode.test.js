import { describe, it, expect, afterEach, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';

let app;

beforeAll(() => {
  app = buildTestApp();
});

afterEach(() => {
  delete process.env.REGISTRATION_CODE;
  delete process.env.REGISTRATION_DISABLED;
});

describe('registration gating', () => {
  it('exposes registration-info reflecting env vars', async () => {
    let res = await request(app).get('/api/auth/registration-info');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ disabled: false, inviteRequired: false });

    process.env.REGISTRATION_CODE = 'letmein';
    res = await request(app).get('/api/auth/registration-info');
    expect(res.body).toMatchObject({ disabled: false, inviteRequired: true });

    process.env.REGISTRATION_DISABLED = '1';
    res = await request(app).get('/api/auth/registration-info');
    expect(res.body.disabled).toBe(true);
  });

  it('rejects registration when REGISTRATION_DISABLED=1', async () => {
    process.env.REGISTRATION_DISABLED = '1';
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'reg_off_user', password: 'secret123' });
    expect(res.status).toBe(403);
  });

  it('requires invite when REGISTRATION_CODE is set', async () => {
    process.env.REGISTRATION_CODE = 'sesame';
    const a = await request(app)
      .post('/api/auth/register')
      .send({ username: 'inv_user_a', password: 'secret123' });
    expect(a.status).toBe(400);

    const b = await request(app)
      .post('/api/auth/register')
      .send({ username: 'inv_user_b', password: 'secret123', invite: 'wrong' });
    expect(b.status).toBe(403);

    const c = await request(app)
      .post('/api/auth/register')
      .send({ username: 'inv_user_c', password: 'secret123', invite: 'sesame' });
    expect(c.status).toBe(200);
    expect(c.body.token).toBeTruthy();
  });
});

describe('registration is closed by default', () => {
  // Проверяем главное свойство: инстанс, поднятый без единой настройки,
  // не открыт всему интернету. Тестовый setup.js выставляет
  // REGISTRATION_OPEN=1 ради остальных тестов — здесь снимаем.
  const OPEN = process.env.REGISTRATION_OPEN;
  beforeEach(() => {
    delete process.env.REGISTRATION_OPEN;
  });
  afterEach(() => {
    if (OPEN !== undefined) process.env.REGISTRATION_OPEN = OPEN;
  });

  it('requires an invite once the server has users', async () => {
    // База в этом файле уже не пустая (см. тесты выше), так что владелец
    // «занят» и свободная регистрация должна быть закрыта.
    const info = await request(app).get('/api/auth/registration-info');
    expect(info.body).toMatchObject({ disabled: false, inviteRequired: true, bootstrap: false });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'closed_by_default', password: 'secret123' });
    expect(res.status).toBe(400);
  });

  it('REGISTRATION_OPEN=1 opens it back up', async () => {
    process.env.REGISTRATION_OPEN = '1';
    const res = await request(app)
      .post('/api/auth/register')
      .send({ username: 'explicitly_open', password: 'secret123' });
    expect(res.status).toBe(200);
  });
});
