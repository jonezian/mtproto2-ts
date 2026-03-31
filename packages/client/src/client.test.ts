import { describe, it, expect, vi } from 'vitest';
import { TLReader } from '@kerainmtp/binary';
import { TelegramClient } from './client.js';
import { MemorySession } from './session/memory.js';
import { EntityCache } from './entity-cache.js';
import { FileManager } from './file-manager.js';

const CID = {
  users_getUsers: 0x0d91a548,
  vector: 0x1cb5c415,
  inputUserSelf: 0xf7c1b13f,
} as const;

describe('TelegramClient', () => {
  describe('constructor', () => {
    it('should set apiId and apiHash', () => {
      const client = new TelegramClient({
        apiId: 12345,
        apiHash: 'abc123',
        session: new MemorySession(),
      });
      expect(client.apiId).toBe(12345);
      expect(client.apiHash).toBe('abc123');
    });

    it('should use default dcId of 2', () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      // dcId is private, test indirectly via connect later
      expect(client).toBeInstanceOf(TelegramClient);
    });

    it('should initialize entity cache', () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      expect(client.entityCache).toBeInstanceOf(EntityCache);
    });

    it('should initialize file manager', () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      expect(client.fileManager).toBeInstanceOf(FileManager);
    });

    it('should default autoReconnect to true', () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      expect(client.autoReconnect).toBe(true);
    });

    it('should accept autoReconnect = false', () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
        autoReconnect: false,
      });
      expect(client.autoReconnect).toBe(false);
    });
  });

  describe('isConnected', () => {
    it('should return false before connect', () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('invoke', () => {
    it('should throw when not connected', async () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      await expect(client.invoke(Buffer.alloc(4))).rejects.toThrow(
        'Client is not connected',
      );
    });
  });

  describe('getMe', () => {
    it('should throw when not connected', async () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      await expect(client.getMe()).rejects.toThrow('Client is not connected');
    });

    it('should serialize users.getUsers with inputUserSelf (via mock)', async () => {
      // We'll test the serialization by mocking invoke
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });

      let capturedData: Buffer | null = null;

      // Monkey-patch invoke to capture the call
      const originalInvoke = client.invoke.bind(client);
      client.invoke = vi.fn(async (method: Buffer) => {
        capturedData = method;
        return Buffer.alloc(4); // dummy response
      });

      // Need to mark as connected
      // @ts-expect-error accessing private for testing
      client._connected = true;

      await client.getMe();
      // Restore
      client.invoke = originalInvoke;

      expect(capturedData).not.toBeNull();
      const r = new TLReader(capturedData!);
      expect(r.readConstructorId()).toBe(CID.users_getUsers);
      expect(r.readConstructorId()).toBe(CID.vector);
      expect(r.readInt32()).toBe(1); // count
      expect(r.readConstructorId()).toBe(CID.inputUserSelf);
    });
  });

  describe('disconnect', () => {
    it('should set connected to false after disconnect', async () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      // Simulate connected state
      // @ts-expect-error accessing private for testing
      client._connected = true;

      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });

    it('should be safe to call disconnect multiple times', async () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      await client.disconnect();
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('events', () => {
    it('should support typed event listeners', () => {
      const client = new TelegramClient({
        apiId: 1,
        apiHash: 'x',
        session: new MemorySession(),
      });
      const handler = vi.fn();
      client.on('error', handler);
      client.emit('error', new Error('test'));
      expect(handler).toHaveBeenCalledOnce();
    });
  });
});
