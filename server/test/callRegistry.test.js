import { describe, it, expect, beforeAll } from 'vitest';
import db from '../src/db.js';
import {
  registerInvite,
  markActive,
  markWaiting,
  finalize,
  getCall,
  tryRejoinable,
} from '../src/callRegistry.js';

let aliceId;
let bobId;

beforeAll(() => {
  // Создаём двух пользователей напрямую в БД (минуя auth)
  const insert = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
  aliceId = Number(insert.run(`alice_call_${Date.now()}`, 'x').lastInsertRowid);
  bobId = Number(insert.run(`bob_call_${Date.now()}`, 'x').lastInsertRowid);
});

function uniqueCallId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

describe('callRegistry', () => {
  it('registerInvite creates a pending call + system message', () => {
    const callId = uniqueCallId('a');
    const r = registerInvite({
      callId,
      callerId: aliceId,
      calleeId: bobId,
      withVideo: false,
    });
    expect(r).toBeTruthy();
    expect(r.message.kind).toBe('call');
    expect(r.message.payload.status).toBe('pending');
    const c = getCall(callId);
    expect(c.status).toBe('pending');
  });

  it('markActive transitions to active and records startedAt', () => {
    const callId = uniqueCallId('b');
    registerInvite({ callId, callerId: aliceId, calleeId: bobId, withVideo: true });
    const c = markActive(callId);
    expect(c.status).toBe('active');
    expect(c.startedAt).toBeGreaterThan(0);
  });

  it('markWaiting sets reconnectUntil in the message payload', () => {
    const callId = uniqueCallId('c');
    registerInvite({ callId, callerId: aliceId, calleeId: bobId, withVideo: false });
    markActive(callId);
    markWaiting(callId);
    const c = getCall(callId);
    expect(c.status).toBe('waiting');

    const row = db.prepare('SELECT payload FROM messages WHERE id = ?').get(c.messageId);
    const payload = JSON.parse(row.payload);
    expect(payload.status).toBe('waiting');
    expect(payload.reconnectUntil).toBeGreaterThan(Date.now());
  });

  it('tryRejoinable returns the call when status is waiting', () => {
    const callId = uniqueCallId('d');
    registerInvite({ callId, callerId: aliceId, calleeId: bobId, withVideo: false });
    markActive(callId);
    markWaiting(callId);
    expect(tryRejoinable(callId, aliceId)).toBeTruthy();
    expect(tryRejoinable(callId, bobId)).toBeTruthy();
    // Незаинтересованный пользователь — null
    expect(tryRejoinable(callId, 999999)).toBeNull();
  });

  it('finalize stores outcome and durationMs', async () => {
    const callId = uniqueCallId('e');
    registerInvite({ callId, callerId: aliceId, calleeId: bobId, withVideo: false });
    markActive(callId);
    // Подождём чуть-чуть для не-нулевой длительности
    await new Promise((r) => setTimeout(r, 30));
    finalize(callId, 'completed');
    const c = getCall(callId);
    expect(c.status).toBe('ended');
    const row = db.prepare('SELECT payload FROM messages WHERE id = ?').get(c.messageId);
    const payload = JSON.parse(row.payload);
    expect(payload.outcome).toBe('completed');
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('finalize with missed records outcome', () => {
    const callId = uniqueCallId('f');
    registerInvite({ callId, callerId: aliceId, calleeId: bobId, withVideo: false });
    finalize(callId, 'missed');
    const c = getCall(callId);
    const row = db.prepare('SELECT payload FROM messages WHERE id = ?').get(c.messageId);
    const payload = JSON.parse(row.payload);
    expect(payload.outcome).toBe('missed');
    expect(payload.startedAt).toBeNull();
  });

  it('tryRejoinable returns null for ended calls', () => {
    const callId = uniqueCallId('g');
    registerInvite({ callId, callerId: aliceId, calleeId: bobId, withVideo: false });
    finalize(callId, 'cancelled');
    expect(tryRejoinable(callId, aliceId)).toBeNull();
  });
});
