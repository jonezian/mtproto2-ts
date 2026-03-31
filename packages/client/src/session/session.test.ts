import { describe, it, expect } from 'vitest';
import { MemorySession } from './memory.js';
import { StringSession } from './string.js';
import type { SessionData } from './abstract.js';

function makeSessionData(overrides?: Partial<SessionData>): SessionData {
  return {
    dcId: 2,
    authKey: Buffer.alloc(256, 0xAB),
    port: 443,
    serverAddress: '149.154.167.51',
    ...overrides,
  };
}

describe('MemorySession', () => {
  it('should return null when no data is stored', async () => {
    const session = new MemorySession();
    const data = await session.load();
    expect(data).toBeNull();
  });

  it('should save and load session data', async () => {
    const session = new MemorySession();
    const input = makeSessionData();
    await session.save(input);

    const loaded = await session.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.dcId).toBe(2);
    expect(loaded!.port).toBe(443);
    expect(loaded!.serverAddress).toBe('149.154.167.51');
    expect(loaded!.authKey).toEqual(input.authKey);
  });

  it('should return a defensive copy of authKey on load', async () => {
    const session = new MemorySession();
    await session.save(makeSessionData());

    const loaded1 = await session.load();
    const loaded2 = await session.load();

    // Mutating the loaded buffer should not affect the stored data
    loaded1!.authKey[0] = 0xFF;
    expect(loaded2!.authKey[0]).toBe(0xAB);
  });

  it('should store a defensive copy of authKey on save', async () => {
    const session = new MemorySession();
    const data = makeSessionData();
    await session.save(data);

    // Mutate the original buffer
    data.authKey[0] = 0xFF;

    const loaded = await session.load();
    expect(loaded!.authKey[0]).toBe(0xAB);
  });

  it('should delete stored data', async () => {
    const session = new MemorySession();
    await session.save(makeSessionData());
    await session.delete();
    const data = await session.load();
    expect(data).toBeNull();
  });

  it('should overwrite previous data on save', async () => {
    const session = new MemorySession();
    await session.save(makeSessionData({ dcId: 1, port: 80 }));
    await session.save(makeSessionData({ dcId: 3, port: 8443 }));

    const loaded = await session.load();
    expect(loaded!.dcId).toBe(3);
    expect(loaded!.port).toBe(8443);
  });

  it('should handle multiple delete calls gracefully', async () => {
    const session = new MemorySession();
    await session.save(makeSessionData());
    await session.delete();
    await session.delete(); // should not throw
    const data = await session.load();
    expect(data).toBeNull();
  });
});

describe('StringSession', () => {
  it('should return null for empty session string', async () => {
    const session = new StringSession('');
    const data = await session.load();
    expect(data).toBeNull();
  });

  it('should return null for default constructor', async () => {
    const session = new StringSession();
    const data = await session.load();
    expect(data).toBeNull();
  });

  it('should save and load session data round-trip', async () => {
    const session = new StringSession();
    const input = makeSessionData();
    await session.save(input);

    const loaded = await session.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.dcId).toBe(input.dcId);
    expect(loaded!.port).toBe(input.port);
    expect(loaded!.serverAddress).toBe(input.serverAddress);
    expect(loaded!.authKey).toEqual(input.authKey);
    expect(loaded!.authKey.length).toBe(256);
  });

  it('should produce a non-empty session string after save', async () => {
    const session = new StringSession();
    await session.save(makeSessionData());
    const str = session.getSessionString();
    expect(str.length).toBeGreaterThan(0);
  });

  it('should restore from a previously saved session string', async () => {
    const session1 = new StringSession();
    const input = makeSessionData({ dcId: 4, port: 8443, serverAddress: '10.0.0.1' });
    await session1.save(input);
    const sessionStr = session1.getSessionString();

    const session2 = new StringSession(sessionStr);
    const loaded = await session2.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.dcId).toBe(4);
    expect(loaded!.port).toBe(8443);
    expect(loaded!.serverAddress).toBe('10.0.0.1');
    expect(loaded!.authKey).toEqual(input.authKey);
  });

  it('should handle different DC IDs', async () => {
    for (const dcId of [1, 2, 3, 4, 5]) {
      const session = new StringSession();
      await session.save(makeSessionData({ dcId }));
      const loaded = await session.load();
      expect(loaded!.dcId).toBe(dcId);
    }
  });

  it('should handle different server addresses', async () => {
    const session = new StringSession();
    const longAddr = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    await session.save(makeSessionData({ serverAddress: longAddr }));
    const loaded = await session.load();
    expect(loaded!.serverAddress).toBe(longAddr);
  });

  it('should handle empty server address', async () => {
    const session = new StringSession();
    await session.save(makeSessionData({ serverAddress: '' }));
    const loaded = await session.load();
    expect(loaded!.serverAddress).toBe('');
  });

  it('should delete the session string', async () => {
    const session = new StringSession();
    await session.save(makeSessionData());
    expect(session.getSessionString()).not.toBe('');

    await session.delete();
    expect(session.getSessionString()).toBe('');
    const loaded = await session.load();
    expect(loaded).toBeNull();
  });

  it('should throw for invalid session string (too short)', async () => {
    const session = new StringSession(Buffer.alloc(10).toString('base64'));
    await expect(session.load()).rejects.toThrow('Invalid session string');
  });

  it('should throw for unsupported version', async () => {
    // Create a valid-length buffer with wrong version byte
    const buf = Buffer.alloc(262);
    buf[0] = 99; // bad version
    const session = new StringSession(buf.toString('base64'));
    await expect(session.load()).rejects.toThrow('Unsupported session string version');
  });

  it('should use version byte 1', async () => {
    const session = new StringSession();
    await session.save(makeSessionData());
    const str = session.getSessionString();
    const decoded = Buffer.from(str, 'base64');
    expect(decoded[0]).toBe(1);
  });

  it('should preserve the exact auth key bytes', async () => {
    const authKey = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) {
      authKey[i] = i;
    }
    const session = new StringSession();
    await session.save(makeSessionData({ authKey }));
    const loaded = await session.load();
    expect(loaded!.authKey).toEqual(authKey);
  });
});
