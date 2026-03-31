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

// MongoDB session storage
export { MongoSession } from './session/mongodb.js';
export type {
  MongoClient,
  MongoDb,
  MongoCollection,
  MongoSessionOptions,
} from './session/mongodb.js';

// Migration utilities
export { MigrationManager } from './migration.js';
export type {
  PortableSession,
  HealthCheckResult,
  SessionDiff,
  ShadowCompareResult,
  ValidationResult,
} from './migration.js';

// Shadow runner
export { ShadowRunner } from './shadow-runner.js';
export type {
  ShadowStats,
  ShadowRunnerOptions,
} from './shadow-runner.js';
