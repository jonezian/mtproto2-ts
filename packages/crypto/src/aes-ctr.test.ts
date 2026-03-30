import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { AesCtr } from './aes-ctr.js';

describe('AES-256-CTR', () => {
  it('should encrypt and decrypt round-trip', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const data = crypto.randomBytes(64);

    const encryptor = new AesCtr(key, iv);
    const decryptor = new AesCtr(key, iv);

    const encrypted = encryptor.encrypt(data);
    const decrypted = decryptor.decrypt(encrypted);

    expect(decrypted).toEqual(data);
  });

  it('should handle streaming encryption', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);

    const encryptor = new AesCtr(key, iv);
    const decryptor = new AesCtr(key, iv);

    const chunk1 = crypto.randomBytes(10);
    const chunk2 = crypto.randomBytes(20);
    const chunk3 = crypto.randomBytes(15);

    const enc1 = encryptor.encrypt(chunk1);
    const enc2 = encryptor.encrypt(chunk2);
    const enc3 = encryptor.encrypt(chunk3);

    const dec1 = decryptor.decrypt(enc1);
    const dec2 = decryptor.decrypt(enc2);
    const dec3 = decryptor.decrypt(enc3);

    expect(dec1).toEqual(chunk1);
    expect(dec2).toEqual(chunk2);
    expect(dec3).toEqual(chunk3);
  });

  it('should produce different ciphertext from plaintext', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const data = Buffer.alloc(32, 0x42);

    const encryptor = new AesCtr(key, iv);
    const encrypted = encryptor.encrypt(data);

    expect(encrypted).not.toEqual(data);
  });

  it('should throw for wrong key size', () => {
    const key = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);

    expect(() => new AesCtr(key, iv)).toThrow('Key must be 32');
  });

  it('should throw for wrong IV size', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(32);

    expect(() => new AesCtr(key, iv)).toThrow('IV must be 16');
  });

  it('should handle non-block-aligned data', () => {
    const key = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);
    const data = crypto.randomBytes(7); // Not aligned to any block size

    const encryptor = new AesCtr(key, iv);
    const decryptor = new AesCtr(key, iv);

    const encrypted = encryptor.encrypt(data);
    const decrypted = decryptor.decrypt(encrypted);

    expect(decrypted).toEqual(data);
    expect(encrypted.length).toBe(7);
  });
});
