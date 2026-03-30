/**
 * MTProto message ID generator.
 *
 * msg_id requirements:
 * - Based on Unix time: approximately floor(unixtime * 2^32)
 * - Must be monotonically increasing
 * - Must be divisible by 4 (for client-originated messages)
 */
export class MsgIdGenerator {
  private lastMsgId = 0n;
  private timeOffset = 0;

  /**
   * Set the time offset (server time - local time) in seconds.
   */
  setTimeOffset(offset: number): void {
    this.timeOffset = offset;
  }

  /**
   * Generate a new unique msg_id.
   */
  generate(): bigint {
    const now = Date.now() / 1000 + this.timeOffset;
    let msgId = BigInt(Math.floor(now * 0x100000000));

    // Ensure divisible by 4
    msgId = msgId - (msgId % 4n);

    // Ensure monotonically increasing
    if (msgId <= this.lastMsgId) {
      msgId = this.lastMsgId + 4n;
    }

    this.lastMsgId = msgId;
    return msgId;
  }
}
