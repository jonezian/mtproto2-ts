import { TLWriter } from '@mtproto2/binary';
import { MTProtoConnection } from '@mtproto2/mtproto';
import type { SessionStorage } from './session/abstract.js';
import { EntityCache } from './entity-cache.js';
import { FileManager } from './file-manager.js';
import { TypedEventEmitter } from './event-emitter.js';

// Constructor IDs
const CID = {
  inputUserSelf: 0xf7c1b13f,
  users_getUsers: 0x0d91a548,
  vector: 0x1cb5c415,
} as const;

/**
 * Events emitted by TelegramClient.
 */
export type TelegramClientEvents = {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'update': (data: Buffer) => void;
};

/**
 * Options for constructing a TelegramClient.
 */
export interface TelegramClientOptions {
  apiId: number;
  apiHash: string;
  session: SessionStorage;
  dcId?: number;
  testMode?: boolean;
  autoReconnect?: boolean;
}

/**
 * High-level Telegram client.
 *
 * Wraps MTProtoConnection with session management, entity caching,
 * file management, and typed events.
 *
 * @example
 * ```ts
 * const client = new TelegramClient({
 *   apiId: 12345,
 *   apiHash: 'abcdef...',
 *   session: new MemorySession(),
 * });
 *
 * await client.connect();
 * const me = await client.getMe();
 * await client.disconnect();
 * ```
 */
export class TelegramClient extends TypedEventEmitter<TelegramClientEvents> {
  readonly apiId: number;
  readonly apiHash: string;
  readonly entityCache: EntityCache;
  readonly fileManager: FileManager;

  private readonly sessionStorage: SessionStorage;
  private readonly dcId: number;
  private readonly testMode: boolean;
  private readonly _autoReconnect: boolean;
  private connection: MTProtoConnection | null = null;
  private _connected = false;

  constructor(options: TelegramClientOptions) {
    super();
    this.apiId = options.apiId;
    this.apiHash = options.apiHash;
    this.sessionStorage = options.session;
    this.dcId = options.dcId ?? 2;
    this.testMode = options.testMode ?? false;
    this._autoReconnect = options.autoReconnect ?? true;
    this.entityCache = new EntityCache();
    this.fileManager = new FileManager({
      invoke: (data: Buffer) => this.invoke(data),
    });
  }

  /**
   * Whether auto-reconnection is enabled.
   */
  get autoReconnect(): boolean {
    return this._autoReconnect;
  }

  /**
   * Establish an MTProto connection.
   *
   * Loads the session from storage if available, creates the transport
   * connection, and performs the auth key exchange if needed.
   */
  async connect(): Promise<void> {
    // Load existing session data
    const sessionData = await this.sessionStorage.load();

    const targetDcId = sessionData?.dcId ?? this.dcId;

    this.connection = new MTProtoConnection({
      dcId: this.testMode ? targetDcId + 10000 : targetDcId,
      transport: 'abridged',
      testMode: this.testMode,
    });

    // Forward events from the connection
    this.connection.on('connected', () => {
      this._connected = true;
      this.emit('connected');
    });

    this.connection.on('disconnected', () => {
      this._connected = false;
      this.emit('disconnected');
    });

    this.connection.on('error', (err: Error) => {
      this.emit('error', err);
    });

    this.connection.on('update', (data: Buffer) => {
      this.emit('update', data);
    });

    await this.connection.connect();
    this._connected = true;

    // Save session after successful connection
    const session = this.connection.getSession();
    if (session) {
      const dc = this.testMode ? targetDcId + 10000 : targetDcId;
      await this.sessionStorage.save({
        dcId: dc,
        authKey: session.state.authKey,
        port: 443,
        serverAddress: '',
      });
    }
  }

  /**
   * Cleanly disconnect from the server.
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.disconnect();
      this.connection = null;
    }
    this._connected = false;
  }

  /**
   * Send a raw TL-serialized request and return the response.
   *
   * @param method - Buffer containing the serialized TL method (constructor ID + params)
   * @returns Buffer containing the serialized TL response
   */
  async invoke(method: Buffer): Promise<Buffer> {
    if (!this.connection || !this._connected) {
      throw new Error('Client is not connected');
    }
    return this.connection.invoke(method);
  }

  /**
   * Check if the client is currently connected.
   */
  isConnected(): boolean {
    return this._connected;
  }

  /**
   * Call users.getUsers with inputUserSelf to get the current user.
   *
   * @returns Raw TL response buffer
   */
  async getMe(): Promise<Buffer> {
    const w = new TLWriter(32);
    w.writeConstructorId(CID.users_getUsers);
    // Vector<InputUser> with a single inputUserSelf
    w.writeConstructorId(CID.vector);
    w.writeInt32(1); // count = 1
    w.writeConstructorId(CID.inputUserSelf);
    return this.invoke(w.toBuffer());
  }
}
