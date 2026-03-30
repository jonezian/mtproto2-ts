import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { MTProtoConnection } from './connection.js';
import { Session } from './session.js';
import { decryptMessage } from './encryption.js';
import { createMsgsAck } from './ack.js';
import { packContainer } from './container.js';

/**
 * Create a mock auth key pair for testing.
 */
function makeAuthKey(): { authKey: Buffer; authKeyId: Buffer } {
  const authKey = crypto.randomBytes(256);
  const authKeyId = crypto.createHash('sha1').update(authKey).digest().subarray(12, 20);
  return { authKey, authKeyId };
}

/**
 * Create a test session.
 */
function makeSession(): Session {
  const { authKey, authKeyId } = makeAuthKey();
  return new Session(authKey, authKeyId, 123456n, 0);
}

/**
 * Create a mock Transport that extends EventEmitter and provides
 * the minimal Transport interface.
 */
class MockTransport extends EventEmitter {
  isConnected = false;
  sent: Buffer[] = [];

  async connect(_host: string, _port: number): Promise<void> {
    this.isConnected = true;
    this.emit('connect');
  }

  send(payload: Buffer): void {
    this.sent.push(Buffer.from(payload));
  }

  close(): void {
    this.isConnected = false;
  }

  encodePacket(payload: Buffer): Buffer {
    return payload;
  }

  decodePacket(data: Buffer): Buffer[] {
    return [data];
  }

  /**
   * Simulate receiving data from the server.
   */
  simulateData(data: Buffer): void {
    this.emit('data', data);
  }

  /**
   * Simulate an error.
   */
  simulateError(err: Error): void {
    this.emit('error', err);
  }

  /**
   * Simulate connection close.
   */
  simulateClose(): void {
    this.isConnected = false;
    this.emit('close');
  }
}

/**
 * Helper to set up a connection with mocked internals.
 * Returns the connection with a session and mock transport attached.
 */
function setupConnection(): {
  connection: MTProtoConnection;
  session: Session;
  mockTransport: MockTransport;
} {
  const session = makeSession();
  const connection = new MTProtoConnection({
    dcId: 2,
    transport: 'abridged',
  });

  const mockTransport = new MockTransport();
  mockTransport.isConnected = true;

  (connection as any).session = session;
  (connection as any).transport = mockTransport;
  (connection as any).connected = true;

  return { connection, session, mockTransport };
}

describe('MTProtoConnection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create connection with default options', () => {
      const connection = new MTProtoConnection({
        dcId: 2,
        transport: 'abridged',
      });

      expect(connection.isConnected()).toBe(false);
      expect(connection.getSession()).toBeNull();
    });

    it('should create connection with custom options', () => {
      const connection = new MTProtoConnection({
        dcId: 1,
        transport: 'intermediate',
        obfuscated: false,
        testMode: true,
      });

      expect(connection.isConnected()).toBe(false);
    });
  });

  describe('session management', () => {
    it('should return null session before connecting', () => {
      const connection = new MTProtoConnection({
        dcId: 2,
        transport: 'abridged',
      });

      expect(connection.getSession()).toBeNull();
    });
  });

  describe('invoke without connection', () => {
    it('should throw when invoking without connection', async () => {
      const connection = new MTProtoConnection({
        dcId: 2,
        transport: 'abridged',
      });

      await expect(connection.invoke(Buffer.alloc(4))).rejects.toThrow('Not connected');
    });
  });

  describe('send without connection', () => {
    it('should throw when sending without connection', async () => {
      const connection = new MTProtoConnection({
        dcId: 2,
        transport: 'abridged',
      });

      await expect(connection.send(Buffer.alloc(4), true)).rejects.toThrow('Not connected');
    });
  });

  describe('ack batching', () => {
    it('should flush acks when batch limit is reached', () => {
      const { connection, mockTransport } = setupConnection();

      // Queue acks (the batch limit is 16)
      for (let i = 0; i < 16; i++) {
        (connection as any).queueAck(BigInt(i + 1));
      }

      // After reaching the batch limit, the acks should have been flushed
      expect((connection as any).ackQueue.length).toBe(0);
      // And a message should have been sent through the transport
      expect(mockTransport.sent.length).toBe(1);
    });

    it('should not flush before batch limit', () => {
      const { connection, mockTransport } = setupConnection();

      // Queue fewer acks than the limit
      for (let i = 0; i < 5; i++) {
        (connection as any).queueAck(BigInt(i + 1));
      }

      expect((connection as any).ackQueue.length).toBe(5);
      expect(mockTransport.sent.length).toBe(0);
    });

    it('should flush remaining acks when flushAcks is called', () => {
      const { connection, mockTransport } = setupConnection();

      (connection as any).queueAck(1n);
      (connection as any).queueAck(2n);
      (connection as any).queueAck(3n);

      connection.flushAcks();

      expect((connection as any).ackQueue.length).toBe(0);
      expect(mockTransport.sent.length).toBe(1);
    });

    it('should not send anything when flushing empty ack queue', () => {
      const { connection, mockTransport } = setupConnection();

      connection.flushAcks();

      expect(mockTransport.sent.length).toBe(0);
    });
  });

  describe('message processing', () => {
    // These tests call processMessage directly to bypass encryption/decryption,
    // since building a proper server-encrypted message requires server-side
    // encryption (x=8) which encryptMessage does not support (it always uses x=0).

    it('should process rpc_result and resolve pending RPC', async () => {
      const { connection, session } = setupConnection();

      // Register a pending RPC
      const msgId = session.nextMsgId();
      const rpcPromise = (connection as any).rpcHandler.register(msgId, 'test.method');

      // Build an rpc_result message
      // Format: cid (4) + req_msg_id (8) + result_data
      const resultPayload = Buffer.from('test result');
      const rpcResult = Buffer.alloc(12 + resultPayload.length);
      rpcResult.writeUInt32LE(0xf35c6d01, 0); // rpc_result CID
      rpcResult.writeBigInt64LE(msgId, 4);
      resultPayload.copy(rpcResult, 12);

      // Directly call processMessage (bypassing encryption)
      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 1, rpcResult);

      const result = await rpcPromise;
      expect(result).toEqual(resultPayload);
    });

    it('should process rpc_error and reject pending RPC', async () => {
      const { connection, session } = setupConnection();

      const msgId = session.nextMsgId();
      const rpcPromise = (connection as any).rpcHandler.register(msgId, 'test.method');

      // Build rpc_result with rpc_error inside
      // rpc_error: cid(4) + error_code(4) + error_message(TL string)
      const errorMsg = 'FLOOD_WAIT_300';
      const errorMsgBuf = Buffer.from(errorMsg, 'utf-8');
      const rpcError = Buffer.alloc(8 + 1 + errorMsgBuf.length);
      rpcError.writeUInt32LE(0x2144ca19, 0); // rpc_error CID
      rpcError.writeInt32LE(420, 4);          // error_code
      rpcError[8] = errorMsgBuf.length;       // TL string length byte
      errorMsgBuf.copy(rpcError, 9);

      // Wrap in rpc_result
      const rpcResult = Buffer.alloc(12 + rpcError.length);
      rpcResult.writeUInt32LE(0xf35c6d01, 0);
      rpcResult.writeBigInt64LE(msgId, 4);
      rpcError.copy(rpcResult, 12);

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 1, rpcResult);

      await expect(rpcPromise).rejects.toThrow('FLOOD_WAIT_300');
    });

    it('should emit update for unknown message types', async () => {
      const { connection } = setupConnection();

      const updateReceived = new Promise<Buffer>((resolve) => {
        connection.on('update', (data: Buffer) => {
          resolve(data);
        });
      });

      // Send a message with an unknown constructor ID
      const unknownMsg = Buffer.alloc(8);
      unknownMsg.writeUInt32LE(0xdeadbeef, 0);
      unknownMsg.writeUInt32LE(42, 4);

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 1, unknownMsg);

      const receivedData = await updateReceived;
      expect(receivedData.readUInt32LE(0)).toBe(0xdeadbeef);
    });

    it('should process bad_server_salt and update session salt', async () => {
      const { connection, session } = setupConnection();

      const msgId = session.nextMsgId();
      const rpcPromise = (connection as any).rpcHandler.register(msgId, 'test.method');

      // Build bad_server_salt
      // Format: cid(4) + bad_msg_id(8) + bad_msg_seqno(4) + error_code(4) + new_server_salt(8)
      const badSalt = Buffer.alloc(28);
      badSalt.writeUInt32LE(0xedab447b, 0);
      badSalt.writeBigInt64LE(msgId, 4);
      badSalt.writeInt32LE(1, 12);
      badSalt.writeInt32LE(48, 16);
      badSalt.writeBigInt64LE(999999n, 20);

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 1, badSalt);

      expect(session.state.salt).toBe(999999n);

      // The pending RPC should be rejected with bad_server_salt
      await expect(rpcPromise).rejects.toThrow('bad_server_salt');
    });

    it('should process new_session_created and update salt', () => {
      const { connection, session } = setupConnection();

      // Build new_session_created
      // Format: cid(4) + first_msg_id(8) + unique_id(8) + server_salt(8)
      const newSession = Buffer.alloc(28);
      newSession.writeUInt32LE(0x9ec20908, 0);
      newSession.writeBigInt64LE(1n, 4);      // first_msg_id
      newSession.writeBigInt64LE(42n, 12);     // unique_id
      newSession.writeBigInt64LE(777777n, 20); // server_salt

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 1, newSession);

      expect(session.state.salt).toBe(777777n);
    });

    it('should process msgs_ack without error', () => {
      const { connection } = setupConnection();

      const ackData = createMsgsAck([1n, 2n, 3n]);
      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;

      // Should not throw or emit error
      const errors: Error[] = [];
      connection.on('error', (err) => errors.push(err));

      (connection as any).processMessage(serverMsgId, 1, ackData);

      expect(errors.length).toBe(0);
    });

    it('should handle msg_container by processing inner messages', async () => {
      const { connection, session } = setupConnection();

      // Register an RPC that will be resolved by a container inner message
      const msgId = session.nextMsgId();
      const rpcPromise = (connection as any).rpcHandler.register(msgId, 'test.method');

      // Build rpc_result
      const resultPayload = Buffer.from('container result');
      const rpcResult = Buffer.alloc(12 + resultPayload.length);
      rpcResult.writeUInt32LE(0xf35c6d01, 0);
      rpcResult.writeBigInt64LE(msgId, 4);
      resultPayload.copy(rpcResult, 12);

      // Wrap in container
      const containerData = packContainer([
        {
          msgId: BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n,
          seqNo: 1,
          body: rpcResult,
        },
      ]);

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 5n;
      (connection as any).processMessage(serverMsgId, 0, containerData);

      const result = await rpcPromise;
      expect(result).toEqual(resultPayload);
    });

    it('should process bad_msg_notification and reject pending RPC', async () => {
      const { connection, session } = setupConnection();

      const msgId = session.nextMsgId();
      const rpcPromise = (connection as any).rpcHandler.register(msgId, 'test.method');

      // Build bad_msg_notification
      // Format: cid(4) + bad_msg_id(8) + bad_msg_seqno(4) + error_code(4)
      const badMsg = Buffer.alloc(20);
      badMsg.writeUInt32LE(0xa7eff811, 0);
      badMsg.writeBigInt64LE(msgId, 4);
      badMsg.writeInt32LE(1, 12);
      badMsg.writeInt32LE(32, 16); // msg_seqno_too_low

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 1, badMsg);

      await expect(rpcPromise).rejects.toThrow('bad_msg_notification');
    });

    it('should process pong and resolve pending RPC', async () => {
      const { connection, session } = setupConnection();

      const msgId = session.nextMsgId();
      const rpcPromise = (connection as any).rpcHandler.register(msgId, 'ping');

      // Build pong response
      // Format: cid(4) + msg_id(8) + ping_id(8)
      const pong = Buffer.alloc(20);
      pong.writeUInt32LE(0x347773c5, 0);
      pong.writeBigInt64LE(msgId, 4);
      pong.writeBigInt64LE(42n, 12);

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 0, pong);

      const result = await rpcPromise;
      expect(result).toEqual(pong);
    });

    it('should emit error for too-short messages', () => {
      const { connection } = setupConnection();

      const errors: Error[] = [];
      connection.on('error', (err) => errors.push(err));

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 1, Buffer.alloc(2));

      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain('too short');
    });

    it('should handle rpc_result with migration error', async () => {
      const { connection, session } = setupConnection();

      // Add an error listener so the EventEmitter doesn't throw
      const emittedErrors: Error[] = [];
      connection.on('error', (err) => emittedErrors.push(err));

      const msgId = session.nextMsgId();
      const rpcPromise = (connection as any).rpcHandler.register(msgId, 'test.method');

      // Build rpc_error with migration message
      const errorMsg = 'PHONE_MIGRATE_2';
      const errorMsgBuf = Buffer.from(errorMsg, 'utf-8');
      const rpcError = Buffer.alloc(8 + 1 + errorMsgBuf.length);
      rpcError.writeUInt32LE(0x2144ca19, 0);
      rpcError.writeInt32LE(303, 4);
      rpcError[8] = errorMsgBuf.length;
      errorMsgBuf.copy(rpcError, 9);

      const rpcResult = Buffer.alloc(12 + rpcError.length);
      rpcResult.writeUInt32LE(0xf35c6d01, 0);
      rpcResult.writeBigInt64LE(msgId, 4);
      rpcError.copy(rpcResult, 12);

      const serverMsgId = BigInt(Math.floor(Date.now() / 1000)) * 0x100000000n + 1n;
      (connection as any).processMessage(serverMsgId, 1, rpcResult);

      // The pending RPC should be rejected
      await expect(rpcPromise).rejects.toThrow('PHONE_MIGRATE_2');

      // A migration error should also have been emitted
      expect(emittedErrors.length).toBe(1);
      expect(emittedErrors[0]!.message).toContain('PHONE_MIGRATE_2');
    });
  });

  describe('disconnect', () => {
    it('should cancel all pending RPCs on disconnect', async () => {
      const { connection, session } = setupConnection();

      const msgId = session.nextMsgId();
      const rpcPromise = (connection as any).rpcHandler.register(msgId, 'test.method');

      await connection.disconnect();

      await expect(rpcPromise).rejects.toThrow('Connection disconnected');
      expect(connection.isConnected()).toBe(false);
    });

    it('should clean up transport on disconnect', async () => {
      const { connection } = setupConnection();

      await connection.disconnect();

      expect(connection.getSession()).not.toBeNull(); // Session is preserved
      expect(connection.isConnected()).toBe(false);
    });

    it('should emit disconnected event', async () => {
      const { connection } = setupConnection();

      let disconnected = false;
      connection.on('disconnected', () => {
        disconnected = true;
      });

      await connection.disconnect();

      expect(disconnected).toBe(true);
    });
  });

  describe('send', () => {
    it('should encrypt and send data through transport', async () => {
      const { connection, session, mockTransport } = setupConnection();

      const data = Buffer.alloc(8);
      data.writeUInt32LE(0x12345678, 0);
      data.writeInt32LE(42, 4);

      const msgId = await connection.send(data, true);

      expect(typeof msgId).toBe('bigint');
      expect(msgId % 4n).toBe(0n); // msg_id must be divisible by 4
      expect(mockTransport.sent.length).toBe(1);

      // Verify we can decrypt the sent data
      const decrypted = decryptMessage({
        authKey: session.state.authKey,
        encrypted: mockTransport.sent[0]!,
        isClient: true,
      });

      expect(decrypted.sessionId).toBe(session.state.sessionId);
      expect(decrypted.data).toEqual(data);
    });

    it('should assign monotonically increasing msg_ids', async () => {
      const { connection } = setupConnection();

      const data = Buffer.alloc(4);
      data.writeUInt32LE(0x12345678, 0);

      const msgId1 = await connection.send(data, true);
      const msgId2 = await connection.send(data, true);
      const msgId3 = await connection.send(data, true);

      expect(msgId2).toBeGreaterThan(msgId1);
      expect(msgId3).toBeGreaterThan(msgId2);
    });
  });

  describe('handleIncoming with unencrypted messages', () => {
    it('should skip unencrypted messages (auth_key_id = 0)', () => {
      const { connection } = setupConnection();

      const errors: Error[] = [];
      connection.on('error', (err) => errors.push(err));

      // Build an unencrypted message (auth_key_id = 0)
      const unencrypted = Buffer.alloc(24);
      unencrypted.writeBigInt64LE(0n, 0); // auth_key_id = 0
      unencrypted.writeBigInt64LE(1n, 8); // msg_id
      unencrypted.writeInt32LE(0, 16);    // length

      (connection as any).handleIncoming(unencrypted);

      // Should not emit any errors (just silently skip)
      expect(errors.length).toBe(0);
    });
  });
});
