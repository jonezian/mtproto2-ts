import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { Session } from './session.js';

function makeAuthKey(): { authKey: Buffer; authKeyId: Buffer } {
  const authKey = crypto.randomBytes(256);
  const authKeyId = crypto.createHash('sha1').update(authKey).digest().subarray(12, 20);
  return { authKey, authKeyId };
}

describe('Session', () => {
  it('should create a session with the given auth key and salt', () => {
    const { authKey, authKeyId } = makeAuthKey();
    const salt = 12345n;
    const timeOffset = 10;

    const session = new Session(authKey, authKeyId, salt, timeOffset);

    expect(session.state.authKey).toEqual(authKey);
    expect(session.state.authKeyId).toEqual(authKeyId);
    expect(session.state.salt).toBe(salt);
    expect(session.state.timeOffset).toBe(timeOffset);
    // Session ID should be a bigint (random 64-bit)
    expect(typeof session.state.sessionId).toBe('bigint');
  });

  it('should generate unique session IDs', () => {
    const { authKey, authKeyId } = makeAuthKey();
    const session1 = new Session(authKey, authKeyId, 0n, 0);
    const session2 = new Session(authKey, authKeyId, 0n, 0);

    // Extremely unlikely to collide with random 64-bit IDs
    expect(session1.state.sessionId).not.toBe(session2.state.sessionId);
  });

  it('should generate monotonically increasing msg_ids', () => {
    const { authKey, authKeyId } = makeAuthKey();
    const session = new Session(authKey, authKeyId, 0n, 0);

    const id1 = session.nextMsgId();
    const id2 = session.nextMsgId();
    const id3 = session.nextMsgId();

    expect(id2).toBeGreaterThan(id1);
    expect(id3).toBeGreaterThan(id2);
  });

  it('should generate msg_ids divisible by 4', () => {
    const { authKey, authKeyId } = makeAuthKey();
    const session = new Session(authKey, authKeyId, 0n, 0);

    for (let i = 0; i < 10; i++) {
      const id = session.nextMsgId();
      expect(id % 4n).toBe(0n);
    }
  });

  it('should generate correct seq_no for content-related and non-content-related messages', () => {
    const { authKey, authKeyId } = makeAuthKey();
    const session = new Session(authKey, authKeyId, 0n, 0);

    // First content-related: 0*2 + 1 = 1, then increment
    expect(session.nextSeqNo(true)).toBe(1);

    // Second non-content-related: 1*2 + 0 = 2
    expect(session.nextSeqNo(false)).toBe(2);

    // Third content-related: 1*2 + 1 = 3, then increment
    expect(session.nextSeqNo(true)).toBe(3);

    // Fourth content-related: 2*2 + 1 = 5, then increment
    expect(session.nextSeqNo(true)).toBe(5);
  });

  it('should reset session_id and seq_no on reset()', () => {
    const { authKey, authKeyId } = makeAuthKey();
    const session = new Session(authKey, authKeyId, 0n, 0);

    const originalSessionId = session.state.sessionId;

    // Generate some seq_nos
    session.nextSeqNo(true);
    session.nextSeqNo(true);

    session.reset();

    // Session ID should change
    expect(session.state.sessionId).not.toBe(originalSessionId);

    // Seq_no should be reset (first content-related = 1)
    expect(session.nextSeqNo(true)).toBe(1);
  });

  it('should update salt', () => {
    const { authKey, authKeyId } = makeAuthKey();
    const session = new Session(authKey, authKeyId, 100n, 0);

    expect(session.state.salt).toBe(100n);

    session.updateSalt(999n);
    expect(session.state.salt).toBe(999n);
  });

  it('should update time offset', () => {
    const { authKey, authKeyId } = makeAuthKey();
    const session = new Session(authKey, authKeyId, 0n, 0);

    session.updateTimeOffset(42);
    expect(session.state.timeOffset).toBe(42);
  });

  describe('serialization', () => {
    it('should serialize and deserialize correctly', () => {
      const { authKey, authKeyId } = makeAuthKey();
      const salt = 0x1234567890abcdefn;
      const timeOffset = -300;

      const session = new Session(authKey, authKeyId, salt, timeOffset);
      const serialized = session.serialize();

      expect(serialized.length).toBe(284);

      const restored = Session.deserialize(serialized);

      expect(restored.state.authKey).toEqual(authKey);
      expect(restored.state.authKeyId).toEqual(authKeyId);
      expect(restored.state.salt).toBe(salt);
      expect(restored.state.sessionId).toBe(session.state.sessionId);
      expect(restored.state.timeOffset).toBe(timeOffset);
    });

    it('should preserve session_id across serialization', () => {
      const { authKey, authKeyId } = makeAuthKey();
      const session = new Session(authKey, authKeyId, 0n, 0);

      const serialized = session.serialize();
      const restored = Session.deserialize(serialized);

      expect(restored.state.sessionId).toBe(session.state.sessionId);
    });

    it('should reset seq_no tracker on deserialization', () => {
      const { authKey, authKeyId } = makeAuthKey();
      const session = new Session(authKey, authKeyId, 0n, 0);

      // Advance seq_no
      session.nextSeqNo(true);
      session.nextSeqNo(true);

      const serialized = session.serialize();
      const restored = Session.deserialize(serialized);

      // Should be fresh (first content-related = 1)
      expect(restored.nextSeqNo(true)).toBe(1);
    });

    it('should throw on short data', () => {
      expect(() => Session.deserialize(Buffer.alloc(100))).toThrow('Session data too short');
    });

    it('should handle negative salt values', () => {
      const { authKey, authKeyId } = makeAuthKey();
      const session = new Session(authKey, authKeyId, -1n, 0);

      const serialized = session.serialize();
      const restored = Session.deserialize(serialized);

      expect(restored.state.salt).toBe(-1n);
    });

    it('should handle negative time offset', () => {
      const { authKey, authKeyId } = makeAuthKey();
      const session = new Session(authKey, authKeyId, 0n, -7200);

      const serialized = session.serialize();
      const restored = Session.deserialize(serialized);

      expect(restored.state.timeOffset).toBe(-7200);
    });
  });
});
