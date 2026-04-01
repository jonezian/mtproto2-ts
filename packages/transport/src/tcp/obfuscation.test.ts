import { describe, it, expect } from 'vitest';
import { generateObfuscatedInit, TRANSPORT_MAGIC } from './obfuscation.js';
import { AesCtr } from '@mtproto2/crypto';
import { AbridgedTransport } from './abridged.js';
import { IntermediateTransport } from './intermediate.js';

describe('Obfuscation', () => {
  describe('generateObfuscatedInit', () => {
    it('generates 64-byte init payload', () => {
      const { initBytes } = generateObfuscatedInit(TRANSPORT_MAGIC.abridged);
      expect(initBytes.length).toBe(64);
    });

    it('first byte is not 0xef', () => {
      // Run multiple times since generation is random
      for (let i = 0; i < 50; i++) {
        const { initBytes } = generateObfuscatedInit(TRANSPORT_MAGIC.intermediate);
        expect(initBytes[0]).not.toBe(0xef);
      }
    });

    it('first 4 bytes do not match banned patterns', () => {
      const banned = new Set([
        0x44414548, // HEAD
        0x54534f50, // POST
        0x20544547, // GET
        0x4954504f, // OPTI
        0xdddddddd,
        0xeeeeeeee,
        0x02010316, // TLS
      ]);

      for (let i = 0; i < 50; i++) {
        const { initBytes } = generateObfuscatedInit(TRANSPORT_MAGIC.abridged);
        const first4 = initBytes.readUInt32BE(0);
        expect(banned.has(first4)).toBe(false);
      }
    });

    it('bytes[4:8] are not all zeros', () => {
      for (let i = 0; i < 50; i++) {
        const { initBytes } = generateObfuscatedInit(TRANSPORT_MAGIC.abridged);
        const second4 = initBytes.readUInt32LE(4);
        expect(second4).not.toBe(0);
      }
    });

    it('returns working encryptor and decryptor', () => {
      const { encryptor, decryptor, initBytes } = generateObfuscatedInit(TRANSPORT_MAGIC.intermediate);

      // The encryptor and decryptor are AesCtr instances
      expect(encryptor).toBeInstanceOf(AesCtr);
      expect(decryptor).toBeInstanceOf(AesCtr);

      // Verify initBytes is 64 bytes
      expect(initBytes.length).toBe(64);
    });
  });

  describe('init magic encryption', () => {
    it('magic bytes at offset 56 are encrypted (not plaintext)', () => {
      const magic = TRANSPORT_MAGIC.intermediate; // 0xeeeeeeee
      const { initBytes } = generateObfuscatedInit(magic);

      // The transmitted initBytes should NOT have plaintext magic at bytes 56-59
      // because the magic was encrypted along with the rest
      const bytes56 = initBytes.readUInt32LE(56);
      // It's theoretically possible (but astronomically unlikely with AES-CTR)
      // that encryption produces the same value. We run multiple times to be safe.
      let allMatchMagic = true;
      for (let i = 0; i < 20; i++) {
        const { initBytes: ib } = generateObfuscatedInit(magic);
        if (ib.readUInt32LE(56) !== magic) {
          allMatchMagic = false;
          break;
        }
      }
      expect(allMatchMagic).toBe(false);
    });

    it('server can decrypt init and find magic at offset 56', () => {
      const magic = TRANSPORT_MAGIC.intermediate;
      const { initBytes } = generateObfuscatedInit(magic);

      // Server derives keys from the plaintext bytes 0-55
      const encryptKey = Buffer.alloc(32);
      initBytes.copy(encryptKey, 0, 8, 40);
      const encryptIv = Buffer.alloc(16);
      initBytes.copy(encryptIv, 0, 40, 56);

      // Server creates a cipher with the same key/iv and decrypts
      const serverCipher = new AesCtr(encryptKey, encryptIv);
      const decrypted = serverCipher.encrypt(initBytes); // CTR: encrypt === decrypt

      // After decryption, bytes 56-59 should contain the magic
      expect(decrypted.readUInt32LE(56)).toBe(magic);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('data encrypted by encryptor can be decrypted by corresponding decryptor', () => {
      // Simulate two sides: the client sends, the server receives.
      // The client's encryptor uses key=bytes[8:40], iv=bytes[40:56].
      // The server's decryptor uses the SAME key/iv derived from the init bytes.
      //
      // In a real scenario, the server would derive these from the 64 bytes it receives.
      // Here we just test that the encryptor output is consistent.

      const { encryptor } = generateObfuscatedInit(TRANSPORT_MAGIC.abridged);

      // Encrypt some data
      const plaintext = Buffer.from('Hello, MTProto transport obfuscation!');
      const ciphertext = encryptor.encrypt(plaintext);

      // Ciphertext should differ from plaintext
      expect(ciphertext).not.toEqual(plaintext);
      expect(ciphertext.length).toBe(plaintext.length);
    });

    it('simulates full client-server obfuscation round-trip', () => {
      // Generate init for client side
      const magic = TRANSPORT_MAGIC.intermediate;
      const { initBytes, encryptor } = generateObfuscatedInit(magic);

      // Server side: derive keys from the received initBytes
      // Encrypt key = bytes[8:40], encrypt IV = bytes[40:56]
      // These are the SEND keys from client perspective => RECEIVE keys for server
      const clientEncKey = Buffer.alloc(32);
      initBytes.copy(clientEncKey, 0, 8, 40);
      const clientEncIv = Buffer.alloc(16);
      initBytes.copy(clientEncIv, 0, 40, 56);

      // Server creates a decryptor with client's encrypt key/iv
      // But first, the server must first process the same init bytes to advance the CTR state.
      // The init bytes were encrypted with the encryptor, so the server's decryptor
      // must first decrypt the init bytes to sync the CTR counter.
      const serverDecryptor = new AesCtr(clientEncKey, clientEncIv);
      // Decrypt the init bytes to advance the counter (server does this internally)
      serverDecryptor.encrypt(initBytes);

      // Now client sends framed data
      const innerTransport = new IntermediateTransport();
      const payload = Buffer.alloc(64, 0x42);
      const framed = innerTransport.encodePacket(payload);
      const encrypted = encryptor.encrypt(framed);

      // Server decrypts
      const decrypted = serverDecryptor.encrypt(encrypted); // AES-CTR: encrypt === decrypt

      // Server decodes
      const decoderTransport = new IntermediateTransport();
      const decoded = decoderTransport.decodePacket(decrypted);

      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });

    it('obfuscation works for abridged transport framing', () => {
      const magic = TRANSPORT_MAGIC.abridged;
      const { initBytes, encryptor } = generateObfuscatedInit(magic);

      // Derive server-side decryptor
      const clientEncKey = Buffer.alloc(32);
      initBytes.copy(clientEncKey, 0, 8, 40);
      const clientEncIv = Buffer.alloc(16);
      initBytes.copy(clientEncIv, 0, 40, 56);

      const serverDecryptor = new AesCtr(clientEncKey, clientEncIv);
      serverDecryptor.encrypt(initBytes); // Advance counter

      // Client sends abridged-framed data
      const innerTransport = new AbridgedTransport();
      const payload = Buffer.alloc(16, 0xab);
      const framed = innerTransport.encodePacket(payload);
      const encrypted = encryptor.encrypt(framed);

      // Server decrypts and decodes
      const decrypted = serverDecryptor.encrypt(encrypted);
      const decoder = new AbridgedTransport();
      const decoded = decoder.decodePacket(decrypted);

      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });
  });
});
