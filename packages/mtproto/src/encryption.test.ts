import { describe, it, expect } from 'vitest';
import { randomBytes, calcAuthKeyId } from '@kerainmtp/crypto';
import { encryptMessage, decryptMessage } from './encryption.js';

function makeAuthKey(): Buffer {
  return randomBytes(256);
}

describe('encryption', () => {
  it('should encrypt then decrypt round-trip (all fields match)', () => {
    const authKey = makeAuthKey();
    const salt = 0x1234567890ABCDEFn;
    const sessionId = 0x7EDCBA0987654321n;
    const msgId = 0x5E0B700000000000n;
    const seqNo = 1;
    const data = Buffer.from('Hello, MTProto!');

    const encrypted = encryptMessage({ authKey, salt, sessionId, msgId, seqNo, data });
    const decrypted = decryptMessage({ authKey, encrypted, isClient: true });

    expect(decrypted.salt).toBe(salt);
    expect(decrypted.sessionId).toBe(sessionId);
    expect(decrypted.msgId).toBe(msgId);
    expect(decrypted.seqNo).toBe(seqNo);
    expect(decrypted.data).toEqual(data);
  });

  it('should produce correct auth_key_id', () => {
    const authKey = makeAuthKey();
    const data = Buffer.alloc(16);

    const encrypted = encryptMessage({
      authKey,
      salt: 0n,
      sessionId: 0n,
      msgId: 0n,
      seqNo: 0,
      data,
    });

    const expectedAuthKeyId = calcAuthKeyId(authKey);
    const actualAuthKeyId = encrypted.subarray(0, 8);
    expect(actualAuthKeyId).toEqual(expectedAuthKeyId);
  });

  it('should produce correct msg_key', () => {
    const authKey = makeAuthKey();
    const data = Buffer.alloc(16);
    const salt = 1n;
    const sessionId = 2n;
    const msgId = 3n;
    const seqNo = 0;

    const encrypted = encryptMessage({ authKey, salt, sessionId, msgId, seqNo, data });

    // Extract the msg_key from the encrypted message
    const msgKeyFromEncrypted = encrypted.subarray(8, 24);

    // Decrypt to verify msg_key matches
    // (decryptMessage already verifies msg_key internally with timingSafeEqual)
    const decrypted = decryptMessage({ authKey, encrypted, isClient: true });
    expect(decrypted.data).toEqual(data);

    // Verify msg_key is 16 bytes
    expect(msgKeyFromEncrypted.length).toBe(16);
  });

  it('should have padding between 12-1024 bytes and 16-byte aligned', () => {
    const authKey = makeAuthKey();

    // Try with different data sizes to exercise padding logic
    for (const dataSize of [0, 1, 15, 16, 31, 32, 100, 255]) {
      const data = randomBytes(dataSize);
      const encrypted = encryptMessage({
        authKey,
        salt: 0n,
        sessionId: 0n,
        msgId: 0n,
        seqNo: 0,
        data,
      });

      // Encrypted data portion (after auth_key_id + msg_key)
      const encryptedData = encrypted.subarray(24);
      // Must be 16-byte aligned
      expect(encryptedData.length % 16).toBe(0);

      // The plaintext = header(32) + data + padding
      // Total plaintext = encryptedData.length (since AES-IGE preserves length)
      const plaintextLen = encryptedData.length;
      const paddingLen = plaintextLen - 32 - dataSize;
      expect(paddingLen).toBeGreaterThanOrEqual(12);
      expect(paddingLen).toBeLessThanOrEqual(1024);
      expect(plaintextLen % 16).toBe(0);
    }
  });

  it('should produce different encrypted output for different sessions', () => {
    const authKey = makeAuthKey();
    const data = Buffer.from('same data');

    const enc1 = encryptMessage({
      authKey,
      salt: 1n,
      sessionId: 100n,
      msgId: 0n,
      seqNo: 0,
      data,
    });

    const enc2 = encryptMessage({
      authKey,
      salt: 1n,
      sessionId: 200n,
      msgId: 0n,
      seqNo: 0,
      data,
    });

    // The encrypted data should differ because session IDs differ,
    // leading to different plaintexts, msg_keys, and thus different ciphertext
    expect(enc1).not.toEqual(enc2);
  });

  it('should fail decryption with wrong auth key', () => {
    const authKey1 = makeAuthKey();
    const authKey2 = makeAuthKey();
    const data = Buffer.from('secret');

    const encrypted = encryptMessage({
      authKey: authKey1,
      salt: 0n,
      sessionId: 0n,
      msgId: 0n,
      seqNo: 0,
      data,
    });

    expect(() =>
      decryptMessage({ authKey: authKey2, encrypted, isClient: true }),
    ).toThrow();
  });
});
