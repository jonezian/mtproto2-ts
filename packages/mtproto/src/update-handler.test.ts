import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { UpdateHandler } from './update-handler.js';
import type { BufferedUpdate } from './difference.js';
import type { UpdateStateData } from './update-state.js';

describe('UpdateHandler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeUpdate(
    cid: number,
    opts?: { pts?: number; ptsCount?: number; qts?: number },
  ): BufferedUpdate {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(cid, 0);
    return {
      constructorId: cid,
      data: buf,
      pts: opts?.pts,
      ptsCount: opts?.ptsCount,
      qts: opts?.qts,
    };
  }

  describe('processUpdate', () => {
    it('should emit update for a pts update that is accepted', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdate(makeUpdate(0xAABBCCDD, { pts: 11, ptsCount: 1 }));

      expect(updates).toEqual([0xAABBCCDD]);
    });

    it('should not emit update for a duplicate pts update', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdate(makeUpdate(0xAABBCCDD, { pts: 10, ptsCount: 1 }));

      expect(updates).toEqual([]);
    });

    it('should buffer update and emit gap-detected for pts gap', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const gaps: string[] = [];
      const updates: number[] = [];
      handler.on('gap-detected', (type: string) => gaps.push(type));
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdate(makeUpdate(0xAABBCCDD, { pts: 15, ptsCount: 1 }));

      expect(gaps).toEqual(['pts']);
      expect(updates).toEqual([]);
      expect(handler.bufferedCount).toBe(1);
    });

    it('should emit update for a qts update that is accepted', () => {
      const handler = new UpdateHandler({ qts: 5 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdate(makeUpdate(0x11223344, { qts: 6 }));

      expect(updates).toEqual([0x11223344]);
    });

    it('should buffer update and emit gap-detected for qts gap', () => {
      const handler = new UpdateHandler({ qts: 5 });
      const gaps: string[] = [];
      handler.on('gap-detected', (type: string) => gaps.push(type));

      handler.processUpdate(makeUpdate(0x11223344, { qts: 10 }));

      expect(gaps).toEqual(['qts']);
      expect(handler.bufferedCount).toBe(1);
    });

    it('should emit update directly when no pts/qts/seq present', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdate(makeUpdate(0xDEADBEEF));

      expect(updates).toEqual([0xDEADBEEF]);
    });

    it('should emit state-updated after accepting a pts update', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const states: UpdateStateData[] = [];
      handler.on('state-updated', (state: UpdateStateData) => states.push(state));

      handler.processUpdate(makeUpdate(0xAA, { pts: 11, ptsCount: 1 }));

      expect(states.length).toBe(1);
      expect(states[0]!.pts).toBe(11);
    });

    it('should accept first update when state is uninitialized (pts=0)', () => {
      const handler = new UpdateHandler();
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdate(makeUpdate(0xAA, { pts: 42, ptsCount: 1 }));

      expect(updates).toEqual([0xAA]);
      expect(handler.getState().pts).toBe(42);
    });
  });

  describe('processUpdates (seq wrapper)', () => {
    it('should process updates when seq is accepted', () => {
      const handler = new UpdateHandler({ pts: 10, seq: 5 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdates(
        [makeUpdate(0xAA, { pts: 11, ptsCount: 1 })],
        6, // seq
        6, // seqStart
        1700000000,
      );

      expect(updates).toEqual([0xAA]);
      expect(handler.getState().seq).toBe(6);
      expect(handler.getState().date).toBe(1700000000);
    });

    it('should discard all updates when seq is duplicate', () => {
      const handler = new UpdateHandler({ pts: 10, seq: 5 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdates(
        [makeUpdate(0xAA, { pts: 11, ptsCount: 1 })],
        5, // duplicate seq
        5,
        1700000000,
      );

      expect(updates).toEqual([]);
    });

    it('should buffer updates and emit gap-detected when seq gap', () => {
      const handler = new UpdateHandler({ pts: 10, seq: 5 });
      const gaps: string[] = [];
      const updates: number[] = [];
      handler.on('gap-detected', (type: string) => gaps.push(type));
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdates(
        [makeUpdate(0xAA, { pts: 11, ptsCount: 1 })],
        10, // gap: expected 6
        10,
        1700000000,
      );

      expect(gaps).toEqual(['seq']);
      expect(updates).toEqual([]);
      expect(handler.bufferedCount).toBe(1);
    });

    it('should handle UpdatesCombined with different seqStart and seq', () => {
      const handler = new UpdateHandler({ pts: 10, seq: 5 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdates(
        [
          makeUpdate(0xAA, { pts: 11, ptsCount: 1 }),
          makeUpdate(0xBB, { pts: 12, ptsCount: 1 }),
        ],
        7, // seq (final)
        6, // seqStart (checked against our state)
        1700000000,
      );

      expect(updates).toEqual([0xAA, 0xBB]);
      expect(handler.getState().seq).toBe(7); // advanced to final seq
    });

    it('should process multiple updates in a single wrapper', () => {
      const handler = new UpdateHandler({ pts: 10, seq: 5 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdates(
        [
          makeUpdate(0xAA, { pts: 11, ptsCount: 1 }),
          makeUpdate(0xBB, { pts: 12, ptsCount: 1 }),
          makeUpdate(0xCC, { pts: 13, ptsCount: 1 }),
        ],
        6,
        6,
        1700000000,
      );

      expect(updates).toEqual([0xAA, 0xBB, 0xCC]);
      expect(handler.getState().pts).toBe(13);
    });
  });

  describe('gap detection and buffering', () => {
    it('should resolve gap when missing update arrives', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      // Update with pts=12 arrives first (gap: missing pts=11)
      handler.processUpdate(makeUpdate(0xBB, { pts: 12, ptsCount: 1 }));
      expect(updates).toEqual([]);
      expect(handler.bufferedCount).toBe(1);

      // Missing update with pts=11 arrives
      handler.processUpdate(makeUpdate(0xAA, { pts: 11, ptsCount: 1 }));

      // Both should now be emitted (AA first, then BB from buffer drain)
      expect(updates).toEqual([0xAA, 0xBB]);
      expect(handler.bufferedCount).toBe(0);
    });

    it('should handle multiple buffered updates being drained', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      // Buffer updates 12 and 13
      handler.processUpdate(makeUpdate(0xCC, { pts: 13, ptsCount: 1 }));
      handler.processUpdate(makeUpdate(0xBB, { pts: 12, ptsCount: 1 }));
      expect(handler.bufferedCount).toBe(2);

      // Missing update 11 fills the gap
      handler.processUpdate(makeUpdate(0xAA, { pts: 11, ptsCount: 1 }));

      expect(updates).toEqual([0xAA, 0xBB, 0xCC]);
      expect(handler.bufferedCount).toBe(0);
    });

    it('should discard duplicates from buffer during drain', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      // Buffer a future update
      handler.processUpdate(makeUpdate(0xBB, { pts: 12, ptsCount: 1 }));

      // Accept the normal next update
      handler.processUpdate(makeUpdate(0xAA, { pts: 11, ptsCount: 1 }));

      // BB should be drained from buffer
      expect(updates).toEqual([0xAA, 0xBB]);

      // Now try to process BB again — should be duplicate
      handler.processUpdate(makeUpdate(0xBB, { pts: 12, ptsCount: 1 }));
      expect(updates).toEqual([0xAA, 0xBB]); // no new emission
    });
  });

  describe('gap timeout', () => {
    it('should emit need-difference when gap timeout fires', () => {
      const handler = new UpdateHandler({ pts: 10 }, 500);
      const needDiff: boolean[] = [];
      handler.on('need-difference', () => needDiff.push(true));

      // Create a gap
      handler.processUpdate(makeUpdate(0xBB, { pts: 15, ptsCount: 1 }));
      expect(needDiff).toEqual([]);

      // Advance time past the gap timeout
      vi.advanceTimersByTime(600);

      expect(needDiff).toEqual([true]);
    });

    it('should not emit need-difference if gap is resolved before timeout', () => {
      const handler = new UpdateHandler({ pts: 10 }, 500);
      const needDiff: boolean[] = [];
      handler.on('need-difference', () => needDiff.push(true));

      // Create a gap (missing pts=11)
      handler.processUpdate(makeUpdate(0xBB, { pts: 12, ptsCount: 1 }));

      // Resolve the gap before timeout
      vi.advanceTimersByTime(200);
      handler.processUpdate(makeUpdate(0xAA, { pts: 11, ptsCount: 1 }));

      // Advance past the original timeout
      vi.advanceTimersByTime(400);

      expect(needDiff).toEqual([]);
    });

    it('should not start multiple gap timers', () => {
      const handler = new UpdateHandler({ pts: 10 }, 500);
      const needDiff: boolean[] = [];
      handler.on('need-difference', () => needDiff.push(true));

      // Create two gaps
      handler.processUpdate(makeUpdate(0xBB, { pts: 15, ptsCount: 1 }));
      handler.processUpdate(makeUpdate(0xCC, { pts: 20, ptsCount: 1 }));

      // Advance past timeout
      vi.advanceTimersByTime(600);

      // Should only emit once
      expect(needDiff).toEqual([true]);
    });
  });

  describe('handleUpdatesTooLong', () => {
    it('should emit need-difference immediately', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const needDiff: boolean[] = [];
      handler.on('need-difference', () => needDiff.push(true));

      handler.handleUpdatesTooLong();

      expect(needDiff).toEqual([true]);
    });
  });

  describe('applyDifference', () => {
    it('should set new state and emit updates from difference', () => {
      const handler = new UpdateHandler({ pts: 10, qts: 5, seq: 3, date: 1700000000 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      const newState: UpdateStateData = { pts: 50, qts: 10, seq: 8, date: 1700001000 };
      const diffUpdates = [
        makeUpdate(0xAA),
        makeUpdate(0xBB),
      ];

      handler.applyDifference(newState, diffUpdates);

      expect(updates).toEqual([0xAA, 0xBB]);
      expect(handler.getState()).toEqual(newState);
    });

    it('should drain buffered updates after applying difference', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      // Buffer an update that creates a gap
      handler.processUpdate(makeUpdate(0xBB, { pts: 52, ptsCount: 1 }));
      expect(handler.bufferedCount).toBe(1);

      // Apply difference that sets pts to 51
      handler.applyDifference(
        { pts: 51, qts: 0, seq: 0, date: 0 },
        [makeUpdate(0xAA)],
      );

      // AA from diff + BB from buffer drain
      expect(updates).toEqual([0xAA, 0xBB]);
      expect(handler.bufferedCount).toBe(0);
    });

    it('should cancel gap timer when difference is applied', () => {
      const handler = new UpdateHandler({ pts: 10 }, 500);
      const needDiff: boolean[] = [];
      handler.on('need-difference', () => needDiff.push(true));

      // Create a gap
      handler.processUpdate(makeUpdate(0xBB, { pts: 15, ptsCount: 1 }));

      // Apply difference before timeout
      handler.applyDifference(
        { pts: 20, qts: 0, seq: 0, date: 0 },
        [],
      );

      // Advance past original timeout
      vi.advanceTimersByTime(600);

      // Should not emit need-difference because it was cancelled
      expect(needDiff).toEqual([]);
    });

    it('should emit state-updated after applying difference', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const states: UpdateStateData[] = [];
      handler.on('state-updated', (state: UpdateStateData) => states.push(state));

      handler.applyDifference(
        { pts: 50, qts: 10, seq: 5, date: 1700000000 },
        [],
      );

      expect(states.length).toBeGreaterThanOrEqual(1);
      const lastState = states[states.length - 1]!;
      expect(lastState.pts).toBe(50);
    });
  });

  describe('setState', () => {
    it('should set all state fields', () => {
      const handler = new UpdateHandler();
      handler.setState({ pts: 100, qts: 50, seq: 10, date: 1700000000 });
      expect(handler.getState()).toEqual({ pts: 100, qts: 50, seq: 10, date: 1700000000 });
    });

    it('should emit state-updated', () => {
      const handler = new UpdateHandler();
      const states: UpdateStateData[] = [];
      handler.on('state-updated', (state: UpdateStateData) => states.push(state));

      handler.setState({ pts: 100, qts: 50, seq: 10, date: 1700000000 });

      expect(states.length).toBe(1);
    });
  });

  describe('reset', () => {
    it('should clear the buffer', () => {
      const handler = new UpdateHandler({ pts: 10 });

      handler.processUpdate(makeUpdate(0xBB, { pts: 15, ptsCount: 1 }));
      expect(handler.bufferedCount).toBe(1);

      handler.reset();
      expect(handler.bufferedCount).toBe(0);
    });

    it('should cancel gap timer', () => {
      const handler = new UpdateHandler({ pts: 10 }, 500);
      const needDiff: boolean[] = [];
      handler.on('need-difference', () => needDiff.push(true));

      handler.processUpdate(makeUpdate(0xBB, { pts: 15, ptsCount: 1 }));
      handler.reset();

      vi.advanceTimersByTime(600);
      expect(needDiff).toEqual([]);
    });

    it('should preserve the state (for getDifference after reconnect)', () => {
      const handler = new UpdateHandler({ pts: 100, qts: 50, seq: 10, date: 1700000000 });
      handler.reset();
      expect(handler.getState()).toEqual({ pts: 100, qts: 50, seq: 10, date: 1700000000 });
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      const handler = new UpdateHandler({ pts: 10, qts: 5, seq: 3, date: 1700000000 });
      expect(handler.getState()).toEqual({ pts: 10, qts: 5, seq: 3, date: 1700000000 });
    });

    it('should reflect state changes from processUpdate', () => {
      const handler = new UpdateHandler({ pts: 10 });
      handler.processUpdate(makeUpdate(0xAA, { pts: 11, ptsCount: 1 }));
      expect(handler.getState().pts).toBe(11);
    });
  });

  describe('edge cases', () => {
    it('should handle update with pts_count=0', () => {
      const handler = new UpdateHandler({ pts: 10 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      // pts_count=0 means: local_pts + 0 == 10 == received_pts => accept
      handler.processUpdate(makeUpdate(0xAA, { pts: 10, ptsCount: 0 }));

      expect(updates).toEqual([0xAA]);
    });

    it('should handle rapid sequential updates', () => {
      const handler = new UpdateHandler({ pts: 0 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      for (let i = 1; i <= 100; i++) {
        handler.processUpdate(makeUpdate(i, { pts: i, ptsCount: 1 }));
      }

      expect(updates.length).toBe(100);
      expect(handler.getState().pts).toBe(100);
    });

    it('should handle interleaved pts and qts updates', () => {
      const handler = new UpdateHandler({ pts: 10, qts: 5 });
      const updates: number[] = [];
      handler.on('update', (cid: number) => updates.push(cid));

      handler.processUpdate(makeUpdate(0xAA, { pts: 11, ptsCount: 1 }));
      handler.processUpdate(makeUpdate(0xBB, { qts: 6 }));
      handler.processUpdate(makeUpdate(0xCC, { pts: 12, ptsCount: 1 }));
      handler.processUpdate(makeUpdate(0xDD, { qts: 7 }));

      expect(updates).toEqual([0xAA, 0xBB, 0xCC, 0xDD]);
    });
  });
});
