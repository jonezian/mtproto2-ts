import { describe, it, expect } from 'vitest';
import { SeqNoTracker } from './seq-no.js';

describe('SeqNoTracker', () => {
  it('should generate content-related sequence: 1, 3, 5, 7...', () => {
    const tracker = new SeqNoTracker();
    expect(tracker.next(true)).toBe(1);
    expect(tracker.next(true)).toBe(3);
    expect(tracker.next(true)).toBe(5);
    expect(tracker.next(true)).toBe(7);
  });

  it('should generate non-content-related sequence: 0, 0, 0... (without content-related)', () => {
    const tracker = new SeqNoTracker();
    // Without any content-related messages, seq_no stays at 0
    expect(tracker.next(false)).toBe(0);
    expect(tracker.next(false)).toBe(0);
    expect(tracker.next(false)).toBe(0);
  });

  it('should handle mixed sequence correctly', () => {
    const tracker = new SeqNoTracker();

    // non-content: contentSeqNo=0, seq = 0*2 = 0
    expect(tracker.next(false)).toBe(0);

    // content: contentSeqNo=0, seq = 0*2+1 = 1, then contentSeqNo becomes 1
    expect(tracker.next(true)).toBe(1);

    // non-content: contentSeqNo=1, seq = 1*2 = 2
    expect(tracker.next(false)).toBe(2);

    // content: contentSeqNo=1, seq = 1*2+1 = 3, then contentSeqNo becomes 2
    expect(tracker.next(true)).toBe(3);

    // non-content: contentSeqNo=2, seq = 2*2 = 4
    expect(tracker.next(false)).toBe(4);

    // content: contentSeqNo=2, seq = 2*2+1 = 5, then contentSeqNo becomes 3
    expect(tracker.next(true)).toBe(5);
  });

  it('should reset correctly', () => {
    const tracker = new SeqNoTracker();

    tracker.next(true);  // 1
    tracker.next(true);  // 3
    tracker.next(false); // 4

    tracker.reset();

    expect(tracker.next(false)).toBe(0);
    expect(tracker.next(true)).toBe(1);
    expect(tracker.next(true)).toBe(3);
  });
});
