import { describe, it, expect } from 'vitest';
import { packContainer, unpackContainer, isContainer } from './container.js';
import type { InnerMessage } from './container.js';

describe('container', () => {
  it('should pack and unpack round-trip', () => {
    const messages: InnerMessage[] = [
      { msgId: 100n, seqNo: 1, body: Buffer.from('hello') },
      { msgId: 200n, seqNo: 3, body: Buffer.from('world') },
      { msgId: 300n, seqNo: 5, body: Buffer.alloc(128, 0xAB) },
    ];

    const packed = packContainer(messages);
    const unpacked = unpackContainer(packed);

    expect(unpacked.length).toBe(messages.length);
    for (let i = 0; i < messages.length; i++) {
      expect(unpacked[i]!.msgId).toBe(messages[i]!.msgId);
      expect(unpacked[i]!.seqNo).toBe(messages[i]!.seqNo);
      expect(unpacked[i]!.body).toEqual(messages[i]!.body);
    }
  });

  it('should have correct container constructor ID (0x73f1f8dc)', () => {
    const packed = packContainer([
      { msgId: 1n, seqNo: 0, body: Buffer.alloc(4) },
    ]);

    const cid = packed.readUInt32LE(0);
    expect(cid).toBe(0x73f1f8dc);
  });

  it('should handle empty container', () => {
    const packed = packContainer([]);
    const unpacked = unpackContainer(packed);
    expect(unpacked.length).toBe(0);

    // Verify: constructor_id (4) + count (4) = 8 bytes
    expect(packed.length).toBe(8);
    expect(packed.readUInt32LE(0)).toBe(0x73f1f8dc);
    expect(packed.readInt32LE(4)).toBe(0);
  });

  it('should handle multiple messages with different sizes', () => {
    const messages: InnerMessage[] = [
      { msgId: 1n, seqNo: 0, body: Buffer.alloc(0) },
      { msgId: 2n, seqNo: 1, body: Buffer.alloc(1, 0x42) },
      { msgId: 3n, seqNo: 2, body: Buffer.alloc(1000, 0xFF) },
    ];

    const packed = packContainer(messages);
    const unpacked = unpackContainer(packed);

    expect(unpacked.length).toBe(3);
    expect(unpacked[0]!.body.length).toBe(0);
    expect(unpacked[1]!.body.length).toBe(1);
    expect(unpacked[1]!.body[0]).toBe(0x42);
    expect(unpacked[2]!.body.length).toBe(1000);
    expect(unpacked[2]!.body[0]).toBe(0xFF);
  });

  it('should reject container with count > 1024', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(0x73f1f8dc, 0); // container CID
    buf.writeInt32LE(2000, 4);         // count = 2000
    expect(() => unpackContainer(buf)).toThrow('Invalid container message count: 2000 (max 1024)');
  });

  it('should reject container with negative count', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(0x73f1f8dc, 0);
    buf.writeInt32LE(-1, 4);
    expect(() => unpackContainer(buf)).toThrow('Invalid container message count: -1 (max 1024)');
  });

  it('should correctly identify containers with isContainer', () => {
    const packed = packContainer([{ msgId: 1n, seqNo: 0, body: Buffer.alloc(4) }]);
    expect(isContainer(packed)).toBe(true);

    // Non-container data
    expect(isContainer(Buffer.alloc(4, 0))).toBe(false);
    expect(isContainer(Buffer.alloc(0))).toBe(false);
    expect(isContainer(Buffer.from([1, 2, 3]))).toBe(false);
  });
});
