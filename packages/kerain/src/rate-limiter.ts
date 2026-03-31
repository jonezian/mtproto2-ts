/**
 * Per-operation cooldown durations in milliseconds.
 */
const OPERATION_COOLDOWNS: Record<string, number> = {
  join: 30_000,
  search: 5_000,
  default: 1_000,
};

/**
 * Internal record of the last call time and flood wait expiry for a bot+operation pair.
 */
interface CallRecord {
  lastCall: number;
  floodWaitUntil: number;
}

/**
 * Options for constructing a RateLimiter.
 */
export interface RateLimiterOptions {
  defaultCooldown?: number;
}

/**
 * Per-bot rate limiting.
 *
 * Tracks API call timing per bot to avoid FLOOD_WAIT errors.
 * Supports per-operation cooldowns and explicit flood wait handling.
 */
export class RateLimiter {
  private readonly records: Map<string, CallRecord> = new Map();
  private readonly defaultCooldown: number;

  constructor(options?: RateLimiterOptions) {
    this.defaultCooldown = options?.defaultCooldown ?? OPERATION_COOLDOWNS.default;
  }

  /**
   * Create a composite key for bot+operation.
   */
  private key(botName: string, operation: string): string {
    return `${botName}:${operation}`;
  }

  /**
   * Get the cooldown duration for a given operation.
   */
  private getCooldown(operation: string): number {
    return OPERATION_COOLDOWNS[operation] ?? this.defaultCooldown;
  }

  /**
   * Check if a bot can proceed with a given operation.
   *
   * Returns true if both the operation cooldown and any flood wait have expired.
   */
  canProceed(botName: string, operation: string): boolean {
    const k = this.key(botName, operation);
    const record = this.records.get(k);

    if (!record) return true;

    const now = Date.now();
    const cooldown = this.getCooldown(operation);

    if (now < record.floodWaitUntil) return false;
    if (now - record.lastCall < cooldown) return false;

    return true;
  }

  /**
   * Record that an API call was made.
   */
  recordCall(botName: string, operation: string): void {
    const k = this.key(botName, operation);
    const existing = this.records.get(k);

    if (existing) {
      existing.lastCall = Date.now();
    } else {
      this.records.set(k, {
        lastCall: Date.now(),
        floodWaitUntil: 0,
      });
    }
  }

  /**
   * Wait for the cooldown to expire before proceeding.
   *
   * Returns a promise that resolves when the bot can proceed.
   */
  async waitForCooldown(botName: string, operation: string): Promise<void> {
    const k = this.key(botName, operation);
    const record = this.records.get(k);

    if (!record) return;

    const now = Date.now();
    const cooldown = this.getCooldown(operation);

    // Check flood wait first (it's typically longer)
    const floodWaitRemaining = record.floodWaitUntil - now;
    const cooldownRemaining = (record.lastCall + cooldown) - now;
    const waitTime = Math.max(floodWaitRemaining, cooldownRemaining, 0);

    if (waitTime > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Set an explicit FLOOD_WAIT timeout for a bot.
   *
   * @param botName - The bot name
   * @param seconds - The flood wait duration in seconds
   */
  setFloodWait(botName: string, seconds: number): void {
    const now = Date.now();
    const until = now + seconds * 1000;

    // Apply flood wait to all operations for this bot
    // by setting it on a special "flood" key and the specific operation
    // For simplicity, we set it on all existing records for this bot
    // and also on a general key
    const generalKey = `${botName}:*`;
    const existing = this.records.get(generalKey);
    if (existing) {
      existing.floodWaitUntil = Math.max(existing.floodWaitUntil, until);
    } else {
      this.records.set(generalKey, {
        lastCall: 0,
        floodWaitUntil: until,
      });
    }

    // Also update all existing records for this bot
    for (const [key, record] of this.records) {
      if (key.startsWith(`${botName}:`)) {
        record.floodWaitUntil = Math.max(record.floodWaitUntil, until);
      }
    }
  }

  /**
   * Get the time remaining before a bot can proceed (in ms).
   * Returns 0 if the bot can proceed immediately.
   */
  getWaitTime(botName: string, operation: string): number {
    const k = this.key(botName, operation);
    const record = this.records.get(k);

    if (!record) return 0;

    const now = Date.now();
    const cooldown = this.getCooldown(operation);

    const floodWaitRemaining = record.floodWaitUntil - now;
    const cooldownRemaining = (record.lastCall + cooldown) - now;

    return Math.max(floodWaitRemaining, cooldownRemaining, 0);
  }

  /**
   * Reset rate limits for a specific bot or all bots.
   *
   * @param botName - If provided, only reset limits for this bot
   */
  reset(botName?: string): void {
    if (botName) {
      const keysToDelete: string[] = [];
      for (const key of this.records.keys()) {
        if (key.startsWith(`${botName}:`)) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        this.records.delete(key);
      }
    } else {
      this.records.clear();
    }
  }
}
