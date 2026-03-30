import crypto from 'node:crypto';

/**
 * Generate cryptographically secure random bytes.
 */
export function randomBytes(length: number): Buffer {
  return crypto.randomBytes(length);
}

/**
 * Generate a random bigint of the given bit length.
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
