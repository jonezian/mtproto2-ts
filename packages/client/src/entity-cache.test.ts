import { describe, it, expect } from 'vitest';
import { TLReader } from '@mtproto2/binary';
import { EntityCache } from './entity-cache.js';

// InputPeer constructor IDs
const CID = {
  inputPeerUser: 0xdde8a54c,
  inputPeerChat: 0x35a95cb9,
  inputPeerChannel: 0x27bcbbfc,
} as const;

describe('EntityCache', () => {
  describe('set / get / has', () => {
    it('should store and retrieve a user entity', () => {
      const cache = new EntityCache();
      cache.set(12345n, 67890n, 'user');

      expect(cache.has(12345n)).toBe(true);
      const entity = cache.get(12345n);
      expect(entity).toBeDefined();
      expect(entity!.id).toBe(12345n);
      expect(entity!.accessHash).toBe(67890n);
      expect(entity!.type).toBe('user');
    });

    it('should store and retrieve a chat entity', () => {
      const cache = new EntityCache();
      cache.set(111n, 0n, 'chat');

      const entity = cache.get(111n);
      expect(entity).toBeDefined();
      expect(entity!.type).toBe('chat');
    });

    it('should store and retrieve a channel entity', () => {
      const cache = new EntityCache();
      cache.set(999n, 888n, 'channel');

      const entity = cache.get(999n);
      expect(entity).toBeDefined();
      expect(entity!.type).toBe('channel');
      expect(entity!.accessHash).toBe(888n);
    });

    it('should return undefined for missing entities', () => {
      const cache = new EntityCache();
      expect(cache.get(999n)).toBeUndefined();
      expect(cache.has(999n)).toBe(false);
    });

    it('should overwrite existing entities', () => {
      const cache = new EntityCache();
      cache.set(1n, 100n, 'user');
      cache.set(1n, 200n, 'channel');

      const entity = cache.get(1n);
      expect(entity!.accessHash).toBe(200n);
      expect(entity!.type).toBe('channel');
    });

    it('should track the correct size', () => {
      const cache = new EntityCache();
      expect(cache.size).toBe(0);
      cache.set(1n, 0n, 'user');
      cache.set(2n, 0n, 'chat');
      cache.set(3n, 0n, 'channel');
      expect(cache.size).toBe(3);
    });
  });

  describe('clear', () => {
    it('should remove all entities', () => {
      const cache = new EntityCache();
      cache.set(1n, 0n, 'user');
      cache.set(2n, 0n, 'chat');
      cache.set(3n, 0n, 'channel');

      cache.clear();
      expect(cache.size).toBe(0);
      expect(cache.has(1n)).toBe(false);
      expect(cache.has(2n)).toBe(false);
      expect(cache.has(3n)).toBe(false);
    });

    it('should handle clearing an already empty cache', () => {
      const cache = new EntityCache();
      cache.clear(); // should not throw
      expect(cache.size).toBe(0);
    });
  });

  describe('getInputPeer', () => {
    it('should serialize inputPeerUser correctly', () => {
      const cache = new EntityCache();
      cache.set(12345n, 67890n, 'user');

      const buf = cache.getInputPeer(12345n);
      const r = new TLReader(buf);

      expect(r.readConstructorId()).toBe(CID.inputPeerUser);
      expect(r.readInt64()).toBe(12345n);
      expect(r.readInt64()).toBe(67890n);
      expect(r.remaining).toBe(0);
    });

    it('should serialize inputPeerChat correctly', () => {
      const cache = new EntityCache();
      cache.set(111n, 0n, 'chat');

      const buf = cache.getInputPeer(111n);
      const r = new TLReader(buf);

      expect(r.readConstructorId()).toBe(CID.inputPeerChat);
      expect(r.readInt64()).toBe(111n);
      expect(r.remaining).toBe(0);
    });

    it('should serialize inputPeerChannel correctly', () => {
      const cache = new EntityCache();
      cache.set(999n, 888n, 'channel');

      const buf = cache.getInputPeer(999n);
      const r = new TLReader(buf);

      expect(r.readConstructorId()).toBe(CID.inputPeerChannel);
      expect(r.readInt64()).toBe(999n);
      expect(r.readInt64()).toBe(888n);
      expect(r.remaining).toBe(0);
    });

    it('should throw for entities not in the cache', () => {
      const cache = new EntityCache();
      expect(() => cache.getInputPeer(42n)).toThrow('Entity 42 not found');
    });

    it('should serialize different user IDs correctly', () => {
      const cache = new EntityCache();
      cache.set(1n, 100n, 'user');
      cache.set(2n, 200n, 'user');

      const buf1 = cache.getInputPeer(1n);
      const buf2 = cache.getInputPeer(2n);

      const r1 = new TLReader(buf1);
      r1.readConstructorId();
      expect(r1.readInt64()).toBe(1n);
      expect(r1.readInt64()).toBe(100n);

      const r2 = new TLReader(buf2);
      r2.readConstructorId();
      expect(r2.readInt64()).toBe(2n);
      expect(r2.readInt64()).toBe(200n);
    });

    it('should handle negative ID values (signed bigint)', () => {
      const cache = new EntityCache();
      cache.set(-1001234567890n, 777n, 'channel');

      const buf = cache.getInputPeer(-1001234567890n);
      const r = new TLReader(buf);
      expect(r.readConstructorId()).toBe(CID.inputPeerChannel);
      expect(r.readInt64()).toBe(-1001234567890n);
      expect(r.readInt64()).toBe(777n);
    });
  });
});
