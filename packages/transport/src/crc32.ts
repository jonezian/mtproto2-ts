/**
 * CRC32 (IEEE 802.3 polynomial) implementation.
 * Used by the Full transport to verify frame integrity.
 */

const TABLE = new Uint32Array(256);

// Build CRC32 lookup table (IEEE polynomial 0xEDB88320)
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    if (crc & 1) {
      crc = (crc >>> 1) ^ 0xedb88320;
    } else {
      crc = crc >>> 1;
    }
  }
  TABLE[i] = crc >>> 0;
}

/**
 * Compute CRC32 of a buffer.
 * Returns an unsigned 32-bit integer.
 */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ TABLE[(crc ^ data[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
