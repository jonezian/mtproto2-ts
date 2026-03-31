import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BotPool } from './bot-pool.js';
import type { SessionConfig, ClientFactory } from './bot-pool.js';
import type { TelegramClient } from '@kerainmtp/client';

/**
 * Create a mock TelegramClient with all required methods.
 */
function createMockClient(name: string): TelegramClient {
  const listeners: Map<string, Array<(...args: unknown[]) => void>> = new Map();

  return {
    apiId: 12345,
    apiHash: 'testhash',
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    invoke: vi.fn(async () => Buffer.alloc(4)),
    isConnected: vi.fn(() => true),
    getMe: vi.fn(async () => Buffer.alloc(4)),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(handler);
      return {} as TelegramClient;
    }),
    off: vi.fn(() => ({}) as TelegramClient),
    once: vi.fn(() => ({}) as TelegramClient),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const handlers = listeners.get(event) ?? [];
      for (const h of handlers) h(...args);
      return true;
    }),
    // Additional properties from TelegramClient
    entityCache: { size: 0 } as unknown as TelegramClient['entityCache'],
    fileManager: {} as unknown as TelegramClient['fileManager'],
    autoReconnect: true,
    _name: name,
  } as unknown as TelegramClient;
}

function createMockFactory(): { factory: ClientFactory; clients: Map<string, TelegramClient> } {
  const clients = new Map<string, TelegramClient>();

  const factory: ClientFactory = (config: SessionConfig) => {
    const client = createMockClient(config.name);
    clients.set(config.name, client);
    return client;
  };

  return { factory, clients };
}

const baseSessions: SessionConfig[] = [
  { name: 'bot1', sessionString: 'session1', phoneNumber: '+1111' },
  { name: 'bot2', sessionString: 'session2', phoneNumber: '+2222' },
  { name: 'bot3', sessionString: 'session3', phoneNumber: '+3333' },
];

describe('BotPool', () => {
  let pool: BotPool;
  let clients: Map<string, TelegramClient>;

  beforeEach(() => {
    const { factory, clients: c } = createMockFactory();
    clients = c;
    pool = new BotPool(
      { sessions: baseSessions, apiId: 12345, apiHash: 'testhash' },
      factory,
    );
  });

  describe('constructor', () => {
    it('should create a pool with the correct number of bots', () => {
      expect(pool.getBotCount()).toBe(3);
    });

    it('should throw on duplicate bot names', () => {
      const { factory } = createMockFactory();
      expect(() => {
        new BotPool(
          {
            sessions: [
              { name: 'dup', sessionString: 's1', phoneNumber: '+1' },
              { name: 'dup', sessionString: 's2', phoneNumber: '+2' },
            ],
            apiId: 1,
            apiHash: 'x',
          },
          factory,
        );
      }).toThrow('Duplicate bot name: dup');
    });

    it('should throw without a client factory', () => {
      expect(() => {
        new BotPool({
          sessions: [{ name: 'bot1', sessionString: 's', phoneNumber: '+1' }],
          apiId: 1,
          apiHash: 'x',
        });
      }).toThrow('ClientFactory is required');
    });
  });

  describe('getBot', () => {
    it('should return a bot by name', () => {
      const bot = pool.getBot('bot1');
      expect(bot).toBeDefined();
      expect(bot).toBe(clients.get('bot1'));
    });

    it('should return undefined for unknown bot name', () => {
      expect(pool.getBot('nonexistent')).toBeUndefined();
    });
  });

  describe('connectAll', () => {
    it('should call connect on all bots', async () => {
      await pool.connectAll();

      for (const client of clients.values()) {
        expect(client.connect).toHaveBeenCalledOnce();
      }
    });

    it('should mark all bots as connected', async () => {
      await pool.connectAll();
      expect(pool.getConnectedCount()).toBe(3);
    });
  });

  describe('disconnectAll', () => {
    it('should call disconnect on all bots', async () => {
      await pool.connectAll();
      await pool.disconnectAll();

      for (const client of clients.values()) {
        expect(client.disconnect).toHaveBeenCalledOnce();
      }
    });

    it('should mark all bots as disconnected', async () => {
      await pool.connectAll();
      await pool.disconnectAll();
      expect(pool.getConnectedCount()).toBe(0);
    });
  });

  describe('getAvailableBot', () => {
    it('should throw when no bots are connected', () => {
      expect(() => pool.getAvailableBot()).toThrow('No connected bots available');
    });

    it('should return a connected bot', async () => {
      await pool.connectAll();
      const bot = pool.getAvailableBot();
      expect(bot).toBeDefined();
    });

    it('should round-robin through connected bots', async () => {
      await pool.connectAll();

      const bot1 = pool.getAvailableBot();
      const bot2 = pool.getAvailableBot();
      const bot3 = pool.getAvailableBot();

      // After 3 calls, each bot should be returned once
      const botSet = new Set([bot1, bot2, bot3]);
      expect(botSet.size).toBe(3);
    });

    it('should cycle back to the first bot after all have been used', async () => {
      await pool.connectAll();

      const first = pool.getAvailableBot();
      pool.getAvailableBot();
      pool.getAvailableBot();
      const fourth = pool.getAvailableBot();

      expect(fourth).toBe(first);
    });
  });

  describe('getBotName', () => {
    it('should return the name for a known client', () => {
      const client = pool.getBot('bot2');
      expect(pool.getBotName(client!)).toBe('bot2');
    });

    it('should return undefined for an unknown client', () => {
      const unknownClient = createMockClient('unknown');
      expect(pool.getBotName(unknownClient)).toBeUndefined();
    });
  });

  describe('getBotCount', () => {
    it('should return total bot count', () => {
      expect(pool.getBotCount()).toBe(3);
    });
  });

  describe('getConnectedCount', () => {
    it('should return 0 before connecting', () => {
      expect(pool.getConnectedCount()).toBe(0);
    });

    it('should return correct count after connecting', async () => {
      await pool.connectAll();
      expect(pool.getConnectedCount()).toBe(3);
    });
  });

  describe('onUpdate', () => {
    it('should register handler on all bots', () => {
      const handler = vi.fn();
      pool.onUpdate(handler);

      for (const client of clients.values()) {
        expect(client.on).toHaveBeenCalledWith('update', expect.any(Function));
      }
    });

    it('should call handler with bot name when update is emitted', () => {
      const handler = vi.fn();
      pool.onUpdate(handler);

      const bot1Client = clients.get('bot1')!;
      const testData = Buffer.from('test-update');

      // Trigger the update event
      bot1Client.emit('update', testData);

      expect(handler).toHaveBeenCalledWith(testData, 'bot1');
    });
  });
});
