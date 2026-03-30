/**
 * Update state tracking for MTProto 2.0.
 *
 * Tracks pts, qts, seq, and date to detect gaps and duplicates
 * in the update stream. This is critical for ensuring no updates
 * are lost and for triggering getDifference when gaps are detected.
 *
 * The core pts logic:
 *   if local_pts + pts_count == received_pts -> accept (no gap)
 *   if received_pts <= local_pts            -> duplicate, skip
 *   else                                    -> GAP -> need getDifference
 */

export interface UpdateStateData {
  pts: number;
  qts: number;
  seq: number;
  date: number;
}

export type UpdateApplyResult = 'accept' | 'duplicate' | 'gap';

export class UpdateState {
  private pts: number;
  private qts: number;
  private seq: number;
  private date: number;

  constructor(initial?: Partial<UpdateStateData>) {
    this.pts = initial?.pts ?? 0;
    this.qts = initial?.qts ?? 0;
    this.seq = initial?.seq ?? 0;
    this.date = initial?.date ?? 0;
  }

  /**
   * Get the current state snapshot.
   */
  getState(): UpdateStateData {
    return {
      pts: this.pts,
      qts: this.qts,
      seq: this.seq,
      date: this.date,
    };
  }

  /**
   * Apply a pts update.
   *
   * Returns 'accept' if the update is the expected next one (no gap).
   * Returns 'duplicate' if received_pts <= local_pts (already seen).
   * Returns 'gap' if there is a gap between local_pts and received_pts.
   *
   * On 'accept', the internal pts is updated to received_pts.
   */
  applyPts(receivedPts: number, ptsCount: number): UpdateApplyResult {
    // If our state is uninitialized (pts=0), accept anything
    if (this.pts === 0) {
      this.pts = receivedPts;
      return 'accept';
    }

    const expectedPts = this.pts + ptsCount;

    if (receivedPts === expectedPts) {
      // Perfect: no gap
      this.pts = receivedPts;
      return 'accept';
    }

    if (receivedPts <= this.pts) {
      // Already seen this or an older update
      return 'duplicate';
    }

    // receivedPts > expectedPts: there's a gap
    return 'gap';
  }

  /**
   * Apply a qts update.
   *
   * qts increments by 1 for each secret-chat update.
   * Returns 'accept' if receivedQts == local_qts + 1.
   * Returns 'duplicate' if receivedQts <= local_qts.
   * Returns 'gap' otherwise.
   */
  applyQts(receivedQts: number): UpdateApplyResult {
    if (this.qts === 0) {
      this.qts = receivedQts;
      return 'accept';
    }

    if (receivedQts === this.qts + 1) {
      this.qts = receivedQts;
      return 'accept';
    }

    if (receivedQts <= this.qts) {
      return 'duplicate';
    }

    return 'gap';
  }

  /**
   * Apply a seq update.
   *
   * seq increments by 1 for each Updates/UpdatesCombined wrapper.
   * Returns 'accept' if receivedSeq == local_seq + 1 (or local_seq == 0).
   * Returns 'duplicate' if receivedSeq <= local_seq.
   * Returns 'gap' otherwise.
   */
  applySeq(receivedSeq: number): UpdateApplyResult {
    // seq=0 means this update doesn't carry a seq (e.g., updateShort)
    if (receivedSeq === 0) {
      return 'accept';
    }

    if (this.seq === 0) {
      this.seq = receivedSeq;
      return 'accept';
    }

    if (receivedSeq === this.seq + 1) {
      this.seq = receivedSeq;
      return 'accept';
    }

    if (receivedSeq <= this.seq) {
      return 'duplicate';
    }

    return 'gap';
  }

  /**
   * Set pts directly (e.g., from getDifference result).
   */
  setPts(pts: number): void {
    this.pts = pts;
  }

  /**
   * Set qts directly (e.g., from getDifference result).
   */
  setQts(qts: number): void {
    this.qts = qts;
  }

  /**
   * Set seq directly (e.g., from getDifference result).
   */
  setSeq(seq: number): void {
    this.seq = seq;
  }

  /**
   * Set date directly (e.g., from getDifference result).
   */
  setDate(date: number): void {
    this.date = date;
  }

  /**
   * Serialize the state for persistence.
   *
   * Format: pts(4) + qts(4) + seq(4) + date(4) = 16 bytes total.
   * All values are signed 32-bit little-endian integers.
   */
  serialize(): Buffer {
    const buf = Buffer.alloc(16);
    buf.writeInt32LE(this.pts, 0);
    buf.writeInt32LE(this.qts, 4);
    buf.writeInt32LE(this.seq, 8);
    buf.writeInt32LE(this.date, 12);
    return buf;
  }

  /**
   * Deserialize a previously serialized UpdateState.
   */
  static deserialize(data: Buffer): UpdateState {
    if (data.length < 16) {
      throw new Error(`UpdateState data too short: expected 16 bytes, got ${data.length}`);
    }

    return new UpdateState({
      pts: data.readInt32LE(0),
      qts: data.readInt32LE(4),
      seq: data.readInt32LE(8),
      date: data.readInt32LE(12),
    });
  }
}
