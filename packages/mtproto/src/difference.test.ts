import { describe, it, expect } from 'vitest';
import { TLWriter } from '@kerainmtp/binary';
import { TLReader } from '@kerainmtp/binary';
import {
  UPDATE_CIDS,
  extractUpdateState,
  isUpdateWrapper,
  parseUpdateShort,
  serializeGetState,
  serializeGetDifference,
  serializeGetChannelDifference,
} from './difference.js';

describe('difference', () => {
  describe('UPDATE_CIDS', () => {
    it('should have correct constructor IDs', () => {
      expect(UPDATE_CIDS.updatesTooLong).toBe(0xe317af7e);
      expect(UPDATE_CIDS.updateShortMessage).toBe(0x313bc7f8);
      expect(UPDATE_CIDS.updateShortChatMessage).toBe(0x4d6deea5);
      expect(UPDATE_CIDS.updateShort).toBe(0x78d4dec1);
      expect(UPDATE_CIDS.updatesCombined).toBe(0x725b04c3);
      expect(UPDATE_CIDS.updates).toBe(0x74ae4240);
      expect(UPDATE_CIDS.updateShortSentMessage).toBe(0x9015e101);
    });
  });

  describe('isUpdateWrapper', () => {
    it('should return true for all update wrapper CIDs', () => {
      expect(isUpdateWrapper(UPDATE_CIDS.updatesTooLong)).toBe(true);
      expect(isUpdateWrapper(UPDATE_CIDS.updateShortMessage)).toBe(true);
      expect(isUpdateWrapper(UPDATE_CIDS.updateShortChatMessage)).toBe(true);
      expect(isUpdateWrapper(UPDATE_CIDS.updateShort)).toBe(true);
      expect(isUpdateWrapper(UPDATE_CIDS.updatesCombined)).toBe(true);
      expect(isUpdateWrapper(UPDATE_CIDS.updates)).toBe(true);
      expect(isUpdateWrapper(UPDATE_CIDS.updateShortSentMessage)).toBe(true);
    });

    it('should return false for non-update CIDs', () => {
      expect(isUpdateWrapper(0xDEADBEEF)).toBe(false);
      expect(isUpdateWrapper(0x00000000)).toBe(false);
      expect(isUpdateWrapper(0xf35c6d01)).toBe(false); // rpc_result
    });
  });

  describe('extractUpdateState', () => {
    it('should return null for data too short', () => {
      expect(extractUpdateState(UPDATE_CIDS.updateShortMessage, Buffer.alloc(4))).toBeNull();
    });

    it('should return null for unknown constructor ID', () => {
      const buf = Buffer.alloc(32);
      buf.writeUInt32LE(0xDEADBEEF, 0);
      expect(extractUpdateState(0xDEADBEEF, buf)).toBeNull();
    });

    it('should extract pts/ptsCount from updateShortMessage', () => {
      // Build an updateShortMessage: cid(4) + flags(4) + id(4) + user_id(8) + message(TL string) + pts(4) + pts_count(4) + date(4)
      const writer = new TLWriter();
      writer.writeConstructorId(UPDATE_CIDS.updateShortMessage);
      writer.writeInt32(0);          // flags
      writer.writeInt32(12345);      // id
      writer.writeInt64(67890n);     // user_id
      writer.writeString('hello');   // message
      writer.writeInt32(42);         // pts
      writer.writeInt32(1);          // pts_count
      writer.writeInt32(1700000000); // date

      const buf = writer.toBuffer();
      const result = extractUpdateState(UPDATE_CIDS.updateShortMessage, buf);

      expect(result).not.toBeNull();
      expect(result!.pts).toBe(42);
      expect(result!.ptsCount).toBe(1);
    });

    it('should extract pts/ptsCount from updateShortChatMessage', () => {
      const writer = new TLWriter();
      writer.writeConstructorId(UPDATE_CIDS.updateShortChatMessage);
      writer.writeInt32(0);          // flags
      writer.writeInt32(12345);      // id
      writer.writeInt64(100n);       // from_id
      writer.writeInt64(200n);       // chat_id
      writer.writeString('msg');     // message
      writer.writeInt32(99);         // pts
      writer.writeInt32(3);          // pts_count
      writer.writeInt32(1700000000); // date

      const buf = writer.toBuffer();
      const result = extractUpdateState(UPDATE_CIDS.updateShortChatMessage, buf);

      expect(result).not.toBeNull();
      expect(result!.pts).toBe(99);
      expect(result!.ptsCount).toBe(3);
    });

    it('should extract pts/ptsCount from updateShortSentMessage', () => {
      const writer = new TLWriter();
      writer.writeConstructorId(UPDATE_CIDS.updateShortSentMessage);
      writer.writeInt32(0);          // flags
      writer.writeInt32(12345);      // id
      writer.writeInt32(77);         // pts
      writer.writeInt32(2);          // pts_count

      const buf = writer.toBuffer();
      const result = extractUpdateState(UPDATE_CIDS.updateShortSentMessage, buf);

      expect(result).not.toBeNull();
      expect(result!.pts).toBe(77);
      expect(result!.ptsCount).toBe(2);
    });

    it('should return null for updateShort (needs separate parsing)', () => {
      const writer = new TLWriter();
      writer.writeConstructorId(UPDATE_CIDS.updateShort);
      writer.writeConstructorId(0x12345678); // inner update CID
      writer.writeInt32(1700000000); // date

      const buf = writer.toBuffer();
      const result = extractUpdateState(UPDATE_CIDS.updateShort, buf);

      expect(result).toBeNull();
    });
  });

  describe('parseUpdateShort', () => {
    it('should return null for data too short', () => {
      expect(parseUpdateShort(Buffer.alloc(8))).toBeNull();
    });

    it('should return null for wrong constructor ID', () => {
      const buf = Buffer.alloc(16);
      buf.writeUInt32LE(0xDEADBEEF, 0);
      expect(parseUpdateShort(buf)).toBeNull();
    });

    it('should parse updateShort and extract inner update CID', () => {
      const writer = new TLWriter();
      writer.writeConstructorId(UPDATE_CIDS.updateShort);
      writer.writeConstructorId(0x12345678); // inner update constructor ID
      writer.writeInt32(42);                  // some inner data
      writer.writeInt32(1700000000);          // date (last 4 bytes)

      const buf = writer.toBuffer();
      const result = parseUpdateShort(buf);

      expect(result).not.toBeNull();
      expect(result!.constructorId).toBe(0x12345678);
      // The data should be the inner portion (excluding the outer CID and trailing date)
      expect(result!.data.length).toBe(buf.length - 4 - 4); // minus outer CID and trailing date
    });
  });

  describe('serializeGetState', () => {
    it('should serialize updates.getState with correct CID', () => {
      const buf = serializeGetState();
      expect(buf.length).toBe(4);
      expect(buf.readUInt32LE(0)).toBe(0xedd4882a);
    });
  });

  describe('serializeGetDifference', () => {
    it('should serialize with correct constructor ID', () => {
      const buf = serializeGetDifference(100, 50, 1700000000);
      const reader = new TLReader(buf);
      expect(reader.readUInt32()).toBe(0x19c2f763);
    });

    it('should serialize pts, date, and qts in correct order', () => {
      const buf = serializeGetDifference(100, 50, 1700000000);
      const reader = new TLReader(buf);
      reader.readUInt32();       // constructor ID
      reader.readInt32();        // flags
      expect(reader.readInt32()).toBe(100);        // pts
      expect(reader.readInt32()).toBe(1700000000); // date
      expect(reader.readInt32()).toBe(50);         // qts
    });

    it('should have flags=0 (no optional fields)', () => {
      const buf = serializeGetDifference(1, 2, 3);
      const reader = new TLReader(buf);
      reader.readUInt32(); // CID
      expect(reader.readInt32()).toBe(0); // flags
    });

    it('should produce correct total size', () => {
      const buf = serializeGetDifference(1, 2, 3);
      // CID(4) + flags(4) + pts(4) + date(4) + qts(4) = 20
      expect(buf.length).toBe(20);
    });
  });

  describe('serializeGetChannelDifference', () => {
    it('should serialize with correct constructor ID', () => {
      const buf = serializeGetChannelDifference(123, 456n, 100, 50, 'empty');
      const reader = new TLReader(buf);
      expect(reader.readUInt32()).toBe(0x03173d78);
    });

    it('should serialize channel input correctly', () => {
      const buf = serializeGetChannelDifference(123, 456n, 100, 50, 'empty');
      const reader = new TLReader(buf);
      reader.readUInt32();  // CID
      reader.readInt32();   // flags

      // InputChannel
      expect(reader.readUInt32()).toBe(0xf35aec28); // inputChannel CID
      expect(reader.readInt64()).toBe(123n);         // channel_id
      expect(reader.readInt64()).toBe(456n);         // access_hash
    });

    it('should use empty filter when specified', () => {
      const buf = serializeGetChannelDifference(123, 456n, 100, 50, 'empty');
      const reader = new TLReader(buf);
      reader.readUInt32();  // CID
      reader.readInt32();   // flags
      reader.readUInt32();  // inputChannel CID
      reader.readInt64();   // channel_id
      reader.readInt64();   // access_hash

      expect(reader.readUInt32()).toBe(0x94d42ee7); // channelMessagesFilterEmpty
    });

    it('should use new filter when specified', () => {
      const buf = serializeGetChannelDifference(123, 456n, 100, 50, 'new');
      const reader = new TLReader(buf);
      reader.readUInt32();  // CID
      reader.readInt32();   // flags
      reader.readUInt32();  // inputChannel CID
      reader.readInt64();   // channel_id
      reader.readInt64();   // access_hash

      expect(reader.readUInt32()).toBe(0xcd77d957); // channelMessagesFilterNew
    });

    it('should serialize pts and limit', () => {
      const buf = serializeGetChannelDifference(123, 456n, 100, 50, 'empty');
      const reader = new TLReader(buf);
      reader.readUInt32();  // CID
      reader.readInt32();   // flags
      reader.readUInt32();  // inputChannel CID
      reader.readInt64();   // channel_id
      reader.readInt64();   // access_hash
      reader.readUInt32();  // filter CID

      expect(reader.readInt32()).toBe(100); // pts
      expect(reader.readInt32()).toBe(50);  // limit
    });

    it('should have flags=0', () => {
      const buf = serializeGetChannelDifference(123, 456n, 100, 50, 'empty');
      const reader = new TLReader(buf);
      reader.readUInt32(); // CID
      expect(reader.readInt32()).toBe(0); // flags
    });
  });
});
