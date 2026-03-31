// Bot pool
export { BotPool } from './bot-pool.js';
export type { SessionConfig, BotPoolOptions, ClientFactory } from './bot-pool.js';

// Contact pool
export { ContactPool } from './contact-pool.js';
export type { ContactEntry, ContactPoolOptions, ResolveFn } from './contact-pool.js';

// Rate limiter
export { RateLimiter } from './rate-limiter.js';
export type { RateLimiterOptions } from './rate-limiter.js';

// Redis publisher
export { RedisPublisher } from './publisher.js';
export type {
  RedisClient,
  RedisPublisherOptions,
  TelegramMessagePayload,
  DeletionPayload,
  NostraEventPayload,
} from './publisher.js';

// Event handlers
export {
  handleNewMessage,
  handleMessageDeleted,
  handleMessageEdited,
  handleChatAction,
  setupEventHandlers,
} from './event-handlers.js';
export type {
  RawNewMessageUpdate,
  RawDeletionUpdate,
  RawEditUpdate,
  RawChatActionUpdate,
  EventHandlerSet,
} from './event-handlers.js';

// HTTP API
export { createApiHandlers } from './http-api.js';
export type {
  ApiResponse,
  ApiHandlers,
  ChannelOpts,
  ParticipantsOpts,
  ResolveOpts,
  ImportContactsOpts,
  SearchGlobalOpts,
  SearchContactsOpts,
  GetFullUserOpts,
  CommonChatsOpts,
  GetMessagesOpts,
  GetHistoryOpts,
  SendMessageOpts,
  GetEntityOpts,
  GetDialogsOpts,
  DownloadMediaOpts,
} from './http-api.js';
