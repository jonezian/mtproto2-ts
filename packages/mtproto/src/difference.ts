/**
 * getDifference / getChannelDifference helpers for MTProto 2.0.
 *
 * Provides constructor ID constants for update-related types,
 * helpers to extract pts/qts from raw update data, and serialization
 * functions for the updates.getState, updates.getDifference, and
 * updates.getChannelDifference RPC methods.
 */

import { TLReader } from '@kerainmtp/binary';
import { TLWriter } from '@kerainmtp/binary';

export interface BufferedUpdate {
  constructorId: number;
  data: Buffer;
  pts?: number;
  ptsCount?: number;
  qts?: number;
}

/**
 * Constructor IDs for update wrapper types.
 * These are the top-level types that wrap individual updates.
 */
export const UPDATE_CIDS = {
  updatesTooLong: 0xe317af7e,
  updateShortMessage: 0x313bc7f8,
  updateShortChatMessage: 0x4d6deea5,
  updateShort: 0x78d4dec1,
  updatesCombined: 0x725b04c3,
  updates: 0x74ae4240,
  updateShortSentMessage: 0x9015e101,
} as const;

/**
 * Constructor IDs for RPC methods related to updates.
 */
const RPC_CIDS = {
  getState: 0xedd4882a,             // updates.getState
  getDifference: 0x19c2f763,        // updates.getDifference (layer 155+)
  getChannelDifference: 0x03173d78, // updates.getChannelDifference
  channelMessagesFilterEmpty: 0x94d42ee7,
  channelMessagesFilterNew: 0xcd77d957, // Undocumented but used in practice; using collapsed filter
  inputChannelEmpty: 0xee8c1e86,    // Actually not needed, but here for reference
  inputChannel: 0xf35aec28,
} as const;

/**
 * Extract pts/ptsCount/qts from raw update data based on constructor ID.
 *
 * This function reads update payloads to extract state-tracking fields.
 * The exact offsets depend on the update type. For most updates,
 * pts and pts_count are at predictable positions after the constructor ID.
 *
 * Returns null if the constructor ID is not recognized or data is too short.
 */
export function extractUpdateState(constructorId: number, data: Buffer): {
  pts?: number;
  ptsCount?: number;
  qts?: number;
} | null {
  if (data.length < 8) {
    return null;
  }

  const reader = new TLReader(data);

  // Skip the constructor ID (already known)
  reader.readUInt32();

  switch (constructorId) {
    case UPDATE_CIDS.updateShortMessage: {
      // updateShortMessage#313bc7f8:
      //   flags:# out:flags.1?true mentioned:flags.4?true media_unread:flags.5?true
      //   silent:flags.13?true id:int user_id:long message:string pts:int pts_count:int
      //   date:int ...
      // We need to skip: flags(4) + id(4) + user_id(8) + message(variable) to reach pts
      if (data.length < 12) return null;
      const flags = reader.readInt32(); // flags
      reader.readInt32(); // id
      reader.readInt64(); // user_id
      reader.readString(); // message
      const pts = reader.readInt32();
      const ptsCount = reader.readInt32();
      void flags; // suppress unused warning
      return { pts, ptsCount };
    }

    case UPDATE_CIDS.updateShortChatMessage: {
      // updateShortChatMessage#4d6deea5:
      //   flags:# out:flags.1?true mentioned:flags.4?true media_unread:flags.5?true
      //   silent:flags.13?true id:int from_id:long chat_id:long message:string pts:int pts_count:int
      //   date:int ...
      if (data.length < 16) return null;
      const flags = reader.readInt32(); // flags
      reader.readInt32(); // id
      reader.readInt64(); // from_id
      reader.readInt64(); // chat_id
      reader.readString(); // message
      const pts = reader.readInt32();
      const ptsCount = reader.readInt32();
      void flags;
      return { pts, ptsCount };
    }

    case UPDATE_CIDS.updateShort: {
      // updateShort#78d4dec1: update:Update date:int
      // The inner update is a TL object. We don't fully parse it here,
      // but we return null because the caller should parse the inner update separately.
      return null;
    }

    case UPDATE_CIDS.updateShortSentMessage: {
      // updateShortSentMessage#9015e101:
      //   flags:# out:flags.1?true id:int pts:int pts_count:int date:int ...
      if (data.length < 20) return null;
      reader.readInt32(); // flags
      reader.readInt32(); // id
      const pts = reader.readInt32();
      const ptsCount = reader.readInt32();
      return { pts, ptsCount };
    }

    default:
      return null;
  }
}

/**
 * Check if a constructor ID is an update wrapper type
 * (Updates, UpdatesCombined, UpdateShort, etc.).
 */
export function isUpdateWrapper(constructorId: number): boolean {
  const cids = Object.values(UPDATE_CIDS) as readonly number[];
  return cids.includes(constructorId);
}

/**
 * Parse an updateShort — extract the inner update constructor ID and data.
 *
 * updateShort#78d4dec1: update:Update date:int
 *
 * After the constructor ID (4 bytes), the next field is the inner Update
 * which starts with its own constructor ID.
 */
export function parseUpdateShort(data: Buffer): BufferedUpdate | null {
  if (data.length < 12) {
    return null;
  }

  const reader = new TLReader(data);
  const outerCid = reader.readUInt32();

  if (outerCid !== UPDATE_CIDS.updateShort) {
    return null;
  }

  // The inner update starts here — its constructor ID is at position 4
  const innerCid = reader.readUInt32();

  // The inner data is everything from offset 4 to the end minus the trailing date(4)
  // But we don't know the exact boundary without full TL parsing.
  // Instead, return the entire data from offset 4 onward (minus the 4-byte date at the end)
  // as the inner update's raw data, and let the caller deal with it.
  // The date is the last 4 bytes.
  const innerData = Buffer.from(data.subarray(4, data.length - 4));

  return {
    constructorId: innerCid,
    data: innerData,
  };
}

/**
 * Serialize an updates.getState request.
 *
 * updates.getState#edd4882a = updates.State
 */
export function serializeGetState(): Buffer {
  const writer = new TLWriter(4);
  writer.writeConstructorId(RPC_CIDS.getState);
  return writer.toBuffer();
}

/**
 * Serialize an updates.getDifference request.
 *
 * updates.getDifference#19c2f763:
 *   flags:# pts:int date:int qts:int pts_total_limit:flags.0?int
 *   = updates.Difference
 *
 * We omit the optional pts_total_limit (flags = 0).
 */
export function serializeGetDifference(pts: number, qts: number, date: number): Buffer {
  const writer = new TLWriter(20);
  writer.writeConstructorId(RPC_CIDS.getDifference);
  writer.writeInt32(0);    // flags (no optional fields)
  writer.writeInt32(pts);
  writer.writeInt32(date);
  writer.writeInt32(qts);
  return writer.toBuffer();
}

/**
 * Serialize an updates.getChannelDifference request.
 *
 * updates.getChannelDifference#03173d78:
 *   flags:# force:flags.0?true channel:InputChannel
 *   filter:ChannelMessagesFilter pts:int limit:int
 *   = updates.ChannelDifference
 */
export function serializeGetChannelDifference(
  channelId: number,
  accessHash: bigint,
  pts: number,
  limit: number,
  filter: 'empty' | 'new',
): Buffer {
  const writer = new TLWriter(64);
  writer.writeConstructorId(RPC_CIDS.getChannelDifference);
  writer.writeInt32(0);   // flags (force=false)

  // InputChannel#f35aec28: channel_id:long access_hash:long
  writer.writeConstructorId(RPC_CIDS.inputChannel);
  writer.writeInt64(BigInt(channelId));
  writer.writeInt64(accessHash);

  // ChannelMessagesFilter
  if (filter === 'empty') {
    writer.writeConstructorId(RPC_CIDS.channelMessagesFilterEmpty);
  } else {
    writer.writeConstructorId(RPC_CIDS.channelMessagesFilterNew);
  }

  writer.writeInt32(pts);
  writer.writeInt32(limit);

  return writer.toBuffer();
}
