/**
 * MTProto message container (msg_container).
 *
 * Constructor ID: 0x73f1f8dc
 *
 * Format:
 *   constructor_id (4 bytes)
 *   count (4 bytes, int32)
 *   for each message:
 *     msg_id (8 bytes)
 *     seqno (4 bytes)
 *     bytes (4 bytes) - length of body
 *     body (bytes bytes)
 */

const CONTAINER_CID = 0x73f1f8dc;

export interface InnerMessage {
  msgId: bigint;
  seqNo: number;
  body: Buffer;
}

/**
 * Pack multiple messages into a msg_container.
 */
export function packContainer(messages: InnerMessage[]): Buffer {
  // Calculate total size:
  // constructor_id (4) + count (4) + sum of (msg_id (8) + seqno (4) + bytes (4) + body)
  let totalSize = 8; // 4 + 4
  for (const msg of messages) {
    totalSize += 16 + msg.body.length; // 8 + 4 + 4 + body.length
  }

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // Constructor ID
  buf.writeUInt32LE(CONTAINER_CID, offset);
  offset += 4;

  // Count
  buf.writeInt32LE(messages.length, offset);
  offset += 4;

  // Messages
  for (const msg of messages) {
    buf.writeBigInt64LE(msg.msgId, offset);
    offset += 8;

    buf.writeInt32LE(msg.seqNo, offset);
    offset += 4;

    buf.writeInt32LE(msg.body.length, offset);
    offset += 4;

    msg.body.copy(buf, offset);
    offset += msg.body.length;
  }

  return buf;
}

/**
 * Unpack a msg_container into individual messages.
 */
export function unpackContainer(data: Buffer): InnerMessage[] {
  if (data.length < 8) {
    throw new Error('Container data too short');
  }

  let offset = 0;

  const cid = data.readUInt32LE(offset);
  offset += 4;

  if (cid !== CONTAINER_CID) {
    throw new Error(
      `Invalid container constructor ID: 0x${cid.toString(16).padStart(8, '0')}, expected 0x${CONTAINER_CID.toString(16).padStart(8, '0')}`,
    );
  }

  const count = data.readInt32LE(offset);
  offset += 4;

  if (count < 0 || count > 1024) {
    throw new Error(`Invalid container message count: ${count} (max 1024)`);
  }

  const messages: InnerMessage[] = [];

  for (let i = 0; i < count; i++) {
    if (offset + 16 > data.length) {
      throw new Error('Container data truncated reading message header');
    }

    const msgId = data.readBigInt64LE(offset);
    offset += 8;

    const seqNo = data.readInt32LE(offset);
    offset += 4;

    const bodyLen = data.readInt32LE(offset);
    offset += 4;

    if (offset + bodyLen > data.length) {
      throw new Error('Container data truncated reading message body');
    }

    const body = Buffer.from(data.subarray(offset, offset + bodyLen));
    offset += bodyLen;

    messages.push({ msgId, seqNo, body });
  }

  return messages;
}

/**
 * Check if a buffer starts with the msg_container constructor ID.
 */
export function isContainer(data: Buffer): boolean {
  if (data.length < 4) return false;
  return data.readUInt32LE(0) === CONTAINER_CID;
}
