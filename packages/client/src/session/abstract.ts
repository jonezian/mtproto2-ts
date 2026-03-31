/**
 * Session data stored by SessionStorage implementations.
 */
export interface SessionData {
  dcId: number;
  authKey: Buffer;
  port: number;
  serverAddress: string;
}

/**
 * Abstract interface for session persistence.
 *
 * Implementations store the minimal data needed to resume
 * an authenticated MTProto connection: the DC id, server address,
 * port, and the 256-byte auth key.
 */
export interface SessionStorage {
  /** Load a previously saved session, or null if none exists. */
  load(): Promise<SessionData | null>;

  /** Persist session data. */
  save(data: SessionData): Promise<void>;

  /** Delete the stored session. */
  delete(): Promise<void>;
}
