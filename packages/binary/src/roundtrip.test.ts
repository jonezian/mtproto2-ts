import { describe, it, expect } from 'vitest';
import { TLWriter } from './writer.js';
import { TLReader } from './reader.js';

describe('Round-trip integration tests', () => {
  describe('mixed types sequentially', () => {
    it('writes and reads multiple mixed types', () => {
      const writer = new TLWriter();

      writer.writeInt32(42);
      writer.writeInt64(-123456789012345n);
      writer.writeDouble(2.718281828);
      writer.writeString('Hello, TL!');
      writer.writeBool(true);
      writer.writeBool(false);
      writer.writeBytes(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
      writer.writeUInt32(0xffffffff);

      const reader = new TLReader(writer.toBuffer());

      expect(reader.readInt32()).toBe(42);
      expect(reader.readInt64()).toBe(-123456789012345n);
      expect(reader.readDouble()).toBeCloseTo(2.718281828, 8);
      expect(reader.readString()).toBe('Hello, TL!');
      expect(reader.readBool()).toBe(true);
      expect(reader.readBool()).toBe(false);
      expect(reader.readBytes()).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
      expect(reader.readUInt32()).toBe(0xffffffff);
      expect(reader.remaining).toBe(0);
    });

    it('writes int128 and int256 with surrounding data', () => {
      const nonce = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) nonce[i] = 0xa0 + i;

      const serverNonce = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) serverNonce[i] = 0xb0 + i;

      const sha256 = Buffer.alloc(32);
      for (let i = 0; i < 32; i++) sha256[i] = 0xc0 + i;

      const writer = new TLWriter();
      writer.writeConstructorId(0x60469778); // example constructor ID
      writer.writeInt128(nonce);
      writer.writeInt128(serverNonce);
      writer.writeInt256(sha256);
      writer.writeInt32(12345);

      const reader = new TLReader(writer.toBuffer());
      expect(reader.readConstructorId()).toBe(0x60469778);
      expect(reader.readInt128()).toEqual(nonce);
      expect(reader.readInt128()).toEqual(serverNonce);
      expect(reader.readInt256()).toEqual(sha256);
      expect(reader.readInt32()).toBe(12345);
      expect(reader.remaining).toBe(0);
    });
  });

  describe('nested vectors', () => {
    it('writes and reads vector of vectors of int32', () => {
      const writer = new TLWriter();
      const data = [[1, 2, 3], [4, 5], [6]];

      writer.writeVector(data, (inner) => {
        writer.writeVector(inner, (val) => writer.writeInt32(val));
      });

      const reader = new TLReader(writer.toBuffer());
      const result = reader.readVector(() =>
        reader.readVector(() => reader.readInt32()),
      );

      expect(result).toEqual([[1, 2, 3], [4, 5], [6]]);
    });

    it('writes and reads vector of strings', () => {
      const writer = new TLWriter();
      const strings = ['alpha', 'beta', 'gamma', 'delta'];

      writer.writeVector(strings, (s) => writer.writeString(s));

      const reader = new TLReader(writer.toBuffer());
      const result = reader.readVector(() => reader.readString());
      expect(result).toEqual(strings);
    });

    it('writes and reads vector of bools', () => {
      const writer = new TLWriter();
      const bools = [true, false, true, true, false];

      writer.writeVector(bools, (b) => writer.writeBool(b));

      const reader = new TLReader(writer.toBuffer());
      const result = reader.readVector(() => reader.readBool());
      expect(result).toEqual(bools);
    });
  });

  describe('Telegram protocol examples', () => {
    it('simulates req_pq_multi serialization', () => {
      // req_pq_multi#be7e8ef1 nonce:int128 = ResPQ
      const constructorId = 0xbe7e8ef1;
      const nonce = Buffer.alloc(16);
      for (let i = 0; i < 16; i++) nonce[i] = Math.floor(Math.random() * 256);

      const writer = new TLWriter();
      writer.writeConstructorId(constructorId);
      writer.writeInt128(nonce);

      const buf = writer.toBuffer();
      expect(buf.length).toBe(20); // 4 + 16

      const reader = new TLReader(buf);
      expect(reader.readConstructorId()).toBe(constructorId);
      expect(reader.readInt128()).toEqual(nonce);
      expect(reader.remaining).toBe(0);
    });

    it('simulates resPQ deserialization', () => {
      // resPQ#05162463 nonce:int128 server_nonce:int128
      //   pq:string server_public_key_fingerprints:Vector<long> = ResPQ
      const constructorId = 0x05162463;
      const nonce = Buffer.alloc(16, 0xaa);
      const serverNonce = Buffer.alloc(16, 0xbb);
      const pq = Buffer.from([0x01, 0x7a, 0x5f, 0x2f, 0x3e, 0x37, 0x13, 0x97]); // example PQ
      // Telegram fingerprints are unsigned 64-bit, but TL stores them as signed int64.
      // Use the signed representation of the same bit pattern.
      const fingerprints = [-4344800451088580831n]; // same bits as 0xc3b42b026ce86b21

      const writer = new TLWriter();
      writer.writeConstructorId(constructorId);
      writer.writeInt128(nonce);
      writer.writeInt128(serverNonce);
      writer.writeBytes(pq);
      writer.writeVector(fingerprints, (fp) => writer.writeInt64(fp));

      const reader = new TLReader(writer.toBuffer());
      expect(reader.readConstructorId()).toBe(constructorId);
      expect(reader.readInt128()).toEqual(nonce);
      expect(reader.readInt128()).toEqual(serverNonce);
      expect(reader.readBytes()).toEqual(pq);
      const readFingerprints = reader.readVector(() => reader.readInt64());
      expect(readFingerprints).toEqual(fingerprints);
      expect(reader.remaining).toBe(0);
    });

    it('simulates message container', () => {
      // Simulate a simple msg_container-like structure
      // constructor_id + count + (msg_id:long + seqno:int + length:int + body)*
      const writer = new TLWriter();
      writer.writeConstructorId(0x73f1f8dc); // msg_container

      const messages = [
        { msgId: 1234567890123456n, seqno: 1, body: Buffer.from([0x01, 0x02]) },
        { msgId: 9876543210987654n, seqno: 3, body: Buffer.from([0x03, 0x04, 0x05, 0x06]) },
      ];

      writer.writeInt32(messages.length);
      for (const msg of messages) {
        writer.writeInt64(msg.msgId);
        writer.writeInt32(msg.seqno);
        writer.writeInt32(msg.body.length);
        writer.writeRaw(msg.body);
      }

      const reader = new TLReader(writer.toBuffer());
      expect(reader.readConstructorId()).toBe(0x73f1f8dc);
      const count = reader.readInt32();
      expect(count).toBe(2);

      for (const msg of messages) {
        expect(reader.readInt64()).toBe(msg.msgId);
        expect(reader.readInt32()).toBe(msg.seqno);
        const bodyLen = reader.readInt32();
        expect(bodyLen).toBe(msg.body.length);
        expect(reader.readRaw(bodyLen)).toEqual(msg.body);
      }

      expect(reader.remaining).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles large byte arrays', () => {
      const data = Buffer.alloc(10000);
      for (let i = 0; i < data.length; i++) data[i] = i & 0xff;

      const writer = new TLWriter();
      writer.writeBytes(data);

      const reader = new TLReader(writer.toBuffer());
      const result = reader.readBytes();
      expect(result).toEqual(data);
    });

    it('handles string at byte boundary (253 chars)', () => {
      const str = 'A'.repeat(253);
      const writer = new TLWriter();
      writer.writeString(str);

      const reader = new TLReader(writer.toBuffer());
      expect(reader.readString()).toBe(str);
    });

    it('handles string just over boundary (254 chars)', () => {
      const str = 'B'.repeat(254);
      const writer = new TLWriter();
      writer.writeString(str);

      const reader = new TLReader(writer.toBuffer());
      expect(reader.readString()).toBe(str);
    });

    it('handles many sequential writes with growth', () => {
      const writer = new TLWriter(4); // Very small initial capacity
      const count = 1000;
      for (let i = 0; i < count; i++) {
        writer.writeInt32(i);
      }

      const reader = new TLReader(writer.toBuffer());
      for (let i = 0; i < count; i++) {
        expect(reader.readInt32()).toBe(i);
      }
      expect(reader.remaining).toBe(0);
    });

    it('peekInt32 does not affect subsequent reads', () => {
      const writer = new TLWriter();
      writer.writeInt32(100);
      writer.writeInt32(200);

      const reader = new TLReader(writer.toBuffer());
      expect(reader.peekInt32()).toBe(100);
      expect(reader.peekInt32()).toBe(100); // Still the same
      expect(reader.readInt32()).toBe(100);
      expect(reader.peekInt32()).toBe(200);
      expect(reader.readInt32()).toBe(200);
    });

    it('readRaw combined with TL-encoded data', () => {
      const writer = new TLWriter();
      writer.writeInt32(42);
      writer.writeRaw(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
      writer.writeString('test');

      const reader = new TLReader(writer.toBuffer());
      expect(reader.readInt32()).toBe(42);
      expect(reader.readRaw(4)).toEqual(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
      expect(reader.readString()).toBe('test');
      expect(reader.remaining).toBe(0);
    });

    it('writes and reads constructor ID followed by complex payload', () => {
      const writer = new TLWriter();
      // Simulate an auth.sendCode-like structure
      writer.writeConstructorId(0xa677244f);
      writer.writeString('+15551234567');
      writer.writeInt32(12345);  // api_id
      writer.writeString('abcdef1234567890abcdef1234567890'); // api_hash
      writer.writeString('en'); // lang_code

      const reader = new TLReader(writer.toBuffer());
      expect(reader.readConstructorId()).toBe(0xa677244f);
      expect(reader.readString()).toBe('+15551234567');
      expect(reader.readInt32()).toBe(12345);
      expect(reader.readString()).toBe('abcdef1234567890abcdef1234567890');
      expect(reader.readString()).toBe('en');
      expect(reader.remaining).toBe(0);
    });
  });
});
