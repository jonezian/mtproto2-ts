import crypto from 'node:crypto';

/**
 * AES-256-CTR stream cipher for transport obfuscation.
 *
 * **IMPORTANT**: Each AesCtr instance maintains internal counter state.
 * A new instance MUST be created for each connection/session. Never reuse
 * an AesCtr instance across different (key, IV) contexts, as this would
 * violate the CTR mode security requirement of unique (key, nonce) pairs.
 *
 * The current usage pattern (one instance per obfuscated transport connection)
 * is correct and safe.
 */
export class AesCtr {
  private cipher: crypto.Cipher;
  private decipher: crypto.Decipher;

  constructor(key: Buffer, iv: Buffer) {
    if (key.length !== 32) {
      throw new Error('Key must be 32 bytes');
    }
    if (iv.length !== 16) {
      throw new Error('IV must be 16 bytes');
    }

    this.cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
    this.decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
  }

  encrypt(data: Buffer): Buffer {
    return this.cipher.update(data);
  }

  decrypt(data: Buffer): Buffer {
    return this.decipher.update(data);
  }
}
