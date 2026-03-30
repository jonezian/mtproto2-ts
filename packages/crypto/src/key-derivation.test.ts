import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { deriveAesKeyIv } from './key-derivation.js';

describe('Key Derivation', () => {
  const authKey = crypto.randomBytes(256);
  const msgKey = crypto.randomBytes(16);

  it('should produce 32-byte key', () => {
    const { key } = deriveAesKeyIv(authKey, msgKey, true);
    expect(key.length).toBe(32);
  });

  it('should produce 32-byte IV', () => {
    const { iv } = deriveAesKeyIv(authKey, msgKey, true);
    expect(iv.length).toBe(32);
  });

  it('should produce different results for client vs server', () => {
    const client = deriveAesKeyIv(authKey, msgKey, true);
    const server = deriveAesKeyIv(authKey, msgKey, false);

    expect(client.key).not.toEqual(server.key);
    expect(client.iv).not.toEqual(server.iv);
  });

  it('should produce deterministic results', () => {
    const result1 = deriveAesKeyIv(authKey, msgKey, true);
    const result2 = deriveAesKeyIv(authKey, msgKey, true);

    expect(result1.key).toEqual(result2.key);
    expect(result1.iv).toEqual(result2.iv);
  });

  it('should produce different results for different auth keys', () => {
    const authKey2 = crypto.randomBytes(256);
    const result1 = deriveAesKeyIv(authKey, msgKey, true);
    const result2 = deriveAesKeyIv(authKey2, msgKey, true);

    expect(result1.key).not.toEqual(result2.key);
  });

  it('should produce different results for different msg keys', () => {
    const msgKey2 = crypto.randomBytes(16);
    const result1 = deriveAesKeyIv(authKey, msgKey, true);
    const result2 = deriveAesKeyIv(authKey, msgKey2, true);

    expect(result1.key).not.toEqual(result2.key);
  });
});
