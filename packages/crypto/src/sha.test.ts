import { describe, it, expect } from 'vitest';
import { sha1, sha256 } from './sha.js';

describe('SHA-1', () => {
  it('should hash empty string correctly', () => {
    const hash = sha1(Buffer.alloc(0));
    expect(hash.toString('hex')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('should return 20-byte hash', () => {
    const hash = sha1(Buffer.from('hello'));
    expect(hash.length).toBe(20);
  });

  it('should support concatenation mode', () => {
    const a = Buffer.from('hello');
    const b = Buffer.from(' ');
    const c = Buffer.from('world');

    const combined = sha1(a, b, c);
    const direct = sha1(Buffer.from('hello world'));

    expect(combined).toEqual(direct);
  });
});

describe('SHA-256', () => {
  it('should hash empty string correctly', () => {
    const hash = sha256(Buffer.alloc(0));
    expect(hash.toString('hex')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('should return 32-byte hash', () => {
    const hash = sha256(Buffer.from('hello'));
    expect(hash.length).toBe(32);
  });

  it('should support concatenation mode', () => {
    const a = Buffer.from('foo');
    const b = Buffer.from('bar');
    const c = Buffer.from('baz');

    const combined = sha256(a, b, c);
    const direct = sha256(Buffer.from('foobarbaz'));

    expect(combined).toEqual(direct);
  });

  it('should hash known value correctly', () => {
    const hash = sha256(Buffer.from('hello'));
    expect(hash.toString('hex')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});
