import type { TelegramClient } from '@kerainmtp/client';

/**
 * Configuration for a single bot session.
 */
export interface SessionConfig {
  name: string;
  sessionString: string;
  phoneNumber: string;
}

/**
 * Options for constructing a BotPool.
 */
export interface BotPoolOptions {
  sessions: SessionConfig[];
  apiId: number;
  apiHash: string;
  testMode?: boolean;
}

/**
 * Internal state tracked per bot.
 */
interface BotEntry {
  name: string;
  client: TelegramClient;
  connected: boolean;
  config: SessionConfig;
}

/**
 * Factory function type for creating TelegramClient instances.
 * Used for dependency injection in testing.
 */
export type ClientFactory = (config: SessionConfig, apiId: number, apiHash: string, testMode: boolean) => TelegramClient;

/**
 * Multi-bot pool manager.
 *
 * Manages multiple TelegramClient instances with round-robin
 * selection for load balancing across bots.
 */
export class BotPool {
  private readonly bots: Map<string, BotEntry> = new Map();
  private readonly botNames: string[] = [];
  private roundRobinIndex = 0;
  private readonly apiId: number;
  private readonly apiHash: string;
  private readonly testMode: boolean;
  private readonly clientFactory: ClientFactory | undefined;

  constructor(options: BotPoolOptions, clientFactory?: ClientFactory) {
    this.apiId = options.apiId;
    this.apiHash = options.apiHash;
    this.testMode = options.testMode ?? false;
    this.clientFactory = clientFactory;

    for (const session of options.sessions) {
      if (this.bots.has(session.name)) {
        throw new Error(`Duplicate bot name: ${session.name}`);
      }

      let client: TelegramClient;
      if (this.clientFactory) {
        client = this.clientFactory(session, this.apiId, this.apiHash, this.testMode);
      } else {
        // Dynamic import would be needed for real usage; for the pool
        // we require a factory to be passed for testability
        throw new Error('ClientFactory is required');
      }

      const entry: BotEntry = {
        name: session.name,
        client,
        connected: false,
        config: session,
      };

      this.bots.set(session.name, entry);
      this.botNames.push(session.name);
    }
  }

  /**
   * Connect all bots concurrently.
   */
  async connectAll(): Promise<void> {
    const entries = Array.from(this.bots.values());
    await Promise.all(
      entries.map(async (entry) => {
        await entry.client.connect();
        entry.connected = true;
      }),
    );
  }

  /**
   * Disconnect all bots.
   */
  async disconnectAll(): Promise<void> {
    const entries = Array.from(this.bots.values());
    await Promise.all(
      entries.map(async (entry) => {
        await entry.client.disconnect();
        entry.connected = false;
      }),
    );
  }

  /**
   * Get a specific bot by name.
   *
   * @param name - The bot name as defined in SessionConfig
   * @returns The TelegramClient for the bot, or undefined if not found
   */
  getBot(name: string): TelegramClient | undefined {
    return this.bots.get(name)?.client;
  }

  /**
   * Get an available bot using round-robin selection.
   *
   * Only returns connected bots. Throws if no bots are connected.
   */
  getAvailableBot(): TelegramClient {
    const connectedBots = this.botNames.filter(
      (name) => this.bots.get(name)!.connected,
    );

    if (connectedBots.length === 0) {
      throw new Error('No connected bots available');
    }

    const index = this.roundRobinIndex % connectedBots.length;
    this.roundRobinIndex = (this.roundRobinIndex + 1) % connectedBots.length;

    const name = connectedBots[index]!;
    return this.bots.get(name)!.client;
  }

  /**
   * Get the name of a bot by its client reference.
   */
  getBotName(client: TelegramClient): string | undefined {
    for (const [name, entry] of this.bots) {
      if (entry.client === client) {
        return name;
      }
    }
    return undefined;
  }

  /**
   * Get the number of bots in the pool (connected or not).
   */
  getBotCount(): number {
    return this.bots.size;
  }

  /**
   * Get the number of connected bots.
   */
  getConnectedCount(): number {
    let count = 0;
    for (const entry of this.bots.values()) {
      if (entry.connected) count++;
    }
    return count;
  }

  /**
   * Register an update handler on all bots.
   *
   * @param handler - Function called when any bot receives an update
   */
  onUpdate(handler: (data: Buffer, botName: string) => void): void {
    for (const entry of this.bots.values()) {
      const botName = entry.name;
      entry.client.on('update', (data: Buffer) => {
        handler(data, botName);
      });
    }
  }
}
