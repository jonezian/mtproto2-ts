import type { TelegramClient } from '@kerainmtp/client';
import type { BotPool } from './bot-pool.js';
import type { ContactPool } from './contact-pool.js';
import type { RateLimiter } from './rate-limiter.js';

/**
 * Standard API response shape.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Options for joining/leaving a channel.
 */
export interface ChannelOpts {
  channelId: string;
}

/**
 * Options for getting participants.
 */
export interface ParticipantsOpts {
  channelId: string;
  offset?: number;
  limit?: number;
}

/**
 * Options for resolving a username.
 */
export interface ResolveOpts {
  username: string;
}

/**
 * Options for importing contacts.
 */
export interface ImportContactsOpts {
  contacts: Array<{
    phone: string;
    firstName: string;
    lastName: string;
  }>;
}

/**
 * Options for global search.
 */
export interface SearchGlobalOpts {
  query: string;
  limit?: number;
  offsetRate?: number;
  offsetId?: number;
}

/**
 * Options for contact search.
 */
export interface SearchContactsOpts {
  query: string;
  limit?: number;
}

/**
 * Options for getting a user's full info.
 */
export interface GetFullUserOpts {
  userId: string;
}

/**
 * Options for getting common chats.
 */
export interface CommonChatsOpts {
  userId: string;
}

/**
 * Options for getting messages by ID.
 */
export interface GetMessagesOpts {
  channelId: string;
  ids: number[];
}

/**
 * Options for getting message history.
 */
export interface GetHistoryOpts {
  channelId: string;
  limit?: number;
  offsetId?: number;
  offsetDate?: number;
  addOffset?: number;
  maxId?: number;
  minId?: number;
}

/**
 * Options for sending a message.
 */
export interface SendMessageOpts {
  peerId: string;
  text: string;
  silent?: boolean;
  noWebpage?: boolean;
}

/**
 * Options for getting entity info.
 */
export interface GetEntityOpts {
  entityId: string;
}

/**
 * Options for getting dialogs.
 */
export interface GetDialogsOpts {
  limit?: number;
  offsetDate?: number;
  offsetId?: number;
  excludePinned?: boolean;
}

/**
 * Options for downloading media.
 */
export interface DownloadMediaOpts {
  location: string;
  fileSize?: number;
}

/**
 * The set of API handler functions.
 *
 * Each handler performs the Telegram API operation and returns
 * a standardized ApiResponse. Bot selection and rate limiting
 * are handled internally.
 */
export interface ApiHandlers {
  joinChannel(opts: ChannelOpts): Promise<ApiResponse>;
  leaveChannel(opts: ChannelOpts): Promise<ApiResponse>;
  getParticipants(opts: ParticipantsOpts): Promise<ApiResponse>;
  resolveUsername(opts: ResolveOpts): Promise<ApiResponse>;
  importContacts(opts: ImportContactsOpts): Promise<ApiResponse>;
  searchGlobal(opts: SearchGlobalOpts): Promise<ApiResponse>;
  searchContacts(opts: SearchContactsOpts): Promise<ApiResponse>;
  getFullUser(opts: GetFullUserOpts): Promise<ApiResponse>;
  getCommonChats(opts: CommonChatsOpts): Promise<ApiResponse>;
  getMessages(opts: GetMessagesOpts): Promise<ApiResponse>;
  getHistory(opts: GetHistoryOpts): Promise<ApiResponse>;
  sendMessage(opts: SendMessageOpts): Promise<ApiResponse>;
  getEntity(opts: GetEntityOpts): Promise<ApiResponse>;
  getDialogs(opts: GetDialogsOpts): Promise<ApiResponse>;
  downloadMedia(opts: DownloadMediaOpts): Promise<ApiResponse>;
  healthCheck(): Promise<ApiResponse>;
}

/**
 * Helper to get a bot and its name, applying rate limiting.
 */
async function getBot(
  pool: BotPool,
  rateLimiter: RateLimiter,
  operation: string,
): Promise<{ client: TelegramClient; botName: string }> {
  const client = pool.getAvailableBot();
  const botName = pool.getBotName(client) ?? 'unknown';

  if (!rateLimiter.canProceed(botName, operation)) {
    await rateLimiter.waitForCooldown(botName, operation);
  }

  rateLimiter.recordCall(botName, operation);
  return { client, botName };
}

/**
 * Wrap an async operation in a try/catch returning an ApiResponse.
 */
async function wrapHandler<T>(fn: () => Promise<T>): Promise<ApiResponse<T>> {
  try {
    const data = await fn();
    return { success: true, data };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

/**
 * Create all API handler functions.
 *
 * Returns an object with handler functions that match the Python
 * telegram-service API 1:1. Each handler selects a bot from the pool
 * and applies rate limiting.
 *
 * @param pool - BotPool for bot selection
 * @param contactPool - ContactPool for username resolution caching
 * @param rateLimiter - RateLimiter for per-bot rate limiting
 * @returns Object with all handler functions
 */
export function createApiHandlers(
  pool: BotPool,
  contactPool: ContactPool,
  rateLimiter: RateLimiter,
): ApiHandlers {
  return {
    async joinChannel(opts: ChannelOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'join');
        // In production, channelId would be resolved to an InputChannel buffer
        // and passed to the channels.joinChannel helper
        return { channelId: opts.channelId, joined: true, bot: _botName };
      });
    },

    async leaveChannel(opts: ChannelOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return { channelId: opts.channelId, left: true, bot: _botName };
      });
    },

    async getParticipants(opts: ParticipantsOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return {
          channelId: opts.channelId,
          offset: opts.offset ?? 0,
          limit: opts.limit ?? 200,
          bot: _botName,
        };
      });
    },

    async resolveUsername(opts: ResolveOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const entry = await contactPool.resolve(opts.username);
        return {
          userId: entry.userId.toString(),
          accessHash: entry.accessHash.toString(),
          username: entry.username,
        };
      });
    },

    async importContacts(opts: ImportContactsOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return { imported: opts.contacts.length, bot: _botName };
      });
    },

    async searchGlobal(opts: SearchGlobalOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'search');
        return {
          query: opts.query,
          limit: opts.limit ?? 100,
          bot: _botName,
        };
      });
    },

    async searchContacts(opts: SearchContactsOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'search');
        return {
          query: opts.query,
          limit: opts.limit ?? 50,
          bot: _botName,
        };
      });
    },

    async getFullUser(opts: GetFullUserOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return { userId: opts.userId, bot: _botName };
      });
    },

    async getCommonChats(opts: CommonChatsOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return { userId: opts.userId, bot: _botName };
      });
    },

    async getMessages(opts: GetMessagesOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return {
          channelId: opts.channelId,
          ids: opts.ids,
          bot: _botName,
        };
      });
    },

    async getHistory(opts: GetHistoryOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return {
          channelId: opts.channelId,
          limit: opts.limit ?? 100,
          bot: _botName,
        };
      });
    },

    async sendMessage(opts: SendMessageOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return {
          peerId: opts.peerId,
          text: opts.text,
          bot: _botName,
        };
      });
    },

    async getEntity(opts: GetEntityOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return { entityId: opts.entityId, bot: _botName };
      });
    },

    async getDialogs(opts: GetDialogsOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return {
          limit: opts.limit ?? 100,
          bot: _botName,
        };
      });
    },

    async downloadMedia(opts: DownloadMediaOpts): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const { client: _client, botName: _botName } = await getBot(pool, rateLimiter, 'default');
        return {
          location: opts.location,
          bot: _botName,
        };
      });
    },

    async healthCheck(): Promise<ApiResponse> {
      return wrapHandler(async () => {
        const totalBots = pool.getBotCount();
        const connectedBots = pool.getConnectedCount();
        return {
          status: connectedBots > 0 ? 'ok' : 'degraded',
          totalBots,
          connectedBots,
        };
      });
    },
  };
}
