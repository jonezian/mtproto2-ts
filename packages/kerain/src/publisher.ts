/**
 * Interface for a Redis client.
 * Abstracts the actual Redis library so the package stays dependency-free.
 */
export interface RedisClient {
  /** Connect to the Redis server. */
  connect(): Promise<void>;

  /** Disconnect from the Redis server. */
  disconnect(): Promise<void>;

  /**
   * XADD command: append an entry to a stream.
   *
   * @param stream - The stream key
   * @param id - The entry ID (use '*' for auto-generated)
   * @param fields - Key-value pairs to add
   * @returns The entry ID
   */
  xAdd(stream: string, id: string, fields: Record<string, string>): Promise<string>;
}

/**
 * Options for constructing a RedisPublisher.
 */
export interface RedisPublisherOptions {
  redisUrl?: string;
  client?: RedisClient;
}

/**
 * A Telegram message payload for publishing.
 */
export interface TelegramMessagePayload {
  messageId: number;
  chatId: string;
  text?: string;
  date: number;
  fromId?: string;
  fromUsername?: string;
  replyToMsgId?: number;
  mediaType?: string;
  raw?: Record<string, unknown>;
}

/**
 * A message deletion payload.
 */
export interface DeletionPayload {
  messageIds: number[];
  chatId: string;
}

/**
 * A Nostra event payload.
 */
export interface NostraEventPayload {
  eventId: string;
  pubkey: string;
  kind: number;
  content: string;
  tags?: string[][];
  createdAt: number;
}

/**
 * Redis stream publisher.
 *
 * Publishes Telegram events to Redis streams for consumption
 * by the backend application.
 */
export class RedisPublisher {
  private client: RedisClient | null;
  private readonly redisUrl: string;
  private connected = false;

  constructor(options?: RedisPublisherOptions) {
    this.redisUrl = options?.redisUrl ?? 'redis://localhost:6379';
    this.client = options?.client ?? null;
  }

  /**
   * Connect to Redis.
   *
   * If a RedisClient was provided in the constructor, uses that.
   * Otherwise throws — the consumer must inject a client.
   */
  async connect(): Promise<void> {
    if (!this.client) {
      throw new Error(
        'No Redis client provided. Inject a RedisClient via the constructor options.',
      );
    }
    await this.client.connect();
    this.connected = true;
  }

  /**
   * Disconnect from Redis.
   */
  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }

  /**
   * Whether the publisher is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * The Redis URL configured for this publisher.
   */
  getRedisUrl(): string {
    return this.redisUrl;
  }

  /**
   * Publish a message to a Redis stream using XADD.
   *
   * @param streamName - The Redis stream key
   * @param data - Key-value pairs to publish
   * @returns The entry ID returned by Redis
   */
  async publishMessage(streamName: string, data: Record<string, string>): Promise<string> {
    if (!this.client || !this.connected) {
      throw new Error('Redis publisher is not connected');
    }
    return this.client.xAdd(streamName, '*', data);
  }

  /**
   * Publish a Telegram message to the 'telegram-messages' stream.
   *
   * Complex fields are JSON-serialized.
   */
  async publishTelegramMessage(msg: TelegramMessagePayload): Promise<string> {
    const data: Record<string, string> = {
      messageId: String(msg.messageId),
      chatId: msg.chatId,
      date: String(msg.date),
    };

    if (msg.text !== undefined) data.text = msg.text;
    if (msg.fromId !== undefined) data.fromId = msg.fromId;
    if (msg.fromUsername !== undefined) data.fromUsername = msg.fromUsername;
    if (msg.replyToMsgId !== undefined) data.replyToMsgId = String(msg.replyToMsgId);
    if (msg.mediaType !== undefined) data.mediaType = msg.mediaType;
    if (msg.raw !== undefined) data.raw = JSON.stringify(msg.raw);

    return this.publishMessage('telegram-messages', data);
  }

  /**
   * Publish a deletion event to the 'telegram-deletions' stream.
   */
  async publishDeletion(msg: DeletionPayload): Promise<string> {
    const data: Record<string, string> = {
      messageIds: JSON.stringify(msg.messageIds),
      chatId: msg.chatId,
    };

    return this.publishMessage('telegram-deletions', data);
  }

  /**
   * Publish a Nostra event to the 'nostra-events' stream.
   */
  async publishNostraEvent(event: NostraEventPayload): Promise<string> {
    const data: Record<string, string> = {
      eventId: event.eventId,
      pubkey: event.pubkey,
      kind: String(event.kind),
      content: event.content,
      createdAt: String(event.createdAt),
    };

    if (event.tags !== undefined) data.tags = JSON.stringify(event.tags);

    return this.publishMessage('nostra-events', data);
  }
}
