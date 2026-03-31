import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TLReader, TLWriter } from '@mtproto2/binary';
import { getUsers, getFullUser, USERS_CID } from './users.js';
import { TelegramClient } from './client.js';
import { MemorySession } from './session/memory.js';

function createMockClient(): TelegramClient & { _lastInvoke: Buffer | null } {
  const client = new TelegramClient({
    apiId: 1,
    apiHash: 'x',
    session: new MemorySession(),
  });

  const mock = client as TelegramClient & { _lastInvoke: Buffer | null };
  mock._lastInvoke = null;

  // @ts-expect-error accessing private
  client._connected = true;

  client.invoke = vi.fn(async (method: Buffer) => {
    mock._lastInvoke = method;
    return Buffer.alloc(4);
  });

  return mock;
}

function makeInputUser(id: bigint, accessHash: bigint): Buffer {
  const w = new TLWriter(24);
  w.writeConstructorId(0xf21158c6); // inputUser
  w.writeInt64(id);
  w.writeInt64(accessHash);
  return w.toBuffer();
}

describe('users helpers', () => {
  let client: TelegramClient & { _lastInvoke: Buffer | null };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('getUsers', () => {
    it('should serialize with correct CID', async () => {
      await getUsers(client, []);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(USERS_CID.users_getUsers);
    });

    it('should serialize empty vector', async () => {
      await getUsers(client, []);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readConstructorId()).toBe(USERS_CID.vector);
      expect(r.readInt32()).toBe(0);
    });

    it('should serialize multiple InputUser entries', async () => {
      const user1 = makeInputUser(1n, 100n);
      const user2 = makeInputUser(2n, 200n);

      await getUsers(client, [user1, user2]);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); // vector
      expect(r.readInt32()).toBe(2);

      expect(r.readConstructorId()).toBe(0xf21158c6);
      expect(r.readInt64()).toBe(1n);
      expect(r.readInt64()).toBe(100n);

      expect(r.readConstructorId()).toBe(0xf21158c6);
      expect(r.readInt64()).toBe(2n);
      expect(r.readInt64()).toBe(200n);
    });
  });

  describe('getFullUser', () => {
    it('should serialize with correct CID', async () => {
      await getFullUser(client, makeInputUser(1n, 100n));

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(USERS_CID.users_getFullUser);
    });

    it('should include the InputUser data', async () => {
      await getFullUser(client, makeInputUser(42n, 999n));

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readConstructorId()).toBe(0xf21158c6);
      expect(r.readInt64()).toBe(42n);
      expect(r.readInt64()).toBe(999n);
    });
  });
});
