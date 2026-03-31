import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrate, processSession, docToSessionData, readAllSessions } from './migrate-sessions.js';
import { MigrationManager } from '../src/migration.js';
import type { MongoClient, MongoCollection, MongoDb } from '../src/session/mongodb.js';

function createMockMongo(docs: Map<string, Record<string, unknown>>): {
  client: MongoClient;
  collection: MongoCollection;
} {
  const collection: MongoCollection = {
    findOne: vi.fn(async (filter: Record<string, unknown>) => {
      const id = filter._id as string;
      return docs.get(id) ?? null;
    }),
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

describe('migrate-sessions', () => {
  let manager: MigrationManager;

  beforeEach(() => {
    manager = new MigrationManager();
  });

  describe('docToSessionData', () => {
    it('should convert a valid document with Buffer auth_key', () => {
      const doc = {
        _id: '+123',
        dc_id: 2,
        auth_key: Buffer.alloc(256, 0xab),
        server_address: '10.0.0.1',
        port: 443,
      };

      const data = docToSessionData(doc);
      expect(data).not.toBeNull();
      expect(data!.dcId).toBe(2);
      expect(data!.authKey.length).toBe(256);
      expect(data!.serverAddress).toBe('10.0.0.1');
      expect(data!.port).toBe(443);
    });

    it('should convert a document with Uint8Array auth_key', () => {
      const doc = {
        _id: '+123',
        dc_id: 3,
        auth_key: new Uint8Array(256).fill(0xcd),
        server_address: '10.0.0.2',
        port: 8443,
      };

      const data = docToSessionData(doc);
      expect(data).not.toBeNull();
      expect(data!.authKey.length).toBe(256);
    });

    it('should return null for invalid auth_key type', () => {
      const doc = {
        _id: '+123',
        dc_id: 2,
        auth_key: 'not-a-buffer',
        server_address: '10.0.0.1',
        port: 443,
      };

      const data = docToSessionData(doc);
      expect(data).toBeNull();
    });

    it('should default dc_id to 0 when missing', () => {
      const doc = {
        _id: '+123',
        auth_key: Buffer.alloc(256),
        server_address: '10.0.0.1',
        port: 443,
      };

      const data = docToSessionData(doc);
      expect(data).not.toBeNull();
      expect(data!.dcId).toBe(0);
    });
  });

  describe('processSession', () => {
    it('should report valid session', () => {
      const doc = {
        _id: '+123',
        dc_id: 2,
        auth_key: Buffer.alloc(256, 0xab),
        server_address: '149.154.167.51',
        port: 443,
      };

      const report = processSession('+123', doc, manager);
      expect(report.valid).toBe(true);
      expect(report.errors).toEqual([]);
      expect(report.session).toBeDefined();
      expect(report.session!.dcId).toBe(2);
    });

    it('should report invalid when document is null', () => {
      const report = processSession('+123', null, manager);
      expect(report.valid).toBe(false);
      expect(report.errors).toContain('Session document not found');
    });

    it('should report invalid when auth_key is wrong type', () => {
      const doc = {
        _id: '+123',
        dc_id: 2,
        auth_key: 'bad',
        server_address: '10.0.0.1',
        port: 443,
      };

      const report = processSession('+123', doc, manager);
      expect(report.valid).toBe(false);
      expect(report.errors[0]).toContain('auth_key');
    });

    it('should report invalid for wrong auth_key size', () => {
      const doc = {
        _id: '+123',
        dc_id: 2,
        auth_key: Buffer.alloc(128),
        server_address: '10.0.0.1',
        port: 443,
      };

      const report = processSession('+123', doc, manager);
      expect(report.valid).toBe(false);
    });

    it('should report invalid for out-of-range dc_id', () => {
      const doc = {
        _id: '+123',
        dc_id: 99,
        auth_key: Buffer.alloc(256, 0xab),
        server_address: '10.0.0.1',
        port: 443,
      };

      const report = processSession('+123', doc, manager);
      expect(report.valid).toBe(false);
    });
  });

  describe('readAllSessions', () => {
    it('should read documents for all phone numbers', async () => {
      const docs = new Map<string, Record<string, unknown>>([
        ['+111', { _id: '+111', dc_id: 1, auth_key: Buffer.alloc(256), server_address: '10.0.0.1', port: 443 }],
        ['+222', { _id: '+222', dc_id: 2, auth_key: Buffer.alloc(256), server_address: '10.0.0.2', port: 443 }],
      ]);

      const { collection } = createMockMongo(docs);
      const results = await readAllSessions(collection, ['+111', '+222', '+333']);

      expect(results).toHaveLength(3);
      expect(results[0]!.doc).not.toBeNull();
      expect(results[1]!.doc).not.toBeNull();
      expect(results[2]!.doc).toBeNull();
    });
  });

  describe('migrate', () => {
    it('should report total, valid, and invalid counts', async () => {
      const docs = new Map<string, Record<string, unknown>>([
        ['+111', { _id: '+111', dc_id: 2, auth_key: Buffer.alloc(256, 0xab), server_address: '10.0.0.1', port: 443 }],
        ['+222', { _id: '+222', dc_id: 99, auth_key: Buffer.alloc(256, 0xab), server_address: '10.0.0.2', port: 443 }],
      ]);

      const { client } = createMockMongo(docs);

      const result = await migrate({
        mongoClient: client,
        database: 'testdb',
        collection: 'sessions',
        phoneNumbers: ['+111', '+222', '+333'],
      });

      expect(result.total).toBe(3);
      expect(result.valid).toBe(1);
      expect(result.invalid).toBe(2); // +222 invalid dc_id, +333 missing
    });

    it('should connect and close the client', async () => {
      const { client } = createMockMongo(new Map());

      await migrate({
        mongoClient: client,
        database: 'testdb',
        collection: 'sessions',
        phoneNumbers: [],
      });

      expect(client.connect).toHaveBeenCalledOnce();
      expect(client.close).toHaveBeenCalledOnce();
    });

    it('should close the client even on error', async () => {
      const collection: MongoCollection = {
        findOne: vi.fn(async () => { throw new Error('DB error'); }),
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

      await expect(
        migrate({
          mongoClient: client,
          database: 'testdb',
          collection: 'sessions',
          phoneNumbers: ['+111'],
        }),
      ).rejects.toThrow('DB error');

      expect(client.close).toHaveBeenCalledOnce();
    });

    it('should include detailed reports for each session', async () => {
      const docs = new Map<string, Record<string, unknown>>([
        ['+111', { _id: '+111', dc_id: 2, auth_key: Buffer.alloc(256, 0xab), server_address: '10.0.0.1', port: 443 }],
      ]);

      const { client } = createMockMongo(docs);

      const result = await migrate({
        mongoClient: client,
        database: 'testdb',
        collection: 'sessions',
        phoneNumbers: ['+111'],
      });

      expect(result.reports).toHaveLength(1);
      expect(result.reports[0]!.phoneNumber).toBe('+111');
      expect(result.reports[0]!.valid).toBe(true);
      expect(result.reports[0]!.session).toBeDefined();
      expect(result.reports[0]!.session!.dcId).toBe(2);
    });
  });
});
