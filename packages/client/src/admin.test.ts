import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TLReader, TLWriter } from '@mtproto2/binary';
import { createChannel, deleteChannel, editAdmin, ADMIN_CID } from './admin.js';
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

function makeInputChannel(): Buffer {
  const w = new TLWriter(24);
  w.writeConstructorId(0xf35aec28); // inputChannel
  w.writeInt64(12345n);
  w.writeInt64(67890n);
  return w.toBuffer();
}

function makeInputUser(): Buffer {
  const w = new TLWriter(24);
  w.writeConstructorId(0xf21158c6); // inputUser
  w.writeInt64(111n);
  w.writeInt64(222n);
  return w.toBuffer();
}

describe('admin helpers', () => {
  let client: TelegramClient & { _lastInvoke: Buffer | null };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('createChannel', () => {
    it('should serialize with correct CID', async () => {
      await createChannel(client, 'Test', 'About');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(ADMIN_CID.channels_createChannel);
    });

    it('should set broadcast flag by default', async () => {
      await createChannel(client, 'Test', 'About');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 0)).not.toBe(0);
      expect(flags & (1 << 1)).toBe(0);
    });

    it('should set megagroup flag when specified', async () => {
      await createChannel(client, 'Test', 'About', true);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 0)).toBe(0);
      expect(flags & (1 << 1)).not.toBe(0);
    });

    it('should include title and about', async () => {
      await createChannel(client, 'My Group', 'A test group');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      expect(r.readString()).toBe('My Group');
      expect(r.readString()).toBe('A test group');
    });
  });

  describe('deleteChannel', () => {
    it('should serialize with correct CID', async () => {
      await deleteChannel(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(ADMIN_CID.channels_deleteChannel);
    });

    it('should include channel data', async () => {
      await deleteChannel(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readConstructorId()).toBe(0xf35aec28); // inputChannel
      expect(r.readInt64()).toBe(12345n);
      expect(r.readInt64()).toBe(67890n);
    });
  });

  describe('editAdmin', () => {
    it('should serialize with correct CID', async () => {
      await editAdmin(client, makeInputChannel(), makeInputUser(), 0);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(ADMIN_CID.channels_editAdmin);
    });

    it('should include channel, user, rights, and rank', async () => {
      const rights = (1 << 3) | (1 << 4); // arbitrary flags
      await editAdmin(client, makeInputChannel(), makeInputUser(), rights);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      // channel
      r.readConstructorId(); r.readInt64(); r.readInt64();
      // user
      r.readConstructorId(); r.readInt64(); r.readInt64();
      // chatAdminRights
      expect(r.readConstructorId()).toBe(ADMIN_CID.chatAdminRights);
      expect(r.readInt32()).toBe(rights);
      expect(r.readString()).toBe(''); // rank
    });

    it('should serialize zero rights', async () => {
      await editAdmin(client, makeInputChannel(), makeInputUser(), 0);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); r.readInt64(); r.readInt64(); // channel
      r.readConstructorId(); r.readInt64(); r.readInt64(); // user
      r.readConstructorId(); // chatAdminRights
      expect(r.readInt32()).toBe(0);
    });
  });
});
