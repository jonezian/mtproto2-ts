// Files
export {
  serializeSaveFilePart,
  serializeSaveBigFilePart,
  serializeGetFile,
  parseGetFileResponse,
  splitFile,
  computePartSize,
  serializeInputFileLocation,
  generateFileId,
  FILE_CID,
} from './files.js';

export type {
  FilePartOptions,
  BigFilePartOptions,
  GetFileOptions,
  UploadResult,
  GetFileResult,
  CdnRedirectResult,
} from './files.js';

export { FileManager } from './file-manager.js';

export type {
  UploadProgress,
  DownloadProgress,
  FileManagerOptions,
} from './file-manager.js';

// Event emitter
export { TypedEventEmitter } from './event-emitter.js';

// Session storage
export type { SessionStorage, SessionData } from './session/index.js';
export { MemorySession } from './session/index.js';
export { StringSession } from './session/index.js';

// Entity cache
export { EntityCache } from './entity-cache.js';
export type { EntityType, CachedEntity } from './entity-cache.js';

// Client
export { TelegramClient } from './client.js';
export type { TelegramClientEvents, TelegramClientOptions } from './client.js';

// Auth helpers
export {
  sendCode,
  signIn,
  signUp,
  logOut,
  checkPassword,
  AUTH_CID,
} from './auth.js';

// Message helpers
export {
  sendMessage,
  getMessages,
  getHistory,
  deleteMessages,
  editMessage,
  searchMessages,
  MESSAGES_CID,
} from './messages.js';

// Channel helpers
export {
  joinChannel,
  leaveChannel,
  getParticipants,
  getFullChannel,
  createChannel as createChannelHelper,
  editAdmin as editAdminHelper,
  CHANNELS_CID,
} from './channels.js';

// Contacts helpers
export {
  importContacts,
  resolveUsername,
  search as searchContacts,
  getContacts,
  CONTACTS_CID,
} from './contacts.js';
export type { PhoneContact } from './contacts.js';

// Users helpers
export {
  getUsers,
  getFullUser,
  USERS_CID,
} from './users.js';

// Dialogs helpers
export {
  getDialogs,
  getPeerDialogs,
  DIALOGS_CID,
} from './dialogs.js';

// Search helpers
export {
  searchGlobal,
  SEARCH_CID,
} from './search.js';

// Admin helpers
export {
  createChannel as adminCreateChannel,
  deleteChannel,
  editAdmin as adminEditAdmin,
  ADMIN_CID,
} from './admin.js';
