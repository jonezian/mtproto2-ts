import { describe, it, expect } from 'vitest';
import { FullTransport } from './full.js';
import { crc32 } from '../crc32.js';

describe('FullTransport', () => {
  function makeTransport(): FullTransport {
    return new FullTransport();
  }

  describe('encodePacket', () => {
    it('encodes with correct total length', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(32, 0xaa);
      const encoded = transport.encodePacket(payload);

      // Total length = 12 + 32 = 44
      expect(encoded.length).toBe(44);
      expect(encoded.readUInt32LE(0)).toBe(44);
    });

    it('encodes with sequence number starting at 0', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(16, 0xbb);
      const encoded = transport.encodePacket(payload);

      expect(encoded.readUInt32LE(4)).toBe(0);
    });

    it('increments sequence number on each packet', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(16, 0xcc);

      const encoded0 = transport.encodePacket(payload);
      const encoded1 = transport.encodePacket(payload);
      const encoded2 = transport.encodePacket(payload);

      expect(encoded0.readUInt32LE(4)).toBe(0);
      expect(encoded1.readUInt32LE(4)).toBe(1);
      expect(encoded2.readUInt32LE(4)).toBe(2);
    });

    it('includes payload at offset 8', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(20, 0xdd);
      const encoded = transport.encodePacket(payload);

      expect(encoded.subarray(8, 28)).toEqual(payload);
    });

    it('appends valid CRC32', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(24, 0xee);
      const encoded = transport.encodePacket(payload);

      const totalLen = encoded.readUInt32LE(0);
      const dataBeforeCrc = encoded.subarray(0, totalLen - 4);
      const expectedCrc = crc32(dataBeforeCrc);
      const actualCrc = encoded.readUInt32LE(totalLen - 4);

      expect(actualCrc).toBe(expectedCrc);
    });
  });

  describe('decodePacket', () => {
    it('decodes a valid frame', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(32, 0x42);

      // Use a separate transport for encoding to avoid shared seq state
      const encoder = makeTransport();
      const encoded = encoder.encodePacket(payload);

      const decoded = transport.decodePacket(encoded);
      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload);
    });

    it('decodes multiple frames', () => {
      const encoder = makeTransport();
      const decoder = makeTransport();
      const p1 = Buffer.alloc(8, 0x11);
      const p2 = Buffer.alloc(16, 0x22);
      const p3 = Buffer.alloc(24, 0x33);

      const encoded = Buffer.concat([
        encoder.encodePacket(p1),
        encoder.encodePacket(p2),
        encoder.encodePacket(p3),
      ]);

      const decoded = decoder.decodePacket(encoded);
      expect(decoded.length).toBe(3);
      expect(decoded[0]).toEqual(p1);
      expect(decoded[1]).toEqual(p2);
      expect(decoded[2]).toEqual(p3);
    });

    it('rejects frame with corrupted CRC32', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(16, 0xff);

      const encoder = makeTransport();
      const encoded = encoder.encodePacket(payload);

      // Corrupt the CRC32 (last 4 bytes)
      const corrupted = Buffer.from(encoded);
      corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 0xff;

      const errors: Error[] = [];
      transport.on('error', (err: Error) => errors.push(err));

      const decoded = transport.decodePacket(corrupted);
      expect(decoded.length).toBe(0);
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toMatch(/CRC32 mismatch/);
    });

    it('rejects frame with corrupted payload', () => {
      const transport = makeTransport();
      const payload = Buffer.alloc(16, 0xaa);

      const encoder = makeTransport();
      const encoded = encoder.encodePacket(payload);

      // Corrupt the payload
      const corrupted = Buffer.from(encoded);
      corrupted[10] = corrupted[10]! ^ 0xff;

      const errors: Error[] = [];
      transport.on('error', (err: Error) => errors.push(err));

      const decoded = transport.decodePacket(corrupted);
      expect(decoded.length).toBe(0);
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toMatch(/CRC32 mismatch/);
    });

    it('rejects frame exceeding MAX_FRAME_PAYLOAD', () => {
      const transport = makeTransport();
      const errors: Error[] = [];
      transport.on('error', (err: Error) => errors.push(err));

      // Craft a buffer with totalLen > MAX_FRAME_PAYLOAD + 12
      const buf = Buffer.alloc(12);
      buf.writeUInt32LE(16 * 1024 * 1024 + 13, 0); // exceeds max

      const decoded = transport.decodePacket(buf);
      expect(decoded.length).toBe(0);
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toMatch(/Frame too large/);
    });

    it('skips frame on sequence number mismatch', () => {
      const decoder = makeTransport();
      const errors: Error[] = [];
      decoder.on('error', (err: Error) => errors.push(err));

      // Build two frames: first with seq=5 (wrong, expected 0), second with seq=0 (correct after skip)
      // Frame 1: wrong seq
      const payload1 = Buffer.alloc(8, 0x11);
      const totalLen1 = 12 + payload1.length;
      const frame1 = Buffer.alloc(totalLen1);
      frame1.writeUInt32LE(totalLen1, 0);
      frame1.writeUInt32LE(5, 4); // wrong seq (expected 0)
      payload1.copy(frame1, 8);
      const crc1 = crc32(frame1.subarray(0, totalLen1 - 4));
      frame1.writeUInt32LE(crc1, totalLen1 - 4);

      // Frame 2: correct seq (still 0, since frame1 was skipped)
      const payload2 = Buffer.alloc(8, 0x22);
      const totalLen2 = 12 + payload2.length;
      const frame2 = Buffer.alloc(totalLen2);
      frame2.writeUInt32LE(totalLen2, 0);
      frame2.writeUInt32LE(0, 4); // correct seq
      payload2.copy(frame2, 8);
      const crc2 = crc32(frame2.subarray(0, totalLen2 - 4));
      frame2.writeUInt32LE(crc2, totalLen2 - 4);

      const combined = Buffer.concat([frame1, frame2]);
      const decoded = decoder.decodePacket(combined);

      // First frame should be skipped (seq mismatch), second should decode
      expect(decoded.length).toBe(1);
      expect(decoded[0]).toEqual(payload2);
      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toMatch(/Sequence number mismatch/);
    });

    it('handles partial frame (buffers remaining)', () => {
      const encoder = makeTransport();
      const decoder = makeTransport();
      const payload = Buffer.alloc(64, 0x77);
      const encoded = encoder.encodePacket(payload);

      // Send partial
      const part1 = encoded.subarray(0, 20);
      const decoded1 = decoder.decodePacket(part1);
      expect(decoded1.length).toBe(0);

      // Send rest
      const part2 = encoded.subarray(20);
      const decoded2 = decoder.decodePacket(part2);
      expect(decoded2.length).toBe(1);
      expect(decoded2[0]).toEqual(payload);
    });
  });

  describe('crc32', () => {
    it('computes known CRC32 value', () => {
      // Known test vector: CRC32 of "123456789" = 0xCBF43926
      const data = Buffer.from('123456789', 'ascii');
      expect(crc32(data)).toBe(0xcbf43926);
    });

    it('computes CRC32 of empty buffer', () => {
      expect(crc32(Buffer.alloc(0))).toBe(0x00000000);
    });
  });
});
