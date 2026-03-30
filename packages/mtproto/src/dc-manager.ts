/**
 * Data Center configuration and migration error handling.
 *
 * Manages Telegram DC endpoints for both production and test environments,
 * and parses DC migration errors from RPC responses.
 */

export interface DCConfig {
  id: number;           // 1-5 for production, 10001-10005 for test
  ip: string;
  port: number;
  test: boolean;
}

/**
 * Production DC addresses (IPv4).
 * Source: https://core.telegram.org/resources/cidr.txt
 */
export const PRODUCTION_DCS: DCConfig[] = [
  { id: 1, ip: '149.154.175.53', port: 443, test: false },
  { id: 2, ip: '149.154.167.51', port: 443, test: false },
  { id: 3, ip: '149.154.175.100', port: 443, test: false },
  { id: 4, ip: '149.154.167.91', port: 443, test: false },
  { id: 5, ip: '91.108.56.130', port: 443, test: false },
];

/**
 * Test DC addresses (IPv4).
 */
export const TEST_DCS: DCConfig[] = [
  { id: 10001, ip: '149.154.175.10', port: 443, test: true },
  { id: 10002, ip: '149.154.167.40', port: 443, test: true },
  { id: 10003, ip: '149.154.175.117', port: 443, test: true },
];

/**
 * Regex pattern for parsing DC migration errors.
 *
 * Matches errors like:
 *   PHONE_MIGRATE_2
 *   FILE_MIGRATE_3
 *   NETWORK_MIGRATE_1
 *   USER_MIGRATE_4
 */
const MIGRATE_ERROR_PATTERN = /^(?:PHONE|FILE|NETWORK|USER)_MIGRATE_(\d+)$/;

/**
 * DCManager maintains the mapping of DC IDs to their network configurations.
 *
 * It is initialized with either production or test DCs, and can be updated
 * at runtime when the client receives a help.getConfig response from the server.
 */
export class DCManager {
  private configs: Map<number, DCConfig>;

  constructor(useTestDCs?: boolean) {
    this.configs = new Map();
    const dcs = useTestDCs ? TEST_DCS : PRODUCTION_DCS;
    for (const dc of dcs) {
      this.configs.set(dc.id, { ...dc });
    }
  }

  /**
   * Get DC config by ID.
   */
  getDC(dcId: number): DCConfig | undefined {
    return this.configs.get(dcId);
  }

  /**
   * Get the default DC (DC 2 for production, DC 10002 for test).
   * DC 2 is typically the main DC for new accounts.
   */
  getDefaultDC(): DCConfig {
    // Try to find the default DC
    for (const [, config] of this.configs) {
      if (config.test) {
        if (config.id === 10002) return config;
      } else {
        if (config.id === 2) return config;
      }
    }

    // Fallback: return the first DC
    const first = this.configs.values().next();
    if (first.done) {
      throw new Error('No DC configs available');
    }
    return first.value;
  }

  /**
   * Update DC configs (e.g., from help.getConfig response).
   * New configs are merged with existing ones; existing entries with
   * the same ID are replaced.
   */
  updateConfigs(configs: DCConfig[]): void {
    for (const config of configs) {
      this.configs.set(config.id, { ...config });
    }
  }

  /**
   * Parse PHONE_MIGRATE_X, FILE_MIGRATE_X, NETWORK_MIGRATE_X,
   * USER_MIGRATE_X errors and return the target DC ID.
   *
   * Returns null if the error message does not match a migration pattern.
   */
  static parseMigrateError(errorMessage: string): number | null {
    const match = MIGRATE_ERROR_PATTERN.exec(errorMessage);
    if (!match) return null;
    return parseInt(match[1]!, 10);
  }
}
