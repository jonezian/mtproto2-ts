import { TLWriter } from '@kerainmtp/binary';

/**
 * Entity types that can be cached.
 */
export type EntityType = 'user' | 'chat' | 'channel';

/**
 * Cached entity data.
 */
export interface CachedEntity {
  id: bigint;
  accessHash: bigint;
  type: EntityType;
}

// InputPeer constructor IDs
const CID = {
  inputPeerUser: 0xdde8a54c,
  inputPeerChat: 0x35a95cb9,
  inputPeerChannel: 0x27bcbbfc,
} as const;

/**
 * Cache for Telegram entities (users, chats, channels).
 *
 * Maps entity ID to its access hash and type, enabling the construction
 * of InputPeer TL objects needed for API calls.
 */
export class EntityCache {
  private cache = new Map<bigint, CachedEntity>();

  /**
   * Store an entity in the cache.
   */
  set(id: bigint, accessHash: bigint, type: EntityType): void {
    this.cache.set(id, { id, accessHash, type });
  }

  /**
   * Retrieve a cached entity by ID.
   */
  get(id: bigint): CachedEntity | undefined {
    return this.cache.get(id);
  }

  /**
   * Check if an entity is in the cache.
   */
  has(id: bigint): boolean {
    return this.cache.has(id);
  }

  /**
   * Serialize the cached entity as an InputPeer TL object.
   *
   * Returns the raw TL bytes for inputPeerUser, inputPeerChat,
   * or inputPeerChannel depending on the entity type.
   *
   * @throws Error if the entity ID is not in the cache.
   */
  getInputPeer(id: bigint): Buffer {
    const entity = this.cache.get(id);
    if (!entity) {
      throw new Error(`Entity ${id} not found in cache`);
    }

    const w = new TLWriter(32);

    switch (entity.type) {
      case 'user': {
        // inputPeerUser#dde8a54c user_id:long access_hash:long = InputPeer;
        w.writeConstructorId(CID.inputPeerUser);
        w.writeInt64(entity.id);
        w.writeInt64(entity.accessHash);
        break;
      }
      case 'chat': {
        // inputPeerChat#35a95cb9 chat_id:long = InputPeer;
        w.writeConstructorId(CID.inputPeerChat);
        w.writeInt64(entity.id);
        break;
      }
      case 'channel': {
        // inputPeerChannel#27bcbbfc channel_id:long access_hash:long = InputPeer;
        w.writeConstructorId(CID.inputPeerChannel);
        w.writeInt64(entity.id);
        w.writeInt64(entity.accessHash);
        break;
      }
    }

    return w.toBuffer();
  }

  /**
   * Remove all cached entities.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the number of cached entities.
   */
  get size(): number {
    return this.cache.size;
  }
}
