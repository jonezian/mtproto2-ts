import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShadowRunner } from './shadow-runner.js';
import type { TelegramClient } from '@mtproto2/client';
import type { RedisPublisher } from './publisher.js';

type UpdateHandler = (data: Buffer) => void;

interface MockClient {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  _handlers: Map<string, UpdateHandler[]>;
  _emit: (event: string, data: Buffer) => void;
}

function createMockClient(): MockClient {
  const handlers = new Map<string, UpdateHandler[]>();

  const client: Record<string, unknown> = {
    apiId: 12345,
    apiHash: 'abc123',
    isConnected: vi.fn(() => true),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    invoke: vi.fn(async () => Buffer.alloc(0)),
    getMe: vi.fn(async () => Buffer.alloc(0)),
    once: vi.fn(),
    emit: vi.fn(() => true),
    _handlers: handlers,
  };

  client.on = vi.fn((event: string, handler: UpdateHandler) => {
    const existing = handlers.get(event) ?? [];
    existing.push(handler);
    handlers.set(event, existing);
    return client;
  });

  client.off = vi.fn((event: string, handler: UpdateHandler) => {
    const existing = handlers.get(event) ?? [];
    const idx = existing.indexOf(handler);
    if (idx >= 0) existing.splice(idx, 1);
    handlers.set(event, existing);
    return client;
  });

  client._emit = (event: string, data: Buffer) => {
    const fns = handlers.get(event) ?? [];
    for (const fn of fns) fn(data);
  };

  return client as unknown as MockClient;
}

function createMockPublisher(connected = true): RedisPublisher & {
  publishMessage: ReturnType<typeof vi.fn>;
  isConnected: ReturnType<typeof vi.fn>;
} {
  return {
    publishMessage: vi.fn(async () => '1-0'),
    publishTelegramMessage: vi.fn(async () => '1-0'),
    publishDeletion: vi.fn(async () => '1-0'),
    publishNostraEvent: vi.fn(async () => '1-0'),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => connected),
    getRedisUrl: vi.fn(() => 'redis://localhost:6379'),
  } as unknown as RedisPublisher & {
    publishMessage: ReturnType<typeof vi.fn>;
    isConnected: ReturnType<typeof vi.fn>;
  };
}

describe('ShadowRunner', () => {
  let client: ReturnType<typeof createMockClient>;
  let publisher: ReturnType<typeof createMockPublisher>;
  let runner: ShadowRunner;

  beforeEach(() => {
    client = createMockClient();
    publisher = createMockPublisher();
    runner = new ShadowRunner({
      kerainClient: client as unknown as TelegramClient,
      pythonServiceUrl: 'http://localhost:5000',
      publisher: publisher as unknown as RedisPublisher,
    });
  });

  describe('constructor', () => {
    it('should use default stream name', () => {
      expect(runner.getStreamName()).toBe('telegram-messages-v2');
    });

    it('should accept custom stream name', () => {
      const custom = new ShadowRunner({
        kerainClient: client as unknown as TelegramClient,
        pythonServiceUrl: 'http://localhost:5000',
        publisher: publisher as unknown as RedisPublisher,
        streamName: 'custom-stream',
      });
      expect(custom.getStreamName()).toBe('custom-stream');
    });

    it('should store python service URL', () => {
      expect(runner.getPythonServiceUrl()).toBe('http://localhost:5000');
    });
  });

  describe('start', () => {
    it('should register an update handler on the client', async () => {
      await runner.start();
      expect(client.on).toHaveBeenCalledWith('update', expect.any(Function));
    });

    it('should mark runner as running', async () => {
      expect(runner.isRunning()).toBe(false);
      await runner.start();
      expect(runner.isRunning()).toBe(true);
    });

    it('should throw if already running', async () => {
      await runner.start();
      await expect(runner.start()).rejects.toThrow('already running');
    });

    it('should throw if publisher is not connected', async () => {
      const disconnectedPub = createMockPublisher(false);
      const r = new ShadowRunner({
        kerainClient: client as unknown as TelegramClient,
        pythonServiceUrl: 'http://localhost:5000',
        publisher: disconnectedPub as unknown as RedisPublisher,
      });

      await expect(r.start()).rejects.toThrow('publisher must be connected');
    });
  });

  describe('stop', () => {
    it('should remove the update handler', async () => {
      await runner.start();
      await runner.stop();
      expect(client.off).toHaveBeenCalledWith('update', expect.any(Function));
    });

    it('should mark runner as not running', async () => {
      await runner.start();
      await runner.stop();
      expect(runner.isRunning()).toBe(false);
    });

    it('should be safe to call when not running', async () => {
      await runner.stop(); // should not throw
      expect(runner.isRunning()).toBe(false);
    });

    it('should be safe to call multiple times', async () => {
      await runner.start();
      await runner.stop();
      await runner.stop();
      expect(runner.isRunning()).toBe(false);
    });
  });

  describe('update handling', () => {
    it('should increment messagesReceived on each update', async () => {
      await runner.start();

      client._emit('update', Buffer.from('test1'));
      client._emit('update', Buffer.from('test2'));
      client._emit('update', Buffer.from('test3'));

      // Give microtasks time to resolve
      await new Promise((r) => setTimeout(r, 10));

      const stats = runner.getStats();
      expect(stats.messagesReceived).toBe(3);
    });

    it('should publish to the shadow stream', async () => {
      await runner.start();

      const data = Buffer.from('hello');
      client._emit('update', data);

      // Wait for async publish
      await new Promise((r) => setTimeout(r, 10));

      expect(publisher.publishMessage).toHaveBeenCalledWith(
        'telegram-messages-v2',
        expect.objectContaining({
          data: data.toString('base64'),
          source: 'kerain',
        }),
      );
    });

    it('should include timestamp in published message', async () => {
      await runner.start();

      const before = Date.now();
      client._emit('update', Buffer.from('data'));
      await new Promise((r) => setTimeout(r, 10));

      const [, fields] = publisher.publishMessage.mock.calls[0]!;
      const ts = Number((fields as Record<string, string>).timestamp);
      expect(ts).toBeGreaterThanOrEqual(before);
    });

    it('should increment missedCount when publish fails', async () => {
      publisher.publishMessage.mockRejectedValue(new Error('Redis down'));

      await runner.start();
      client._emit('update', Buffer.from('data'));

      // Wait for the catch handler to fire
      await new Promise((r) => setTimeout(r, 50));

      const stats = runner.getStats();
      expect(stats.messagesReceived).toBe(1);
      expect(stats.missedCount).toBe(1);
    });

    it('should not publish after stop', async () => {
      await runner.start();
      await runner.stop();

      client._emit('update', Buffer.from('data'));
      await new Promise((r) => setTimeout(r, 10));

      expect(publisher.publishMessage).not.toHaveBeenCalled();
    });
  });

  describe('stats tracking', () => {
    it('should start with zeroed stats', () => {
      const stats = runner.getStats();
      expect(stats.messagesReceived).toBe(0);
      expect(stats.matchCount).toBe(0);
      expect(stats.mismatchCount).toBe(0);
      expect(stats.missedCount).toBe(0);
    });

    it('should return a snapshot (not a reference)', () => {
      const stats1 = runner.getStats();
      runner.recordMatch();
      const stats2 = runner.getStats();

      expect(stats1.matchCount).toBe(0);
      expect(stats2.matchCount).toBe(1);
    });

    it('should track matches', () => {
      runner.recordMatch();
      runner.recordMatch();
      expect(runner.getStats().matchCount).toBe(2);
    });

    it('should track mismatches', () => {
      runner.recordMismatch();
      expect(runner.getStats().mismatchCount).toBe(1);
    });

    it('should track misses', () => {
      runner.recordMiss();
      runner.recordMiss();
      runner.recordMiss();
      expect(runner.getStats().missedCount).toBe(3);
    });

    it('should reset all stats', () => {
      runner.recordMatch();
      runner.recordMismatch();
      runner.recordMiss();
      runner.resetStats();

      const stats = runner.getStats();
      expect(stats.messagesReceived).toBe(0);
      expect(stats.matchCount).toBe(0);
      expect(stats.mismatchCount).toBe(0);
      expect(stats.missedCount).toBe(0);
    });
  });

  describe('restart', () => {
    it('should allow start after stop', async () => {
      await runner.start();
      await runner.stop();
      await runner.start(); // should not throw

      expect(runner.isRunning()).toBe(true);
    });

    it('should register a new handler on restart', async () => {
      await runner.start();
      await runner.stop();
      await runner.start();

      // Should have called on('update', ...) twice
      expect(client.on).toHaveBeenCalledTimes(2);
    });
  });
});
