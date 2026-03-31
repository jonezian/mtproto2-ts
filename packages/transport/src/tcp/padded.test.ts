import { describe, it, expect } from 'vitest';
import { PaddedIntermediateTransport } from './padded.js';

describe('PaddedIntermediateTransport', () => {
  function makeTransport(): PaddedIntermediateTransport {
    return new PaddedIntermediateTransport();
  }

  describe('encodePacket', () => {
    it('prepends a 4-byte LE length header', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(32, 0xab);
      const encoded = transport.encodePacket(payload);

      // First 4 bytes are the total data length (payload + padding)
      const totalDataLen = encoded.readUInt32LE(0);
      expect(encoded.length).toBe(4 + totalDataLen);
    });

    it('encoded data length (excluding 4-byte header) is divisible by 16', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(17, 0xcc); // 17 bytes, not aligned
      const encoded = transport.encodePacket(payload);

      const totalDataLen = encoded.readUInt32LE(0);
      expect(totalDataLen % 16).toBe(0);
    });

    it('adds correct padding for 16-byte alignment', () => {
      const transport = makeTransport();

      // 32 bytes payload => 32 % 16 == 0 => no padding needed
      const payload32 = Buffer.alloc(32, 0x11);
      const encoded32 = transport.encodePacket(payload32);
      const dataLen32 = encoded32.readUInt32LE(0);
      expect(dataLen32).toBe(32);

      // 20 bytes payload => need 12 bytes of padding => total 32
      const transport2 = makeTransport();
      const payload20 = Buffer.alloc(20, 0x22);
      const encoded20 = transport2.encodePacket(payload20);
      const dataLen20 = encoded20.readUInt32LE(0);
      expect(dataLen20).toBe(32); // 20 + 12 = 32
    });

    it('includes payload bytes starting at offset 4', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(16, 0xdd);
      const encoded = transport.encodePacket(payload);

      // The first 16 bytes after the header should be the payload
      expect(encoded.subarray(4, 4 + 16)).toEqual(payload);
    });

    it('handles empty payload', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(0);
      const encoded = transport.encodePacket(payload);

      const totalDataLen = encoded.readUInt32LE(0);
      // 0 bytes payload, 0 % 16 == 0, so no padding
      expect(totalDataLen).toBe(0);
      expect(encoded.length).toBe(4);
    });

    it('handles payload already aligned to 16 bytes', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(48, 0xee);
      const encoded = transport.encodePacket(payload);

      const totalDataLen = encoded.readUInt32LE(0);
      expect(totalDataLen).toBe(48);
      expect(encoded.length).toBe(52);
    });
  });

  describe('decodePacket', () => {
    it('round-trips: encode then decode recovers padded data', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(48, 0x42);
      const encoded = transport.encodePacket(payload);

      const decoded = transport.decodePacket(encoded);
      expect(decoded.length).toBe(1);
      // Decoded data includes payload + padding (the upper layer strips padding)
      const totalDataLen = encoded.readUInt32LE(0);
      expect(decoded[0]!.length).toBe(totalDataLen);
      // The first 48 bytes should be the original payload
      expect(decoded[0]!.subarray(0, 48)).toEqual(payload);
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

      // Use a fresh transport for decoding (clean recvBuf)
      const decoder = makeTransport();
      const decoded = decoder.decodePacket(encoded);

      expect(decoded.length).toBe(3);
      expect(decoded[0]!.subarray(0, 16)).toEqual(p1);
      expect(decoded[1]!.subarray(0, 32)).toEqual(p2);
      expect(decoded[2]!.subarray(0, 48)).toEqual(p3);
    });

    it('handles partial frames by buffering', () => {
      const encoder = makeTransport();
      const decoder = makeTransport();
      const payload = Buffer.alloc(64, 0x77);
      const encoded = encoder.encodePacket(payload);

      // Send partial data (only part of the frame)
      const part1 = encoded.subarray(0, 10);
      const decoded1 = decoder.decodePacket(part1);
      expect(decoded1.length).toBe(0);

      // Send the rest
      const part2 = encoded.subarray(10);
      const decoded2 = decoder.decodePacket(part2);
      expect(decoded2.length).toBe(1);
      expect(decoded2[0]!.subarray(0, 64)).toEqual(payload);
    });

    it('handles empty input', () => {
      const transport = makeTransport();
      const decoded = transport.decodePacket(Buffer.alloc(0));
      expect(decoded.length).toBe(0);
    });

    it('handles partial header (less than 4 bytes)', () => {
      const transport = makeTransport();
      const partial = Buffer.from([0x20, 0x00]);
      const decoded = transport.decodePacket(partial);
      expect(decoded.length).toBe(0);
    });
  });
});
