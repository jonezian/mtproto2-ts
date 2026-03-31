import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TLReader, TLWriter } from '@kerainmtp/binary';
import {
  sendMessage,
  getMessages,
  getHistory,
  deleteMessages,
  editMessage,
  searchMessages,
  MESSAGES_CID,
} from './messages.js';
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

function makeInputPeer(): Buffer {
  const w = new TLWriter(16);
  w.writeConstructorId(0x7f3b18ea); // inputPeerEmpty
  return w.toBuffer();
}

describe('messages helpers', () => {
  let client: TelegramClient & { _lastInvoke: Buffer | null };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('sendMessage', () => {
    it('should serialize with correct CID', async () => {
      await sendMessage(client, makeInputPeer(), 'hello');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(MESSAGES_CID.messages_sendMessage);
    });

    it('should include flags (0 by default)', async () => {
      await sendMessage(client, makeInputPeer(), 'hello');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt32()).toBe(0); // flags
    });

    it('should set no_webpage flag', async () => {
      await sendMessage(client, makeInputPeer(), 'hello', { noWebpage: true });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 1)).not.toBe(0);
    });

    it('should set silent flag', async () => {
      await sendMessage(client, makeInputPeer(), 'hello', { silent: true });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 5)).not.toBe(0);
    });

    it('should include the message text', async () => {
      await sendMessage(client, makeInputPeer(), 'hello world');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readConstructorId(); // inputPeerEmpty
      expect(r.readString()).toBe('hello world');
    });

    it('should include random_id as int64', async () => {
      await sendMessage(client, makeInputPeer(), 'test', { randomId: 42n });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readConstructorId(); // inputPeerEmpty
      r.readString(); // message
      expect(r.readInt64()).toBe(42n);
    });
  });

  describe('getMessages', () => {
    it('should serialize with correct CID', async () => {
      await getMessages(client, [1, 2, 3]);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(MESSAGES_CID.messages_getMessages);
    });

    it('should include vector of inputMessageID', async () => {
      await getMessages(client, [10, 20, 30]);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId(); // CID
      expect(r.readConstructorId()).toBe(MESSAGES_CID.vector); // vector CID
      expect(r.readInt32()).toBe(3); // count

      // Each element: inputMessageID CID + id
      expect(r.readConstructorId()).toBe(MESSAGES_CID.inputMessageID);
      expect(r.readInt32()).toBe(10);

      expect(r.readConstructorId()).toBe(MESSAGES_CID.inputMessageID);
      expect(r.readInt32()).toBe(20);

      expect(r.readConstructorId()).toBe(MESSAGES_CID.inputMessageID);
      expect(r.readInt32()).toBe(30);
    });

    it('should handle empty IDs array', async () => {
      await getMessages(client, []);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); // vector
      expect(r.readInt32()).toBe(0); // empty vector
    });
  });

  describe('getHistory', () => {
    it('should serialize with correct CID', async () => {
      await getHistory(client, makeInputPeer());

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(MESSAGES_CID.messages_getHistory);
    });

    it('should use defaults for optional parameters', async () => {
      await getHistory(client, makeInputPeer());

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); // inputPeerEmpty
      expect(r.readInt32()).toBe(0); // offset_id
      expect(r.readInt32()).toBe(0); // offset_date
      expect(r.readInt32()).toBe(0); // add_offset
      expect(r.readInt32()).toBe(100); // limit (default)
      expect(r.readInt32()).toBe(0); // max_id
      expect(r.readInt32()).toBe(0); // min_id
      expect(r.readInt64()).toBe(0n); // hash
    });

    it('should respect custom options', async () => {
      await getHistory(client, makeInputPeer(), {
        offsetId: 50,
        offsetDate: 1000,
        addOffset: -10,
        limit: 20,
        maxId: 100,
        minId: 5,
        hash: 99n,
      });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); // inputPeerEmpty
      expect(r.readInt32()).toBe(50);
      expect(r.readInt32()).toBe(1000);
      expect(r.readInt32()).toBe(-10);
      expect(r.readInt32()).toBe(20);
      expect(r.readInt32()).toBe(100);
      expect(r.readInt32()).toBe(5);
      expect(r.readInt64()).toBe(99n);
    });
  });

  describe('deleteMessages', () => {
    it('should serialize with correct CID', async () => {
      await deleteMessages(client, [1, 2]);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(MESSAGES_CID.messages_deleteMessages);
    });

    it('should set revoke flag when true', async () => {
      await deleteMessages(client, [1], true);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt32()).toBe(0x1); // flags with revoke
    });

    it('should not set revoke flag when false', async () => {
      await deleteMessages(client, [1], false);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt32()).toBe(0);
    });

    it('should include vector of message IDs', async () => {
      await deleteMessages(client, [10, 20, 30]);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readConstructorId(); // vector CID
      expect(r.readInt32()).toBe(3);
      expect(r.readInt32()).toBe(10);
      expect(r.readInt32()).toBe(20);
      expect(r.readInt32()).toBe(30);
    });
  });

  describe('editMessage', () => {
    it('should serialize with correct CID', async () => {
      await editMessage(client, makeInputPeer(), 42, 'edited text');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(MESSAGES_CID.messages_editMessage);
    });

    it('should set message flag (bit 11)', async () => {
      await editMessage(client, makeInputPeer(), 42, 'edited');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      const flags = r.readInt32();
      expect(flags & (1 << 11)).not.toBe(0);
    });

    it('should include peer, id, and message text', async () => {
      await editMessage(client, makeInputPeer(), 42, 'new text');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readConstructorId(); // inputPeerEmpty
      expect(r.readInt32()).toBe(42); // msg_id
      expect(r.readString()).toBe('new text');
    });
  });

  describe('searchMessages', () => {
    it('should serialize with correct CID', async () => {
      await searchMessages(client, makeInputPeer(), 'query');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(MESSAGES_CID.messages_search);
    });

    it('should include query string', async () => {
      await searchMessages(client, makeInputPeer(), 'test query');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readConstructorId(); // inputPeerEmpty
      expect(r.readString()).toBe('test query');
    });

    it('should include inputMessagesFilterEmpty', async () => {
      await searchMessages(client, makeInputPeer(), 'q');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readConstructorId(); // inputPeerEmpty
      r.readString(); // query
      expect(r.readConstructorId()).toBe(MESSAGES_CID.inputMessagesFilterEmpty);
    });

    it('should use defaults for optional parameters', async () => {
      await searchMessages(client, makeInputPeer(), 'q');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readConstructorId(); // inputPeerEmpty
      r.readString(); // query
      r.readConstructorId(); // filter
      expect(r.readInt32()).toBe(0); // min_date
      expect(r.readInt32()).toBe(0); // max_date
      expect(r.readInt32()).toBe(0); // offset_id
      expect(r.readInt32()).toBe(0); // add_offset
      expect(r.readInt32()).toBe(100); // limit
      expect(r.readInt32()).toBe(0); // max_id
      expect(r.readInt32()).toBe(0); // min_id
      expect(r.readInt64()).toBe(0n); // hash
    });

    it('should respect custom search options', async () => {
      await searchMessages(client, makeInputPeer(), 'q', {
        limit: 10,
        minDate: 1000,
        maxDate: 2000,
      });

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readConstructorId(); // inputPeerEmpty
      r.readString(); // query
      r.readConstructorId(); // filter
      expect(r.readInt32()).toBe(1000); // min_date
      expect(r.readInt32()).toBe(2000); // max_date
      r.readInt32(); // offset_id
      r.readInt32(); // add_offset
      expect(r.readInt32()).toBe(10); // limit
    });
  });
});
