import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TLReader } from '@mtproto2/binary';
import {
  importContacts,
  resolveUsername,
  search,
  getContacts,
  CONTACTS_CID,
} from './contacts.js';
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

describe('contacts helpers', () => {
  let client: TelegramClient & { _lastInvoke: Buffer | null };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('importContacts', () => {
    it('should serialize with correct CID', async () => {
      await importContacts(client, []);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CONTACTS_CID.contacts_importContacts);
    });

    it('should serialize empty contacts vector', async () => {
      await importContacts(client, []);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readConstructorId()).toBe(CONTACTS_CID.vector);
      expect(r.readInt32()).toBe(0);
    });

    it('should serialize contacts with inputPhoneContact', async () => {
      await importContacts(client, [
        { clientId: 1n, phone: '+123', firstName: 'John', lastName: 'Doe' },
      ]);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId(); // contacts.importContacts
      r.readConstructorId(); // vector
      expect(r.readInt32()).toBe(1); // count

      expect(r.readConstructorId()).toBe(CONTACTS_CID.inputPhoneContact);
      expect(r.readInt64()).toBe(1n); // client_id
      expect(r.readString()).toBe('+123'); // phone
      expect(r.readString()).toBe('John'); // first_name
      expect(r.readString()).toBe('Doe'); // last_name
    });

    it('should serialize multiple contacts', async () => {
      await importContacts(client, [
        { clientId: 1n, phone: '+111', firstName: 'Alice', lastName: '' },
        { clientId: 2n, phone: '+222', firstName: 'Bob', lastName: 'B' },
      ]);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readConstructorId(); // vector
      expect(r.readInt32()).toBe(2);

      // First contact
      r.readConstructorId(); // inputPhoneContact
      expect(r.readInt64()).toBe(1n);
      expect(r.readString()).toBe('+111');
      r.readString(); // first_name
      r.readString(); // last_name

      // Second contact
      r.readConstructorId(); // inputPhoneContact
      expect(r.readInt64()).toBe(2n);
      expect(r.readString()).toBe('+222');
    });
  });

  describe('resolveUsername', () => {
    it('should serialize with correct CID', async () => {
      await resolveUsername(client, 'durov');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CONTACTS_CID.contacts_resolveUsername);
    });

    it('should include flags=0 and username', async () => {
      await resolveUsername(client, 'testuser');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt32()).toBe(0); // flags
      expect(r.readString()).toBe('testuser');
    });
  });

  describe('search', () => {
    it('should serialize with correct CID', async () => {
      await search(client, 'query');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CONTACTS_CID.contacts_search);
    });

    it('should include query and default limit', async () => {
      await search(client, 'test query');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readString()).toBe('test query');
      expect(r.readInt32()).toBe(50); // default limit
    });

    it('should respect custom limit', async () => {
      await search(client, 'q', 10);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readString();
      expect(r.readInt32()).toBe(10);
    });
  });

  describe('getContacts', () => {
    it('should serialize with correct CID', async () => {
      await getContacts(client);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(CONTACTS_CID.contacts_getContacts);
    });

    it('should use 0 as default hash', async () => {
      await getContacts(client);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt64()).toBe(0n);
    });

    it('should use provided hash', async () => {
      await getContacts(client, 42n);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt64()).toBe(42n);
    });
  });
});
