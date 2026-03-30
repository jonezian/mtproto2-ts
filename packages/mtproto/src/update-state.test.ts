import { describe, it, expect } from 'vitest';
import { UpdateState } from './update-state.js';
import type { UpdateStateData } from './update-state.js';

describe('UpdateState', () => {
  describe('constructor', () => {
    it('should initialize with default zeros', () => {
      const state = new UpdateState();
      expect(state.getState()).toEqual({ pts: 0, qts: 0, seq: 0, date: 0 });
    });

    it('should initialize with partial state', () => {
      const state = new UpdateState({ pts: 100, seq: 5 });
      expect(state.getState()).toEqual({ pts: 100, qts: 0, seq: 5, date: 0 });
    });

    it('should initialize with full state', () => {
      const initial: UpdateStateData = { pts: 100, qts: 50, seq: 10, date: 1700000000 };
      const state = new UpdateState(initial);
      expect(state.getState()).toEqual(initial);
    });
  });

  describe('applyPts', () => {
    it('should accept first update when pts is 0 (uninitialized)', () => {
      const state = new UpdateState();
      expect(state.applyPts(5, 1)).toBe('accept');
      expect(state.getState().pts).toBe(5);
    });

    it('should accept update when local_pts + pts_count == received_pts', () => {
      const state = new UpdateState({ pts: 100 });
      expect(state.applyPts(101, 1)).toBe('accept');
      expect(state.getState().pts).toBe(101);
    });

    it('should accept update with pts_count > 1', () => {
      const state = new UpdateState({ pts: 100 });
      // Batch update affecting 5 entries: 100 + 5 = 105
      expect(state.applyPts(105, 5)).toBe('accept');
      expect(state.getState().pts).toBe(105);
    });

    it('should detect duplicate when received_pts <= local_pts', () => {
      const state = new UpdateState({ pts: 100 });
      expect(state.applyPts(100, 1)).toBe('duplicate');
      expect(state.getState().pts).toBe(100); // unchanged
    });

    it('should detect duplicate when received_pts < local_pts', () => {
      const state = new UpdateState({ pts: 100 });
      expect(state.applyPts(95, 1)).toBe('duplicate');
      expect(state.getState().pts).toBe(100); // unchanged
    });

    it('should detect gap when received_pts > local_pts + pts_count', () => {
      const state = new UpdateState({ pts: 100 });
      // Expected: 100 + 1 = 101, but received 110 -> gap
      expect(state.applyPts(110, 1)).toBe('gap');
      expect(state.getState().pts).toBe(100); // unchanged on gap
    });

    it('should handle sequential updates correctly', () => {
      const state = new UpdateState({ pts: 0 });
      expect(state.applyPts(1, 1)).toBe('accept');
      expect(state.applyPts(2, 1)).toBe('accept');
      expect(state.applyPts(3, 1)).toBe('accept');
      expect(state.getState().pts).toBe(3);
    });

    it('should handle mixed batch sizes', () => {
      const state = new UpdateState({ pts: 10 });
      expect(state.applyPts(11, 1)).toBe('accept');  // 10 + 1 = 11
      expect(state.applyPts(14, 3)).toBe('accept');  // 11 + 3 = 14
      expect(state.applyPts(16, 2)).toBe('accept');  // 14 + 2 = 16
      expect(state.getState().pts).toBe(16);
    });
  });

  describe('applyQts', () => {
    it('should accept first qts update when qts is 0 (uninitialized)', () => {
      const state = new UpdateState();
      expect(state.applyQts(1)).toBe('accept');
      expect(state.getState().qts).toBe(1);
    });

    it('should accept sequential qts update (qts + 1)', () => {
      const state = new UpdateState({ qts: 10 });
      expect(state.applyQts(11)).toBe('accept');
      expect(state.getState().qts).toBe(11);
    });

    it('should detect duplicate qts', () => {
      const state = new UpdateState({ qts: 10 });
      expect(state.applyQts(10)).toBe('duplicate');
      expect(state.getState().qts).toBe(10);
    });

    it('should detect duplicate for lower qts', () => {
      const state = new UpdateState({ qts: 10 });
      expect(state.applyQts(5)).toBe('duplicate');
    });

    it('should detect gap in qts', () => {
      const state = new UpdateState({ qts: 10 });
      expect(state.applyQts(13)).toBe('gap');
      expect(state.getState().qts).toBe(10); // unchanged on gap
    });

    it('should handle sequential qts correctly', () => {
      const state = new UpdateState({ qts: 0 });
      expect(state.applyQts(1)).toBe('accept');
      expect(state.applyQts(2)).toBe('accept');
      expect(state.applyQts(3)).toBe('accept');
      expect(state.getState().qts).toBe(3);
    });
  });

  describe('applySeq', () => {
    it('should accept first seq update when seq is 0 (uninitialized)', () => {
      const state = new UpdateState();
      expect(state.applySeq(1)).toBe('accept');
      expect(state.getState().seq).toBe(1);
    });

    it('should accept seq=0 unconditionally (no-seq update)', () => {
      const state = new UpdateState({ seq: 5 });
      expect(state.applySeq(0)).toBe('accept');
      expect(state.getState().seq).toBe(5); // unchanged because seq=0 is special
    });

    it('should accept sequential seq update', () => {
      const state = new UpdateState({ seq: 10 });
      expect(state.applySeq(11)).toBe('accept');
      expect(state.getState().seq).toBe(11);
    });

    it('should detect duplicate seq', () => {
      const state = new UpdateState({ seq: 10 });
      expect(state.applySeq(10)).toBe('duplicate');
      expect(state.getState().seq).toBe(10);
    });

    it('should detect gap in seq', () => {
      const state = new UpdateState({ seq: 10 });
      expect(state.applySeq(15)).toBe('gap');
      expect(state.getState().seq).toBe(10); // unchanged on gap
    });
  });

  describe('setters', () => {
    it('should set pts directly', () => {
      const state = new UpdateState();
      state.setPts(500);
      expect(state.getState().pts).toBe(500);
    });

    it('should set qts directly', () => {
      const state = new UpdateState();
      state.setQts(100);
      expect(state.getState().qts).toBe(100);
    });

    it('should set seq directly', () => {
      const state = new UpdateState();
      state.setSeq(42);
      expect(state.getState().seq).toBe(42);
    });

    it('should set date directly', () => {
      const state = new UpdateState();
      state.setDate(1700000000);
      expect(state.getState().date).toBe(1700000000);
    });

    it('should allow applyPts to work after setPts', () => {
      const state = new UpdateState();
      state.setPts(100);
      expect(state.applyPts(101, 1)).toBe('accept');
      expect(state.getState().pts).toBe(101);
    });
  });

  describe('serialize / deserialize', () => {
    it('should round-trip serialize and deserialize', () => {
      const state = new UpdateState({ pts: 12345, qts: 678, seq: 90, date: 1700000000 });
      const buf = state.serialize();
      const restored = UpdateState.deserialize(buf);
      expect(restored.getState()).toEqual(state.getState());
    });

    it('should produce a 16-byte buffer', () => {
      const state = new UpdateState({ pts: 1, qts: 2, seq: 3, date: 4 });
      const buf = state.serialize();
      expect(buf.length).toBe(16);
    });

    it('should serialize in little-endian int32 format', () => {
      const state = new UpdateState({ pts: 100, qts: 200, seq: 300, date: 400 });
      const buf = state.serialize();
      expect(buf.readInt32LE(0)).toBe(100);
      expect(buf.readInt32LE(4)).toBe(200);
      expect(buf.readInt32LE(8)).toBe(300);
      expect(buf.readInt32LE(12)).toBe(400);
    });

    it('should throw on data too short', () => {
      const buf = Buffer.alloc(8);
      expect(() => UpdateState.deserialize(buf)).toThrow('too short');
    });

    it('should handle zero values', () => {
      const state = new UpdateState();
      const buf = state.serialize();
      const restored = UpdateState.deserialize(buf);
      expect(restored.getState()).toEqual({ pts: 0, qts: 0, seq: 0, date: 0 });
    });

    it('should handle negative values (time offsets, etc.)', () => {
      const state = new UpdateState({ pts: -1, qts: -2, seq: -3, date: -4 });
      const buf = state.serialize();
      const restored = UpdateState.deserialize(buf);
      expect(restored.getState()).toEqual({ pts: -1, qts: -2, seq: -3, date: -4 });
    });
  });
});
