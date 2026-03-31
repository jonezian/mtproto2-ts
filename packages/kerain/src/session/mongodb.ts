import type { SessionStorage, SessionData } from '@kerainmtp/client';

/**
 * Injectable MongoDB collection interface.
 *
 * Mirrors the minimal subset of the official mongodb driver's Collection
 * so that consumers can inject any compatible client without pulling in the
 * actual dependency.
 */
export interface MongoCollection {
  findOne(filter: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<void>;
  deleteOne(filter: Record<string, unknown>): Promise<void>;
}

/**
 * Injectable MongoDB database interface.
 */
export interface MongoDb {
  collection(name: string): MongoCollection;
}

/**
 * Injectable MongoDB client interface.
 *
 * Abstracts the actual mongodb driver so the package stays dependency-free.
 */
export interface MongoClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  db(name: string): MongoDb;
}

/**
 * Options for constructing a MongoSession.
 */
export interface MongoSessionOptions {
  client: MongoClient;
  database: string;
  collection: string;
  phoneNumber: string;
}

/**
 * MongoDB-backed session storage.
 *
 * Compatible with the Python session_store.py document format used by
 * the Telethon-based telegram-service. Documents are stored with the
 * phone number as `_id` and contain the DC id, auth key (as a binary
 * buffer), server address, and port.
 *
 * Document format:
 * ```json
 * {
 *   "_id": "+1234567890",
 *   "dc_id": 2,
 *   "auth_key": <Buffer 256 bytes>,
 *   "server_address": "149.154.167.51",
 *   "port": 443
 * }
 * ```
 */
export class MongoSession implements SessionStorage {
  private readonly client: MongoClient;
  private readonly database: string;
  private readonly collectionName: string;
  private readonly phoneNumber: string;

  constructor(options: MongoSessionOptions) {
    this.client = options.client;
    this.database = options.database;
    this.collectionName = options.collection;
    this.phoneNumber = options.phoneNumber;
  }

  /**
   * Get the MongoDB collection handle.
   */
  private getCollection(): MongoCollection {
    return this.client.db(this.database).collection(this.collectionName);
  }

  /**
   * Load session data from MongoDB.
   *
   * Reads the document matching the phone number and converts from
   * the Python-compatible snake_case format to KerainMTP's SessionData.
   */
  async load(): Promise<SessionData | null> {
    const coll = this.getCollection();
    const doc = await coll.findOne({ _id: this.phoneNumber });

    if (!doc) return null;

    const authKeyRaw = doc['auth_key'];
    let authKey: Buffer;

    if (Buffer.isBuffer(authKeyRaw)) {
      authKey = authKeyRaw;
    } else if (authKeyRaw instanceof Uint8Array) {
      authKey = Buffer.from(authKeyRaw);
    } else if (typeof authKeyRaw === 'object' && authKeyRaw !== null && 'buffer' in authKeyRaw) {
      // Handle MongoDB Binary type which has a .buffer property
      authKey = Buffer.from((authKeyRaw as { buffer: Uint8Array }).buffer);
    } else {
      return null;
    }

    return {
      dcId: doc['dc_id'] as number,
      authKey,
      serverAddress: (doc['server_address'] as string) ?? '',
      port: (doc['port'] as number) ?? 443,
    };
  }

  /**
   * Save (upsert) session data to MongoDB.
   *
   * Writes in the Python-compatible snake_case document format so the
   * session store is interoperable with the existing Telethon service.
   */
  async save(data: SessionData): Promise<void> {
    const coll = this.getCollection();
    await coll.updateOne(
      { _id: this.phoneNumber },
      {
        $set: {
          dc_id: data.dcId,
          auth_key: Buffer.from(data.authKey),
          server_address: data.serverAddress,
          port: data.port,
        },
      },
      { upsert: true },
    );
  }

  /**
   * Delete the session document from MongoDB.
   */
  async delete(): Promise<void> {
    const coll = this.getCollection();
    await coll.deleteOne({ _id: this.phoneNumber });
  }
}
