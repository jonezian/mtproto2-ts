import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TLReader, TLWriter } from '@mtproto2/binary';
import {
  joinChannel,
  leaveChannel,
  getParticipants,
  getFullChannel,
  createChannel,
  editAdmin,
  CHANNELS_CID,
} from './channels.js';
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
  w.writeInt64(12345n); // channel_id
  w.writeInt64(67890n); // access_hash
  return w.toBuffer();
}

function makeInputUser(): Buffer {
  const w = new TLWriter(24);
  w.writeConstructorId(0xf21158c6); // inputUser
  w.writeInt64(111n);
  w.writeInt64(222n);
  return w.toBuffer();
}

describe('channels helpers', () => {
  let client: TelegramClient & { _lastInvoke: Buffer | null };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('joinChannel', () => {
    it('should serialize with correct CID', async () => {
      await joinChannel(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CHANNELS_CID.channels_joinChannel);
    });

    it('should include the channel data', async () => {
      const channelBuf = makeInputChannel();
      await joinChannel(client, channelBuf);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId(); // channels.joinChannel
      expect(r.readConstructorId()).toBe(0xf35aec28); // inputChannel
      expect(r.readInt64()).toBe(12345n);
      expect(r.readInt64()).toBe(67890n);
    });
  });

  describe('leaveChannel', () => {
    it('should serialize with correct CID', async () => {
      await leaveChannel(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CHANNELS_CID.channels_leaveChannel);
    });

    it('should include the channel data', async () => {
      await leaveChannel(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readConstructorId()).toBe(0xf35aec28);
    });
  });

  describe('getParticipants', () => {
    it('should serialize with correct CID', async () => {
      await getParticipants(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CHANNELS_CID.channels_getParticipants);
    });

    it('should include channelParticipantsRecent filter', async () => {
      await getParticipants(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      // Skip channel
      r.readConstructorId(); r.readInt64(); r.readInt64();
      expect(r.readConstructorId()).toBe(CHANNELS_CID.channelParticipantsRecent);
    });

    it('should use default offset, limit, hash', async () => {
      await getParticipants(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); r.readInt64(); r.readInt64(); // channel
      r.readConstructorId(); // filter
      expect(r.readInt32()).toBe(0); // offset
      expect(r.readInt32()).toBe(200); // limit
      expect(r.readInt64()).toBe(0n); // hash
    });

    it('should respect custom options', async () => {
      await getParticipants(client, makeInputChannel(), {
        offset: 10,
        limit: 50,
        hash: 99n,
      });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); r.readInt64(); r.readInt64(); // channel
      r.readConstructorId(); // filter
      expect(r.readInt32()).toBe(10);
      expect(r.readInt32()).toBe(50);
      expect(r.readInt64()).toBe(99n);
    });
  });

  describe('getFullChannel', () => {
    it('should serialize with correct CID', async () => {
      await getFullChannel(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CHANNELS_CID.channels_getFullChannel);
    });

    it('should include channel data', async () => {
      await getFullChannel(client, makeInputChannel());

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readConstructorId()).toBe(0xf35aec28);
      expect(r.readInt64()).toBe(12345n);
    });
  });

  describe('createChannel', () => {
    it('should serialize with correct CID', async () => {
      await createChannel(client, 'Test', 'About');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CHANNELS_CID.channels_createChannel);
    });

    it('should set broadcast flag by default', async () => {
      await createChannel(client, 'Test', 'About');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 0)).not.toBe(0); // broadcast
      expect(flags & (1 << 1)).toBe(0); // not megagroup
    });

    it('should set megagroup flag when specified', async () => {
      await createChannel(client, 'Test', 'About', true);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 0)).toBe(0); // not broadcast
      expect(flags & (1 << 1)).not.toBe(0); // megagroup
    });

    it('should include title and about', async () => {
      await createChannel(client, 'My Channel', 'Description here');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      expect(r.readString()).toBe('My Channel');
      expect(r.readString()).toBe('Description here');
    });
  });

  describe('editAdmin', () => {
    it('should serialize with correct CID', async () => {
      await editAdmin(client, makeInputChannel(), makeInputUser(), 0);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CHANNELS_CID.channels_editAdmin);
    });

    it('should include channel, user, and admin rights', async () => {
      const rights = (1 << 0) | (1 << 2); // change_info + ban_users
      await editAdmin(client, makeInputChannel(), makeInputUser(), rights);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      // channel
      expect(r.readConstructorId()).toBe(0xf35aec28);
      r.readInt64(); r.readInt64();
      // user
      expect(r.readConstructorId()).toBe(0xf21158c6);
      r.readInt64(); r.readInt64();
      // chatAdminRights
      expect(r.readConstructorId()).toBe(CHANNELS_CID.chatAdminRights);
      expect(r.readInt32()).toBe(rights);
      // rank
      expect(r.readString()).toBe('');
    });
  });
});
