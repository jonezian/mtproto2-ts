import { describe, it, expect, vi, afterEach } from 'vitest';
import { ReconnectStrategy } from './reconnect.js';

describe('ReconnectStrategy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('nextDelay', () => {
    it('should return increasing delays with exponential backoff', () => {
      // Disable jitter for predictable testing
      const strategy = new ReconnectStrategy({
        initialDelay: 1000,
        multiplier: 2,
        jitter: false,
      });

      expect(strategy.nextDelay()).toBe(1000);   // 1000 * 2^0
      expect(strategy.nextDelay()).toBe(2000);   // 1000 * 2^1
      expect(strategy.nextDelay()).toBe(4000);   // 1000 * 2^2
      expect(strategy.nextDelay()).toBe(8000);   // 1000 * 2^3
    });

    it('should cap delay at maxDelay', () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 1000,
        multiplier: 2,
        maxDelay: 5000,
        jitter: false,
      });

      strategy.nextDelay(); // 1000
      strategy.nextDelay(); // 2000
      strategy.nextDelay(); // 4000
      expect(strategy.nextDelay()).toBe(5000); // capped at 5000
      expect(strategy.nextDelay()).toBe(5000); // still capped
    });

    it('should apply jitter when enabled', () => {
      // Mock Math.random to return 0.5, giving jitter factor of 1.0
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const strategy = new ReconnectStrategy({
        initialDelay: 1000,
        multiplier: 1.5,
        jitter: true,
      });

      // jitterFactor = 0.5 + 0.5 = 1.0, so delay = 1000 * 1.0 = 1000
      expect(strategy.nextDelay()).toBe(1000);
    });

    it('should apply minimum jitter factor of 0.5', () => {
      // Math.random() returns 0.0 -> jitter factor = 0.5
      vi.spyOn(Math, 'random').mockReturnValue(0.0);

      const strategy = new ReconnectStrategy({
        initialDelay: 1000,
        multiplier: 1.5,
        jitter: true,
      });

      expect(strategy.nextDelay()).toBe(500); // 1000 * 0.5
    });

    it('should apply maximum jitter factor near 1.5', () => {
      // Math.random() returns ~1.0 -> jitter factor ~ 1.5
      vi.spyOn(Math, 'random').mockReturnValue(0.9999);

      const strategy = new ReconnectStrategy({
        initialDelay: 1000,
        multiplier: 1.5,
        jitter: true,
      });

      // 1000 * (0.5 + 0.9999) = 1000 * 1.4999 = 1499
      expect(strategy.nextDelay()).toBe(1499);
    });

    it('should use default options', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const strategy = new ReconnectStrategy();

      // Default: initialDelay=1000, multiplier=1.5, jitter=true
      // With random=0.5, jitter factor=1.0
      const delay = strategy.nextDelay();
      expect(delay).toBe(1000);
    });
  });

  describe('reset', () => {
    it('should reset the attempt counter', () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 1000,
        multiplier: 2,
        jitter: false,
      });

      strategy.nextDelay(); // 1000, attempt 0 -> 1
      strategy.nextDelay(); // 2000, attempt 1 -> 2
      strategy.nextDelay(); // 4000, attempt 2 -> 3

      strategy.reset();

      // Should start from the beginning
      expect(strategy.nextDelay()).toBe(1000); // 1000 * 2^0
    });
  });

  describe('isExhausted', () => {
    it('should return false before maxAttempts', () => {
      const strategy = new ReconnectStrategy({
        maxAttempts: 3,
        jitter: false,
      });

      expect(strategy.isExhausted()).toBe(false);
      strategy.nextDelay(); // attempt 0 -> 1
      expect(strategy.isExhausted()).toBe(false);
      strategy.nextDelay(); // attempt 1 -> 2
      expect(strategy.isExhausted()).toBe(false);
    });

    it('should return true when maxAttempts reached', () => {
      const strategy = new ReconnectStrategy({
        maxAttempts: 2,
        jitter: false,
      });

      strategy.nextDelay(); // attempt 0 -> 1
      strategy.nextDelay(); // attempt 1 -> 2
      expect(strategy.isExhausted()).toBe(true);
    });

    it('should never be exhausted with default Infinity maxAttempts', () => {
      const strategy = new ReconnectStrategy({ jitter: false });

      for (let i = 0; i < 100; i++) {
        strategy.nextDelay();
      }

      expect(strategy.isExhausted()).toBe(false);
    });

    it('should return false after reset', () => {
      const strategy = new ReconnectStrategy({
        maxAttempts: 2,
        jitter: false,
      });

      strategy.nextDelay();
      strategy.nextDelay();
      expect(strategy.isExhausted()).toBe(true);

      strategy.reset();
      expect(strategy.isExhausted()).toBe(false);
    });
  });

  describe('withReconnect', () => {
    it('should return result on first successful call', async () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 10,
        jitter: false,
      });

      const result = await strategy.withReconnect(async () => 'success');
      expect(result).toBe('success');
    });

    it('should retry on failure and return on eventual success', async () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 10,
        maxDelay: 50,
        jitter: false,
        maxAttempts: 5,
      });

      let callCount = 0;

      const result = await strategy.withReconnect(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('connection failed');
        }
        return 'recovered';
      });

      expect(result).toBe('recovered');
      expect(callCount).toBe(3);
    });

    it('should throw after all attempts exhausted', async () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 10,
        jitter: false,
        maxAttempts: 3,
      });

      let callCount = 0;

      await expect(
        strategy.withReconnect(async () => {
          callCount++;
          throw new Error('always fails');
        }),
      ).rejects.toThrow('always fails');

      // First call + 2 retries (delay happens before retries, maxAttempts=3)
      // The first call counts as attempt 0, then nextDelay increments attempt to 1,
      // second call, nextDelay increments to 2, third call, nextDelay increments to 3,
      // isExhausted() = true (3 >= 3), so it breaks.
      expect(callCount).toBe(3);
    });

    it('should throw when maxAttempts is 1', async () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 10,
        jitter: false,
        maxAttempts: 1,
      });

      await expect(
        strategy.withReconnect(async () => {
          throw new Error('fails once');
        }),
      ).rejects.toThrow('fails once');
    });

    it('should reset attempts on success', async () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 10,
        jitter: false,
        maxAttempts: 5,
      });

      // First run succeeds
      await strategy.withReconnect(async () => 'ok');

      // Should be reset, can run again
      expect(strategy.isExhausted()).toBe(false);
    });
  });

  describe('custom options', () => {
    it('should support custom multiplier', () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 100,
        multiplier: 3,
        jitter: false,
      });

      expect(strategy.nextDelay()).toBe(100);   // 100 * 3^0
      expect(strategy.nextDelay()).toBe(300);   // 100 * 3^1
      expect(strategy.nextDelay()).toBe(900);   // 100 * 3^2
    });

    it('should support very small initialDelay', () => {
      const strategy = new ReconnectStrategy({
        initialDelay: 1,
        multiplier: 2,
        jitter: false,
      });

      expect(strategy.nextDelay()).toBe(1);
      expect(strategy.nextDelay()).toBe(2);
      expect(strategy.nextDelay()).toBe(4);
    });
  });
});
