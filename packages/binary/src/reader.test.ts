import { describe, it, expect } from 'vitest';
import { TLReader } from './reader.js';

describe('TLReader', () => {
  describe('readInt32', () => {
    it('reads positive int32', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(42, 0);
      const reader = new TLReader(buf);
      expect(reader.readInt32()).toBe(42);
    });

    it('reads negative int32', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(-100, 0);
      const reader = new TLReader(buf);
      expect(reader.readInt32()).toBe(-100);
    });

    it('reads zero', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(0, 0);
      const reader = new TLReader(buf);
      expect(reader.readInt32()).toBe(0);
    });

    it('reads int32 min value', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(-2147483648, 0);
      const reader = new TLReader(buf);
      expect(reader.readInt32()).toBe(-2147483648);
    });

    it('reads int32 max value', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(2147483647, 0);
      const reader = new TLReader(buf);
      expect(reader.readInt32()).toBe(2147483647);
    });
  });

  describe('readUInt32', () => {
    it('reads unsigned int32', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0xdeadbeef, 0);
      const reader = new TLReader(buf);
      expect(reader.readUInt32()).toBe(0xdeadbeef);
    });
  });

  describe('readInt64', () => {
    it('reads positive bigint', () => {
      const buf = Buffer.alloc(8);
      buf.writeBigInt64LE(123456789012345n, 0);
      const reader = new TLReader(buf);
      expect(reader.readInt64()).toBe(123456789012345n);
    });

    it('reads negative bigint', () => {
      const buf = Buffer.alloc(8);
      buf.writeBigInt64LE(-999999999999n, 0);
      const reader = new TLReader(buf);
      expect(reader.readInt64()).toBe(-999999999999n);
    });

    it('reads zero bigint', () => {
      const buf = Buffer.alloc(8);
      buf.writeBigInt64LE(0n, 0);
      const reader = new TLReader(buf);
      expect(reader.readInt64()).toBe(0n);
    });
  });

  describe('readDouble', () => {
    it('reads a double', () => {
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(3.141592653589793, 0);
      const reader = new TLReader(buf);
      expect(reader.readDouble()).toBeCloseTo(3.141592653589793, 15);
    });

    it('reads negative double', () => {
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(-273.15, 0);
      const reader = new TLReader(buf);
      expect(reader.readDouble()).toBeCloseTo(-273.15, 10);
    });

    it('reads zero double', () => {
      const buf = Buffer.alloc(8);
      buf.writeDoubleLE(0.0, 0);
      const reader = new TLReader(buf);
      expect(reader.readDouble()).toBe(0.0);
    });
  });

  describe('readInt128', () => {
    it('reads 16 bytes', () => {
      const data = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) data[i] = i + 1;
      const reader = new TLReader(data);
      const result = reader.readInt128();
      expect(result).toEqual(data);
      expect(result.length).toBe(16);
    });
  });

  describe('readInt256', () => {
    it('reads 32 bytes', () => {
      const data = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) data[i] = i + 1;
      const reader = new TLReader(data);
      const result = reader.readInt256();
      expect(result).toEqual(data);
      expect(result.length).toBe(32);
    });
  });

  describe('readBytes', () => {
    it('reads empty bytes', () => {
      // length 0: header = 0x00, padding to 4 bytes = 3 zero bytes
      const buf = Buffer.alloc(4);
      buf[0] = 0; // length 0
      const reader = new TLReader(buf);
      const result = reader.readBytes();
      expect(result.length).toBe(0);
      expect(reader.position).toBe(4);
    });

    it('reads short bytes (< 254)', () => {
      // length 3: header byte + 3 data bytes = 4 total, no padding needed
      const buf = Buffer.alloc(4);
      buf[0] = 3;
      buf[1] = 0xaa;
      buf[2] = 0xbb;
      buf[3] = 0xcc;
      const reader = new TLReader(buf);
      const result = reader.readBytes();
      expect(result).toEqual(Buffer.from([0xaa, 0xbb, 0xcc]));
      expect(reader.position).toBe(4);
    });

    it('reads short bytes with padding', () => {
      // length 1: header(1) + data(1) = 2, padding = 2 to reach 4
      const buf = Buffer.alloc(4);
      buf[0] = 1;
      buf[1] = 0xff;
      const reader = new TLReader(buf);
      const result = reader.readBytes();
      expect(result).toEqual(Buffer.from([0xff]));
      expect(reader.position).toBe(4);
    });

    it('reads long bytes (>= 254)', () => {
      const length = 300;
      const headerSize = 4; // 0xFE + 3 byte length
      const padding = (4 - ((headerSize + length) % 4)) % 4;
      const totalSize = headerSize + length + padding;
      const buf = Buffer.alloc(totalSize);

      buf[0] = 0xfe;
      buf[1] = length & 0xff;
      buf[2] = (length >> 8) & 0xff;
      buf[3] = (length >> 16) & 0xff;
      for (let i = 0; i < length; i++) {
        buf[headerSize + i] = i & 0xff;
      }

      const reader = new TLReader(buf);
      const result = reader.readBytes();
      expect(result.length).toBe(300);
      for (let i = 0; i < length; i++) {
        expect(result[i]).toBe(i & 0xff);
      }
      expect(reader.position).toBe(totalSize);
    });

    it('reads bytes with exact length 253', () => {
      // 253 < 254, so short encoding: 1 + 253 = 254, padding = 2
      const length = 253;
      const totalBeforePad = 1 + length;
      const padding = (4 - (totalBeforePad % 4)) % 4;
      const totalSize = totalBeforePad + padding;
      const buf = Buffer.alloc(totalSize);
      buf[0] = length;
      for (let i = 0; i < length; i++) buf[1 + i] = 0x42;

      const reader = new TLReader(buf);
      const result = reader.readBytes();
      expect(result.length).toBe(253);
    });

    it('reads bytes with exact length 254', () => {
      // 254 >= 254, so long encoding
      const length = 254;
      const headerSize = 4;
      const totalBeforePad = headerSize + length;
      const padding = (4 - (totalBeforePad % 4)) % 4;
      const totalSize = totalBeforePad + padding;
      const buf = Buffer.alloc(totalSize);
      buf[0] = 0xfe;
      buf[1] = length & 0xff;
      buf[2] = (length >> 8) & 0xff;
      buf[3] = (length >> 16) & 0xff;

      const reader = new TLReader(buf);
      const result = reader.readBytes();
      expect(result.length).toBe(254);
    });
  });

  describe('readString', () => {
    it('reads ASCII string', () => {
      const str = 'hello';
      const data = Buffer.from(str, 'utf-8');
      const headerSize = 1;
      const totalBeforePad = headerSize + data.length;
      const padding = (4 - (totalBeforePad % 4)) % 4;
      const buf = Buffer.alloc(totalBeforePad + padding);
      buf[0] = data.length;
      data.copy(buf, 1);

      const reader = new TLReader(buf);
      expect(reader.readString()).toBe('hello');
    });

    it('reads UTF-8 string with multibyte chars', () => {
      const str = 'Hello, World!';
      const data = Buffer.from(str, 'utf-8');
      const headerSize = 1;
      const totalBeforePad = headerSize + data.length;
      const padding = (4 - (totalBeforePad % 4)) % 4;
      const buf = Buffer.alloc(totalBeforePad + padding);
      buf[0] = data.length;
      data.copy(buf, 1);

      const reader = new TLReader(buf);
      expect(reader.readString()).toBe(str);
    });

    it('reads UTF-8 multibyte string (emoji)', () => {
      const str = '\u{1F600}'; // Grinning face emoji - 4 bytes in UTF-8
      const data = Buffer.from(str, 'utf-8');
      const headerSize = 1;
      const totalBeforePad = headerSize + data.length;
      const padding = (4 - (totalBeforePad % 4)) % 4;
      const buf = Buffer.alloc(totalBeforePad + padding);
      buf[0] = data.length;
      data.copy(buf, 1);

      const reader = new TLReader(buf);
      expect(reader.readString()).toBe(str);
    });
  });

  describe('readBool', () => {
    it('reads true', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0x997275b5, 0);
      const reader = new TLReader(buf);
      expect(reader.readBool()).toBe(true);
    });

    it('reads false', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0xbc799737, 0);
      const reader = new TLReader(buf);
      expect(reader.readBool()).toBe(false);
    });

    it('throws on invalid bool constructor', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0x12345678, 0);
      const reader = new TLReader(buf);
      expect(() => reader.readBool()).toThrow('Invalid Bool constructor ID');
    });
  });

  describe('readVector', () => {
    it('reads vector of int32s', () => {
      // Constructor ID (4) + count (4) + 3 * int32 (12) = 20 bytes
      const buf = Buffer.alloc(20);
      buf.writeUInt32LE(0x1cb5c415, 0); // vector CID
      buf.writeInt32LE(3, 4);            // count
      buf.writeInt32LE(10, 8);
      buf.writeInt32LE(20, 12);
      buf.writeInt32LE(30, 16);

      const reader = new TLReader(buf);
      const result = reader.readVector(() => reader.readInt32());
      expect(result).toEqual([10, 20, 30]);
    });

    it('reads empty vector', () => {
      const buf = Buffer.alloc(8);
      buf.writeUInt32LE(0x1cb5c415, 0);
      buf.writeInt32LE(0, 4);

      const reader = new TLReader(buf);
      const result = reader.readVector(() => reader.readInt32());
      expect(result).toEqual([]);
    });

    it('throws on invalid vector constructor ID', () => {
      const buf = Buffer.alloc(8);
      buf.writeUInt32LE(0xdeadbeef, 0);
      buf.writeInt32LE(0, 4);

      const reader = new TLReader(buf);
      expect(() => reader.readVector(() => reader.readInt32())).toThrow('Invalid Vector constructor ID');
    });

    it('throws on negative vector count', () => {
      const buf = Buffer.alloc(8);
      buf.writeUInt32LE(0x1cb5c415, 0);
      buf.writeInt32LE(-1, 4);

      const reader = new TLReader(buf);
      expect(() => reader.readVector(() => reader.readInt32())).toThrow('Vector count -1 exceeds maximum');
    });

    it('throws on vector count exceeding MAX_VECTOR_COUNT', () => {
      const buf = Buffer.alloc(8);
      buf.writeUInt32LE(0x1cb5c415, 0);
      buf.writeInt32LE(2_000_000, 4);

      const reader = new TLReader(buf);
      expect(() => reader.readVector(() => reader.readInt32())).toThrow('Vector count 2000000 exceeds maximum');
    });
  });

  describe('readRaw', () => {
    it('reads raw bytes without TL encoding', () => {
      const buf = Buffer.from([1, 2, 3, 4, 5]);
      const reader = new TLReader(buf);
      const result = reader.readRaw(3);
      expect(result).toEqual(Buffer.from([1, 2, 3]));
      expect(reader.position).toBe(3);
    });
  });

  describe('readConstructorId', () => {
    it('reads constructor ID as uint32', () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0x1cb5c415, 0);
      const reader = new TLReader(buf);
      expect(reader.readConstructorId()).toBe(0x1cb5c415);
    });
  });

  describe('peekInt32', () => {
    it('peeks without advancing position', () => {
      const buf = Buffer.alloc(4);
      buf.writeInt32LE(42, 0);
      const reader = new TLReader(buf);
      expect(reader.peekInt32()).toBe(42);
      expect(reader.position).toBe(0);
      // Can still read it
      expect(reader.readInt32()).toBe(42);
      expect(reader.position).toBe(4);
    });
  });

  describe('position tracking', () => {
    it('tracks position correctly', () => {
      const buf = Buffer.alloc(12);
      buf.writeInt32LE(1, 0);
      buf.writeInt32LE(2, 4);
      buf.writeInt32LE(3, 8);

      const reader = new TLReader(buf);
      expect(reader.position).toBe(0);
      expect(reader.remaining).toBe(12);

      reader.readInt32();
      expect(reader.position).toBe(4);
      expect(reader.remaining).toBe(8);

      reader.readInt32();
      expect(reader.position).toBe(8);
      expect(reader.remaining).toBe(4);

      reader.readInt32();
      expect(reader.position).toBe(12);
      expect(reader.remaining).toBe(0);
    });
  });

  describe('MAX_BYTES_LENGTH guard', () => {
    it('has MAX_BYTES_LENGTH static property set to 10MB', () => {
      expect(TLReader.MAX_BYTES_LENGTH).toBe(10 * 1024 * 1024);
    });

    it('throws RangeError when readBytes encounters a length > MAX_BYTES_LENGTH (11MB)', () => {
      // Fabricate a buffer with a long-form length field encoding 11MB
      const length = 11 * 1024 * 1024; // 11MB
      const headerSize = 4;
      const buf = Buffer.alloc(headerSize + 16); // Don't need the full buffer, just the header
      buf[0] = 0xfe; // long-form marker
      buf[1] = length & 0xff;
      buf[2] = (length >> 8) & 0xff;
      buf[3] = (length >> 16) & 0xff;

      const reader = new TLReader(buf);
      expect(() => reader.readBytes()).toThrow(RangeError);
    });

    it('does not throw for readBytes at the limit (10MB) if buffer is large enough', () => {
      const length = 10 * 1024 * 1024; // exactly 10MB
      const headerSize = 4;
      const totalBeforePad = headerSize + length;
      const padding = (4 - (totalBeforePad % 4)) % 4;
      const totalSize = totalBeforePad + padding;
      const buf = Buffer.alloc(totalSize);
      buf[0] = 0xfe;
      buf[1] = length & 0xff;
      buf[2] = (length >> 8) & 0xff;
      buf[3] = (length >> 16) & 0xff;

      const reader = new TLReader(buf);
      // Should not throw - the length is exactly at the limit
      const result = reader.readBytes();
      expect(result.length).toBe(length);
    });
  });

  describe('reading past end', () => {
    it('throws when reading int32 past end', () => {
      const buf = Buffer.alloc(2);
      const reader = new TLReader(buf);
      expect(() => reader.readInt32()).toThrow('Read past end of buffer');
    });

    it('throws when reading int64 past end', () => {
      const buf = Buffer.alloc(4);
      const reader = new TLReader(buf);
      expect(() => reader.readInt64()).toThrow('Read past end of buffer');
    });

    it('throws when reading from empty buffer', () => {
      const buf = Buffer.alloc(0);
      const reader = new TLReader(buf);
      expect(() => reader.readInt32()).toThrow('Read past end of buffer');
    });

    it('throws when reading raw past end', () => {
      const buf = Buffer.alloc(3);
      const reader = new TLReader(buf);
      expect(() => reader.readRaw(5)).toThrow('Read past end of buffer');
    });

    it('throws when peeking past end', () => {
      const buf = Buffer.alloc(2);
      const reader = new TLReader(buf);
      expect(() => reader.peekInt32()).toThrow('Read past end of buffer');
    });
  });
});
