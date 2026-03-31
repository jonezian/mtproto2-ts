import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MongoSession } from './mongodb.js';
import type { MongoClient, MongoCollection, MongoDb } from './mongodb.js';
import type { SessionData } from '@kerainmtp/client';

function makeSessionData(overrides?: Partial<SessionData>): SessionData {
  return {
    dcId: 2,
    authKey: Buffer.alloc(256, 0xab),
    port: 443,
    serverAddress: '149.154.167.51',
    ...overrides,
  };
}

/**
 * Create a mock MongoDB stack with injectable collection behavior.
 */
function createMockMongo(): {
  client: MongoClient;
  collection: MongoCollection & {
    findOne: ReturnType<typeof vi.fn>;
    updateOne: ReturnType<typeof vi.fn>;
    deleteOne: ReturnType<typeof vi.fn>;
  };
} {
  const collection = {
    findOne: vi.fn(async () => null),
    updateOne: vi.fn(async () => {}),
    deleteOne: vi.fn(async () => {}),
  };

  const db: MongoDb = {
    collection: vi.fn(() => collection),
  };

  const client: MongoClient = {
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    db: vi.fn(() => db),
  };

  return { client, collection };
}

describe('MongoSession', () => {
  let mongo: ReturnType<typeof createMockMongo>;
  let session: MongoSession;

  beforeEach(() => {
    mongo = createMockMongo();
    session = new MongoSession({
      client: mongo.client,
      database: 'testdb',
      collection: 'sessions',
      phoneNumber: '+1234567890',
    });
  });

  describe('load', () => {
    it('should return null when no document exists', async () => {
      mongo.collection.findOne.mockResolvedValue(null);
      const data = await session.load();
      expect(data).toBeNull();
    });

    it('should query with phone number as _id', async () => {
      mongo.collection.findOne.mockResolvedValue(null);
      await session.load();
      expect(mongo.collection.findOne).toHaveBeenCalledWith({ _id: '+1234567890' });
    });

    it('should convert Python-format document to SessionData', async () => {
      const authKey = Buffer.alloc(256, 0xab);
      mongo.collection.findOne.mockResolvedValue({
        _id: '+1234567890',
        dc_id: 2,
        auth_key: authKey,
        server_address: '149.154.167.51',
        port: 443,
      });

      const data = await session.load();
      expect(data).not.toBeNull();
      expect(data!.dcId).toBe(2);
      expect(data!.authKey).toEqual(authKey);
      expect(data!.serverAddress).toBe('149.154.167.51');
      expect(data!.port).toBe(443);
    });

    it('should handle Uint8Array auth_key', async () => {
      const raw = new Uint8Array(256).fill(0xcd);
      mongo.collection.findOne.mockResolvedValue({
        _id: '+1234567890',
        dc_id: 3,
        auth_key: raw,
        server_address: '10.0.0.1',
        port: 8443,
      });

      const data = await session.load();
      expect(data).not.toBeNull();
      expect(data!.authKey).toEqual(Buffer.from(raw));
      expect(data!.authKey.length).toBe(256);
    });

    it('should handle MongoDB Binary-like auth_key with .buffer property', async () => {
      const raw = new Uint8Array(256).fill(0xef);
      const binaryLike = { buffer: raw };
      mongo.collection.findOne.mockResolvedValue({
        _id: '+1234567890',
        dc_id: 1,
        auth_key: binaryLike,
        server_address: '10.0.0.2',
        port: 443,
      });

      const data = await session.load();
      expect(data).not.toBeNull();
      expect(data!.authKey).toEqual(Buffer.from(raw));
    });

    it('should return null when auth_key is not a valid type', async () => {
      mongo.collection.findOne.mockResolvedValue({
        _id: '+1234567890',
        dc_id: 2,
        auth_key: 'not-a-buffer',
        server_address: '10.0.0.1',
        port: 443,
      });

      const data = await session.load();
      expect(data).toBeNull();
    });

    it('should default server_address to empty string when missing', async () => {
      mongo.collection.findOne.mockResolvedValue({
        _id: '+1234567890',
        dc_id: 2,
        auth_key: Buffer.alloc(256),
        port: 443,
      });

      const data = await session.load();
      expect(data).not.toBeNull();
      expect(data!.serverAddress).toBe('');
    });

    it('should default port to 443 when missing', async () => {
      mongo.collection.findOne.mockResolvedValue({
        _id: '+1234567890',
        dc_id: 2,
        auth_key: Buffer.alloc(256),
        server_address: '10.0.0.1',
      });

      const data = await session.load();
      expect(data).not.toBeNull();
      expect(data!.port).toBe(443);
    });

    it('should use correct database and collection names', async () => {
      mongo.collection.findOne.mockResolvedValue(null);
      await session.load();

      expect(mongo.client.db).toHaveBeenCalledWith('testdb');
      const db = mongo.client.db('testdb');
      expect(db.collection).toHaveBeenCalledWith('sessions');
    });
  });

  describe('save', () => {
    it('should upsert document with Python-compatible format', async () => {
      const data = makeSessionData();
      await session.save(data);

      expect(mongo.collection.updateOne).toHaveBeenCalledWith(
        { _id: '+1234567890' },
        {
          $set: {
            dc_id: 2,
            auth_key: expect.any(Buffer),
            server_address: '149.154.167.51',
            port: 443,
          },
        },
        { upsert: true },
      );
    });

    it('should store a copy of the auth_key buffer', async () => {
      const data = makeSessionData();
      await session.save(data);

      const [, update] = mongo.collection.updateOne.mock.calls[0]!;
      const savedAuthKey = (update as Record<string, Record<string, Buffer>>).$set.auth_key;
      expect(savedAuthKey).toEqual(data.authKey);
      // Should be a copy, not the same reference
      expect(savedAuthKey).not.toBe(data.authKey);
    });

    it('should update existing document on second save', async () => {
      await session.save(makeSessionData({ dcId: 1 }));
      await session.save(makeSessionData({ dcId: 3 }));

      expect(mongo.collection.updateOne).toHaveBeenCalledTimes(2);

      const [, update2] = mongo.collection.updateOne.mock.calls[1]!;
      expect((update2 as Record<string, Record<string, number>>).$set.dc_id).toBe(3);
    });
  });

  describe('delete', () => {
    it('should delete the document by phone number', async () => {
      await session.delete();

      expect(mongo.collection.deleteOne).toHaveBeenCalledWith({
        _id: '+1234567890',
      });
    });

    it('should be safe to call multiple times', async () => {
      await session.delete();
      await session.delete();

      expect(mongo.collection.deleteOne).toHaveBeenCalledTimes(2);
    });
  });

  describe('different phone numbers', () => {
    it('should use the configured phone number for all operations', async () => {
      const session2 = new MongoSession({
        client: mongo.client,
        database: 'testdb',
        collection: 'sessions',
        phoneNumber: '+9876543210',
      });

      await session2.load();
      expect(mongo.collection.findOne).toHaveBeenCalledWith({ _id: '+9876543210' });

      await session2.save(makeSessionData());
      expect(mongo.collection.updateOne).toHaveBeenCalledWith(
        { _id: '+9876543210' },
        expect.any(Object),
        expect.any(Object),
      );

      await session2.delete();
      expect(mongo.collection.deleteOne).toHaveBeenCalledWith({ _id: '+9876543210' });
    });
  });
});
