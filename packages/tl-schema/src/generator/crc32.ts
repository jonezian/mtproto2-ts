/**
 * CRC32 (ISO 3309) computation.
 *
 * Uses the standard polynomial 0xEDB88320 (reversed representation).
 * Used to verify TL constructor IDs.
 */

const TABLE = new Uint32Array(256);

// Pre-compute CRC32 lookup table
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    if (crc & 1) {
      crc = (crc >>> 1) ^ 0xEDB88320;
    } else {
      crc = crc >>> 1;
    }
  }
  TABLE[i] = crc;
}

/**
 * Compute the CRC32 checksum of a UTF-8 string.
 *
 * Returns an unsigned 32-bit integer.
 */
export function crc32(input: string): number {
  const bytes = new TextEncoder().encode(input);
  let crc = 0xFFFFFFFF;

  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ bytes[i]) & 0xFF];
  }

  return (crc ^ 0xFFFFFFFF) >>> 0;
}
