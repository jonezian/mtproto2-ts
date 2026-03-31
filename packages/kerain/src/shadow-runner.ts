import type { TelegramClient } from '@mtproto2/client';
import type { RedisPublisher } from './publisher.js';

/**
 * Statistics tracked during shadow mode operation.
 */
export interface ShadowStats {
  messagesReceived: number;
  matchCount: number;
  mismatchCount: number;
  missedCount: number;
}

/**
 * Options for constructing a ShadowRunner.
 */
export interface ShadowRunnerOptions {
  kerainClient: TelegramClient;
  pythonServiceUrl: string;
  publisher: RedisPublisher;
  streamName?: string;
}

/**
 * Shadow mode runner.
 *
 * Runs the KerainMTP client alongside the existing Python Telethon
 * service to verify that the new implementation produces equivalent
 * results. Messages received by KerainMTP are published to a separate
 * Redis stream (`telegram-messages-v2` by default) for comparison
 * without affecting the production `telegram-messages` stream.
 *
 * Usage:
 * ```ts
 * const shadow = new ShadowRunner({
 *   kerainClient: client,
 *   pythonServiceUrl: 'http://localhost:5000',
 *   publisher: redisPublisher,
 * });
 *
 * await shadow.start();
 * // ... run for a while ...
 * const stats = shadow.getStats();
 * await shadow.stop();
 * ```
 */
export class ShadowRunner {
  private readonly kerainClient: TelegramClient;
  private readonly pythonServiceUrl: string;
  private readonly publisher: RedisPublisher;
  private readonly streamName: string;
  private running = false;
  private updateHandler: ((data: Buffer) => void) | null = null;

  private stats: ShadowStats = {
    messagesReceived: 0,
    matchCount: 0,
    mismatchCount: 0,
    missedCount: 0,
  };

  constructor(options: ShadowRunnerOptions) {
    this.kerainClient = options.kerainClient;
    this.pythonServiceUrl = options.pythonServiceUrl;
    this.publisher = options.publisher;
    this.streamName = options.streamName ?? 'telegram-messages-v2';
  }

  /**
   * Start shadow mode.
   *
   * Registers an update listener on the KerainMTP client that publishes
   * received messages to the shadow stream. Each message increments the
   * `messagesReceived` counter.
   *
   * @throws If already running or if the publisher is not connected
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Shadow runner is already running');
    }

    if (!this.publisher.isConnected()) {
      throw new Error('Redis publisher must be connected before starting shadow mode');
    }

    this.running = true;

    this.updateHandler = (data: Buffer) => {
      this.stats.messagesReceived++;

      // Publish the raw update data to the shadow stream.
      // Fire-and-forget: errors are tracked as misses.
      this.publisher
        .publishMessage(this.streamName, {
          data: data.toString('base64'),
          timestamp: String(Date.now()),
          source: 'kerain',
        })
        .catch(() => {
          this.stats.missedCount++;
        });
    };

    this.kerainClient.on('update', this.updateHandler);
  }

  /**
   * Stop shadow mode.
   *
   * Removes the update listener from the client.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    if (this.updateHandler) {
      this.kerainClient.off('update', this.updateHandler);
      this.updateHandler = null;
    }

    this.running = false;
  }

  /**
   * Whether shadow mode is currently active.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the current comparison statistics.
   *
   * Returns a snapshot of the stats — further updates will not
   * mutate the returned object.
   */
  getStats(): ShadowStats {
    return { ...this.stats };
  }

  /**
   * Record a match between Python and KerainMTP results.
   *
   * Called externally by the comparison logic when a message from
   * the Python stream matches a message from the KerainMTP stream.
   */
  recordMatch(): void {
    this.stats.matchCount++;
  }

  /**
   * Record a mismatch between Python and KerainMTP results.
   *
   * Called externally when the two implementations produce different
   * results for the same message.
   */
  recordMismatch(): void {
    this.stats.mismatchCount++;
  }

  /**
   * Record a missed message.
   *
   * Called when a message was received by one implementation but not
   * the other within the comparison window.
   */
  recordMiss(): void {
    this.stats.missedCount++;
  }

  /**
   * Reset all statistics to zero.
   */
  resetStats(): void {
    this.stats = {
      messagesReceived: 0,
      matchCount: 0,
      mismatchCount: 0,
      missedCount: 0,
    };
  }

  /**
   * Get the Python service URL configured for comparison.
   */
  getPythonServiceUrl(): string {
    return this.pythonServiceUrl;
  }

  /**
   * Get the Redis stream name used for shadow publishing.
   */
  getStreamName(): string {
    return this.streamName;
  }
}
