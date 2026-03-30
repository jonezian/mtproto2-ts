import { describe, it, expect, vi, afterEach } from 'vitest';
import { SaltManager } from './salt-manager.js';

describe('SaltManager', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return the currently valid salt', () => {
    const now = Math.floor(Date.now() / 1000);
    const manager = new SaltManager();

    manager.addSalts([
      { validSince: now - 100, validUntil: now + 3600, salt: 111n },
    ]);

    expect(manager.getCurrentSalt()).toBe(111n);
  });

  it('should return 0n when no salts are available', () => {
    const manager = new SaltManager();
    expect(manager.getCurrentSalt()).toBe(0n);
  });

  it('should return 0n when all salts have expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const manager = new SaltManager();

    manager.addSalts([
      { validSince: now - 7200, validUntil: now - 3600, salt: 999n },
    ]);

    expect(manager.getCurrentSalt()).toBe(0n);
  });

  it('should return the most recent valid salt when multiple are valid', () => {
    const now = Math.floor(Date.now() / 1000);
    const manager = new SaltManager();

    manager.addSalts([
      { validSince: now - 200, validUntil: now + 3600, salt: 100n },
      { validSince: now - 100, validUntil: now + 7200, salt: 200n },
    ]);

    // The salt with the latest validSince that is still valid should be returned
    expect(manager.getCurrentSalt()).toBe(200n);
  });

  it('should report needsRefresh when no salts', () => {
    const manager = new SaltManager();
    expect(manager.needsRefresh()).toBe(true);
  });

  it('should report needsRefresh when all salts expired', () => {
    const now = Math.floor(Date.now() / 1000);
    const manager = new SaltManager();

    manager.addSalts([
      { validSince: now - 7200, validUntil: now - 3600, salt: 1n },
    ]);

    expect(manager.needsRefresh()).toBe(true);
  });

  it('should not report needsRefresh when salts are valid for a long time', () => {
    const now = Math.floor(Date.now() / 1000);
    const manager = new SaltManager();

    manager.addSalts([
      { validSince: now - 100, validUntil: now + 7200, salt: 42n },
    ]);

    // 7200 seconds remaining > 1800 second threshold
    expect(manager.needsRefresh()).toBe(false);
  });

  it('should report needsRefresh when salt expires soon', () => {
    const now = Math.floor(Date.now() / 1000);
    const manager = new SaltManager();

    manager.addSalts([
      { validSince: now - 100, validUntil: now + 600, salt: 42n },
    ]);

    // 600 seconds remaining < 1800 second threshold
    expect(manager.needsRefresh()).toBe(true);
  });

  it('should merge salts from multiple addSalts calls', () => {
    const now = Math.floor(Date.now() / 1000);
    const manager = new SaltManager();

    manager.addSalts([
      { validSince: now - 100, validUntil: now + 3600, salt: 10n },
    ]);

    manager.addSalts([
      { validSince: now - 50, validUntil: now + 7200, salt: 20n },
    ]);

    expect(manager.getCurrentSalt()).toBe(20n);
  });
});
