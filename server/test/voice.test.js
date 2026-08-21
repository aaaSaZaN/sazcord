import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './appFactory.js';

let app;
let aliceToken;
let bobId;

beforeAll(async () => {
  app = buildTestApp();
  const a = await request(app)
    .post('/api/auth/register')
    .send({ username: 'alice_voice', password: 'secret123' });
  aliceToken = a.body.token;
  const b = await request(app)
    .post('/api/auth/register')
    .send({ username: 'bob_voice', password: 'secret123' });
  bobId = b.body.user.id;
});

// Мини-файлы с валидными magic-байтами: содержимое не важно, sniff смотрит
// только на первые 16 байт.
function webmBlob() {
  const b = Buffer.alloc(64);
  b[0] = 0x1a;
  b[1] = 0x45;
  b[2] = 0xdf;
  b[3] = 0xa3;
  return b;
}
function oggBlob() {
  const b = Buffer.alloc(64);
  b.write('OggS', 0, 'ascii');
  return b;
}
// Safari/iOS: MediaRecorder отдаёт audio/mp4, ISO BMFF с 'ftyp' на 4..7.
function mp4Blob() {
  const b = Buffer.alloc(64);
  b.write('ftyp', 4, 'ascii');
  b.write('M4A ', 8, 'ascii');
  return b;
}

function sendVoice(buf, contentType) {
  return request(app)
    .post('/api/messages/voice')
    .set('Authorization', `Bearer ${aliceToken}`)
    .field('to', String(bobId))
    .field('durationMs', '1200')
    .attach('voice', buf, { filename: 'voice.webm', contentType });
}

describe('voice messages', () => {
  it('принимает webm/opus', async () => {
    const res = await sendVoice(webmBlob(), 'audio/webm;codecs=opus');
    expect(res.status).toBe(200);
    expect(res.body.message.kind).toBe('voice');
    expect(res.body.message.attachmentPath).toMatch(/\.webm$/);
  });

  it('принимает ogg/opus', async () => {
    const res = await sendVoice(oggBlob(), 'audio/ogg;codecs=opus');
    expect(res.status).toBe(200);
    expect(res.body.message.attachmentPath).toMatch(/\.ogg$/);
  });

  it('принимает mp4/aac из Safari и сохраняет как .m4a', async () => {
    const res = await sendVoice(mp4Blob(), 'audio/mp4');
    expect(res.status).toBe(200);
    expect(res.body.message.attachmentPath).toMatch(/\.m4a$/);
  });
});
