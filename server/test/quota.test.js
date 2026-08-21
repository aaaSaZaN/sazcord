import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';
import { usedBytes, usedBytesByUser } from '../src/quota.js';

let app;
let alice;
let bob;

beforeAll(async () => {
  app = buildTestApp();
  alice = await register('quota_alice');
  bob = await register('quota_bob');
});

afterEach(() => {
  delete process.env.UPLOADS_MAX_TOTAL_MB;
  delete process.env.UPLOADS_MAX_PER_USER_MB;
  delete process.env.UPLOADS_MIN_FREE_DISK_MB;
  delete process.env.UPLOADS_OVER_QUOTA;
});

async function register(username, password = 'secret123') {
  const r = await request(app).post('/api/auth/register').send({ username, password });
  expect(r.status).toBe(200);
  return { token: r.body.token, user: r.body.user };
}

// Заливает файл заданного размера от `from` к `to`.
function upload(from, to, bytes, name = 'blob.bin') {
  return request(app)
    .post('/api/messages/file')
    .set('Authorization', `Bearer ${from.token}`)
    .field('to', String(to.user.id))
    .attach('files', Buffer.alloc(bytes, 1), name);
}

const MB = 1024 * 1024;

describe('upload quotas', () => {
  it('allows uploads when no quota is configured', async () => {
    // Дефолт остаётся прежним поведением: потолка по объёму нет.
    const r = await upload(alice, bob, 64 * 1024);
    expect(r.status).toBe(200);
  });

  it('counts what has been stored', async () => {
    const before = usedBytes();
    const r = await upload(alice, bob, 100 * 1024);
    expect(r.status).toBe(200);
    expect(usedBytes()).toBe(before + 100 * 1024);
    expect(usedBytesByUser(alice.user.id)).toBeGreaterThanOrEqual(100 * 1024);
  });

  it('rejects an upload that would exceed the per-user quota', async () => {
    process.env.UPLOADS_MAX_PER_USER_MB = '1';
    const r = await upload(alice, bob, 2 * MB);
    expect(r.status).toBe(507);
    expect(r.body.error).toMatch(/личная квота/i);
  });

  it('leaves other users alone when one hits the personal quota', async () => {
    // Персональная квота Алисы уже выбрана предыдущими загрузками.
    process.env.UPLOADS_MAX_PER_USER_MB = '1';
    expect((await upload(alice, bob, 2 * MB)).status).toBe(507);
    // Боб ещё ничего не заливал — его лимит не тронут.
    const r = await upload(bob, alice, 64 * 1024);
    expect(r.status).toBe(200);
  });

  it('rejects an upload that would exceed the total quota', async () => {
    process.env.UPLOADS_MAX_TOTAL_MB = '1';
    const r = await upload(bob, alice, 4 * MB);
    expect(r.status).toBe(507);
    expect(r.body.error).toMatch(/хранилище/i);
  });

  it('refuses to write when free disk would drop below the floor', async () => {
    // Порог заведомо больше любого реального диска — проверяем, что
    // страховка срабатывает раньше всех остальных правил.
    process.env.UPLOADS_MIN_FREE_DISK_MB = String(1024 * 1024 * 1024);
    const r = await upload(alice, bob, 1024);
    expect(r.status).toBe(507);
    expect(r.body.error).toMatch(/место/i);
  });

  it('does not leave orphaned files behind when it rejects', async () => {
    // Отказ после записи обязан подчистить за собой: файл без строки в
    // messages не увидит ни ретеншн, ни подсчёт квоты — он остался бы
    // на диске навсегда.
    process.env.UPLOADS_MAX_PER_USER_MB = '1';
    const before = usedBytes();
    expect((await upload(alice, bob, 3 * MB)).status).toBe(507);
    expect(usedBytes()).toBe(before);
  });
});
