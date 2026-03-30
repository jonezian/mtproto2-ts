import crypto from 'node:crypto';

const BLOCK_SIZE = 16;

function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const result = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i]! ^ b[i]!;
  }
  return result;
}

function aesEcbEncrypt(key: Buffer, block: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-256-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function aesEcbDecrypt(key: Buffer, block: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(block), decipher.final()]);
}

/**
 * AES-256-IGE encryption.
 * @param data - Plaintext (must be 16-byte aligned)
 * @param key  - 32-byte AES key
 * @param iv   - 32-byte IV (first 16 bytes = iv_cipher, last 16 bytes = iv_plain)
 */
export function aesIgeEncrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  if (data.length % BLOCK_SIZE !== 0) {
    throw new Error('Data length must be a multiple of 16 bytes');
  }
  if (key.length !== 32) {
    throw new Error('Key must be 32 bytes');
  }
  if (iv.length !== 32) {
    throw new Error('IV must be 32 bytes');
  }

  const result = Buffer.alloc(data.length);
  let ivCipherPrev = iv.subarray(0, BLOCK_SIZE);
  let ivPlainPrev = iv.subarray(BLOCK_SIZE, 32);

  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
    const plainBlock = data.subarray(offset, offset + BLOCK_SIZE);

    // x_i = plaintext_i XOR iv_cipher_prev
    const xored = xorBuffers(plainBlock, ivCipherPrev);
    // y_i = AES_ECB_encrypt(key, x_i) XOR iv_plain_prev
    const encrypted = xorBuffers(aesEcbEncrypt(key, xored), ivPlainPrev);

    encrypted.copy(result, offset);

    // Update for next block
    ivCipherPrev = encrypted;
    ivPlainPrev = plainBlock;
  }

  return result;
}

/**
 * AES-256-IGE decryption.
 * @param data - Ciphertext (must be 16-byte aligned)
 * @param key  - 32-byte AES key
 * @param iv   - 32-byte IV (first 16 bytes = iv_cipher, last 16 bytes = iv_plain)
 */
export function aesIgeDecrypt(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  if (data.length % BLOCK_SIZE !== 0) {
    throw new Error('Data length must be a multiple of 16 bytes');
  }
  if (key.length !== 32) {
    throw new Error('Key must be 32 bytes');
  }
  if (iv.length !== 32) {
    throw new Error('IV must be 32 bytes');
  }

  const result = Buffer.alloc(data.length);
  let ivCipherPrev = iv.subarray(0, BLOCK_SIZE);
  let ivPlainPrev = iv.subarray(BLOCK_SIZE, 32);

  for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
    const cipherBlock = data.subarray(offset, offset + BLOCK_SIZE);

    // x_i = ciphertext_i XOR iv_plain_prev
    const xored = xorBuffers(cipherBlock, ivPlainPrev);
    // y_i = AES_ECB_decrypt(key, x_i) XOR iv_cipher_prev
    const decrypted = xorBuffers(aesEcbDecrypt(key, xored), ivCipherPrev);

    decrypted.copy(result, offset);

    // Update for next block
    ivCipherPrev = cipherBlock;
    ivPlainPrev = decrypted;
  }

  return result;
}
