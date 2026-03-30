import { describe, it, expect } from 'vitest';
import { AbridgedTransport } from './abridged.js';

describe('AbridgedTransport', () => {
  function makeTransport(): AbridgedTransport {
    return new AbridgedTransport();
  }

  describe('encodePacket', () => {
    it('encodes small packet with 1-byte length prefix', () => {
      const transport = makeTransport();
      // 16 bytes payload => 16/4 = 4 < 127 => 1-byte prefix
      const payload = Buffer.alloc(16, 0xaa);
      const encoded = transport.encodePacket(payload);

      expect(encoded.length).toBe(1 + 16);
      expect(encoded[0]).toBe(4); // 16 / 4
      expect(encoded.subarray(1)).toEqual(payload);
    });

    it('encodes payload of 504 bytes (126 words) with 1-byte prefix', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(504, 0xbb);
      const encoded = transport.encodePacket(payload);

      expect(encoded.length).toBe(1 + 504);
      expect(encoded[0]).toBe(126);
      expect(encoded.subarray(1)).toEqual(payload);
    });

    it('encodes large packet with 4-byte length prefix (0x7f + 3 bytes LE)', () => {
      const transport = makeTransport();
      // 508 bytes => 508/4 = 127 >= 127 => 4-byte prefix
      const payload = Buffer.alloc(508, 0xcc);
      const encoded = transport.encodePacket(payload);

      expect(encoded.length).toBe(4 + 508);
      expect(encoded[0]).toBe(0x7f);
      // 127 in 3-byte LE
      expect(encoded[1]).toBe(127);
      expect(encoded[2]).toBe(0);
      expect(encoded[3]).toBe(0);
      expect(encoded.subarray(4)).toEqual(payload);
    });

    it('encodes large packet with multi-byte word count', () => {
      const transport = makeTransport();
      // 2048 bytes => 2048/4 = 512 words
      const payload = Buffer.alloc(2048, 0xdd);
      const encoded = transport.encodePacket(payload);

      expect(encoded.length).toBe(4 + 2048);
      expect(encoded[0]).toBe(0x7f);
      // 512 = 0x000200 in LE => 0x00, 0x02, 0x00
      expect(encoded[1]).toBe(0x00);
      expect(encoded[2]).toBe(0x02);
      expect(encoded[3]).toBe(0x00);
    });
  });

  describe('decodePacket', () => {
    it('decodes a single small frame', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(16, 0xaa);
      const encoded = transport.encodePacket(payload);

      const decoded = transport.decodePacket(encoded);

      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });

    it('decodes a single large frame', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(508, 0xcc);
      const encoded = transport.encodePacket(payload);

      const decoded = transport.decodePacket(encoded);

      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });

    it('decodes multiple frames from one buffer', () => {
      const transport = makeTransport();
      const payload1 = Buffer.alloc(8, 0x11);
      const payload2 = Buffer.alloc(12, 0x22);
      const payload3 = Buffer.alloc(20, 0x33);

      const encoded = Buffer.concat([
        transport.encodePacket(payload1),
        transport.encodePacket(payload2),
        transport.encodePacket(payload3),
      ]);

      const decoded = transport.decodePacket(encoded);

      expect(decoded.length).toBe(3);
      expect(decoded[0]).toEqual(payload1);
      expect(decoded[1]).toEqual(payload2);
      expect(decoded[2]).toEqual(payload3);
    });

    it('returns empty array for partial frame (buffers remaining)', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(100, 0x55);
      const encoded = transport.encodePacket(payload);

      // Only send part of the frame
      const partial = encoded.subarray(0, 10);
      const decoded = transport.decodePacket(partial);

      expect(decoded.length).toBe(0);
    });

    it('completes partial frame when remaining data arrives', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(100, 0x55);
      const encoded = transport.encodePacket(payload);

      // Send in two parts
      const part1 = encoded.subarray(0, 10);
      const part2 = encoded.subarray(10);

      const decoded1 = transport.decodePacket(part1);
      expect(decoded1.length).toBe(0);

      const decoded2 = transport.decodePacket(part2);
      expect(decoded2.length).toBe(1);
      expect(decoded2[0]).toEqual(payload);
    });

    it('handles partial 4-byte header (only 2 bytes of header received)', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(508, 0xee);
      const encoded = transport.encodePacket(payload);

      // 4-byte header: 0x7f + 3 bytes. Send only 2 bytes of header.
      const partial = encoded.subarray(0, 2);
      const decoded = transport.decodePacket(partial);
      expect(decoded.length).toBe(0);

      // Now send the rest
      const rest = encoded.subarray(2);
      const decoded2 = transport.decodePacket(rest);
      expect(decoded2.length).toBe(1);
      expect(decoded2[0]).toEqual(payload);
    });
  });

  describe('round-trip', () => {
    it('encode then decode small payload', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(32, 0x42);

      const encoded = transport.encodePacket(payload);
      const decoded = transport.decodePacket(encoded);

      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });

    it('encode then decode large payload', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(4096, 0x99);

      const encoded = transport.encodePacket(payload);
      const decoded = transport.decodePacket(encoded);

      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });
  });
});
