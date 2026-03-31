import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiHandlers } from './http-api.js';
import type { ApiHandlers } from './http-api.js';
import type { BotPool } from './bot-pool.js';
import type { ContactPool, ContactEntry } from './contact-pool.js';
import type { RateLimiter } from './rate-limiter.js';
import type { TelegramClient } from '@mtproto2/client';

function createMockClient(name: string): TelegramClient {
  return {
    apiId: 12345,
    apiHash: 'test',
    _name: name,
  } as unknown as TelegramClient;
}

function createMockPool(): BotPool & {
  getAvailableBot: ReturnType<typeof vi.fn>;
  getBotName: ReturnType<typeof vi.fn>;
  getBotCount: ReturnType<typeof vi.fn>;
  getConnectedCount: ReturnType<typeof vi.fn>;
} {
  const client = createMockClient('bot1');

  return {
    getAvailableBot: vi.fn(() => client),
    getBotName: vi.fn(() => 'bot1'),
    getBot: vi.fn(() => client),
    getBotCount: vi.fn(() => 3),
    getConnectedCount: vi.fn(() => 3),
    connectAll: vi.fn(async () => {}),
    disconnectAll: vi.fn(async () => {}),
    onUpdate: vi.fn(),
  } as unknown as BotPool & {
    getAvailableBot: ReturnType<typeof vi.fn>;
    getBotName: ReturnType<typeof vi.fn>;
    getBotCount: ReturnType<typeof vi.fn>;
    getConnectedCount: ReturnType<typeof vi.fn>;
  };
}

function createMockContactPool(): ContactPool & {
  resolve: ReturnType<typeof vi.fn>;
} {
  return {
    resolve: vi.fn(async (username: string): Promise<ContactEntry> => ({
      userId: 12345n,
      accessHash: 67890n,
      username,
      lastUsed: Date.now(),
    })),
    resolveById: vi.fn(),
    evict: vi.fn(),
    clear: vi.fn(),
    size: 0,
  } as unknown as ContactPool & {
    resolve: ReturnType<typeof vi.fn>;
  };
}

function createMockRateLimiter(): RateLimiter & {
  canProceed: ReturnType<typeof vi.fn>;
  recordCall: ReturnType<typeof vi.fn>;
  waitForCooldown: ReturnType<typeof vi.fn>;
} {
  return {
    canProceed: vi.fn(() => true),
    recordCall: vi.fn(),
    waitForCooldown: vi.fn(async () => {}),
    setFloodWait: vi.fn(),
    getWaitTime: vi.fn(() => 0),
    reset: vi.fn(),
  } as unknown as RateLimiter & {
    canProceed: ReturnType<typeof vi.fn>;
    recordCall: ReturnType<typeof vi.fn>;
    waitForCooldown: ReturnType<typeof vi.fn>;
  };
}

describe('http-api handlers', () => {
  let handlers: ApiHandlers;
  let pool: ReturnType<typeof createMockPool>;
  let contactPool: ReturnType<typeof createMockContactPool>;
  let rateLimiter: ReturnType<typeof createMockRateLimiter>;

  beforeEach(() => {
    pool = createMockPool();
    contactPool = createMockContactPool();
    rateLimiter = createMockRateLimiter();
    handlers = createApiHandlers(pool, contactPool, rateLimiter);
  });

  describe('joinChannel', () => {
    it('should return success response', async () => {
      const result = await handlers.joinChannel({ channelId: 'test_channel' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ channelId: 'test_channel', joined: true }),
      );
    });

    it('should use join rate limiting', async () => {
      await handlers.joinChannel({ channelId: 'ch1' });
      expect(rateLimiter.canProceed).toHaveBeenCalledWith('bot1', 'join');
      expect(rateLimiter.recordCall).toHaveBeenCalledWith('bot1', 'join');
    });

    it('should wait for cooldown when rate limited', async () => {
      rateLimiter.canProceed.mockReturnValue(false);
      await handlers.joinChannel({ channelId: 'ch1' });
      expect(rateLimiter.waitForCooldown).toHaveBeenCalledWith('bot1', 'join');
    });
  });

  describe('leaveChannel', () => {
    it('should return success response', async () => {
      const result = await handlers.leaveChannel({ channelId: 'ch1' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ channelId: 'ch1', left: true }),
      );
    });
  });

  describe('getParticipants', () => {
    it('should return success with default options', async () => {
      const result = await handlers.getParticipants({ channelId: 'ch1' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ channelId: 'ch1', offset: 0, limit: 200 }),
      );
    });

    it('should pass through custom options', async () => {
      const result = await handlers.getParticipants({
        channelId: 'ch1',
        offset: 10,
        limit: 50,
      });
      expect(result.data).toEqual(
        expect.objectContaining({ offset: 10, limit: 50 }),
      );
    });
  });

  describe('resolveUsername', () => {
    it('should resolve through contactPool', async () => {
      const result = await handlers.resolveUsername({ username: 'alice' });
      expect(result.success).toBe(true);
      expect(contactPool.resolve).toHaveBeenCalledWith('alice');
      expect(result.data).toEqual(
        expect.objectContaining({
          userId: '12345',
          accessHash: '67890',
          username: 'alice',
        }),
      );
    });

    it('should return error when resolution fails', async () => {
      contactPool.resolve.mockRejectedValue(new Error('User not found'));
      const result = await handlers.resolveUsername({ username: 'unknown' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not found');
    });
  });

  describe('importContacts', () => {
    it('should return success with import count', async () => {
      const result = await handlers.importContacts({
        contacts: [
          { phone: '+111', firstName: 'Alice', lastName: 'A' },
          { phone: '+222', firstName: 'Bob', lastName: 'B' },
        ],
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ imported: 2 }));
    });
  });

  describe('searchGlobal', () => {
    it('should use search rate limiting', async () => {
      await handlers.searchGlobal({ query: 'test' });
      expect(rateLimiter.canProceed).toHaveBeenCalledWith('bot1', 'search');
      expect(rateLimiter.recordCall).toHaveBeenCalledWith('bot1', 'search');
    });

    it('should return success with query info', async () => {
      const result = await handlers.searchGlobal({ query: 'test', limit: 50 });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ query: 'test', limit: 50 }),
      );
    });

    it('should default limit to 100', async () => {
      const result = await handlers.searchGlobal({ query: 'test' });
      expect(result.data).toEqual(expect.objectContaining({ limit: 100 }));
    });
  });

  describe('searchContacts', () => {
    it('should use search rate limiting', async () => {
      await handlers.searchContacts({ query: 'test' });
      expect(rateLimiter.canProceed).toHaveBeenCalledWith('bot1', 'search');
    });

    it('should default limit to 50', async () => {
      const result = await handlers.searchContacts({ query: 'test' });
      expect(result.data).toEqual(expect.objectContaining({ limit: 50 }));
    });
  });

  describe('getFullUser', () => {
    it('should return success with userId', async () => {
      const result = await handlers.getFullUser({ userId: '123' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ userId: '123' }));
    });
  });

  describe('getCommonChats', () => {
    it('should return success with userId', async () => {
      const result = await handlers.getCommonChats({ userId: '123' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ userId: '123' }));
    });
  });

  describe('getMessages', () => {
    it('should return success with channel and message IDs', async () => {
      const result = await handlers.getMessages({
        channelId: 'ch1',
        ids: [1, 2, 3],
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ channelId: 'ch1', ids: [1, 2, 3] }),
      );
    });
  });

  describe('getHistory', () => {
    it('should return success with default limit', async () => {
      const result = await handlers.getHistory({ channelId: 'ch1' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ channelId: 'ch1', limit: 100 }),
      );
    });

    it('should pass custom limit', async () => {
      const result = await handlers.getHistory({ channelId: 'ch1', limit: 20 });
      expect(result.data).toEqual(expect.objectContaining({ limit: 20 }));
    });
  });

  describe('sendMessage', () => {
    it('should return success with peer and text', async () => {
      const result = await handlers.sendMessage({
        peerId: 'peer1',
        text: 'hello',
      });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ peerId: 'peer1', text: 'hello' }),
      );
    });
  });

  describe('getEntity', () => {
    it('should return success with entityId', async () => {
      const result = await handlers.getEntity({ entityId: 'ent1' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ entityId: 'ent1' }));
    });
  });

  describe('getDialogs', () => {
    it('should return success with default limit', async () => {
      const result = await handlers.getDialogs({});
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ limit: 100 }));
    });

    it('should pass custom limit', async () => {
      const result = await handlers.getDialogs({ limit: 10 });
      expect(result.data).toEqual(expect.objectContaining({ limit: 10 }));
    });
  });

  describe('downloadMedia', () => {
    it('should return success with location', async () => {
      const result = await handlers.downloadMedia({ location: 'loc1' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ location: 'loc1' }),
      );
    });
  });

  describe('healthCheck', () => {
    it('should return ok status when bots are connected', async () => {
      const result = await handlers.healthCheck();
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          status: 'ok',
          totalBots: 3,
          connectedBots: 3,
        }),
      );
    });

    it('should return degraded status when no bots are connected', async () => {
      pool.getConnectedCount.mockReturnValue(0);
      const result = await handlers.healthCheck();
      expect(result.success).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({ status: 'degraded', connectedBots: 0 }),
      );
    });
  });

  describe('error handling', () => {
    it('should catch errors and return error response', async () => {
      pool.getAvailableBot.mockImplementation(() => {
        throw new Error('No connected bots available');
      });

      const result = await handlers.joinChannel({ channelId: 'ch1' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('No connected bots available');
    });

    it('should handle non-Error throws', async () => {
      pool.getAvailableBot.mockImplementation(() => {
        throw 'string error';
      });

      const result = await handlers.getHistory({ channelId: 'ch1' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('string error');
    });
  });

  describe('bot selection', () => {
    it('should get a bot from the pool for each call', async () => {
      await handlers.getHistory({ channelId: 'ch1' });
      await handlers.sendMessage({ peerId: 'p1', text: 'hi' });

      expect(pool.getAvailableBot).toHaveBeenCalledTimes(2);
    });

    it('should include bot name in response data', async () => {
      const result = await handlers.getHistory({ channelId: 'ch1' });
      expect(result.data).toEqual(expect.objectContaining({ bot: 'bot1' }));
    });
  });
});
