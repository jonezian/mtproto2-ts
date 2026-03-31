import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('canProceed', () => {
    it('should return true for first call', () => {
      expect(limiter.canProceed('bot1', 'default')).toBe(true);
    });

    it('should return false immediately after a call (within cooldown)', () => {
      limiter.recordCall('bot1', 'default');
      expect(limiter.canProceed('bot1', 'default')).toBe(false);
    });

    it('should return true after default cooldown expires', () => {
      limiter.recordCall('bot1', 'default');
      vi.advanceTimersByTime(1001); // default cooldown is 1000ms
      expect(limiter.canProceed('bot1', 'default')).toBe(true);
    });

    it('should return false within join cooldown (30s)', () => {
      limiter.recordCall('bot1', 'join');
      vi.advanceTimersByTime(10_000); // 10s < 30s
      expect(limiter.canProceed('bot1', 'join')).toBe(false);
    });

    it('should return true after join cooldown expires', () => {
      limiter.recordCall('bot1', 'join');
      vi.advanceTimersByTime(30_001);
      expect(limiter.canProceed('bot1', 'join')).toBe(true);
    });

    it('should return false within search cooldown (5s)', () => {
      limiter.recordCall('bot1', 'search');
      vi.advanceTimersByTime(3_000);
      expect(limiter.canProceed('bot1', 'search')).toBe(false);
    });

    it('should return true after search cooldown expires', () => {
      limiter.recordCall('bot1', 'search');
      vi.advanceTimersByTime(5_001);
      expect(limiter.canProceed('bot1', 'search')).toBe(true);
    });

    it('should track different bots independently', () => {
      limiter.recordCall('bot1', 'default');
      expect(limiter.canProceed('bot2', 'default')).toBe(true);
    });

    it('should track different operations independently', () => {
      limiter.recordCall('bot1', 'join');
      expect(limiter.canProceed('bot1', 'search')).toBe(true);
    });
  });

  describe('recordCall', () => {
    it('should record the call timestamp', () => {
      limiter.recordCall('bot1', 'default');
      expect(limiter.canProceed('bot1', 'default')).toBe(false);
    });

    it('should update the timestamp on subsequent calls', () => {
      limiter.recordCall('bot1', 'default');
      vi.advanceTimersByTime(1001);
      limiter.recordCall('bot1', 'default');
      expect(limiter.canProceed('bot1', 'default')).toBe(false);
    });
  });

  describe('waitForCooldown', () => {
    it('should resolve immediately when no cooldown is active', async () => {
      const start = Date.now();
      await limiter.waitForCooldown('bot1', 'default');
      expect(Date.now() - start).toBe(0);
    });

    it('should wait for the cooldown duration', async () => {
      limiter.recordCall('bot1', 'default');

      const promise = limiter.waitForCooldown('bot1', 'default');
      vi.advanceTimersByTime(1001);
      await promise;

      expect(limiter.canProceed('bot1', 'default')).toBe(true);
    });
  });

  describe('setFloodWait', () => {
    it('should block operations during flood wait', () => {
      limiter.recordCall('bot1', 'default');
      limiter.setFloodWait('bot1', 60); // 60 seconds

      vi.advanceTimersByTime(30_000); // Only 30s
      expect(limiter.canProceed('bot1', 'default')).toBe(false);
    });

    it('should allow operations after flood wait expires', () => {
      limiter.recordCall('bot1', 'default');
      limiter.setFloodWait('bot1', 10);

      vi.advanceTimersByTime(10_001);
      expect(limiter.canProceed('bot1', 'default')).toBe(true);
    });

    it('should apply flood wait to all operations for a bot', () => {
      limiter.recordCall('bot1', 'search');
      limiter.setFloodWait('bot1', 60);

      vi.advanceTimersByTime(10_000);
      expect(limiter.canProceed('bot1', 'search')).toBe(false);
    });

    it('should not affect other bots', () => {
      limiter.setFloodWait('bot1', 60);
      expect(limiter.canProceed('bot2', 'default')).toBe(true);
    });
  });

  describe('getWaitTime', () => {
    it('should return 0 when no cooldown is active', () => {
      expect(limiter.getWaitTime('bot1', 'default')).toBe(0);
    });

    it('should return remaining cooldown time', () => {
      limiter.recordCall('bot1', 'default');
      vi.advanceTimersByTime(500);
      const remaining = limiter.getWaitTime('bot1', 'default');
      expect(remaining).toBe(500);
    });

    it('should return 0 after cooldown expires', () => {
      limiter.recordCall('bot1', 'default');
      vi.advanceTimersByTime(1001);
      expect(limiter.getWaitTime('bot1', 'default')).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset all limits for a specific bot', () => {
      limiter.recordCall('bot1', 'default');
      limiter.recordCall('bot1', 'join');
      limiter.recordCall('bot2', 'default');

      limiter.reset('bot1');

      expect(limiter.canProceed('bot1', 'default')).toBe(true);
      expect(limiter.canProceed('bot1', 'join')).toBe(true);
      expect(limiter.canProceed('bot2', 'default')).toBe(false);
    });

    it('should reset all bots when no name is provided', () => {
      limiter.recordCall('bot1', 'default');
      limiter.recordCall('bot2', 'default');

      limiter.reset();

      expect(limiter.canProceed('bot1', 'default')).toBe(true);
      expect(limiter.canProceed('bot2', 'default')).toBe(true);
    });

    it('should clear flood wait when resetting', () => {
      limiter.recordCall('bot1', 'default');
      limiter.setFloodWait('bot1', 60);
      limiter.reset('bot1');

      expect(limiter.canProceed('bot1', 'default')).toBe(true);
    });
  });

  describe('custom default cooldown', () => {
    it('should use custom default cooldown', () => {
      const customLimiter = new RateLimiter({ defaultCooldown: 5000 });
      customLimiter.recordCall('bot1', 'unknown_op');

      vi.advanceTimersByTime(3000);
      expect(customLimiter.canProceed('bot1', 'unknown_op')).toBe(false);

      vi.advanceTimersByTime(2001);
      expect(customLimiter.canProceed('bot1', 'unknown_op')).toBe(true);
    });

    it('should still use per-operation cooldowns for known operations', () => {
      const customLimiter = new RateLimiter({ defaultCooldown: 100 });
      customLimiter.recordCall('bot1', 'join');

      vi.advanceTimersByTime(200);
      // join has 30s cooldown regardless of default
      expect(customLimiter.canProceed('bot1', 'join')).toBe(false);
    });
  });
});
