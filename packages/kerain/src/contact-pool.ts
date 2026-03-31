import type { TelegramClient } from '@kerainmtp/client';

/**
 * A cached contact entry with LRU tracking.
 */
export interface ContactEntry {
  userId: bigint;
  accessHash: bigint;
  username: string;
  lastUsed: number;
}

/**
 * Options for constructing a ContactPool.
 */
export interface ContactPoolOptions {
  maxSize: number;
  client: TelegramClient;
}

/**
 * Contact resolution function type.
 * Used for dependency injection in testing.
 */
export type ResolveFn = (client: TelegramClient, username: string) => Promise<ContactEntry>;

/**
 * Contact pool with LRU eviction.
 *
 * Manages a pool of Telegram contacts resolved by username,
 * with LRU eviction when the pool exceeds maxSize.
 */
export class ContactPool {
  private readonly cache: Map<string, ContactEntry> = new Map();
  private readonly idIndex: Map<bigint, ContactEntry> = new Map();
  private readonly maxSize: number;
  private readonly client: TelegramClient;
  private readonly resolveFn: ResolveFn | undefined;

  constructor(options: ContactPoolOptions, resolveFn?: ResolveFn) {
    this.maxSize = options.maxSize;
    this.client = options.client;
    this.resolveFn = resolveFn;
  }

  /**
   * Resolve a username to a contact entry.
   *
   * If the username is already cached, updates the lastUsed timestamp
   * and returns the cached entry. Otherwise, resolves the username
   * via the Telegram API, caches the result, and performs LRU eviction
   * if needed.
   *
   * @param username - The username to resolve (without @ prefix)
   * @returns The contact entry
   */
  async resolve(username: string): Promise<ContactEntry> {
    const normalized = username.toLowerCase();

    const existing = this.cache.get(normalized);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }

    let entry: ContactEntry;
    if (this.resolveFn) {
      entry = await this.resolveFn(this.client, normalized);
    } else {
      throw new Error('ResolveFn is required for resolve operations');
    }

    entry.lastUsed = Date.now();
    this.cache.set(normalized, entry);
    this.idIndex.set(entry.userId, entry);

    this.evictIfNeeded();

    return entry;
  }

  /**
   * Resolve a user by their ID from the cache.
   *
   * Only checks the cache -- does not make API calls.
   *
   * @param userId - The user ID
   * @returns The cached entry or undefined
   */
  resolveById(userId: bigint): ContactEntry | undefined {
    const entry = this.idIndex.get(userId);
    if (entry) {
      entry.lastUsed = Date.now();
    }
    return entry;
  }

  /**
   * Manually evict a username from the cache.
   *
   * @param username - The username to evict
   * @returns True if the entry was found and removed
   */
  evict(username: string): boolean {
    const normalized = username.toLowerCase();
    const entry = this.cache.get(normalized);
    if (!entry) return false;

    this.cache.delete(normalized);
    this.idIndex.delete(entry.userId);
    return true;
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.idIndex.clear();
  }

  /**
   * Current number of cached entries.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Evict the least recently used entry if the pool exceeds maxSize.
   */
  private evictIfNeeded(): void {
    while (this.cache.size > this.maxSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      for (const [key, entry] of this.cache) {
        if (entry.lastUsed < oldestTime) {
          oldestTime = entry.lastUsed;
          oldestKey = key;
        }
      }

      if (oldestKey !== null) {
        const entry = this.cache.get(oldestKey)!;
        this.cache.delete(oldestKey);
        this.idIndex.delete(entry.userId);
      }
    }
  }
}
