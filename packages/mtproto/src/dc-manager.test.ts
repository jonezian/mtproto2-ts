import { describe, it, expect } from 'vitest';
import { DCManager, PRODUCTION_DCS, TEST_DCS } from './dc-manager.js';

describe('DCManager', () => {
  describe('production DCs', () => {
    it('should load production DCs by default', () => {
      const manager = new DCManager();

      for (const dc of PRODUCTION_DCS) {
        const config = manager.getDC(dc.id);
        expect(config).toBeDefined();
        expect(config!.ip).toBe(dc.ip);
        expect(config!.port).toBe(dc.port);
        expect(config!.test).toBe(false);
      }
    });

    it('should have 5 production DCs', () => {
      expect(PRODUCTION_DCS).toHaveLength(5);
    });

    it('should not return test DCs when using production', () => {
      const manager = new DCManager(false);

      for (const dc of TEST_DCS) {
        expect(manager.getDC(dc.id)).toBeUndefined();
      }
    });

    it('should return DC 2 as default for production', () => {
      const manager = new DCManager(false);
      const defaultDc = manager.getDefaultDC();

      expect(defaultDc.id).toBe(2);
      expect(defaultDc.test).toBe(false);
    });
  });

  describe('test DCs', () => {
    it('should load test DCs when useTestDCs is true', () => {
      const manager = new DCManager(true);

      for (const dc of TEST_DCS) {
        const config = manager.getDC(dc.id);
        expect(config).toBeDefined();
        expect(config!.ip).toBe(dc.ip);
        expect(config!.port).toBe(dc.port);
        expect(config!.test).toBe(true);
      }
    });

    it('should have 3 test DCs', () => {
      expect(TEST_DCS).toHaveLength(3);
    });

    it('should not return production DCs when using test', () => {
      const manager = new DCManager(true);

      for (const dc of PRODUCTION_DCS) {
        expect(manager.getDC(dc.id)).toBeUndefined();
      }
    });

    it('should return DC 10002 as default for test', () => {
      const manager = new DCManager(true);
      const defaultDc = manager.getDefaultDC();

      expect(defaultDc.id).toBe(10002);
      expect(defaultDc.test).toBe(true);
    });
  });

  describe('getDC', () => {
    it('should return undefined for unknown DC ID', () => {
      const manager = new DCManager();
      expect(manager.getDC(999)).toBeUndefined();
    });

    it('should return correct config for each production DC', () => {
      const manager = new DCManager();

      const dc1 = manager.getDC(1);
      expect(dc1).toBeDefined();
      expect(dc1!.ip).toBe('149.154.175.53');

      const dc5 = manager.getDC(5);
      expect(dc5).toBeDefined();
      expect(dc5!.ip).toBe('91.108.56.130');
    });
  });

  describe('updateConfigs', () => {
    it('should add new DC configs', () => {
      const manager = new DCManager();

      manager.updateConfigs([
        { id: 100, ip: '10.0.0.1', port: 8443, test: false },
      ]);

      const config = manager.getDC(100);
      expect(config).toBeDefined();
      expect(config!.ip).toBe('10.0.0.1');
      expect(config!.port).toBe(8443);
    });

    it('should update existing DC configs', () => {
      const manager = new DCManager();

      // DC 1 originally has IP 149.154.175.53
      expect(manager.getDC(1)!.ip).toBe('149.154.175.53');

      manager.updateConfigs([
        { id: 1, ip: '10.0.0.99', port: 8080, test: false },
      ]);

      expect(manager.getDC(1)!.ip).toBe('10.0.0.99');
      expect(manager.getDC(1)!.port).toBe(8080);
    });

    it('should not affect other DCs when updating', () => {
      const manager = new DCManager();

      manager.updateConfigs([
        { id: 1, ip: '10.0.0.1', port: 8080, test: false },
      ]);

      // DC 2 should still be the original
      expect(manager.getDC(2)!.ip).toBe('149.154.167.51');
    });
  });

  describe('parseMigrateError', () => {
    it('should parse PHONE_MIGRATE_X', () => {
      expect(DCManager.parseMigrateError('PHONE_MIGRATE_2')).toBe(2);
      expect(DCManager.parseMigrateError('PHONE_MIGRATE_4')).toBe(4);
    });

    it('should parse FILE_MIGRATE_X', () => {
      expect(DCManager.parseMigrateError('FILE_MIGRATE_1')).toBe(1);
      expect(DCManager.parseMigrateError('FILE_MIGRATE_3')).toBe(3);
    });

    it('should parse NETWORK_MIGRATE_X', () => {
      expect(DCManager.parseMigrateError('NETWORK_MIGRATE_1')).toBe(1);
      expect(DCManager.parseMigrateError('NETWORK_MIGRATE_5')).toBe(5);
    });

    it('should parse USER_MIGRATE_X', () => {
      expect(DCManager.parseMigrateError('USER_MIGRATE_2')).toBe(2);
      expect(DCManager.parseMigrateError('USER_MIGRATE_3')).toBe(3);
    });

    it('should return null for non-migration errors', () => {
      expect(DCManager.parseMigrateError('PHONE_NUMBER_INVALID')).toBeNull();
      expect(DCManager.parseMigrateError('FLOOD_WAIT_300')).toBeNull();
      expect(DCManager.parseMigrateError('AUTH_KEY_UNREGISTERED')).toBeNull();
      expect(DCManager.parseMigrateError('')).toBeNull();
    });

    it('should return null for partial matches', () => {
      expect(DCManager.parseMigrateError('PHONE_MIGRATE_')).toBeNull();
      expect(DCManager.parseMigrateError('PHONE_MIGRATE_X')).toBeNull();
      expect(DCManager.parseMigrateError('MIGRATE_2')).toBeNull();
    });

    it('should handle multi-digit DC IDs', () => {
      expect(DCManager.parseMigrateError('PHONE_MIGRATE_10')).toBe(10);
      expect(DCManager.parseMigrateError('FILE_MIGRATE_123')).toBe(123);
    });
  });

  describe('DC config constants', () => {
    it('should have port 443 for all production DCs', () => {
      for (const dc of PRODUCTION_DCS) {
        expect(dc.port).toBe(443);
      }
    });

    it('should have port 443 for all test DCs', () => {
      for (const dc of TEST_DCS) {
        expect(dc.port).toBe(443);
      }
    });

    it('should have test=false for all production DCs', () => {
      for (const dc of PRODUCTION_DCS) {
        expect(dc.test).toBe(false);
      }
    });

    it('should have test=true for all test DCs', () => {
      for (const dc of TEST_DCS) {
        expect(dc.test).toBe(true);
      }
    });

    it('should have IDs 1-5 for production DCs', () => {
      const ids = PRODUCTION_DCS.map(dc => dc.id);
      expect(ids).toEqual([1, 2, 3, 4, 5]);
    });

    it('should have IDs 10001-10003 for test DCs', () => {
      const ids = TEST_DCS.map(dc => dc.id);
      expect(ids).toEqual([10001, 10002, 10003]);
    });
  });
});
