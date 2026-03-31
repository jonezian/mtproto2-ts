import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TLReader } from '@mtproto2/binary';
import { sendCode, signIn, signUp, logOut, checkPassword, AUTH_CID } from './auth.js';
import { TelegramClient } from './client.js';
import { MemorySession } from './session/memory.js';

function createMockClient(): TelegramClient & { _lastInvoke: Buffer | null } {
  const client = new TelegramClient({
    apiId: 12345,
    apiHash: 'test_hash',
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

describe('auth helpers', () => {
  let client: TelegramClient & { _lastInvoke: Buffer | null };

  beforeEach(() => {
    client = createMockClient();
  });

  describe('sendCode', () => {
    it('should serialize auth.sendCode with correct CID', async () => {
      await sendCode(client, '+1234567890');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(AUTH_CID.auth_sendCode);
    });

    it('should include phone_number', async () => {
      await sendCode(client, '+1234567890');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId(); // CID
      expect(r.readString()).toBe('+1234567890');
    });

    it('should include api_id as int32', async () => {
      await sendCode(client, '+1234567890');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readString(); // phone_number
      expect(r.readInt32()).toBe(12345); // api_id from mock client
    });

    it('should include api_hash', async () => {
      await sendCode(client, '+1234567890');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readString(); // phone_number
      r.readInt32(); // api_id
      expect(r.readString()).toBe('test_hash');
    });

    it('should include codeSettings constructor', async () => {
      await sendCode(client, '+1234567890');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readString(); // phone_number
      r.readInt32(); // api_id
      r.readString(); // api_hash
      expect(r.readConstructorId()).toBe(AUTH_CID.codeSettings);
      expect(r.readInt32()).toBe(0); // flags
    });
  });

  describe('signIn', () => {
    it('should serialize auth.signIn with correct CID', async () => {
      await signIn(client, '+1234567890', 'hash123', '12345');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(AUTH_CID.auth_signIn);
    });

    it('should include flags with phone_code bit set', async () => {
      await signIn(client, '+1234567890', 'hash123', '12345');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt32()).toBe(0x1); // flags: phone_code present
    });

    it('should include phone_number', async () => {
      await signIn(client, '+1234567890', 'hash123', '12345');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      expect(r.readString()).toBe('+1234567890');
    });

    it('should include phone_code_hash', async () => {
      await signIn(client, '+1234567890', 'hash123', '12345');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readString(); // phone_number
      expect(r.readString()).toBe('hash123');
    });

    it('should include phone_code', async () => {
      await signIn(client, '+1234567890', 'hash123', '12345');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readString(); // phone_number
      r.readString(); // phone_code_hash
      expect(r.readString()).toBe('12345');
    });
  });

  describe('signUp', () => {
    it('should serialize auth.signUp with correct CID', async () => {
      await signUp(client, '+1234567890', 'hash123', 'John', 'Doe');

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(AUTH_CID.auth_signUp);
    });

    it('should include all fields', async () => {
      await signUp(client, '+1234567890', 'hash123', 'John', 'Doe');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.readInt32()).toBe(0); // flags
      expect(r.readString()).toBe('+1234567890');
      expect(r.readString()).toBe('hash123');
      expect(r.readString()).toBe('John');
      expect(r.readString()).toBe('Doe');
    });

    it('should use empty string for missing lastName', async () => {
      await signUp(client, '+1234567890', 'hash123', 'John');

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      r.readInt32(); // flags
      r.readString(); // phone_number
      r.readString(); // phone_code_hash
      r.readString(); // first_name
      expect(r.readString()).toBe('');
    });
  });

  describe('logOut', () => {
    it('should serialize auth.logOut with correct CID', async () => {
      await logOut(client);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(AUTH_CID.auth_logOut);
    });

    it('should only contain the CID (no additional fields)', async () => {
      await logOut(client);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId();
      expect(r.remaining).toBe(0);
    });
  });

  describe('checkPassword', () => {
    it('should serialize auth.checkPassword with correct CID', async () => {
      await checkPassword(client);

      const r = new TLReader(client._lastInvoke!);
      expect(r.readConstructorId()).toBe(AUTH_CID.auth_checkPassword);
    });

    it('should include inputCheckPasswordEmpty when no params', async () => {
      await checkPassword(client);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId(); // auth.checkPassword
      expect(r.readConstructorId()).toBe(AUTH_CID.inputCheckPasswordEmpty);
    });

    it('should include raw SRP params when provided', async () => {
      const srpData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      await checkPassword(client, srpData);

      const r = new TLReader(client._lastInvoke!);
      r.readConstructorId(); // auth.checkPassword
      // The SRP data is written as raw bytes
      const remaining = r.readRaw(4);
      expect(remaining).toEqual(srpData);
    });
  });
});
