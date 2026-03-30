/**
 * Update processing and gap detection for MTProto 2.0.
 *
 * The UpdateHandler manages the flow of incoming updates:
 *   1. Receives raw update messages from the connection layer
 *   2. Checks pts/qts/seq against the tracked state
 *   3. Accepts, buffers, or discards updates accordingly
 *   4. When a gap is detected, starts a timer to wait for the missing updates
 *   5. If the gap isn't filled in time, emits 'need-difference' so the
 *      application layer can call updates.getDifference
 *   6. After getDifference returns, applies the new state and drains the buffer
 */

import { EventEmitter } from 'node:events';
import { UpdateState } from './update-state.js';
import type { UpdateStateData, UpdateApplyResult } from './update-state.js';
import type { BufferedUpdate } from './difference.js';

export type { BufferedUpdate } from './difference.js';

export interface UpdateHandlerEvents {
  'update': (constructorId: number, data: Buffer) => void;
  'gap-detected': (type: 'pts' | 'qts' | 'seq') => void;
  'need-difference': () => void;
  'need-channel-difference': (channelId: number) => void;
  'state-updated': (state: UpdateStateData) => void;
}

/** Default time to wait for a gap to be resolved before requesting getDifference. */
const DEFAULT_GAP_TIMEOUT_MS = 500;

export class UpdateHandler extends EventEmitter {
  private state: UpdateState;
  private buffer: BufferedUpdate[];
  private gapTimeout: ReturnType<typeof setTimeout> | null;
  private readonly GAP_TIMEOUT_MS: number;

  constructor(initialState?: Partial<UpdateStateData>, gapTimeoutMs?: number) {
    super();
    this.state = new UpdateState(initialState);
    this.buffer = [];
    this.gapTimeout = null;
    this.GAP_TIMEOUT_MS = gapTimeoutMs ?? DEFAULT_GAP_TIMEOUT_MS;
  }

  /**
   * Process a single incoming update with pts/ptsCount/qts tracking.
   *
   * If the update carries pts, it is validated against the current state.
   * If there's a gap, the update is buffered and a gap timer is started.
   * Duplicates are silently discarded.
   */
  processUpdate(update: BufferedUpdate): void {
    // If the update carries pts information
    if (update.pts !== undefined && update.ptsCount !== undefined) {
      const result = this.state.applyPts(update.pts, update.ptsCount);
      this.handleApplyResult(result, update, 'pts');
      return;
    }

    // If the update carries qts information
    if (update.qts !== undefined) {
      const result = this.state.applyQts(update.qts);
      this.handleApplyResult(result, update, 'qts');
      return;
    }

    // No pts or qts — emit directly (e.g., simple updates without ordering)
    this.emitUpdate(update);
  }

  /**
   * Process updates from an Updates or UpdatesCombined wrapper.
   *
   * These wrappers carry seq (and optionally seq_start for UpdatesCombined).
   * The seq check is done on the wrapper, and then individual updates
   * inside are processed for their pts/qts.
   *
   * @param updates - The individual updates contained in the wrapper
   * @param seq - The seq value from the wrapper
   * @param seqStart - The seq_start value (same as seq for Updates, may differ for UpdatesCombined)
   * @param date - The date from the wrapper
   */
  processUpdates(
    updates: BufferedUpdate[],
    seq: number,
    seqStart: number,
    date: number,
  ): void {
    // Validate seq on the wrapper
    // For Updates, seqStart == seq. For UpdatesCombined, seqStart may be < seq.
    // We check seqStart against our current seq.
    const seqToCheck = seqStart > 0 ? seqStart : seq;
    const seqResult = this.state.applySeq(seqToCheck);

    if (seqResult === 'duplicate') {
      // Already processed this batch
      return;
    }

    if (seqResult === 'gap') {
      // Buffer all updates from this wrapper
      for (const update of updates) {
        this.buffer.push(update);
      }
      this.emit('gap-detected', 'seq');
      this.startGapTimer();
      return;
    }

    // seq accepted — if seqStart != seq, we need to advance seq to the final value
    if (seq > seqToCheck) {
      this.state.setSeq(seq);
    }

    // Update date
    if (date > 0) {
      this.state.setDate(date);
    }

    // Process each individual update for its pts/qts
    for (const update of updates) {
      this.processUpdate(update);
    }

    this.emitStateUpdated();
  }

  /**
   * Handle an updatesTooLong notification.
   * This means the server can't send us individual updates and we need
   * to call getDifference to catch up.
   */
  handleUpdatesTooLong(): void {
    this.emit('need-difference');
  }

  /**
   * Apply the result of a getDifference call.
   *
   * Sets the new state and processes any updates returned by getDifference.
   * Then drains any buffered updates that may now be applicable.
   */
  applyDifference(newState: UpdateStateData, updates: BufferedUpdate[]): void {
    // Set the authoritative state from the server
    this.state.setPts(newState.pts);
    this.state.setQts(newState.qts);
    this.state.setSeq(newState.seq);
    this.state.setDate(newState.date);

    // Cancel any pending gap timer
    this.clearGapTimer();

    // Emit the updates from getDifference directly (they are already validated)
    for (const update of updates) {
      this.emitUpdate(update);
    }

    // Try to drain any buffered updates that may now fit
    this.drainBuffer();

    this.emitStateUpdated();
  }

  /**
   * Get the current update state (for passing to getDifference).
   */
  getState(): UpdateStateData {
    return this.state.getState();
  }

  /**
   * Set the state (e.g., on initial connection from updates.getState).
   */
  setState(state: UpdateStateData): void {
    this.state.setPts(state.pts);
    this.state.setQts(state.qts);
    this.state.setSeq(state.seq);
    this.state.setDate(state.date);
    this.emitStateUpdated();
  }

  /**
   * Reset the handler (e.g., on reconnection).
   * Clears the buffer and gap timer but preserves the state
   * so getDifference can be called with the last known state.
   */
  reset(): void {
    this.buffer = [];
    this.clearGapTimer();
  }

  /**
   * Get the number of currently buffered updates (useful for testing/monitoring).
   */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Try to drain buffered updates by re-applying them.
   *
   * Buffered updates are sorted by pts and applied in order.
   * Any that are accepted or duplicated are removed from the buffer.
   * If gaps still exist, they remain buffered.
   */
  private drainBuffer(): void {
    if (this.buffer.length === 0) return;

    // Sort buffered updates by pts (updates without pts go first)
    this.buffer.sort((a, b) => {
      const aPts = a.pts ?? 0;
      const bPts = b.pts ?? 0;
      return aPts - bPts;
    });

    const remaining: BufferedUpdate[] = [];
    let progress = true;

    // Keep draining while we make progress
    while (progress) {
      progress = false;
      const tryAgain: BufferedUpdate[] = [];

      const toProcess = remaining.length > 0 ? remaining.splice(0) : this.buffer.splice(0);

      for (const update of toProcess) {
        if (update.pts !== undefined && update.ptsCount !== undefined) {
          const result = this.state.applyPts(update.pts, update.ptsCount);
          if (result === 'accept') {
            this.emitUpdate(update);
            progress = true;
          } else if (result === 'gap') {
            tryAgain.push(update);
          }
          // 'duplicate' — drop it
        } else if (update.qts !== undefined) {
          const result = this.state.applyQts(update.qts);
          if (result === 'accept') {
            this.emitUpdate(update);
            progress = true;
          } else if (result === 'gap') {
            tryAgain.push(update);
          }
        } else {
          // No pts/qts — just emit
          this.emitUpdate(update);
          progress = true;
        }
      }

      remaining.push(...tryAgain);
    }

    this.buffer = remaining;
  }

  /**
   * Start the gap resolution timer.
   * If the gap isn't resolved before the timer fires, emit 'need-difference'.
   */
  private startGapTimer(): void {
    // Don't start multiple timers
    if (this.gapTimeout !== null) return;

    this.gapTimeout = setTimeout(() => {
      this.handleGapTimeout();
    }, this.GAP_TIMEOUT_MS);
  }

  /**
   * Handle gap timeout — the gap wasn't resolved in time.
   */
  private handleGapTimeout(): void {
    this.gapTimeout = null;
    this.emit('need-difference');
  }

  /**
   * Clear the gap timer if it's running.
   */
  private clearGapTimer(): void {
    if (this.gapTimeout !== null) {
      clearTimeout(this.gapTimeout);
      this.gapTimeout = null;
    }
  }

  /**
   * Handle the result of applying a pts/qts/seq update.
   */
  private handleApplyResult(
    result: UpdateApplyResult,
    update: BufferedUpdate,
    type: 'pts' | 'qts' | 'seq',
  ): void {
    switch (result) {
      case 'accept':
        this.emitUpdate(update);
        this.emitStateUpdated();
        // After accepting an update, try draining the buffer
        // in case this fills a gap for buffered updates.
        this.drainBuffer();
        // If the buffer is now empty, cancel the gap timer
        if (this.buffer.length === 0) {
          this.clearGapTimer();
        }
        break;

      case 'duplicate':
        // Silently discard
        break;

      case 'gap':
        this.buffer.push(update);
        this.emit('gap-detected', type);
        this.startGapTimer();
        break;
    }
  }

  /**
   * Emit an update to listeners.
   */
  private emitUpdate(update: BufferedUpdate): void {
    this.emit('update', update.constructorId, update.data);
  }

  /**
   * Emit the current state to listeners.
   */
  private emitStateUpdated(): void {
    this.emit('state-updated', this.state.getState());
  }
}
