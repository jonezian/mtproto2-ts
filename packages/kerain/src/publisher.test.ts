import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisPublisher } from './publisher.js';
import type { RedisClient, TelegramMessagePayload, DeletionPayload, NostraEventPayload } from './publisher.js';

function createMockRedisClient(): RedisClient & {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  xAdd: ReturnType<typeof vi.fn>;
} {
  return {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    xAdd: vi.fn(async (_stream: string, _id: string, _fields: Record<string, string>) => {
      return '1234567890-0';
    }),
  };
}

describe('RedisPublisher', () => {
  let redis: ReturnType<typeof createMockRedisClient>;
  let publisher: RedisPublisher;

  beforeEach(() => {
    redis = createMockRedisClient();
    publisher = new RedisPublisher({ client: redis });
  });

  describe('constructor', () => {
    it('should use default Redis URL', () => {
      const p = new RedisPublisher({ client: redis });
      expect(p.getRedisUrl()).toBe('redis://localhost:6379');
    });

    it('should accept custom Redis URL', () => {
      const p = new RedisPublisher({ redisUrl: 'redis://custom:1234', client: redis });
      expect(p.getRedisUrl()).toBe('redis://custom:1234');
    });
  });

  describe('connect', () => {
    it('should call connect on the Redis client', async () => {
      await publisher.connect();
      expect(redis.connect).toHaveBeenCalledOnce();
    });

    it('should mark as connected', async () => {
      await publisher.connect();
      expect(publisher.isConnected()).toBe(true);
    });

    it('should throw when no Redis client is provided', async () => {
      const p = new RedisPublisher();
      await expect(p.connect()).rejects.toThrow('No Redis client provided');
    });
  });

  describe('disconnect', () => {
    it('should call disconnect on the Redis client', async () => {
      await publisher.connect();
      await publisher.disconnect();
      expect(redis.disconnect).toHaveBeenCalledOnce();
    });

    it('should mark as disconnected', async () => {
      await publisher.connect();
      await publisher.disconnect();
      expect(publisher.isConnected()).toBe(false);
    });

    it('should be safe to call when not connected', async () => {
      await publisher.disconnect(); // should not throw
      expect(publisher.isConnected()).toBe(false);
    });
  });

  describe('publishMessage', () => {
    it('should throw when not connected', async () => {
      await expect(
        publisher.publishMessage('stream', { key: 'value' }),
      ).rejects.toThrow('Redis publisher is not connected');
    });

    it('should call xAdd with correct arguments', async () => {
      await publisher.connect();

      await publisher.publishMessage('my-stream', { foo: 'bar', baz: '42' });

      expect(redis.xAdd).toHaveBeenCalledWith(
        'my-stream',
        '*',
        { foo: 'bar', baz: '42' },
      );
    });

    it('should return the entry ID from Redis', async () => {
      await publisher.connect();

      const id = await publisher.publishMessage('stream', { key: 'val' });
      expect(id).toBe('1234567890-0');
    });
  });

  describe('publishTelegramMessage', () => {
    it('should publish to telegram-messages stream', async () => {
      await publisher.connect();

      const msg: TelegramMessagePayload = {
        messageId: 42,
        chatId: '-100123',
        date: 1700000000,
        text: 'hello world',
      };

      await publisher.publishTelegramMessage(msg);

      expect(redis.xAdd).toHaveBeenCalledWith(
        'telegram-messages',
        '*',
        expect.objectContaining({
          messageId: '42',
          chatId: '-100123',
          date: '1700000000',
          text: 'hello world',
        }),
      );
    });

    it('should include optional fields when present', async () => {
      await publisher.connect();

      const msg: TelegramMessagePayload = {
        messageId: 1,
        chatId: '-100',
        date: 1000,
        fromId: '12345',
        fromUsername: 'alice',
        replyToMsgId: 99,
        mediaType: 'photo',
      };

      await publisher.publishTelegramMessage(msg);

      expect(redis.xAdd).toHaveBeenCalledWith(
        'telegram-messages',
        '*',
        expect.objectContaining({
          fromId: '12345',
          fromUsername: 'alice',
          replyToMsgId: '99',
          mediaType: 'photo',
        }),
      );
    });

    it('should omit optional fields when undefined', async () => {
      await publisher.connect();

      const msg: TelegramMessagePayload = {
        messageId: 1,
        chatId: '-100',
        date: 1000,
      };

      await publisher.publishTelegramMessage(msg);

      const [, , fields] = redis.xAdd.mock.calls[0]!;
      expect(fields.text).toBeUndefined();
      expect(fields.fromId).toBeUndefined();
      expect(fields.fromUsername).toBeUndefined();
      expect(fields.replyToMsgId).toBeUndefined();
      expect(fields.mediaType).toBeUndefined();
      expect(fields.raw).toBeUndefined();
    });

    it('should JSON-serialize the raw field', async () => {
      await publisher.connect();

      const msg: TelegramMessagePayload = {
        messageId: 1,
        chatId: '-100',
        date: 1000,
        raw: { botName: 'bot1', extra: 42 },
      };

      await publisher.publishTelegramMessage(msg);

      const [, , fields] = redis.xAdd.mock.calls[0]!;
      expect(JSON.parse(fields.raw)).toEqual({ botName: 'bot1', extra: 42 });
    });
  });

  describe('publishDeletion', () => {
    it('should publish to telegram-deletions stream', async () => {
      await publisher.connect();

      const msg: DeletionPayload = {
        messageIds: [1, 2, 3],
        chatId: '-100123',
      };

      await publisher.publishDeletion(msg);

      expect(redis.xAdd).toHaveBeenCalledWith(
        'telegram-deletions',
        '*',
        {
          messageIds: '[1,2,3]',
          chatId: '-100123',
        },
      );
    });

    it('should JSON-serialize messageIds array', async () => {
      await publisher.connect();

      await publisher.publishDeletion({ messageIds: [42, 43], chatId: 'c1' });

      const [, , fields] = redis.xAdd.mock.calls[0]!;
      expect(JSON.parse(fields.messageIds)).toEqual([42, 43]);
    });
  });

  describe('publishNostraEvent', () => {
    it('should publish to nostra-events stream', async () => {
      await publisher.connect();

      const event: NostraEventPayload = {
        eventId: 'evt1',
        pubkey: 'pk1',
        kind: 1,
        content: 'hello nostra',
        createdAt: 1700000000,
      };

      await publisher.publishNostraEvent(event);

      expect(redis.xAdd).toHaveBeenCalledWith(
        'nostra-events',
        '*',
        expect.objectContaining({
          eventId: 'evt1',
          pubkey: 'pk1',
          kind: '1',
          content: 'hello nostra',
          createdAt: '1700000000',
        }),
      );
    });

    it('should JSON-serialize tags when present', async () => {
      await publisher.connect();

      const event: NostraEventPayload = {
        eventId: 'evt1',
        pubkey: 'pk1',
        kind: 1,
        content: 'tagged',
        createdAt: 1000,
        tags: [['p', 'pk2'], ['e', 'evt0']],
      };

      await publisher.publishNostraEvent(event);

      const [, , fields] = redis.xAdd.mock.calls[0]!;
      expect(JSON.parse(fields.tags)).toEqual([['p', 'pk2'], ['e', 'evt0']]);
    });

    it('should omit tags when undefined', async () => {
      await publisher.connect();

      const event: NostraEventPayload = {
        eventId: 'evt1',
        pubkey: 'pk1',
        kind: 1,
        content: 'no tags',
        createdAt: 1000,
      };

      await publisher.publishNostraEvent(event);

      const [, , fields] = redis.xAdd.mock.calls[0]!;
      expect(fields.tags).toBeUndefined();
    });
  });
});
