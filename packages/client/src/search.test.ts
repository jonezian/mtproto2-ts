import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TLReader, TLWriter } from '@kerainmtp/binary';
import { searchGlobal, SEARCH_CID } from './search.js';
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

describe('search helpers', () => {
  let client: TelegramClient & { _lastInvoke: Buffer | null };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('searchGlobal', () => {
    it('should serialize with correct CID', async () => {
      await searchGlobal(client, 'hello');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(SEARCH_CID.messages_searchGlobal);
    });

    it('should include flags=0 by default', async () => {
      await searchGlobal(client, 'hello');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt32()).toBe(0);
    });

    it('should include query string', async () => {
      await searchGlobal(client, 'test query');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      expect(r.readString()).toBe('test query');
    });

    it('should include inputMessagesFilterEmpty', async () => {
      await searchGlobal(client, 'q');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readString(); // query
      expect(r.readConstructorId()).toBe(SEARCH_CID.inputMessagesFilterEmpty);
    });

    it('should use default values for optional parameters', async () => {
      await searchGlobal(client, 'q');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readString(); // query
      r.readConstructorId(); // filter
      expect(r.readInt32()).toBe(0); // min_date
      expect(r.readInt32()).toBe(0); // max_date
      expect(r.readInt32()).toBe(0); // offset_rate
      expect(r.readConstructorId()).toBe(SEARCH_CID.inputPeerEmpty);
      expect(r.readInt32()).toBe(0); // offset_id
      expect(r.readInt32()).toBe(100); // limit
    });

    it('should set broadcastsOnly flag', async () => {
      await searchGlobal(client, 'q', { broadcastsOnly: true });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 1)).not.toBe(0);
    });

    it('should set groupsOnly flag', async () => {
      await searchGlobal(client, 'q', { groupsOnly: true });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 2)).not.toBe(0);
    });

    it('should set usersOnly flag', async () => {
      await searchGlobal(client, 'q', { usersOnly: true });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 3)).not.toBe(0);
    });

    it('should include folderId when specified', async () => {
      await searchGlobal(client, 'q', { folderId: 1 });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 0)).not.toBe(0);
      expect(r.readInt32()).toBe(1); // folder_id
    });

    it('should respect custom limit and dates', async () => {
      await searchGlobal(client, 'q', {
        limit: 25,
        minDate: 1000,
        maxDate: 2000,
        offsetRate: 5,
      });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readString(); // query
      r.readConstructorId(); // filter
      expect(r.readInt32()).toBe(1000); // min_date
      expect(r.readInt32()).toBe(2000); // max_date
      expect(r.readInt32()).toBe(5); // offset_rate
      r.readConstructorId(); // inputPeerEmpty
      r.readInt32(); // offset_id
      expect(r.readInt32()).toBe(25); // limit
    });

    it('should use custom offsetPeer when provided', async () => {
      const w = new TLWriter(8);
      w.writeConstructorId(0x7f3b18ea); // inputPeerEmpty
      const peer = w.toBuffer();

      await searchGlobal(client, 'q', { offsetPeer: peer });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readString(); // query
      r.readConstructorId(); // filter
      r.readInt32(); // min_date
      r.readInt32(); // max_date
      r.readInt32(); // offset_rate
      expect(r.readConstructorId()).toBe(0x7f3b18ea);
    });
  });
});
