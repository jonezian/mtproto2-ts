/**
 * MTProto message acknowledgments (msgs_ack).
 *
 * Constructor ID: 0x62d6b459
 *
 * Format:
 *   constructor_id (4 bytes, 0x62d6b459)
 *   vector constructor_id (4 bytes, 0x1cb5c415)
 *   count (4 bytes, int32)
 *   msg_ids (count * 8 bytes, int64 each)
 */

const MSGS_ACK_CID = 0x62d6b459;
const VECTOR_CID = 0x1cb5c415;

/**
 * Create a msgs_ack TL object for the given message IDs.
 */
export function createMsgsAck(msgIds: bigint[]): Buffer {
  // constructor_id (4) + vector_cid (4) + count (4) + msg_ids (count * 8)
  const buf = Buffer.alloc(12 + msgIds.length * 8);
  let offset = 0;

  buf.writeUInt32LE(MSGS_ACK_CID, offset);
  offset += 4;

  buf.writeUInt32LE(VECTOR_CID, offset);
  offset += 4;

  buf.writeInt32LE(msgIds.length, offset);
  offset += 4;

  for (const id of msgIds) {
    buf.writeBigInt64LE(id, offset);
    offset += 8;
  }

  return buf;
}

/**
 * Parse a msgs_ack TL object and return the acknowledged message IDs.
 */
export function parseMsgsAck(data: Buffer): bigint[] {
  if (data.length < 12) {
    throw new Error('msgs_ack data too short');
  }

  let offset = 0;

  const cid = data.readUInt32LE(offset);
  offset += 4;

  if (cid !== MSGS_ACK_CID) {
    throw new Error(
      `Invalid msgs_ack constructor ID: 0x${cid.toString(16).padStart(8, '0')}, expected 0x${MSGS_ACK_CID.toString(16).padStart(8, '0')}`,
    );
  }

  const vectorCid = data.readUInt32LE(offset);
  offset += 4;

  if (vectorCid !== VECTOR_CID) {
    throw new Error(
      `Invalid vector constructor ID: 0x${vectorCid.toString(16).padStart(8, '0')}, expected 0x${VECTOR_CID.toString(16).padStart(8, '0')}`,
    );
  }

  const count = data.readInt32LE(offset);
  offset += 4;

  if (data.length < 12 + count * 8) {
    throw new Error('msgs_ack data truncated');
  }

  const msgIds: bigint[] = [];
  for (let i = 0; i < count; i++) {
    msgIds.push(data.readBigInt64LE(offset));
    offset += 8;
  }

  return msgIds;
}
