import { describe, it, expect } from 'vitest';
import { randomBytes, randomBigInt } from './random.js';

describe('randomBytes', () => {
  it('returns Buffer of 0 bytes', () => {
    const result = randomBytes(0);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('returns Buffer of 1 byte', () => {
    const result = randomBytes(1);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it('returns Buffer of 16 bytes', () => {
    const result = randomBytes(16);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(16);
  });

  it('returns Buffer of 32 bytes', () => {
    const result = randomBytes(32);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(32);
  });

  it('returns Buffer of 256 bytes', () => {
    const result = randomBytes(256);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(256);
  });

  it('produces different output on successive calls', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    // Extremely unlikely to be equal for cryptographically random 32 bytes
    expect(a.equals(b)).toBe(false);
  });
});

describe('randomBigInt', () => {
  it('produces a value of the expected bit length for 128 bits', () => {
    const value = randomBigInt(128);
    expect(typeof value).toBe('bigint');
    // The top bit is set, so it must be >= 2^127
    expect(value >= (1n << 127n)).toBe(true);
    // And it must be < 2^128
    expect(value < (1n << 128n)).toBe(true);
  });

  it('produces a value of the expected bit length for 256 bits', () => {
    const value = randomBigInt(256);
    expect(typeof value).toBe('bigint');
    expect(value >= (1n << 255n)).toBe(true);
    expect(value < (1n << 256n)).toBe(true);
  });

  it('produces a value of the expected bit length for 64 bits', () => {
    const value = randomBigInt(64);
    expect(typeof value).toBe('bigint');
    expect(value >= (1n << 63n)).toBe(true);
    expect(value < (1n << 64n)).toBe(true);
  });

  it('produces a value of the expected bit length for 1 bit', () => {
    const value = randomBigInt(1);
    expect(typeof value).toBe('bigint');
    // 1-bit value with top bit set: must be 1
    expect(value).toBe(1n);
  });

  it('produces different values on successive calls (for large bit length)', () => {
    const a = randomBigInt(256);
    const b = randomBigInt(256);
    expect(a !== b).toBe(true);
  });
});
