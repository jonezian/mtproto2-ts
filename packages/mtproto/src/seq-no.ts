/**
 * MTProto sequence number tracker.
 *
 * Rules:
 * - Non-content-related: seq_no = contentSeqNo * 2
 * - Content-related: seq_no = contentSeqNo * 2 + 1, then increment contentSeqNo
 */
export class SeqNoTracker {
  private contentSeqNo = 0;

  /**
   * Get the next sequence number.
   *
   * @param isContentRelated - true for content-related messages (RPC calls, responses),
   *                           false for non-content-related (acks, pings, containers)
   */
  next(isContentRelated: boolean): number {
    const seqNo = this.contentSeqNo * 2 + (isContentRelated ? 1 : 0);
    if (isContentRelated) {
      this.contentSeqNo++;
    }
    return seqNo;
  }

  /**
   * Reset the sequence counter (e.g., on new session).
   */
  reset(): void {
    this.contentSeqNo = 0;
  }
}
