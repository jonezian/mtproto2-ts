import { describe, it, expect } from 'vitest';
import { IntermediateTransport } from './intermediate.js';

describe('IntermediateTransport', () => {
  function makeTransport(): IntermediateTransport {
    return new IntermediateTransport();
  }

  describe('encodePacket', () => {
    it('prepends 4-byte LE length header', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(64, 0xab);
      const encoded = transport.encodePacket(payload);

      expect(encoded.length).toBe(4 + 64);
      expect(encoded.readUInt32LE(0)).toBe(64);
      expect(encoded.subarray(4)).toEqual(payload);
    });

    it('encodes empty payload', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(0);
      const encoded = transport.encodePacket(payload);

      expect(encoded.length).toBe(4);
      expect(encoded.readUInt32LE(0)).toBe(0);
    });

    it('encodes large payload with correct length', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(8192, 0xfe);
      const encoded = transport.encodePacket(payload);

      expect(encoded.length).toBe(4 + 8192);
      expect(encoded.readUInt32LE(0)).toBe(8192);
    });
  });

  describe('decodePacket', () => {
    it('decodes single frame', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(64, 0xab);
      const encoded = transport.encodePacket(payload);

      const decoded = transport.decodePacket(encoded);

      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });

    it('decodes multiple frames from one buffer', () => {
      const transport = makeTransport();
      const p1 = Buffer.alloc(16, 0x11);
      const p2 = Buffer.alloc(32, 0x22);
      const p3 = Buffer.alloc(48, 0x33);

      const encoded = Buffer.concat([
        transport.encodePacket(p1),
        transport.encodePacket(p2),
        transport.encodePacket(p3),
      ]);

      const decoded = transport.decodePacket(encoded);

      expect(decoded.length).toBe(3);
      expect(decoded[0]).toEqual(p1);
      expect(decoded[1]).toEqual(p2);
      expect(decoded[2]).toEqual(p3);
    });

    it('returns empty for partial header', () => {
      const transport = makeTransport();
      const partial = Buffer.from([0x40, 0x00]); // Only 2 bytes of the 4-byte header

      const decoded = transport.decodePacket(partial);
      expect(decoded.length).toBe(0);
    });

    it('returns empty for partial payload', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(100, 0xdd);
      const encoded = transport.encodePacket(payload);

      // Only send header + some payload bytes
      const partial = encoded.subarray(0, 20);
      const decoded = transport.decodePacket(partial);
      expect(decoded.length).toBe(0);
    });

    it('completes partial frame when remaining data arrives', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(100, 0xdd);
      const encoded = transport.encodePacket(payload);

      const part1 = encoded.subarray(0, 20);
      const part2 = encoded.subarray(20);

      const decoded1 = transport.decodePacket(part1);
      expect(decoded1.length).toBe(0);

      const decoded2 = transport.decodePacket(part2);
      expect(decoded2.length).toBe(1);
      expect(decoded2[0]).toEqual(payload);
    });
  });

  describe('round-trip', () => {
    it('encode/decode round-trip preserves data', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) payload[i] = i;

      const encoded = transport.encodePacket(payload);
      const decoded = transport.decodePacket(encoded);

      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });
  });
});
