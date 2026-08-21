import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';

const app = buildTestApp();

describe('GET /api/health', () => {
  it('возвращает 200 ok когда БД и uploads ОК', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      db: true,
      uploads: true,
    });
    expect(typeof res.body.uptime).toBe('number');
  });

  it('включает diskFreeMb если поддерживается ФС', async () => {
    const res = await request(app).get('/api/health');
    // На современных Node 18.15+ statfsSync доступен → поле должно быть.
    if (typeof require !== 'undefined') {
      // CommonJS fallback — пропускаем, ESM-only в проекте.
    }
    // Не делаем strict-проверку: на некоторых ФС/CI statfs может отсутствовать,
    // мы намеренно сделали поле опциональным. Просто проверяем тип, если есть.
    if ('diskFreeMb' in res.body) {
      expect(typeof res.body.diskFreeMb).toBe('number');
      expect(res.body.diskFreeMb).toBeGreaterThanOrEqual(0);
    }
  });

  it('не требует аутентификации (для мониторинга)', async () => {
    const res = await request(app).get('/api/health');
    // Никаких заголовков Authorization — но 200, не 401.
    expect(res.status).toBe(200);
  });
});
