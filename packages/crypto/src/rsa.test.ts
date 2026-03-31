import { describe, it, expect } from 'vitest';
import { rsaPad, TELEGRAM_RSA_KEYS } from './rsa.js';

describe('rsaPad', () => {
  // Use the actual Telegram RSA key for testing
  const testKey = TELEGRAM_RSA_KEYS[0]!;

  it('produces a Buffer output with valid data under 192 bytes', () => {
    const data = Buffer.alloc(64, 0x42);
    const result = rsaPad(data, testKey);
    expect(Buffer.isBuffer(result)).toBe(true);
    // Output must be at least 256 bytes (the hardcoded padStart length in bigintToBuffer)
    expect(result.length).toBeGreaterThanOrEqual(256);
  });

  it('produces output with 1 byte of data', () => {
    const data = Buffer.from([0xaa]);
    const result = rsaPad(data, testKey);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(256);
  });

  it('produces output with 100 bytes of data', () => {
    const data = Buffer.alloc(100, 0xbb);
    const result = rsaPad(data, testKey);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(256);
  });

  it('produces output with 191 bytes of data', () => {
    const data = Buffer.alloc(191, 0xcc);
    const result = rsaPad(data, testKey);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(256);
  });

  it('produces output with exactly 192 bytes of data (max allowed)', () => {
    const data = Buffer.alloc(192, 0xdd);
    const result = rsaPad(data, testKey);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(256);
  });

  it('output changes on each call due to randomness', () => {
    const data = Buffer.alloc(32, 0xee);
    const result1 = rsaPad(data, testKey);
    const result2 = rsaPad(data, testKey);
    // Two calls with the same data should produce different outputs
    // (due to random padding and temp_key)
    expect(result1.equals(result2)).toBe(false);
  });

  it('rejects data over 192 bytes', () => {
    const data = Buffer.alloc(193, 0xff);
    expect(() => rsaPad(data, testKey)).toThrow('Data must not exceed 192 bytes');
  });

  it('rejects data of 256 bytes', () => {
    const data = Buffer.alloc(256, 0xff);
    expect(() => rsaPad(data, testKey)).toThrow('Data must not exceed 192 bytes');
  });
});

describe('TELEGRAM_RSA_KEYS', () => {
  it('is a non-empty array', () => {
    expect(TELEGRAM_RSA_KEYS.length).toBeGreaterThan(0);
  });

  it('each key has a valid fingerprint (bigint)', () => {
    for (const key of TELEGRAM_RSA_KEYS) {
      expect(typeof key.fingerprint).toBe('bigint');
    }
  });

  it('each key has a valid n (bigint)', () => {
    for (const key of TELEGRAM_RSA_KEYS) {
      expect(typeof key.n).toBe('bigint');
      expect(key.n > 0n).toBe(true);
    }
  });

  it('each key has e = 65537n', () => {
    for (const key of TELEGRAM_RSA_KEYS) {
      expect(key.e).toBe(65537n);
    }
  });
});
