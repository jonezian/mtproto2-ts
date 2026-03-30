import { describe, it, expect } from 'vitest';
import { MsgIdGenerator } from './msg-id.js';

describe('MsgIdGenerator', () => {
  it('should generate monotonically increasing IDs', () => {
    const gen = new MsgIdGenerator();
    const ids: bigint[] = [];
    for (let i = 0; i < 100; i++) {
      ids.push(gen.generate());
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]!).toBeGreaterThan(ids[i - 1]!);
    }
  });

  it('should generate IDs divisible by 4', () => {
    const gen = new MsgIdGenerator();
    for (let i = 0; i < 100; i++) {
      const id = gen.generate();
      expect(id % 4n).toBe(0n);
    }
  });

  it('should apply time offset', () => {
    const gen1 = new MsgIdGenerator();
    const gen2 = new MsgIdGenerator();
    gen2.setTimeOffset(3600); // 1 hour ahead

    const id1 = gen1.generate();
    const id2 = gen2.generate();

    // id2 should be roughly 3600 * 2^32 larger
    const diff = id2 - id1;
    const expectedDiff = BigInt(3600) * 0x100000000n;
    // Allow some tolerance for timing differences
    expect(diff).toBeGreaterThan(expectedDiff - 0x200000000n);
    expect(diff).toBeLessThan(expectedDiff + 0x200000000n);
  });

  it('should produce unique IDs even with rapid generation', () => {
    const gen = new MsgIdGenerator();
    const ids = new Set<bigint>();
    for (let i = 0; i < 1000; i++) {
      ids.add(gen.generate());
    }
    expect(ids.size).toBe(1000);
  });
});
