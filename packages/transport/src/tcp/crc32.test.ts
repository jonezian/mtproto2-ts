import { describe, it, expect } from 'vitest';
import { crc32 } from '../crc32.js';

describe('crc32', () => {
  it('returns 0x00000000 for empty buffer', () => {
    expect(crc32(Buffer.alloc(0))).toBe(0x00000000);
  });

  it('returns 0xCBF43926 for "123456789" (IEEE standard test vector)', () => {
    const data = Buffer.from('123456789', 'ascii');
    expect(crc32(data)).toBe(0xcbf43926);
  });

  it('returns a consistent result for all-zeros buffer', () => {
    const data = Buffer.alloc(16, 0x00);
    const result = crc32(data);
    // CRC32 of 16 zero bytes is a known deterministic value
    expect(typeof result).toBe('number');
    // Verify it is the same on repeated calls
    expect(crc32(data)).toBe(result);
  });

  it('returns a 32-bit unsigned integer', () => {
    const data = Buffer.from('hello world', 'ascii');
    const result = crc32(data);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(0xffffffff);
  });

  it('returns different results for different inputs', () => {
    const a = crc32(Buffer.from('foo'));
    const b = crc32(Buffer.from('bar'));
    expect(a).not.toBe(b);
  });

  it('is deterministic', () => {
    const data = Buffer.from('test data for crc32');
    const r1 = crc32(data);
    const r2 = crc32(data);
    expect(r1).toBe(r2);
  });
});
