# @mtproto2/client

High-level Telegram client API built on top of `@mtproto2/mtproto`.

Provides `TelegramClient` with authentication, messaging, channel management, contacts, file transfer, session storage, entity caching, and typed events.

## Installation

```bash
npm install @mtproto2/client
```

## Quick Start

```ts
import { TelegramClient, MemorySession } from '@mtproto2/client';

const client = new TelegramClient({
  apiId: 12345,
  apiHash: 'your_api_hash',
  session: new MemorySession(),
});

await client.connect();
const me = await client.getMe();
await client.disconnect();
```

## API

### TelegramClient

The main entry point. Wraps `MTProtoConnection` with session management, entity caching, file management, and typed events.

```ts
import { TelegramClient } from '@mtproto2/client';
import type { TelegramClientOptions, TelegramClientEvents } from '@mtproto2/client';

const client = new TelegramClient({
  apiId: 12345,                // Your Telegram API ID
  apiHash: 'abcdef...',       // Your Telegram API hash
  session: new MemorySession(), // Session storage backend
  dcId: 2,                    // Data center ID (default: 2)
  testMode: false,            // Use test servers (default: false)
  autoReconnect: true,        // Auto-reconnect on disconnect (default: true)
});

await client.connect();
await client.invoke(serializedMethod); // Send raw TL method
const me = await client.getMe();       // Get current user
client.isConnected();                   // Connection status check
await client.disconnect();
```

**Events:**

```ts
client.on('connected', () => { /* ... */ });
client.on('disconnected', () => { /* ... */ });
client.on('error', (err: Error) => { /* ... */ });
client.on('update', (data: Buffer) => { /* TL-serialized update */ });
```

### Authentication

```ts
import { sendCode, signIn, signUp, logOut, checkPassword } from '@mtproto2/client';

// Step 1: Send verification code
const sentCode = await sendCode(client, '+1234567890');

// Step 2: Sign in with the received code
const auth = await signIn(client, '+1234567890', phoneCodeHash, '12345');

// Step 2 (alt): Sign up if the phone is unregistered
const auth = await signUp(client, '+1234567890', phoneCodeHash, 'First', 'Last');

// 2FA: Check password (when signIn returns SESSION_PASSWORD_NEEDED)
const auth = await checkPassword(client, srpData);

// Log out
await logOut(client);
```

### Messages

```ts
import {
  sendMessage,
  getMessages,
  getHistory,
  deleteMessages,
  editMessage,
  searchMessages,
} from '@mtproto2/client';

// Send a text message
await sendMessage(client, inputPeer, 'Hello!', { silent: false, noWebpage: true });

// Get messages by ID
const msgs = await getMessages(client, [msgId1, msgId2]);

// Get chat history
const history = await getHistory(client, inputPeer, { limit: 50, offsetId: 0 });

// Delete messages
await deleteMessages(client, [msgId1, msgId2], { revoke: true });

// Edit a message
await editMessage(client, inputPeer, msgId, 'Updated text');

// Search messages
const results = await searchMessages(client, inputPeer, 'query', { limit: 20 });
```

### Channels

```ts
import {
  joinChannel,
  leaveChannel,
  getParticipants,
  getFullChannel,
  createChannelHelper,
  editAdminHelper,
} from '@mtproto2/client';

await joinChannel(client, channelPeer);
await leaveChannel(client, channelPeer);
const participants = await getParticipants(client, channelPeer, { limit: 100 });
const fullInfo = await getFullChannel(client, channelPeer);
```

### Contacts

```ts
import {
  importContacts,
  resolveUsername,
  searchContacts,
  getContacts,
} from '@mtproto2/client';
import type { PhoneContact } from '@mtproto2/client';

// Resolve a username to an entity
const resolved = await resolveUsername(client, 'username');

// Search contacts
const results = await searchContacts(client, 'query', 20);

// Import phone contacts
await importContacts(client, [{ phone: '+1234567890', firstName: 'John', lastName: 'Doe' }]);

// Get all contacts
const contacts = await getContacts(client);
```

### Users

```ts
import { getUsers, getFullUser } from '@mtproto2/client';

const users = await getUsers(client, userIds);
const fullUser = await getFullUser(client, userId);
```

### Dialogs

```ts
import { getDialogs, getPeerDialogs } from '@mtproto2/client';

const dialogs = await getDialogs(client, { limit: 100 });
const peerDialogs = await getPeerDialogs(client, [peer1, peer2]);
```

### Search

```ts
import { searchGlobal } from '@mtproto2/client';

const results = await searchGlobal(client, 'query', { limit: 50 });
```

### Admin

```ts
import { adminCreateChannel, deleteChannel, adminEditAdmin } from '@mtproto2/client';

const channel = await adminCreateChannel(client, 'Channel Title', 'Description');
await adminEditAdmin(client, channelPeer, userId, adminRights);
await deleteChannel(client, channelPeer);
```

### Session Storage

Two session storage backends are included:

#### MemorySession

In-memory storage. Session data is lost when the process exits. Useful for testing and short-lived scripts.

```ts
import { MemorySession } from '@mtproto2/client';

const session = new MemorySession();
```

#### StringSession

Base64-encoded session string for portable persistence. Compatible with common session string formats.

```ts
import { StringSession } from '@mtproto2/client';

// Create a new session
const session = new StringSession();

// Or load from an existing session string
const session = new StringSession('AQ...');

// After connecting, retrieve the session string for storage
const str = session.getSessionString();
```

**Security warning:** The session string contains the raw 256-byte auth key in plaintext (base64-encoded). Anyone with this string can impersonate the authenticated user. Treat session strings with the same care as passwords -- never log them, commit them to version control, or expose them in client-side code.

#### Custom Storage

Implement the `SessionStorage` interface for custom backends (database, file, encrypted storage):

```ts
import type { SessionStorage, SessionData } from '@mtproto2/client';

class MySessionStorage implements SessionStorage {
  async load(): Promise<SessionData | null> { /* ... */ }
  async save(data: SessionData): Promise<void> { /* ... */ }
  async delete(): Promise<void> { /* ... */ }
}
```

### Entity Cache

Caches user, chat, and channel entities for InputPeer resolution.

```ts
import { EntityCache } from '@mtproto2/client';
import type { EntityType, CachedEntity } from '@mtproto2/client';

const cache = new EntityCache();

// Store an entity
cache.set(userId, accessHash, 'user');
cache.set(channelId, accessHash, 'channel');

// Retrieve a cached entity
const entity = cache.get(userId);

// Serialize as InputPeer (for use in API calls)
const inputPeer: Buffer = cache.getInputPeer(userId);
// Returns TL-serialized inputPeerUser, inputPeerChat, or inputPeerChannel

cache.has(userId);  // Check existence
cache.size;         // Number of cached entities
cache.clear();      // Remove all
```

### File Transfer

The `FileManager` handles file uploads and downloads with progress tracking.

```ts
import { FileManager } from '@mtproto2/client';
import type { UploadProgress, DownloadProgress, FileManagerOptions } from '@mtproto2/client';

// FileManager is available as client.fileManager
client.fileManager.on('upload-progress', (progress: UploadProgress) => {
  console.log(`Upload: ${progress.uploaded}/${progress.total} (${progress.speed} B/s)`);
});

client.fileManager.on('download-progress', (progress: DownloadProgress) => {
  console.log(`Download: ${progress.offset}/${progress.total}`);
});
```

Low-level file helpers are also available:

```ts
import {
  serializeSaveFilePart,
  serializeSaveBigFilePart,
  serializeGetFile,
  parseGetFileResponse,
  splitFile,
  computePartSize,
  generateFileId,
} from '@mtproto2/client';
```

Files larger than 10 MB automatically use `saveBigFilePart` instead of `saveFilePart`.

### TypedEventEmitter

A type-safe wrapper around Node.js `EventEmitter`:

```ts
import { TypedEventEmitter } from '@mtproto2/client';

interface MyEvents {
  'data': (payload: Buffer) => void;
  'error': (err: Error) => void;
  'close': () => void;
}

class MyClass extends TypedEventEmitter<MyEvents> {
  // on(), off(), once(), emit() are all type-checked
}
```

## License

[MIT](../../LICENSE)
