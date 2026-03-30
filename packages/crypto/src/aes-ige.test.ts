import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { aesIgeEncrypt, aesIgeDecrypt } from './aes-ige.js';

describe('AES-256-IGE', () => {
  it('should encrypt and decrypt round-trip with 16-byte payload', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(32);
    const data = crypto.randomBytes(16);

    const encrypted = aesIgeEncrypt(data, key, iv);
    const decrypted = aesIgeDecrypt(encrypted, key, iv);

    expect(decrypted).toEqual(data);
  });

  it('should encrypt and decrypt round-trip with 32-byte payload', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(32);
    const data = crypto.randomBytes(32);

    const encrypted = aesIgeEncrypt(data, key, iv);
    const decrypted = aesIgeDecrypt(encrypted, key, iv);

    expect(decrypted).toEqual(data);
  });

  it('should encrypt and decrypt round-trip with 64-byte payload', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(32);
    const data = crypto.randomBytes(64);

    const encrypted = aesIgeEncrypt(data, key, iv);
    const decrypted = aesIgeDecrypt(encrypted, key, iv);

    expect(decrypted).toEqual(data);
  });

  it('should produce different ciphertext for different keys', () => {
    const key1 = crypto.randomBytes(32);
    const key2 = crypto.randomBytes(32);
    const iv = crypto.randomBytes(32);
    const data = crypto.randomBytes(32);

    const encrypted1 = aesIgeEncrypt(data, key1, iv);
    const encrypted2 = aesIgeEncrypt(data, key2, iv);

    expect(encrypted1).not.toEqual(encrypted2);
  });

  it('should produce different ciphertext from plaintext', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(32);
    const data = Buffer.alloc(16, 0x42);

    const encrypted = aesIgeEncrypt(data, key, iv);

    expect(encrypted).not.toEqual(data);
  });

  it('should throw for non-16-byte aligned data', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(32);
    const data = crypto.randomBytes(15);

    expect(() => aesIgeEncrypt(data, key, iv)).toThrow('multiple of 16');
    expect(() => aesIgeDecrypt(data, key, iv)).toThrow('multiple of 16');
  });

  it('should throw for wrong key size', () => {
    const key = crypto.randomBytes(16);
    const iv = crypto.randomBytes(32);
    const data = crypto.randomBytes(16);

    expect(() => aesIgeEncrypt(data, key, iv)).toThrow('Key must be 32');
  });

  it('should throw for wrong IV size', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const data = crypto.randomBytes(16);

    expect(() => aesIgeEncrypt(data, key, iv)).toThrow('IV must be 32');
  });

  it('should produce deterministic output with same inputs', () => {
    const key = Buffer.alloc(32, 0x01);
    const iv = Buffer.alloc(32, 0x02);
    const data = Buffer.alloc(16, 0x03);

    const encrypted1 = aesIgeEncrypt(data, key, iv);
    const encrypted2 = aesIgeEncrypt(data, key, iv);

    expect(encrypted1).toEqual(encrypted2);
  });

  it('should handle large payloads (256 bytes)', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(32);
    const data = crypto.randomBytes(256);

    const encrypted = aesIgeEncrypt(data, key, iv);
    const decrypted = aesIgeDecrypt(encrypted, key, iv);

    expect(decrypted).toEqual(data);
    expect(encrypted.length).toBe(256);
  });
});
