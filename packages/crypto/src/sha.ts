import crypto from 'node:crypto';

/**
 * Compute SHA-1 of the concatenation of all provided buffers.
 * Returns a 20-byte Buffer.
 */
export function sha1(...data: Buffer[]): Buffer {
  const hash = crypto.createHash('sha1');
  for (const buf of data) {
    hash.update(buf);
  }
  return hash.digest();
}

/**
 * Compute SHA-256 of the concatenation of all provided buffers.
 * Returns a 32-byte Buffer.
 */
export function sha256(...data: Buffer[]): Buffer {
  const hash = crypto.createHash('sha256');
  for (const buf of data) {
    hash.update(buf);
  }
  return hash.digest();
}
