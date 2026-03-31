# @mtproto2/mtproto

Core MTProto 2.0 protocol engine for Telegram.

Handles message encryption/decryption, auth key exchange, session management, RPC dispatch, ACK batching, update state tracking, and reconnection logic.

## Installation

```bash
npm install @mtproto2/mtproto
```

## API Overview

### MTProtoConnection

The primary entry point. Ties together transport, encryption, session management, RPC handling, and reconnection into a single connection abstraction.

```ts
import { MTProtoConnection } from '@mtproto2/mtproto';
import { TELEGRAM_RSA_KEYS } from '@mtproto2/crypto';

const conn = new MTProtoConnection({
  dcId: 2,
  transport: 'intermediate',  // 'abridged' | 'intermediate' | 'padded' | 'full'
  obfuscated: true,            // default: true
  testMode: false,             // default: false
  rsaKeys: TELEGRAM_RSA_KEYS,
});

// Connect and perform auth key exchange
await conn.connect();

// Send an RPC call
const response = await conn.invoke(serializedMethod);

// Listen for server-pushed updates
conn.on('update', (data: Buffer) => {
  // Process TL-serialized update
});

// Disconnect cleanly
await conn.disconnect();
```

**Lifecycle:**

1. Construct with DC and transport options
2. Call `connect()` -- establishes the TCP connection and performs the DH auth key exchange (if no existing session is provided)
3. Use `invoke(method)` to send RPC calls and await responses
4. Listen for `'update'` events for server-initiated messages
5. Call `disconnect()` when done

**Automatic handling:**

- Auth key exchange (9-step DH protocol) when no session exists
- Message encryption (AES-256-IGE) and decryption with msg_key verification
- Sequence number and message ID generation
- ACK batching (up to 16 messages, flushed every 5 seconds)
- Container unpacking
- RPC result/error dispatch with timeout
- Bad message and bad server salt handling
- Reconnection with exponential backoff

### Encryption and Decryption

Low-level message encryption per the MTProto 2.0 specification.

```ts
import { encryptMessage, decryptMessage } from '@mtproto2/mtproto';

const encrypted = encryptMessage({
  authKey,       // 256-byte auth key
  salt,          // Server salt (bigint)
  sessionId,     // Session ID (bigint)
  msgId,         // Message ID (bigint)
  seqNo,         // Sequence number
  data,          // Serialized message data
});

const decrypted = decryptMessage({
  authKey,
  encrypted,     // Full encrypted message (auth_key_id + msg_key + data)
  isClient: false, // false for server->client decryption
});
// Returns: { salt, sessionId, msgId, seqNo, data }
```

**Plaintext layout:** salt (8) + session_id (8) + msg_id (8) + seq_no (4) + data_length (4) + data + padding (12..1024)

**Encrypted layout:** auth_key_id (8) + msg_key (16) + AES-IGE encrypted data

Security checks on decryption:
- msg_key verified with `crypto.timingSafeEqual()`
- Padding length validated (12--1024 bytes)
- Session ID verified against expected value

### Auth Key Exchange

Implements the 9-step MTProto DH key negotiation protocol.

```ts
import { AuthKeyExchange } from '@mtproto2/mtproto';
import type { AuthKeyResult } from '@mtproto2/mtproto';
import { TELEGRAM_RSA_KEYS } from '@mtproto2/crypto';

const exchange = new AuthKeyExchange({
  send: async (data: Buffer) => { /* send and receive response */ },
  rsaKeys: TELEGRAM_RSA_KEYS,
  dcId: 2,
});

const result: AuthKeyResult = await exchange.execute();
// result.authKey     -- 256-byte auth key
// result.authKeyId   -- 8-byte auth key ID
// result.serverSalt  -- Initial server salt
// result.timeOffset  -- Server time - local time (seconds)
```

**Protocol steps:**

1. Client sends `req_pq_multi(nonce)`
2. Server responds with `resPQ(nonce, server_nonce, pq, fingerprints)`
3. Client factors PQ into p and q (Pollard's rho)
4. Client sends `req_DH_params` with RSA_PAD encrypted `p_q_inner_data_dc`
5. Server responds with `server_DH_params_ok` (AES-IGE encrypted DH params)
6. Client decrypts to get g, dh_prime, g_a, server_time
7. Client validates DH parameters (safe prime, g_a range)
8. Client generates b, computes g_b and auth_key = g_a^b mod p
9. Client sends `set_client_DH_params`, server responds with `dh_gen_ok`

Helper functions:

```ts
import { deriveTmpAesKeyIv, computeServerSalt } from '@mtproto2/mtproto';

// Derive temporary AES key/IV for DH inner data encryption
const { key, iv } = deriveTmpAesKeyIv(newNonce, serverNonce);

// Compute initial server salt from nonces
const salt = computeServerSalt(newNonce, serverNonce);
```

### Session Management

```ts
import { Session } from '@mtproto2/mtproto';
import type { SessionState } from '@mtproto2/mtproto';

const session = new Session(authKey, authKeyId, salt, timeOffset);

session.nextMsgId();                 // Generate next message ID
session.nextSeqNo(contentRelated);   // Generate next sequence number
session.updateSalt(newSalt);         // Update server salt
session.updateTimeOffset(offset);    // Sync with server time
session.reset();                     // New session ID, reset counters

// Persistence
const buf = session.serialize();     // 284 bytes
const restored = Session.deserialize(buf);
```

### RPC Handler

Manages pending RPC calls with timeout and result/error dispatch.

```ts
import { RpcHandler, RpcError } from '@mtproto2/mtproto';

const rpc = new RpcHandler();

// Register a call (returns a promise)
const resultPromise = rpc.register(msgId, 'messages.sendMessage', 30000);

// When a response arrives:
rpc.handleResult(reqMsgId, resultData);   // Resolves the promise
rpc.handleError(reqMsgId, 400, 'PEER_ID_INVALID'); // Rejects with RpcError

// Cancel all pending on disconnect
rpc.cancelAll('Connection lost');
```

`RpcError` extends `Error` with `errorCode` and `errorMessage` properties.

### Message Containers and ACKs

```ts
import { packContainer, unpackContainer, isContainer } from '@mtproto2/mtproto';
import type { InnerMessage } from '@mtproto2/mtproto';
import { createMsgsAck, parseMsgsAck } from '@mtproto2/mtproto';

// Pack multiple messages into a container
const container = packContainer(messages);

// Unpack a received container
const msgs: InnerMessage[] = unpackContainer(containerData);

// Create an ACK message
const ack = createMsgsAck([msgId1, msgId2, msgId3]);
```

### Update State Tracking

Tracks pts/qts/seq/date to detect gaps and duplicates in the update stream.

```ts
import { UpdateState } from '@mtproto2/mtproto';
import type { UpdateApplyResult } from '@mtproto2/mtproto';

const state = new UpdateState({ pts: 100, qts: 0, seq: 50, date: 0 });

const result: UpdateApplyResult = state.applyPts(101, 1);
// 'accept'    -- expected next update, state advanced
// 'duplicate' -- already seen
// 'gap'       -- missing updates, need getDifference

state.applyQts(receivedQts);
state.applySeq(receivedSeq);
state.getState();   // { pts, qts, seq, date }

// Persistence
const buf = state.serialize();   // 16 bytes
const restored = UpdateState.deserialize(buf);
```

### Update Handler

Higher-level update processing with gap detection and automatic getDifference triggering.

```ts
import { UpdateHandler } from '@mtproto2/mtproto';

const handler = new UpdateHandler({ pts: 100, seq: 50 });

handler.on('update', (constructorId, data) => { /* accepted update */ });
handler.on('gap-detected', (type) => { /* 'pts' | 'qts' | 'seq' */ });
handler.on('need-difference', () => { /* call updates.getDifference */ });
handler.on('need-channel-difference', (channelId) => { /* ... */ });
```

### DC Management

```ts
import { DCManager, PRODUCTION_DCS, TEST_DCS } from '@mtproto2/mtproto';
import type { DCConfig } from '@mtproto2/mtproto';

const dcm = new DCManager(/* useTestDCs */ false);
const dc = dcm.getDC(2);          // { id: 2, ip: '149.154.167.51', port: 443 }
const def = dcm.getDefaultDC();    // DC 2 (production) or DC 10002 (test)

// Parse migration errors
const targetDc = DCManager.parseMigrateError('PHONE_MIGRATE_2'); // 2
```

### Reconnection

```ts
import { ReconnectStrategy } from '@mtproto2/mtproto';
import type { ReconnectOptions } from '@mtproto2/mtproto';

const strategy = new ReconnectStrategy({
  initialDelay: 1000,    // 1 second
  maxDelay: 30000,       // 30 seconds
  multiplier: 1.5,
  jitter: true,          // Random jitter (0.5x-1.5x)
  maxAttempts: Infinity,
});

const delay = strategy.nextDelay(); // Exponentially increasing
strategy.reset();                    // On successful connection
strategy.isExhausted();             // True if max attempts reached

// Or use the convenience wrapper
await strategy.withReconnect(async () => {
  await connect();
});
```

### Difference Helpers

Utilities for constructing getDifference and getChannelDifference requests:

```ts
import {
  serializeGetState,
  serializeGetDifference,
  serializeGetChannelDifference,
  extractUpdateState,
  isUpdateWrapper,
  parseUpdateShort,
  UPDATE_CIDS,
} from '@mtproto2/mtproto';
```

### Salt Manager

```ts
import { SaltManager } from '@mtproto2/mtproto';
import type { FutureSalt } from '@mtproto2/mtproto';

const sm = new SaltManager();
sm.addSalts([{ validSince, validUntil, salt }]);
const current = sm.getCurrentSalt();
```

## License

[MIT](../../LICENSE)
