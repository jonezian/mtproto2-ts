import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleNewMessage,
  handleMessageDeleted,
  handleMessageEdited,
  handleChatAction,
  setupEventHandlers,
} from './event-handlers.js';
import type {
  RawNewMessageUpdate,
  RawDeletionUpdate,
  RawEditUpdate,
  RawChatActionUpdate,
} from './event-handlers.js';
import type { RedisPublisher } from './publisher.js';
import type { TelegramClient } from '@mtproto2/client';

function createMockPublisher(): RedisPublisher & {
  publishTelegramMessage: ReturnType<typeof vi.fn>;
  publishDeletion: ReturnType<typeof vi.fn>;
  publishMessage: ReturnType<typeof vi.fn>;
} {
  return {
    publishTelegramMessage: vi.fn(async () => '1-0'),
    publishDeletion: vi.fn(async () => '1-0'),
    publishMessage: vi.fn(async () => '1-0'),
    publishNostraEvent: vi.fn(async () => '1-0'),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    getRedisUrl: vi.fn(() => 'redis://localhost:6379'),
  } as unknown as RedisPublisher & {
    publishTelegramMessage: ReturnType<typeof vi.fn>;
    publishDeletion: ReturnType<typeof vi.fn>;
    publishMessage: ReturnType<typeof vi.fn>;
  };
}

function createMockBot(): TelegramClient {
  return {
    on: vi.fn(() => ({})),
    off: vi.fn(() => ({})),
    once: vi.fn(() => ({})),
    emit: vi.fn(() => true),
  } as unknown as TelegramClient;
}

describe('event-handlers', () => {
  let publisher: ReturnType<typeof createMockPublisher>;

  beforeEach(() => {
    publisher = createMockPublisher();
  });

  describe('handleNewMessage', () => {
    it('should publish a new message to the publisher', async () => {
      const update: RawNewMessageUpdate = {
        messageId: 42,
        chatId: '-100123',
        text: 'hello world',
        date: 1700000000,
        fromId: '456',
        fromUsername: 'alice',
      };

      await handleNewMessage(update, publisher, 'bot1');

      expect(publisher.publishTelegramMessage).toHaveBeenCalledOnce();
      const payload = publisher.publishTelegramMessage.mock.calls[0]![0];
      expect(payload.messageId).toBe(42);
      expect(payload.chatId).toBe('-100123');
      expect(payload.text).toBe('hello world');
      expect(payload.date).toBe(1700000000);
      expect(payload.fromId).toBe('456');
      expect(payload.fromUsername).toBe('alice');
      expect(payload.raw).toEqual({ botName: 'bot1' });
    });

    it('should handle messages without optional fields', async () => {
      const update: RawNewMessageUpdate = {
        messageId: 1,
        chatId: '-100',
        date: 1000,
      };

      await handleNewMessage(update, publisher, 'bot1');

      const payload = publisher.publishTelegramMessage.mock.calls[0]![0];
      expect(payload.text).toBeUndefined();
      expect(payload.fromId).toBeUndefined();
    });

    it('should include replyToMsgId when present', async () => {
      const update: RawNewMessageUpdate = {
        messageId: 2,
        chatId: '-100',
        date: 1000,
        replyToMsgId: 1,
      };

      await handleNewMessage(update, publisher, 'bot1');

      const payload = publisher.publishTelegramMessage.mock.calls[0]![0];
      expect(payload.replyToMsgId).toBe(1);
    });

    it('should include mediaType when present', async () => {
      const update: RawNewMessageUpdate = {
        messageId: 3,
        chatId: '-100',
        date: 1000,
        mediaType: 'photo',
      };

      await handleNewMessage(update, publisher, 'bot1');

      const payload = publisher.publishTelegramMessage.mock.calls[0]![0];
      expect(payload.mediaType).toBe('photo');
    });
  });

  describe('handleMessageDeleted', () => {
    it('should publish a deletion event', async () => {
      const update: RawDeletionUpdate = {
        messageIds: [10, 20, 30],
        chatId: '-100456',
      };

      await handleMessageDeleted(update, publisher, 'bot1');

      expect(publisher.publishDeletion).toHaveBeenCalledOnce();
      const payload = publisher.publishDeletion.mock.calls[0]![0];
      expect(payload.messageIds).toEqual([10, 20, 30]);
      expect(payload.chatId).toBe('-100456');
    });

    it('should handle single message deletion', async () => {
      const update: RawDeletionUpdate = {
        messageIds: [42],
        chatId: '-100',
      };

      await handleMessageDeleted(update, publisher, 'bot1');

      const payload = publisher.publishDeletion.mock.calls[0]![0];
      expect(payload.messageIds).toEqual([42]);
    });
  });

  describe('handleMessageEdited', () => {
    it('should publish an edit event as a telegram message', async () => {
      const update: RawEditUpdate = {
        messageId: 42,
        chatId: '-100123',
        text: 'edited text',
        date: 1700000000,
        fromId: '456',
        editDate: 1700001000,
      };

      await handleMessageEdited(update, publisher, 'bot1');

      expect(publisher.publishTelegramMessage).toHaveBeenCalledOnce();
      const payload = publisher.publishTelegramMessage.mock.calls[0]![0];
      expect(payload.messageId).toBe(42);
      expect(payload.text).toBe('edited text');
      expect(payload.raw).toEqual({
        botName: 'bot1',
        editDate: 1700001000,
        isEdit: true,
      });
    });

    it('should mark the raw payload as an edit', async () => {
      const update: RawEditUpdate = {
        messageId: 1,
        chatId: '-100',
        date: 1000,
      };

      await handleMessageEdited(update, publisher, 'bot2');

      const payload = publisher.publishTelegramMessage.mock.calls[0]![0];
      expect(payload.raw.isEdit).toBe(true);
      expect(payload.raw.botName).toBe('bot2');
    });
  });

  describe('handleChatAction', () => {
    it('should publish a chat action event', async () => {
      const update: RawChatActionUpdate = {
        chatId: '-100123',
        userId: '456',
        action: 'join',
        date: 1700000000,
      };

      await handleChatAction(update, publisher, 'bot1');

      expect(publisher.publishMessage).toHaveBeenCalledOnce();
      expect(publisher.publishMessage).toHaveBeenCalledWith(
        'telegram-actions',
        expect.objectContaining({
          chatId: '-100123',
          userId: '456',
          action: 'join',
          date: '1700000000',
          botName: 'bot1',
        }),
      );
    });

    it('should handle actions without userId', async () => {
      const update: RawChatActionUpdate = {
        chatId: '-100',
        action: 'leave',
        date: 1000,
      };

      await handleChatAction(update, publisher, 'bot1');

      const [, fields] = publisher.publishMessage.mock.calls[0]!;
      expect(fields.userId).toBeUndefined();
    });
  });

  describe('setupEventHandlers', () => {
    it('should return an EventHandlerSet', () => {
      const bot = createMockBot();
      const handlers = setupEventHandlers(bot, publisher, 'bot1');

      expect(handlers.onNewMessage).toBeTypeOf('function');
      expect(handlers.onMessageDeleted).toBeTypeOf('function');
      expect(handlers.onMessageEdited).toBeTypeOf('function');
      expect(handlers.onChatAction).toBeTypeOf('function');
    });

    it('should register an update listener on the bot', () => {
      const bot = createMockBot();
      setupEventHandlers(bot, publisher, 'bot1');

      expect(bot.on).toHaveBeenCalledWith('update', expect.any(Function));
    });

    it('should dispatch new messages through the handler', async () => {
      const bot = createMockBot();
      const handlers = setupEventHandlers(bot, publisher, 'bot1');

      await handlers.onNewMessage({
        messageId: 1,
        chatId: '-100',
        date: 1000,
        text: 'test',
      });

      expect(publisher.publishTelegramMessage).toHaveBeenCalledOnce();
    });

    it('should dispatch deletions through the handler', async () => {
      const bot = createMockBot();
      const handlers = setupEventHandlers(bot, publisher, 'bot1');

      await handlers.onMessageDeleted({
        messageIds: [1, 2],
        chatId: '-100',
      });

      expect(publisher.publishDeletion).toHaveBeenCalledOnce();
    });

    it('should dispatch edits through the handler', async () => {
      const bot = createMockBot();
      const handlers = setupEventHandlers(bot, publisher, 'bot1');

      await handlers.onMessageEdited({
        messageId: 1,
        chatId: '-100',
        date: 1000,
        text: 'edited',
      });

      expect(publisher.publishTelegramMessage).toHaveBeenCalledOnce();
    });

    it('should dispatch chat actions through the handler', async () => {
      const bot = createMockBot();
      const handlers = setupEventHandlers(bot, publisher, 'bot1');

      await handlers.onChatAction({
        chatId: '-100',
        action: 'join',
        date: 1000,
      });

      expect(publisher.publishMessage).toHaveBeenCalledOnce();
    });
  });
});
