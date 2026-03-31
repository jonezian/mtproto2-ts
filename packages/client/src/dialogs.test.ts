import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TLReader, TLWriter } from '@kerainmtp/binary';
import { getDialogs, getPeerDialogs, DIALOGS_CID } from './dialogs.js';
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

function makeInputPeerEmpty(): Buffer {
  const w = new TLWriter(8);
  w.writeConstructorId(0x7f3b18ea); // inputPeerEmpty
  return w.toBuffer();
}

describe('dialogs helpers', () => {
  let client: TelegramClient & { _lastInvoke: Buffer | null };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('getDialogs', () => {
    it('should serialize with correct CID', async () => {
      await getDialogs(client);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(DIALOGS_CID.messages_getDialogs);
    });

    it('should use default parameters', async () => {
      await getDialogs(client);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt32()).toBe(0); // flags
      expect(r.readInt32()).toBe(0); // offset_date
      expect(r.readInt32()).toBe(0); // offset_id
      expect(r.readConstructorId()).toBe(DIALOGS_CID.inputPeerEmpty); // offset_peer
      expect(r.readInt32()).toBe(100); // limit
      expect(r.readInt64()).toBe(0n); // hash
    });

    it('should set exclude_pinned flag', async () => {
      await getDialogs(client, { excludePinned: true });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 0)).not.toBe(0);
    });

    it('should include folder_id when specified', async () => {
      await getDialogs(client, { folderId: 1 });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 1)).not.toBe(0); // folder_id flag
      expect(r.readInt32()).toBe(1); // folder_id value
    });

    it('should respect custom limit', async () => {
      await getDialogs(client, { limit: 20 });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readInt32(); // offset_date
      r.readInt32(); // offset_id
      r.readConstructorId(); // offset_peer
      expect(r.readInt32()).toBe(20);
    });

    it('should use custom offset_peer when provided', async () => {
      const peer = makeInputPeerEmpty();
      await getDialogs(client, { offsetPeer: peer });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readInt32(); // offset_date
      r.readInt32(); // offset_id
      expect(r.readConstructorId()).toBe(0x7f3b18ea); // inputPeerEmpty
    });
  });

  describe('getPeerDialogs', () => {
    it('should serialize with correct CID', async () => {
      await getPeerDialogs(client, []);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(DIALOGS_CID.messages_getPeerDialogs);
    });

    it('should serialize empty peers vector', async () => {
      await getPeerDialogs(client, []);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readConstructorId()).toBe(DIALOGS_CID.vector);
      expect(r.readInt32()).toBe(0);
    });

    it('should wrap each peer in inputDialogPeer', async () => {
      const peer = makeInputPeerEmpty();
      await getPeerDialogs(client, [peer]);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); // vector
      expect(r.readInt32()).toBe(1);
      expect(r.readConstructorId()).toBe(DIALOGS_CID.inputDialogPeer);
      expect(r.readConstructorId()).toBe(0x7f3b18ea); // inputPeerEmpty
    });

    it('should handle multiple peers', async () => {
      const peer1 = makeInputPeerEmpty();
      const peer2 = makeInputPeerEmpty();
      await getPeerDialogs(client, [peer1, peer2]);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); // vector
      expect(r.readInt32()).toBe(2);

      // First peer
      expect(r.readConstructorId()).toBe(DIALOGS_CID.inputDialogPeer);
      expect(r.readConstructorId()).toBe(0x7f3b18ea);

      // Second peer
      expect(r.readConstructorId()).toBe(DIALOGS_CID.inputDialogPeer);
      expect(r.readConstructorId()).toBe(0x7f3b18ea);
    });
  });
});
