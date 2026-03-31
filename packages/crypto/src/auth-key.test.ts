import { describe, it, expect } from 'vitest';
import { calcAuthKeyId, calcMsgKey } from './auth-key.js';
import { deriveAesKeyIv } from './key-derivation.js';

describe('calcAuthKeyId', () => {
  it('returns a Buffer of exactly 8 bytes', () => {
    const authKey = Buffer.alloc(256, 0xab);
    const result = calcAuthKeyId(authKey);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(8);
  });

  it('is deterministic (same input produces same output)', () => {
    const authKey = Buffer.alloc(256, 0xcd);
    const id1 = calcAuthKeyId(authKey);
    const id2 = calcAuthKeyId(authKey);
    expect(id1.equals(id2)).toBe(true);
  });

  it('produces different IDs for different keys', () => {
    const key1 = Buffer.alloc(256, 0x11);
    const key2 = Buffer.alloc(256, 0x22);
    const id1 = calcAuthKeyId(key1);
    const id2 = calcAuthKeyId(key2);
    expect(id1.equals(id2)).toBe(false);
  });
});

describe('calcMsgKey', () => {
  const authKey = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) authKey[i] = i & 0xff;
  const plaintext = Buffer.alloc(64, 0x42);

  it('returns a Buffer of exactly 16 bytes', () => {
    const result = calcMsgKey(authKey, plaintext, true);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBe(16);
  });

  it('is deterministic', () => {
    const r1 = calcMsgKey(authKey, plaintext, true);
    const r2 = calcMsgKey(authKey, plaintext, true);
    expect(r1.equals(r2)).toBe(true);
  });

  it('produces different results for isClient=true vs isClient=false', () => {
    const clientKey = calcMsgKey(authKey, plaintext, true);
    const serverKey = calcMsgKey(authKey, plaintext, false);
    expect(clientKey.equals(serverKey)).toBe(false);
  });

  it('produces different results for different plaintexts', () => {
    const plain1 = Buffer.alloc(64, 0xaa);
    const plain2 = Buffer.alloc(64, 0xbb);
    const r1 = calcMsgKey(authKey, plain1, true);
    const r2 = calcMsgKey(authKey, plain2, true);
    expect(r1.equals(r2)).toBe(false);
  });
});

describe('deriveAesKeyIv', () => {
  const authKey = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) authKey[i] = i & 0xff;
  const msgKey = Buffer.alloc(16, 0x55);

  it('returns an object with key (32 bytes) and iv (32 bytes)', () => {
    const result = deriveAesKeyIv(authKey, msgKey, true);
    expect(Buffer.isBuffer(result.key)).toBe(true);
    expect(Buffer.isBuffer(result.iv)).toBe(true);
    expect(result.key.length).toBe(32);
    expect(result.iv.length).toBe(32);
  });

  it('is deterministic', () => {
    const r1 = deriveAesKeyIv(authKey, msgKey, true);
    const r2 = deriveAesKeyIv(authKey, msgKey, true);
    expect(r1.key.equals(r2.key)).toBe(true);
    expect(r1.iv.equals(r2.iv)).toBe(true);
  });

  it('produces different results for isClient=true vs isClient=false', () => {
    const client = deriveAesKeyIv(authKey, msgKey, true);
    const server = deriveAesKeyIv(authKey, msgKey, false);
    expect(client.key.equals(server.key)).toBe(false);
    expect(client.iv.equals(server.iv)).toBe(false);
  });

  it('produces different results for different msgKeys', () => {
    const mk1 = Buffer.alloc(16, 0xaa);
    const mk2 = Buffer.alloc(16, 0xbb);
    const r1 = deriveAesKeyIv(authKey, mk1, true);
    const r2 = deriveAesKeyIv(authKey, mk2, true);
    expect(r1.key.equals(r2.key)).toBe(false);
  });
});
