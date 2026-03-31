import type { TelegramClient } from '@mtproto2/client';
import type { RedisPublisher, TelegramMessagePayload, DeletionPayload } from './publisher.js';

/**
 * Raw update data as received from Telegram.
 * The actual structure is a TL-deserialized object; we define
 * a minimal interface for the fields we use.
 */
export interface RawNewMessageUpdate {
  messageId: number;
  chatId: string;
  text?: string;
  date: number;
  fromId?: string;
  fromUsername?: string;
  replyToMsgId?: number;
  mediaType?: string;
}

/**
 * Raw deletion update.
 */
export interface RawDeletionUpdate {
  messageIds: number[];
  chatId: string;
}

/**
 * Raw edit update -- same shape as new message with edited content.
 */
export interface RawEditUpdate {
  messageId: number;
  chatId: string;
  text?: string;
  date: number;
  fromId?: string;
  fromUsername?: string;
  editDate?: number;
}

/**
 * Raw chat action update (join, leave, etc.).
 */
export interface RawChatActionUpdate {
  chatId: string;
  userId?: string;
  action: string;
  date: number;
}

/**
 * Process a new message update and publish to Redis.
 */
export async function handleNewMessage(
  update: RawNewMessageUpdate,
  publisher: RedisPublisher,
  botName: string,
): Promise<void> {
  const payload: TelegramMessagePayload = {
    messageId: update.messageId,
    chatId: update.chatId,
    date: update.date,
    text: update.text,
    fromId: update.fromId,
    fromUsername: update.fromUsername,
    replyToMsgId: update.replyToMsgId,
    mediaType: update.mediaType,
    raw: { botName },
  };

  await publisher.publishTelegramMessage(payload);
}

/**
 * Process a message deletion update and publish to Redis.
 */
export async function handleMessageDeleted(
  update: RawDeletionUpdate,
  publisher: RedisPublisher,
  _botName: string,
): Promise<void> {
  const payload: DeletionPayload = {
    messageIds: update.messageIds,
    chatId: update.chatId,
  };

  await publisher.publishDeletion(payload);
}

/**
 * Process a message edit update and publish to Redis.
 *
 * Edits are published to the same 'telegram-messages' stream
 * with an additional 'editDate' field in the raw metadata.
 */
export async function handleMessageEdited(
  update: RawEditUpdate,
  publisher: RedisPublisher,
  botName: string,
): Promise<void> {
  const payload: TelegramMessagePayload = {
    messageId: update.messageId,
    chatId: update.chatId,
    date: update.date,
    text: update.text,
    fromId: update.fromId,
    fromUsername: update.fromUsername,
    raw: {
      botName,
      editDate: update.editDate,
      isEdit: true,
    },
  };

  await publisher.publishTelegramMessage(payload);
}

/**
 * Process a chat action (user join, leave, etc.) and publish to Redis.
 */
export async function handleChatAction(
  update: RawChatActionUpdate,
  publisher: RedisPublisher,
  botName: string,
): Promise<void> {
  const data: Record<string, string> = {
    chatId: update.chatId,
    action: update.action,
    date: String(update.date),
    botName,
  };

  if (update.userId !== undefined) {
    data.userId = update.userId;
  }

  await publisher.publishMessage('telegram-actions', data);
}

/**
 * Event handler dispatcher.
 *
 * Stores registered handlers and dispatches events to them.
 * This allows external code to wire up update parsing to the publisher.
 */
export interface EventHandlerSet {
  onNewMessage: (update: RawNewMessageUpdate) => Promise<void>;
  onMessageDeleted: (update: RawDeletionUpdate) => Promise<void>;
  onMessageEdited: (update: RawEditUpdate) => Promise<void>;
  onChatAction: (update: RawChatActionUpdate) => Promise<void>;
}

/**
 * Wire up all event handlers to a TelegramClient.
 *
 * The client emits raw 'update' events as Buffers. In practice,
 * the update parsing layer would deserialize these and call the
 * appropriate handler. This function sets up that wiring.
 *
 * @param bot - The TelegramClient instance
 * @param publisher - The RedisPublisher to dispatch events to
 * @param botName - The name of the bot for logging/tracking
 * @returns The set of handler functions for external invocation
 */
export function setupEventHandlers(
  bot: TelegramClient,
  publisher: RedisPublisher,
  botName: string,
): EventHandlerSet {
  const handlers: EventHandlerSet = {
    onNewMessage: (update) => handleNewMessage(update, publisher, botName),
    onMessageDeleted: (update) => handleMessageDeleted(update, publisher, botName),
    onMessageEdited: (update) => handleMessageEdited(update, publisher, botName),
    onChatAction: (update) => handleChatAction(update, publisher, botName),
  };

  // Register a raw update handler on the bot
  // The actual deserialization is left to the caller; this just
  // attaches the bot so the event handlers are callable
  bot.on('update', (_data: Buffer) => {
    // Raw buffer processing would happen here in production.
    // The parsed updates would be dispatched to the handlers above.
    // For now, this is a placeholder wiring point.
  });

  return handlers;
}
