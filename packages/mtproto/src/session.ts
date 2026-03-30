import crypto from 'node:crypto';
import { SeqNoTracker } from './seq-no.js';
import { MsgIdGenerator } from './msg-id.js';

/**
 * Session state for an MTProto connection.
 */
export interface SessionState {
  authKey: Buffer;           // 256-byte auth key
  authKeyId: Buffer;         // 8-byte auth key id (SHA1(authKey)[12:20])
  salt: bigint;              // Current server salt
  sessionId: bigint;         // Random 64-bit session ID
  timeOffset: number;        // Server time - local time (seconds)
  seqNoTracker: SeqNoTracker;
  msgIdGenerator: MsgIdGenerator;
}

/**
 * Generate a random 64-bit session ID as a signed bigint (little-endian).
 */
function generateSessionId(): bigint {
  const buf = crypto.randomBytes(8);
  return buf.readBigInt64LE(0);
}

/**
 * Session manages the state for an MTProto encrypted session.
 *
 * Each session has a unique session_id, its own sequence number tracker,
 * and message ID generator. The session ties together the auth key,
 * server salt, and time offset needed for encryption/decryption.
 */
export class Session {
  state: SessionState;

  constructor(authKey: Buffer, authKeyId: Buffer, salt: bigint, timeOffset: number) {
    const seqNoTracker = new SeqNoTracker();
    const msgIdGenerator = new MsgIdGenerator();
    msgIdGenerator.setTimeOffset(timeOffset);

    this.state = {
      authKey,
      authKeyId,
      salt,
      sessionId: generateSessionId(),
      timeOffset,
      seqNoTracker,
      msgIdGenerator,
    };
  }

  /**
   * Reset session: generate a new session_id and reset sequence numbers.
   * This is needed when the server indicates the session is invalid,
   * or when reconnecting after a long disconnection.
   */
  reset(): void {
    this.state.sessionId = generateSessionId();
    this.state.seqNoTracker.reset();
    // Create a fresh MsgIdGenerator to reset the lastMsgId counter
    this.state.msgIdGenerator = new MsgIdGenerator();
    this.state.msgIdGenerator.setTimeOffset(this.state.timeOffset);
  }

  /**
   * Generate next msg_id for outgoing messages.
   */
  nextMsgId(): bigint {
    return this.state.msgIdGenerator.generate();
  }

  /**
   * Generate next seq_no for outgoing messages.
   */
  nextSeqNo(contentRelated: boolean): number {
    return this.state.seqNoTracker.next(contentRelated);
  }

  /**
   * Update the server salt.
   */
  updateSalt(newSalt: bigint): void {
    this.state.salt = newSalt;
  }

  /**
   * Update the time offset (server time - local time) in seconds.
   * Also updates the msg_id generator to use the new offset.
   */
  updateTimeOffset(offset: number): void {
    this.state.timeOffset = offset;
    this.state.msgIdGenerator.setTimeOffset(offset);
  }

  /**
   * Serialize session state for persistence.
   *
   * Format:
   *   authKey (256 bytes)
   *   authKeyId (8 bytes)
   *   salt (8 bytes, LE)
   *   sessionId (8 bytes, LE)
   *   timeOffset (4 bytes, LE signed int32)
   *
   * Total: 284 bytes
   *
   * Note: seqNoTracker and msgIdGenerator are transient state
   * that gets recreated on deserialization (reset to initial values).
   */
  serialize(): Buffer {
    const buf = Buffer.alloc(284);
    let offset = 0;

    this.state.authKey.copy(buf, offset);
    offset += 256;

    this.state.authKeyId.copy(buf, offset);
    offset += 8;

    buf.writeBigInt64LE(this.state.salt, offset);
    offset += 8;

    buf.writeBigInt64LE(this.state.sessionId, offset);
    offset += 8;

    buf.writeInt32LE(this.state.timeOffset, offset);

    return buf;
  }

  /**
   * Restore a session from serialized state.
   * The session_id is preserved from the serialized data (not regenerated).
   * seqNoTracker and msgIdGenerator are reset to initial state.
   */
  static deserialize(data: Buffer): Session {
    if (data.length < 284) {
      throw new Error(`Session data too short: expected 284 bytes, got ${data.length}`);
    }

    let offset = 0;

    const authKey = Buffer.alloc(256);
    data.copy(authKey, 0, offset, offset + 256);
    offset += 256;

    const authKeyId = Buffer.alloc(8);
    data.copy(authKeyId, 0, offset, offset + 8);
    offset += 8;

    const salt = data.readBigInt64LE(offset);
    offset += 8;

    const sessionId = data.readBigInt64LE(offset);
    offset += 8;

    const timeOffset = data.readInt32LE(offset);

    const session = new Session(authKey, authKeyId, salt, timeOffset);
    // Restore the serialized session_id instead of the randomly generated one
    session.state.sessionId = sessionId;

    return session;
  }
}
