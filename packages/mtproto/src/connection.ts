import { EventEmitter } from 'node:events';
import { Transport } from '@kerainmtp/transport';
import {
  AbridgedTransport,
  IntermediateTransport,
  PaddedIntermediateTransport,
  FullTransport,
  ObfuscatedTransport,
} from '@kerainmtp/transport';
import type { TransportMagicName } from '@kerainmtp/transport';
import { Session } from './session.js';
import { RpcHandler, RpcError } from './rpc.js';
import { SaltManager } from './salt-manager.js';
import { ReconnectStrategy } from './reconnect.js';
import { DCManager } from './dc-manager.js';
import type { DCConfig } from './dc-manager.js';
import { encryptMessage, decryptMessage } from './encryption.js';
import { createMsgsAck, parseMsgsAck } from './ack.js';
import { unpackContainer } from './container.js';
import { AuthKeyExchange } from './auth-key-exchange.js';
import type { AuthKeyResult } from './auth-key-exchange.js';
import type { RsaPublicKey } from '@kerainmtp/crypto';

// Well-known constructor IDs
const CID_RPC_RESULT = 0xf35c6d01;
const CID_RPC_ERROR = 0x2144ca19;
const CID_MSGS_ACK = 0x62d6b459;
const CID_NEW_SESSION_CREATED = 0x9ec20908;
const CID_BAD_MSG_NOTIFICATION = 0xa7eff811;
const CID_BAD_SERVER_SALT = 0xedab447b;
const CID_MSG_CONTAINER = 0x73f1f8dc;
const CID_PONG = 0x347773c5;
const CID_MSGS_STATE_REQ = 0xda69fb52;
const CID_MSGS_STATE_INFO = 0x04deb57d;
const CID_MSGS_ALL_INFO = 0x8cc0d131;
const CID_MSG_DETAILED_INFO = 0x276d3ec6;
const CID_MSG_NEW_DETAILED_INFO = 0x809db6df;
const CID_FUTURE_SALTS = 0xae500895;
const CID_GZ_PACKED = 0x3072cfa1;

/** Maximum messages to batch in a single ack before flushing. */
const ACK_BATCH_LIMIT = 16;

/** Interval in ms for flushing pending acks. */
const ACK_FLUSH_INTERVAL_MS = 5000;

/**
 * Transport type names recognized by MTProtoConnection.
 */
export type TransportType = 'abridged' | 'intermediate' | 'padded' | 'full';

/**
 * Options for creating an MTProto connection.
 */
export interface MTProtoConnectionOptions {
  dcId: number;
  transport: TransportType;
  obfuscated?: boolean;    // Default: true
  testMode?: boolean;      // Default: false
  rsaKeys?: RsaPublicKey[];
}

/**
 * Event map for MTProtoConnection.
 */
export interface MTProtoConnectionEvents {
  'connected': () => void;
  'disconnected': () => void;
  'error': (error: Error) => void;
  'update': (data: Buffer) => void;
  'message': (msgId: bigint, data: Buffer) => void;
}

/**
 * Create a transport instance from the transport type name.
 */
function createTransport(type: TransportType, obfuscated: boolean): Transport {
  let inner: Transport;
  switch (type) {
    case 'abridged':
      inner = new AbridgedTransport();
      break;
    case 'intermediate':
      inner = new IntermediateTransport();
      break;
    case 'padded':
      inner = new PaddedIntermediateTransport();
      break;
    case 'full':
      inner = new FullTransport();
      break;
  }

  if (obfuscated && type !== 'full') {
    // Map transport type to magic name for obfuscation
    const magicMap: Record<string, TransportMagicName> = {
      abridged: 'abridged',
      intermediate: 'intermediate',
      padded: 'padded',
    };
    const magic = magicMap[type];
    if (magic) {
      return new ObfuscatedTransport(inner, magic);
    }
  }

  return inner;
}

/**
 * MTProtoConnection ties together transport, encryption, session management,
 * RPC handling, ack batching, and reconnection into a single cohesive
 * connection abstraction.
 *
 * Lifecycle:
 *   1. Construct with DC and transport options
 *   2. Call connect() to establish the connection and auth key exchange
 *   3. Use invoke() to send RPC calls
 *   4. Listen for 'update' events for server-initiated messages
 *   5. Call disconnect() when done
 *
 * The connection automatically handles:
 *   - Auth key exchange (if no existing session is provided)
 *   - Message encryption/decryption
 *   - Sequence number and message ID management
 *   - ACK batching and flushing
 *   - Container packing for acks
 *   - RPC result/error dispatch
 *   - Reconnection with exponential backoff
 */
export class MTProtoConnection extends EventEmitter {
  private session: Session | null = null;
  private transport: Transport | null = null;
  private rpcHandler: RpcHandler;
  private saltManager: SaltManager;
  private reconnectStrategy: ReconnectStrategy;
  private dcManager: DCManager;
  private ackQueue: bigint[] = [];
  private connected = false;
  private ackTimer: ReturnType<typeof setInterval> | null = null;
  private readonly options: Required<Pick<MTProtoConnectionOptions, 'dcId' | 'transport' | 'obfuscated' | 'testMode'>> & { rsaKeys?: RsaPublicKey[] };

  constructor(options: MTProtoConnectionOptions) {
    super();

    this.options = {
      dcId: options.dcId,
      transport: options.transport,
      obfuscated: options.obfuscated ?? true,
      testMode: options.testMode ?? false,
      rsaKeys: options.rsaKeys,
    };

    this.rpcHandler = new RpcHandler();
    this.saltManager = new SaltManager();
    this.reconnectStrategy = new ReconnectStrategy();
    this.dcManager = new DCManager(this.options.testMode);
  }

  /**
   * Connect to the DC, perform auth key exchange if no existing session is provided.
   */
  async connect(existingSession?: Session): Promise<void> {
    const dcConfig = this.dcManager.getDC(this.options.dcId);
    if (!dcConfig) {
      throw new Error(`Unknown DC ID: ${this.options.dcId}`);
    }

    // Create and connect the transport
    this.transport = createTransport(this.options.transport, this.options.obfuscated);
    await this.transport.connect(dcConfig.ip, dcConfig.port);

    // Set up transport event listeners
    this.transport.on('data', (data: Buffer) => {
      this.handleIncoming(data);
    });

    this.transport.on('error', (err: Error) => {
      this.emit('error', err);
      this.handleReconnect();
    });

    this.transport.on('close', () => {
      if (this.connected) {
        this.connected = false;
        this.emit('disconnected');
        this.handleReconnect();
      }
    });

    if (existingSession) {
      this.session = existingSession;
    } else {
      // Perform auth key exchange
      const authResult = await this.performAuthKeyExchange(dcConfig);
      this.session = new Session(
        authResult.authKey,
        authResult.authKeyId,
        authResult.serverSalt,
        authResult.timeOffset,
      );
      this.saltManager.addSalts([{
        validSince: Math.floor(Date.now() / 1000) - 60,
        validUntil: Math.floor(Date.now() / 1000) + 3600,
        salt: authResult.serverSalt,
      }]);
    }

    this.connected = true;
    this.reconnectStrategy.reset();

    // Start the ACK flush timer
    this.startAckTimer();

    this.emit('connected');
  }

  /**
   * Disconnect cleanly.
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.stopAckTimer();

    // Flush any remaining acks before disconnecting
    if (this.ackQueue.length > 0 && this.transport?.isConnected && this.session) {
      try {
        this.flushAcks();
      } catch (_err) {
        // Best-effort: ignore errors during disconnect flush
      }
    }

    // Cancel pending RPCs
    this.rpcHandler.cancelAll('Connection disconnected');

    if (this.transport) {
      this.transport.removeAllListeners();
      this.transport.close();
      this.transport = null;
    }

    this.emit('disconnected');
  }

  /**
   * Send an RPC call and wait for the response.
   *
   * @param method - Serialized TL method data (constructor ID + parameters)
   * @param contentRelated - Whether this is a content-related message (default: true)
   * @returns The result data from the RPC response
   */
  async invoke(method: Buffer, contentRelated: boolean = true): Promise<Buffer> {
    if (!this.connected || !this.session || !this.transport) {
      throw new Error('Not connected');
    }

    const msgId = await this.send(method, contentRelated);

    // Extract method name from constructor ID for logging
    const methodCid = method.length >= 4 ? `0x${method.readUInt32LE(0).toString(16)}` : 'unknown';

    return this.rpcHandler.register(msgId, methodCid);
  }

  /**
   * Send a raw encrypted message and return its msg_id.
   *
   * @param data - The message data to send
   * @param contentRelated - Whether this is a content-related message
   * @returns The msg_id assigned to this message
   */
  async send(data: Buffer, contentRelated: boolean): Promise<bigint> {
    if (!this.session || !this.transport) {
      throw new Error('Not connected');
    }

    const msgId = this.session.nextMsgId();
    const seqNo = this.session.nextSeqNo(contentRelated);

    const encrypted = encryptMessage({
      authKey: this.session.state.authKey,
      salt: this.session.state.salt,
      sessionId: this.session.state.sessionId,
      msgId,
      seqNo,
      data,
    });

    this.transport.send(encrypted);

    return msgId;
  }

  /**
   * Get the current session.
   */
  getSession(): Session | null {
    return this.session;
  }

  /**
   * Check if the connection is active.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Handle incoming data from the transport layer.
   * Decrypts the message and dispatches it for processing.
   */
  private handleIncoming(data: Buffer): void {
    if (!this.session) return;

    try {
      // Check if it's an unencrypted message (auth_key_id = 0)
      if (data.length >= 8) {
        const authKeyId = data.readBigInt64LE(0);
        if (authKeyId === 0n) {
          // Unencrypted message — skip for now (these are used during
          // auth key exchange which is handled separately)
          return;
        }
      }

      const decrypted = decryptMessage({
        authKey: this.session.state.authKey,
        encrypted: data,
        isClient: false,
      });

      // Verify session_id matches
      if (decrypted.sessionId !== this.session.state.sessionId) {
        this.emit('error', new Error('Session ID mismatch in incoming message'));
        return;
      }

      this.processMessage(decrypted.msgId, decrypted.seqNo, decrypted.data);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Process a decrypted message based on its constructor ID.
   */
  private processMessage(msgId: bigint, _seqNo: number, data: Buffer): void {
    if (data.length < 4) {
      this.emit('error', new Error('Message data too short'));
      return;
    }

    // Queue for acknowledgment (server messages with odd msg_id are
    // from server; content-related ones should be acked)
    this.queueAck(msgId);

    const cid = data.readUInt32LE(0);

    switch (cid) {
      case CID_MSG_CONTAINER:
        this.handleContainer(data);
        break;

      case CID_RPC_RESULT:
        this.handleRpcResult(data);
        break;

      case CID_MSGS_ACK:
        // Server acknowledging our messages — nothing to do currently
        this.handleMsgsAck(data);
        break;

      case CID_NEW_SESSION_CREATED:
        this.handleNewSessionCreated(data);
        break;

      case CID_BAD_MSG_NOTIFICATION:
        this.handleBadMsgNotification(data);
        break;

      case CID_BAD_SERVER_SALT:
        this.handleBadServerSalt(data);
        break;

      case CID_PONG:
        this.handlePong(data);
        break;

      case CID_FUTURE_SALTS:
        this.handleFutureSalts(data);
        break;

      case CID_GZ_PACKED:
        // gzip_packed — not handled yet (would need zlib decompression)
        this.emit('error', new Error('gzip_packed not yet implemented'));
        break;

      case CID_MSGS_STATE_REQ:
      case CID_MSGS_STATE_INFO:
      case CID_MSGS_ALL_INFO:
      case CID_MSG_DETAILED_INFO:
      case CID_MSG_NEW_DETAILED_INFO:
        // State info messages — emit as updates for higher-level handling
        this.emit('message', msgId, data);
        break;

      default:
        // Unknown message type — emit as update for the application layer
        this.emit('update', data);
        this.emit('message', msgId, data);
        break;
    }
  }

  /**
   * Handle a msg_container by unpacking and processing each inner message.
   */
  private handleContainer(data: Buffer): void {
    try {
      const messages = unpackContainer(data);
      for (const msg of messages) {
        this.processMessage(msg.msgId, msg.seqNo, msg.body);
      }
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Handle an rpc_result message.
   *
   * Format: cid(4) + req_msg_id(8) + result_data
   * The result_data may be an rpc_error (cid 0x2144ca19).
   */
  private handleRpcResult(data: Buffer): void {
    if (data.length < 12) {
      this.emit('error', new Error('rpc_result too short'));
      return;
    }

    const reqMsgId = data.readBigInt64LE(4);
    const resultData = data.subarray(12);

    // Check if the result is an rpc_error
    if (resultData.length >= 4 && resultData.readUInt32LE(0) === CID_RPC_ERROR) {
      this.handleRpcError(reqMsgId, resultData);
      return;
    }

    this.rpcHandler.handleResult(reqMsgId, resultData);
  }

  /**
   * Handle an rpc_error inside an rpc_result.
   *
   * Format: cid(4) + error_code(4) + error_message(TL string)
   */
  private handleRpcError(reqMsgId: bigint, data: Buffer): void {
    if (data.length < 8) {
      this.emit('error', new Error('rpc_error too short'));
      return;
    }

    const errorCode = data.readInt32LE(4);

    // Parse TL string for error_message
    let errorMessage = 'UNKNOWN';
    if (data.length > 8) {
      const strOffset = 8;
      let strLen: number;
      let strStart: number;

      const firstByte = data[strOffset]!;
      if (firstByte <= 253) {
        strLen = firstByte;
        strStart = strOffset + 1;
      } else {
        // Long string
        strLen = data[strOffset + 1]! | (data[strOffset + 2]! << 8) | (data[strOffset + 3]! << 16);
        strStart = strOffset + 4;
      }

      if (strStart + strLen <= data.length) {
        errorMessage = data.subarray(strStart, strStart + strLen).toString('utf-8');
      }
    }

    // Check for DC migration errors
    const migrateDc = DCManager.parseMigrateError(errorMessage);
    if (migrateDc !== null) {
      // Emit migration info for the application layer to handle
      this.emit('error', new RpcError(errorCode, errorMessage));
    }

    this.rpcHandler.handleError(reqMsgId, errorCode, errorMessage);
  }

  /**
   * Handle msgs_ack from the server.
   */
  private handleMsgsAck(data: Buffer): void {
    try {
      parseMsgsAck(data);
      // The acked msg_ids could be used to clean up pending state,
      // but currently we rely on RPC result/timeout for that.
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Handle new_session_created notification.
   *
   * Format: cid(4) + first_msg_id(8) + unique_id(8) + server_salt(8)
   */
  private handleNewSessionCreated(data: Buffer): void {
    if (data.length < 28) return;

    const serverSalt = data.readBigInt64LE(20);

    if (this.session) {
      this.session.updateSalt(serverSalt);
    }

    this.emit('message', 0n, data);
  }

  /**
   * Handle bad_msg_notification.
   *
   * Format: cid(4) + bad_msg_id(8) + bad_msg_seqno(4) + error_code(4)
   */
  private handleBadMsgNotification(data: Buffer): void {
    if (data.length < 20) return;

    const badMsgId = data.readBigInt64LE(4);
    const errorCode = data.readInt32LE(16);

    // Error code 16 or 17 means time sync issue
    if (errorCode === 16 || errorCode === 17) {
      // Time synchronization issue — the msg_id is too low or too high
      this.emit('error', new Error(`bad_msg_notification: time sync error (code=${errorCode})`));
    }

    // Reject any pending RPC for this msg_id
    this.rpcHandler.handleError(
      badMsgId,
      errorCode,
      `bad_msg_notification (error_code=${errorCode})`,
    );
  }

  /**
   * Handle bad_server_salt.
   *
   * Format: cid(4) + bad_msg_id(8) + bad_msg_seqno(4) + error_code(4) + new_server_salt(8)
   */
  private handleBadServerSalt(data: Buffer): void {
    if (data.length < 28) return;

    const badMsgId = data.readBigInt64LE(4);
    const newSalt = data.readBigInt64LE(20);

    // Update the session salt
    if (this.session) {
      this.session.updateSalt(newSalt);
    }

    // The bad message should be resent with the new salt, but for now
    // we reject the pending RPC so the caller can retry.
    this.rpcHandler.handleError(
      badMsgId,
      48,
      'bad_server_salt',
    );
  }

  /**
   * Handle pong response.
   *
   * Format: cid(4) + msg_id(8) + ping_id(8)
   */
  private handlePong(data: Buffer): void {
    if (data.length < 20) return;

    const pingMsgId = data.readBigInt64LE(4);

    // Resolve the pending ping RPC (pong is a non-content-related response
    // but is treated as an RPC result for the corresponding ping)
    this.rpcHandler.handleResult(pingMsgId, data);
  }

  /**
   * Handle future_salts response.
   *
   * Format: cid(4) + req_msg_id(8) + now(4) + count(4) + salts...
   * Each salt: valid_since(4) + valid_until(4) + salt(8)
   */
  private handleFutureSalts(data: Buffer): void {
    if (data.length < 20) return;

    const reqMsgId = data.readBigInt64LE(4);
    const count = data.readInt32LE(16);

    let offset = 20;
    for (let i = 0; i < count && offset + 16 <= data.length; i++) {
      const validSince = data.readInt32LE(offset);
      const validUntil = data.readInt32LE(offset + 4);
      const salt = data.readBigInt64LE(offset + 8);
      this.saltManager.addSalts([{ validSince, validUntil, salt }]);
      offset += 16;
    }

    // Resolve the pending RPC
    this.rpcHandler.handleResult(reqMsgId, data);
  }

  /**
   * Queue a message ID for acknowledgment.
   * Flushes immediately if the batch limit is reached.
   */
  private queueAck(msgId: bigint): void {
    this.ackQueue.push(msgId);
    if (this.ackQueue.length >= ACK_BATCH_LIMIT) {
      this.flushAcks();
    }
  }

  /**
   * Flush all pending acknowledgments by sending a msgs_ack message.
   */
  flushAcks(): void {
    if (this.ackQueue.length === 0) return;
    if (!this.session || !this.transport) return;

    const msgIds = this.ackQueue.splice(0);
    const ackData = createMsgsAck(msgIds);

    try {
      // ACKs are non-content-related
      const msgId = this.session.nextMsgId();
      const seqNo = this.session.nextSeqNo(false);

      const encrypted = encryptMessage({
        authKey: this.session.state.authKey,
        salt: this.session.state.salt,
        sessionId: this.session.state.sessionId,
        msgId,
        seqNo,
        data: ackData,
      });

      this.transport.send(encrypted);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  /**
   * Start the periodic ack flush timer.
   */
  private startAckTimer(): void {
    this.stopAckTimer();
    this.ackTimer = setInterval(() => {
      this.flushAcks();
    }, ACK_FLUSH_INTERVAL_MS);

    // Unref the timer so it doesn't prevent Node.js from exiting
    if (this.ackTimer && typeof this.ackTimer === 'object' && 'unref' in this.ackTimer) {
      (this.ackTimer as NodeJS.Timeout).unref();
    }
  }

  /**
   * Stop the periodic ack flush timer.
   */
  private stopAckTimer(): void {
    if (this.ackTimer !== null) {
      clearInterval(this.ackTimer);
      this.ackTimer = null;
    }
  }

  /**
   * Handle reconnection after a connection drop.
   */
  private handleReconnect(): void {
    this.stopAckTimer();

    if (this.reconnectStrategy.isExhausted()) {
      this.emit('error', new Error('Reconnection attempts exhausted'));
      return;
    }

    const delay = this.reconnectStrategy.nextDelay();

    setTimeout(async () => {
      try {
        if (this.transport) {
          this.transport.removeAllListeners();
          this.transport.close();
          this.transport = null;
        }

        // Reconnect with the existing session
        await this.connect(this.session ?? undefined);
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.handleReconnect();
      }
    }, delay);
  }

  /**
   * Perform the auth key exchange over the current transport.
   */
  private async performAuthKeyExchange(dcConfig: DCConfig): Promise<AuthKeyResult> {
    if (!this.transport) {
      throw new Error('Transport not connected');
    }

    const rsaKeys = this.options.rsaKeys;
    if (!rsaKeys || rsaKeys.length === 0) {
      throw new Error('RSA keys required for auth key exchange');
    }

    const transport = this.transport;

    // Create a send function that wraps unencrypted messages for the transport.
    // During auth key exchange, messages are sent as unencrypted:
    //   auth_key_id (8 bytes, all zeros) + message_id (8 bytes) + message_length (4 bytes) + message
    const sendFn = (data: Buffer): Promise<Buffer> => {
      return new Promise((resolve, reject) => {
        // Build unencrypted message
        const msgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n;
        const buf = Buffer.alloc(20 + data.length);
        buf.writeBigInt64LE(0n, 0);          // auth_key_id = 0
        buf.writeBigInt64LE(msgId, 8);        // message_id
        buf.writeInt32LE(data.length, 16);    // message_length
        data.copy(buf, 20);                   // message_data

        const onData = (response: Buffer): void => {
          transport.removeListener('error', onError);
          // Parse unencrypted response: skip auth_key_id(8) + msg_id(8) + length(4)
          if (response.length < 20) {
            reject(new Error('Auth response too short'));
            return;
          }
          resolve(response.subarray(20));
        };

        const onError = (err: Error): void => {
          transport.removeListener('data', onData);
          reject(err);
        };

        transport.once('data', onData);
        transport.once('error', onError);

        transport.send(buf);
      });
    };

    const exchange = new AuthKeyExchange({
      send: sendFn,
      rsaKeys,
      dcId: dcConfig.id,
    });

    return exchange.execute();
  }
}
