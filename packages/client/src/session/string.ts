import type { SessionStorage, SessionData } from './abstract.js';

/**
 * String-based session storage using base64 encoding.
 *
 * The session is serialized into a compact binary format and then
 * base64-encoded into a portable string. This is compatible with the
 * Telethon StringSession format:
 *
 * Layout (1 + 2 + 2 + 256 + N bytes):
 *   version     (1 byte)  — currently 1
 *   dcId        (2 bytes, BE)
 *   port        (2 bytes, BE)
 *   authKey     (256 bytes)
 *   serverAddr  (remaining bytes, UTF-8 string)
 *
 * The entire buffer is base64-encoded to produce the session string.
 */
export class StringSession implements SessionStorage {
  private sessionString: string;

  /**
   * Create a StringSession.
   * @param session - An existing base64-encoded session string, or empty string for new session.
   */
  constructor(session: string = '') {
    this.sessionString = session;
  }

  async load(): Promise<SessionData | null> {
    if (!this.sessionString) return null;

    const buf = Buffer.from(this.sessionString, 'base64');
    if (buf.length < 261) {
      throw new Error(
        `Invalid session string: expected at least 261 bytes, got ${buf.length}`,
      );
    }

    const version = buf[0]!;
    if (version !== 1) {
      throw new Error(`Unsupported session string version: ${version}`);
    }

    const dcId = buf.readUInt16BE(1);
    const port = buf.readUInt16BE(3);
    const authKey = Buffer.alloc(256);
    buf.copy(authKey, 0, 5, 261);
    const serverAddress = buf.subarray(261).toString('utf-8');

    return { dcId, port, authKey, serverAddress };
  }

  async save(data: SessionData): Promise<void> {
    const addrBuf = Buffer.from(data.serverAddress, 'utf-8');
    const buf = Buffer.alloc(261 + addrBuf.length);

    buf[0] = 1; // version
    buf.writeUInt16BE(data.dcId, 1);
    buf.writeUInt16BE(data.port, 3);
    data.authKey.copy(buf, 5, 0, 256);
    addrBuf.copy(buf, 261);

    this.sessionString = buf.toString('base64');
  }

  async delete(): Promise<void> {
    this.sessionString = '';
  }

  /**
   * Get the current session string (for persistence by the caller).
   */
  getSessionString(): string {
    return this.sessionString;
  }
}
