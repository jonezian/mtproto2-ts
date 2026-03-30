import { describe, it, expect } from 'vitest';
import { createMsgsAck, parseMsgsAck } from './ack.js';

describe('ack', () => {
  it('should create and parse ack round-trip', () => {
    const msgIds = [100n, 200n, 300n];
    const buf = createMsgsAck(msgIds);
    const parsed = parseMsgsAck(buf);
    expect(parsed).toEqual(msgIds);
  });

  it('should have correct constructor ID (0x62d6b459)', () => {
    const buf = createMsgsAck([1n]);
    const cid = buf.readUInt32LE(0);
    expect(cid).toBe(0x62d6b459);
  });

  it('should handle single msg ID', () => {
    const msgIds = [42n];
    const buf = createMsgsAck(msgIds);
    const parsed = parseMsgsAck(buf);
    expect(parsed).toEqual([42n]);
  });

  it('should handle multiple msg IDs', () => {
    const msgIds = [1n, 2n, 3n, 4n, 5n, 1000000n];
    const buf = createMsgsAck(msgIds);
    const parsed = parseMsgsAck(buf);
    expect(parsed).toEqual(msgIds);
  });

  it('should handle empty msg ID list', () => {
    const buf = createMsgsAck([]);
    const parsed = parseMsgsAck(buf);
    expect(parsed).toEqual([]);
  });

  it('should have vector constructor ID', () => {
    const buf = createMsgsAck([1n]);
    // Vector CID is at offset 4
    const vectorCid = buf.readUInt32LE(4);
    expect(vectorCid).toBe(0x1cb5c415);
  });

  it('should throw on invalid constructor ID', () => {
    const buf = Buffer.alloc(12);
    buf.writeUInt32LE(0xDEADBEEF, 0); // wrong CID
    expect(() => parseMsgsAck(buf)).toThrow('Invalid msgs_ack constructor ID');
  });
});
