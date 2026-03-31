import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContactPool } from './contact-pool.js';
import type { ContactEntry } from './contact-pool.js';
import type { TelegramClient } from '@kerainmtp/client';

function createMockClient(): TelegramClient {
  return {} as unknown as TelegramClient;
}

function createMockResolveFn(): ReturnType<typeof vi.fn> {
  let nextId = 1n;
  return vi.fn(async (_client: TelegramClient, username: string): Promise<ContactEntry> => {
    const id = nextId++;
    return {
      userId: id,
      accessHash: id * 100n,
      username,
      lastUsed: Date.now(),
    };
  });
}

describe('ContactPool', () => {
  let pool: ContactPool;
  let client: TelegramClient;
  let resolveFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = createMockClient();
    resolveFn = createMockResolveFn();
    pool = new ContactPool({ maxSize: 3, client }, resolveFn);
  });

  describe('resolve', () => {
    it('should resolve a username and cache the result', async () => {
      const entry = await pool.resolve('alice');
      expect(entry).toBeDefined();
      expect(entry.username).toBe('alice');
      expect(entry.userId).toBe(1n);
      expect(pool.size).toBe(1);
    });

    it('should return cached result on second call', async () => {
      const first = await pool.resolve('alice');
      const second = await pool.resolve('alice');

      expect(first.userId).toBe(second.userId);
      // resolveFn should only be called once
      expect(resolveFn).toHaveBeenCalledTimes(1);
    });

    it('should normalize usernames to lowercase', async () => {
      await pool.resolve('Alice');
      const entry = await pool.resolve('alice');

      expect(resolveFn).toHaveBeenCalledTimes(1);
      expect(entry.username).toBe('alice');
    });

    it('should update lastUsed on cache hit', async () => {
      await pool.resolve('alice');
      const before = (await pool.resolve('alice')).lastUsed;

      // Small delay
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const after = (await pool.resolve('alice')).lastUsed;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('should call resolveFn with the client', async () => {
      await pool.resolve('bob');
      expect(resolveFn).toHaveBeenCalledWith(client, 'bob');
    });
  });

  describe('resolveById', () => {
    it('should return a cached entry by user ID', async () => {
      const entry = await pool.resolve('alice');
      const found = pool.resolveById(entry.userId);

      expect(found).toBeDefined();
      expect(found!.username).toBe('alice');
    });

    it('should return undefined for unknown user ID', () => {
      expect(pool.resolveById(999n)).toBeUndefined();
    });

    it('should update lastUsed on cache hit', async () => {
      const entry = await pool.resolve('alice');
      const before = entry.lastUsed;

      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      const found = pool.resolveById(entry.userId);
      expect(found!.lastUsed).toBeGreaterThanOrEqual(before);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entry when exceeding maxSize', async () => {
      vi.useFakeTimers();
      try {
        // maxSize is 3
        await pool.resolve('alice'); // userId=1, time=0
        vi.advanceTimersByTime(10);
        await pool.resolve('bob');   // userId=2, time=10
        vi.advanceTimersByTime(10);
        await pool.resolve('carol'); // userId=3, time=20

        vi.advanceTimersByTime(10);
        // Access alice to make it recently used (time=30)
        await pool.resolve('alice');

        vi.advanceTimersByTime(10);
        // Adding a 4th should evict bob (least recently used at time=10)
        await pool.resolve('dave'); // userId=4, time=40

        expect(pool.size).toBe(3);
        expect(pool.resolveById(2n)).toBeUndefined(); // bob evicted
        expect(pool.resolveById(1n)).toBeDefined(); // alice kept (recently used)
        expect(pool.resolveById(3n)).toBeDefined(); // carol kept
        expect(pool.resolveById(4n)).toBeDefined(); // dave added
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not evict when at maxSize', async () => {
      await pool.resolve('alice');
      await pool.resolve('bob');
      await pool.resolve('carol');

      expect(pool.size).toBe(3);
      // All should still be present
      expect(pool.resolveById(1n)).toBeDefined();
      expect(pool.resolveById(2n)).toBeDefined();
      expect(pool.resolveById(3n)).toBeDefined();
    });
  });

  describe('evict', () => {
    it('should remove a specific entry by username', async () => {
      await pool.resolve('alice');
      expect(pool.size).toBe(1);

      const result = pool.evict('alice');
      expect(result).toBe(true);
      expect(pool.size).toBe(0);
    });

    it('should return false for non-existent username', () => {
      expect(pool.evict('nonexistent')).toBe(false);
    });

    it('should remove from both username and ID index', async () => {
      const entry = await pool.resolve('alice');
      pool.evict('alice');

      expect(pool.resolveById(entry.userId)).toBeUndefined();
    });

    it('should normalize username for eviction', async () => {
      await pool.resolve('Alice');
      expect(pool.evict('ALICE')).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      await pool.resolve('alice');
      await pool.resolve('bob');
      await pool.resolve('carol');

      pool.clear();
      expect(pool.size).toBe(0);
    });

    it('should handle clearing an empty pool', () => {
      pool.clear();
      expect(pool.size).toBe(0);
    });
  });

  describe('size', () => {
    it('should return 0 for empty pool', () => {
      expect(pool.size).toBe(0);
    });

    it('should track the correct size', async () => {
      await pool.resolve('alice');
      expect(pool.size).toBe(1);

      await pool.resolve('bob');
      expect(pool.size).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should throw when resolveFn is not provided', async () => {
      const poolNoFn = new ContactPool({ maxSize: 3, client });
      await expect(poolNoFn.resolve('alice')).rejects.toThrow(
        'ResolveFn is required for resolve operations',
      );
    });
  });
});
