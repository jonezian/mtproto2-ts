import crypto from 'node:crypto';

/**
 * AES-256-CTR stream cipher.
 * Used for MTProto transport obfuscation.
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
