import crypto from 'node:crypto';

/**
 * Generate cryptographically secure random bytes.
 *
 * Wraps `crypto.randomBytes()` from the Node.js `node:crypto` module.
 * This function MUST be used for all random generation in the library --
 * `Math.random()` is never acceptable.
 *
 * @param length - Number of random bytes to generate
 * @returns Buffer of cryptographically secure random bytes
 *
 * @example
 * ```ts
 * // Generate a 16-byte nonce
 * const nonce = randomBytes(16);
 *
 * // Generate 32 bytes for an AES key
 * const key = randomBytes(32);
 * ```
 */
export function randomBytes(length: number): Buffer {
  return crypto.randomBytes(length);
}

/**
 * Generate a random bigint of exactly the given bit length.
 *
 * The returned value always has the top bit set, ensuring it is
 * exactly `bits` bits long. Uses `crypto.randomBytes()` internally.
 *
 * @param bits - Desired bit length of the random value
 * @returns A bigint with exactly `bits` bits (top bit set)
 *
 * @example
 * ```ts
 * // Generate a 2048-bit random number for DH
 * const b = randomBigInt(2048);
 *
 * // Generate a 128-bit random value
 * const r = randomBigInt(128);
 * ```
 */
export function randomBigInt(bits: number): bigint {
  const byteLen = Math.ceil(bits / 8);
  const buf = crypto.randomBytes(byteLen);

  // Mask the top byte so we get exactly `bits` bits
  const excessBits = byteLen * 8 - bits;
  if (excessBits > 0) {
    buf[0]! &= (1 << (8 - excessBits)) - 1;
  }

  // Ensure the top bit is set so we get a number of exactly `bits` bits
  const topBitByte = Math.floor(excessBits / 8);
  const topBitPos = 7 - (excessBits % 8);
  buf[topBitByte]! |= 1 << topBitPos;

  return BigInt('0x' + buf.toString('hex'));
}
