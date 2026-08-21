import { describe, it, expect, beforeEach } from 'vitest';
import {
  joinGroupCall,
  leaveGroupCall,
  getCall,
  forceLeaveAll,
  _reset,
} from '../src/groupCallRegistry.js';

beforeEach(() => _reset());

describe('groupCallRegistry', () => {
  it('creates call on first join', () => {
    const r = joinGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    expect(r.created).toBe(true);
    expect(r.peers).toEqual([]);
    expect(getCall(1).participants.size).toBe(1);
  });

  it('returns existing peers when joining', () => {
    joinGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    const r = joinGroupCall({ groupId: 1, userId: 20, socketId: 's2' });
    expect(r.created).toBe(false);
    expect(r.peers).toEqual([10]);
  });

  it('same user can have multiple sockets (no duplicate peer)', () => {
    joinGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    const r = joinGroupCall({ groupId: 1, userId: 10, socketId: 's2' });
    expect(r.alreadyIn).toBe(true);
    expect(getCall(1).participants.get(10).size).toBe(2);
  });

  it('leaving one socket keeps user in call if other sockets remain', () => {
    joinGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    joinGroupCall({ groupId: 1, userId: 10, socketId: 's2' });
    const r = leaveGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    expect(r.userLeft).toBe(false);
    expect(r.callEnded).toBe(false);
    expect(getCall(1).participants.get(10).size).toBe(1);
  });

  it('leaving last socket of user marks user as left', () => {
    joinGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    joinGroupCall({ groupId: 1, userId: 20, socketId: 's2' });
    const r = leaveGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    expect(r.userLeft).toBe(true);
    expect(r.callEnded).toBe(false);
  });

  it('leaving last user ends call', () => {
    joinGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    const r = leaveGroupCall({ groupId: 1, userId: 10, socketId: 's1' });
    expect(r.userLeft).toBe(true);
    expect(r.callEnded).toBe(true);
    expect(getCall(1)).toBeNull();
  });

  it('forceLeaveAll cleans up across groups', () => {
    joinGroupCall({ groupId: 1, userId: 10, socketId: 'sA' });
    joinGroupCall({ groupId: 2, userId: 10, socketId: 'sA' });
    joinGroupCall({ groupId: 2, userId: 20, socketId: 'sB' });
    const removals = forceLeaveAll('sA', 10);
    expect(removals.length).toBe(2);
    expect(getCall(1)).toBeNull(); // call ended
    expect(getCall(2).participants.has(10)).toBe(false);
    expect(getCall(2).participants.has(20)).toBe(true);
  });
});
