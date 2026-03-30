import { describe, it, expect } from 'vitest';
import { TLWriter } from './writer.js';
import { TLReader } from './reader.js';

describe('TLWriter', () => {
  describe('writeInt32 round-trip', () => {
    it('writes and reads positive int32', () => {
      const writer = new TLWriter();
      writer.writeInt32(42);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt32()).toBe(42);
    });

    it('writes and reads negative int32', () => {
      const writer = new TLWriter();
      writer.writeInt32(-100);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt32()).toBe(-100);
    });

    it('writes and reads zero', () => {
      const writer = new TLWriter();
      writer.writeInt32(0);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt32()).toBe(0);
    });

    it('writes and reads int32 min/max', () => {
      const writer = new TLWriter();
      writer.writeInt32(-2147483648);
      writer.writeInt32(2147483647);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt32()).toBe(-2147483648);
      expect(reader.readInt32()).toBe(2147483647);
    });
  });

  describe('writeUInt32', () => {
    it('writes and reads uint32', () => {
      const writer = new TLWriter();
      writer.writeUInt32(0xdeadbeef);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readUInt32()).toBe(0xdeadbeef);
    });
  });

  describe('writeInt64 round-trip', () => {
    it('writes and reads positive bigint', () => {
      const writer = new TLWriter();
      writer.writeInt64(123456789012345n);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt64()).toBe(123456789012345n);
    });

    it('writes and reads negative bigint', () => {
      const writer = new TLWriter();
      writer.writeInt64(-999999999999n);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt64()).toBe(-999999999999n);
    });

    it('writes and reads zero bigint', () => {
      const writer = new TLWriter();
      writer.writeInt64(0n);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt64()).toBe(0n);
    });
  });

  describe('writeDouble round-trip', () => {
    it('writes and reads double', () => {
      const writer = new TLWriter();
      writer.writeDouble(3.141592653589793);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readDouble()).toBeCloseTo(3.141592653589793, 15);
    });

    it('writes and reads negative double', () => {
      const writer = new TLWriter();
      writer.writeDouble(-273.15);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readDouble()).toBeCloseTo(-273.15, 10);
    });
  });

  describe('writeBytes round-trip', () => {
    it('writes and reads empty bytes', () => {
      const writer = new TLWriter();
      writer.writeBytes(Buffer.alloc(0));
      const reader = new TLReader(writer.toBuffer());
      const result = reader.readBytes();
      expect(result.length).toBe(0);
    });

    it('writes and reads short bytes', () => {
      const data = Buffer.from([0xaa, 0xbb, 0xcc]);
      const writer = new TLWriter();
      writer.writeBytes(data);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readBytes()).toEqual(data);
    });

    it('writes and reads bytes with length 1', () => {
      const data = Buffer.from([0xff]);
      const writer = new TLWriter();
      writer.writeBytes(data);
      const buf = writer.toBuffer();
      // 1 header + 1 data + 2 padding = 4 bytes
      expect(buf.length).toBe(4);
      const reader = new TLReader(buf);
      expect(reader.readBytes()).toEqual(data);
    });

    it('writes and reads long bytes (>= 254)', () => {
      const data = Buffer.alloc(300);
      for (let i = 0; i < 300; i++) data[i] = i & 0xff;
      const writer = new TLWriter();
      writer.writeBytes(data);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readBytes()).toEqual(data);
    });

    it('writes and reads bytes at boundary (253)', () => {
      const data = Buffer.alloc(253, 0x42);
      const writer = new TLWriter();
      writer.writeBytes(data);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readBytes()).toEqual(data);
    });

    it('writes and reads bytes at boundary (254)', () => {
      const data = Buffer.alloc(254, 0x42);
      const writer = new TLWriter();
      writer.writeBytes(data);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readBytes()).toEqual(data);
    });

    it('ensures 4-byte alignment for short bytes', () => {
      const writer = new TLWriter();
      writer.writeBytes(Buffer.from([0x01, 0x02]));
      // header(1) + data(2) = 3, padding = 1 -> total 4
      expect(writer.toBuffer().length).toBe(4);
    });

    it('ensures 4-byte alignment for long bytes', () => {
      const writer = new TLWriter();
      writer.writeBytes(Buffer.alloc(255));
      const buf = writer.toBuffer();
      // header(4) + data(255) = 259, padding = (4 - 259%4)%4 = (4 - 3)%4 = 1 -> total 260
      expect(buf.length % 4).toBe(0);
    });
  });

  describe('writeString round-trip', () => {
    it('writes and reads ASCII string', () => {
      const writer = new TLWriter();
      writer.writeString('hello');
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readString()).toBe('hello');
    });

    it('writes and reads empty string', () => {
      const writer = new TLWriter();
      writer.writeString('');
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readString()).toBe('');
    });

    it('writes and reads UTF-8 string', () => {
      const str = '\u{1F600} hello \u{1F4A9}';
      const writer = new TLWriter();
      writer.writeString(str);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readString()).toBe(str);
    });
  });

  describe('writeBool round-trip', () => {
    it('writes and reads true', () => {
      const writer = new TLWriter();
      writer.writeBool(true);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readBool()).toBe(true);
    });

    it('writes and reads false', () => {
      const writer = new TLWriter();
      writer.writeBool(false);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readBool()).toBe(false);
    });
  });

  describe('writeVector round-trip', () => {
    it('writes and reads vector of int32s', () => {
      const writer = new TLWriter();
      writer.writeVector([10, 20, 30], (item) => writer.writeInt32(item));
      const reader = new TLReader(writer.toBuffer());
      const result = reader.readVector(() => reader.readInt32());
      expect(result).toEqual([10, 20, 30]);
    });

    it('writes and reads empty vector', () => {
      const writer = new TLWriter();
      writer.writeVector([], (_item: number) => writer.writeInt32(_item));
      const reader = new TLReader(writer.toBuffer());
      const result = reader.readVector(() => reader.readInt32());
      expect(result).toEqual([]);
    });

    it('writes and reads vector of strings', () => {
      const writer = new TLWriter();
      writer.writeVector(['foo', 'bar', 'baz'], (item) => writer.writeString(item));
      const reader = new TLReader(writer.toBuffer());
      const result = reader.readVector(() => reader.readString());
      expect(result).toEqual(['foo', 'bar', 'baz']);
    });
  });

  describe('writeRaw', () => {
    it('writes raw bytes without TL encoding', () => {
      const writer = new TLWriter();
      writer.writeRaw(Buffer.from([1, 2, 3, 4, 5]));
      const buf = writer.toBuffer();
      expect(buf).toEqual(Buffer.from([1, 2, 3, 4, 5]));
    });
  });

  describe('writeConstructorId', () => {
    it('writes constructor ID as uint32', () => {
      const writer = new TLWriter();
      writer.writeConstructorId(0x1cb5c415);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readConstructorId()).toBe(0x1cb5c415);
    });
  });

  describe('buffer auto-growth', () => {
    it('grows buffer when exceeding initial capacity', () => {
      const writer = new TLWriter(8); // Small initial capacity
      // Write more than 8 bytes
      writer.writeInt32(1);
      writer.writeInt32(2);
      writer.writeInt32(3); // This should trigger growth
      writer.writeInt32(4);

      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt32()).toBe(1);
      expect(reader.readInt32()).toBe(2);
      expect(reader.readInt32()).toBe(3);
      expect(reader.readInt32()).toBe(4);
    });

    it('grows buffer with large writes', () => {
      const writer = new TLWriter(4);
      const bigData = Buffer.alloc(1024, 0xab);
      writer.writeRaw(bigData);
      expect(writer.toBuffer()).toEqual(bigData);
    });
  });

  describe('int128 round-trip', () => {
    it('writes and reads int128', () => {
      const data = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) data[i] = i + 1;
      const writer = new TLWriter();
      writer.writeInt128(data);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt128()).toEqual(data);
    });

    it('rejects wrong-sized buffer for int128', () => {
      const writer = new TLWriter();
      expect(() => writer.writeInt128(Buffer.alloc(15))).toThrow('16 bytes');
      expect(() => writer.writeInt128(Buffer.alloc(17))).toThrow('16 bytes');
    });
  });

  describe('int256 round-trip', () => {
    it('writes and reads int256', () => {
      const data = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) data[i] = i + 1;
      const writer = new TLWriter();
      writer.writeInt256(data);
      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt256()).toEqual(data);
    });

    it('rejects wrong-sized buffer for int256', () => {
      const writer = new TLWriter();
      expect(() => writer.writeInt256(Buffer.alloc(31))).toThrow('32 bytes');
      expect(() => writer.writeInt256(Buffer.alloc(33))).toThrow('32 bytes');
    });
  });

  describe('length property', () => {
    it('tracks written length', () => {
      const writer = new TLWriter();
      expect(writer.length).toBe(0);
      writer.writeInt32(42);
      expect(writer.length).toBe(4);
      writer.writeInt64(0n);
      expect(writer.length).toBe(12);
    });
  });

  describe('toBuffer returns a copy', () => {
    it('returns independent buffer', () => {
      const writer = new TLWriter();
      writer.writeInt32(42);
      const buf1 = writer.toBuffer();
      const buf2 = writer.toBuffer();
      expect(buf1).toEqual(buf2);
      // Mutating buf1 should not affect buf2 or internal buffer
      buf1[0] = 0xff;
      expect(buf2[0]).not.toBe(0xff);
    });
  });
});
