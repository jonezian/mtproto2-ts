import type { SessionStorage, SessionData } from './abstract.js';

/**
 * In-memory session storage.
 *
 * Session data is lost when the process exits.
 * Useful for testing and short-lived scripts.
 */
export class MemorySession implements SessionStorage {
  private data: SessionData | null = null;

  async load(): Promise<SessionData | null> {
    if (!this.data) return null;
    // Return a defensive copy so external mutations don't affect stored data
    return {
      dcId: this.data.dcId,
      authKey: Buffer.from(this.data.authKey),
      port: this.data.port,
      serverAddress: this.data.serverAddress,
    };
  }

  async save(data: SessionData): Promise<void> {
    this.data = {
      dcId: data.dcId,
      authKey: Buffer.from(data.authKey),
      port: data.port,
      serverAddress: data.serverAddress,
    };
  }

  async delete(): Promise<void> {
    this.data = null;
  }
}
