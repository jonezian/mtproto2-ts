import crypto from 'node:crypto';

/**
 * Reconnection strategy with exponential backoff and optional jitter.
 *
 * Implements a configurable backoff algorithm for handling connection
 * failures to Telegram servers.
 */

export interface ReconnectOptions {
  /** Initial delay in milliseconds. Default: 1000 */
  initialDelay: number;
  /** Maximum delay in milliseconds. Default: 30000 */
  maxDelay: number;
  /** Backoff multiplier. Default: 1.5 */
  multiplier: number;
  /** Add random jitter to delays. Default: true */
  jitter: boolean;
  /** Maximum number of reconnection attempts. Default: Infinity */
  maxAttempts: number;
}

const DEFAULT_OPTIONS: Required<ReconnectOptions> = {
  initialDelay: 1000,
  maxDelay: 30000,
  multiplier: 1.5,
  jitter: true,
  maxAttempts: Infinity,
};

/**
 * ReconnectStrategy computes exponential backoff delays for reconnection.
 *
 * Usage:
 *   const strategy = new ReconnectStrategy();
 *   // On connection failure:
 *   const delay = strategy.nextDelay();
 *   await sleep(delay);
 *   // On successful connection:
 *   strategy.reset();
 */
export class ReconnectStrategy {
  private attempt: number = 0;
  private readonly options: Required<ReconnectOptions>;

  constructor(options?: Partial<ReconnectOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get the next delay in milliseconds.
   * The delay increases exponentially with each call,
   * capped at maxDelay. If jitter is enabled, a random
   * factor between 0.5 and 1.5 is applied.
   */
  nextDelay(): number {
    const { initialDelay, maxDelay, multiplier, jitter } = this.options;

    let delay = initialDelay * Math.pow(multiplier, this.attempt);
    delay = Math.min(delay, maxDelay);

    if (jitter) {
      // Apply jitter: multiply by a random factor in [0.5, 1.5)
      const jitterFactor = 0.5 + crypto.randomBytes(4).readUInt32LE(0) / 0x100000000;
      delay = delay * jitterFactor;
    }

    this.attempt++;

    return Math.floor(delay);
  }

  /**
   * Reset the attempts counter (e.g., on successful connection).
   */
  reset(): void {
    this.attempt = 0;
  }

  /**
   * Check if the maximum number of attempts has been exceeded.
   */
  isExhausted(): boolean {
    return this.attempt >= this.options.maxAttempts;
  }

  /**
   * Execute a function with automatic reconnection logic.
   *
   * Calls `fn` repeatedly until it succeeds or maxAttempts is reached.
   * Between attempts, waits with exponential backoff.
   *
   * @throws The last error if all attempts are exhausted.
   */
  async withReconnect<T>(fn: () => Promise<T>): Promise<T> {
    this.reset();

    let lastError: Error | undefined;

    while (!this.isExhausted()) {
      try {
        const result = await fn();
        this.reset();
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (this.isExhausted()) {
          break;
        }

        const delay = this.nextDelay();
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new Error('Reconnection attempts exhausted');
  }
}
