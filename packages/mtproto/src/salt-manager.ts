/**
 * Server salt management for MTProto.
 *
 * Manages a set of future salts and returns the currently valid one.
 * Salts are sorted by validSince and the most appropriate one is returned
 * based on the current time.
 */

export interface FutureSalt {
  validSince: number;
  validUntil: number;
  salt: bigint;
}

/** Threshold in seconds before needing to refresh salts. */
const REFRESH_THRESHOLD_SECONDS = 1800; // 30 minutes

export class SaltManager {
  private salts: FutureSalt[] = [];

  /**
   * Add new salts. They will be merged and sorted.
   */
  addSalts(salts: FutureSalt[]): void {
    this.salts.push(...salts);
    // Sort by validSince ascending
    this.salts.sort((a, b) => a.validSince - b.validSince);
  }

  /**
   * Get the currently valid salt.
   * Returns 0n if no valid salt is available.
   */
  getCurrentSalt(): bigint {
    const now = Math.floor(Date.now() / 1000);

    // Find the most recently valid salt (latest validSince that has started
    // and hasn't expired)
    let bestSalt: FutureSalt | undefined;
    for (const salt of this.salts) {
      if (salt.validSince <= now && salt.validUntil > now) {
        bestSalt = salt;
      }
    }

    return bestSalt ? bestSalt.salt : 0n;
  }

  /**
   * Check if we need to request fresh salts from the server.
   * Returns true when no salts are available, all have expired,
   * or the latest salt expires soon.
   */
  needsRefresh(): boolean {
    if (this.salts.length === 0) return true;

    const now = Math.floor(Date.now() / 1000);

    // Find the latest expiry time among all salts
    let latestExpiry = 0;
    for (const salt of this.salts) {
      if (salt.validUntil > latestExpiry) {
        latestExpiry = salt.validUntil;
      }
    }

    // Need refresh if all expired or last one expires within threshold
    return latestExpiry <= now + REFRESH_THRESHOLD_SECONDS;
  }
}
