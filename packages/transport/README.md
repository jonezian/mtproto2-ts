# @mtproto2/transport

TCP transport layer for Telegram's MTProto 2.0 protocol.

Implements all four MTProto transport protocols plus an obfuscation wrapper for DPI (deep packet inspection) resistance.

## Installation

```bash
npm install @mtproto2/transport
```

## Transport Modes

| Transport | Init Bytes | Frame Format | Use Case |
|-----------|-----------|--------------|----------|
| **Abridged** | `0xef` (1 byte) | 1 or 4 byte length header (in 4-byte words) + payload | Minimal overhead |
| **Intermediate** | `0xeeeeeeee` (4 bytes) | 4-byte length (LE) + payload | Simple, recommended |
| **Padded Intermediate** | `0xdddddddd` (4 bytes) | 4-byte length (LE) + payload + random padding (16-byte aligned) | Padding for security |
| **Full** | None | 4-byte total length + 4-byte seq_no + payload + 4-byte CRC32 | Integrity verification |

### Abridged

The simplest transport. Length is encoded in 4-byte words.

```ts
import { AbridgedTransport } from '@mtproto2/transport';

const transport = new AbridgedTransport();
await transport.connect('149.154.167.51', 443);
transport.send(payload);
transport.on('data', (data: Buffer) => { /* ... */ });
transport.close();
```

### Intermediate

4-byte length header with the raw byte count (not divided by 4). Recommended for most uses.

```ts
import { IntermediateTransport } from '@mtproto2/transport';

const transport = new IntermediateTransport();
await transport.connect('149.154.167.51', 443);
```

### Padded Intermediate

Like Intermediate, but pads each frame to a 16-byte boundary with random bytes.

```ts
import { PaddedIntermediateTransport } from '@mtproto2/transport';

const transport = new PaddedIntermediateTransport();
await transport.connect('149.154.167.51', 443);
```

### Full

Includes sequence numbers and CRC32 checksums for integrity verification. No init bytes are sent.

```ts
import { FullTransport } from '@mtproto2/transport';

const transport = new FullTransport();
await transport.connect('149.154.167.51', 443);
```

## Obfuscation

The `ObfuscatedTransport` wraps any transport with AES-256-CTR encryption, making the protocol undetectable by DPI. A 64-byte random init payload is generated and sent at connection time.

```ts
import {
  IntermediateTransport,
  ObfuscatedTransport,
} from '@mtproto2/transport';

const inner = new IntermediateTransport();
const transport = new ObfuscatedTransport(inner, 'intermediate');
await transport.connect('149.154.167.51', 443);

// All subsequent traffic is encrypted with AES-256-CTR
transport.send(payload);
transport.on('data', (data: Buffer) => { /* decrypted automatically */ });
```

The obfuscation init process:
1. Generate 64 random bytes (avoiding patterns that look like HTTP/TLS)
2. Derive encrypt key (bytes 8-40) and IV (bytes 40-56)
3. Derive decrypt key and IV from the reversed bytes
4. Create AES-256-CTR ciphers for each direction
5. Encrypt the 64-byte init, embed the transport magic bytes
6. Send the init payload; all subsequent frames are encrypted/decrypted

### Transport Magic Constants

```ts
import { TRANSPORT_MAGIC } from '@mtproto2/transport';

TRANSPORT_MAGIC.abridged;      // 0xefefefef
TRANSPORT_MAGIC.intermediate;  // 0xeeeeeeee
TRANSPORT_MAGIC.padded;        // 0xdddddddd
```

### Standalone Init Generation

```ts
import { generateObfuscatedInit } from '@mtproto2/transport';

const { initBytes, encryptor, decryptor } = generateObfuscatedInit(0xeeeeeeee);
// initBytes: 64-byte Buffer to send as the first message
// encryptor: AesCtr instance for encrypting outgoing data
// decryptor: AesCtr instance for decrypting incoming data
```

## Low-Level TCP

The `TcpConnection` class provides a raw TCP socket wrapper with event-based I/O.

```ts
import { TcpConnection } from '@mtproto2/transport';

const tcp = new TcpConnection();
await tcp.connect('149.154.167.51', 443);
tcp.write(data);
tcp.on('data', (data: Buffer) => { /* ... */ });
tcp.on('error', (err: Error) => { /* ... */ });
tcp.on('close', () => { /* ... */ });
tcp.close();
```

## Abstract Base Class

All transports extend the `Transport` abstract class:

```ts
import { Transport } from '@mtproto2/transport';

abstract class Transport extends EventEmitter {
  abstract connect(host: string, port: number): Promise<void>;
  abstract send(payload: Buffer): void;
  abstract close(): void;
  abstract get isConnected(): boolean;
  abstract encodePacket(payload: Buffer): Buffer;
  abstract decodePacket(data: Buffer): Buffer[];
}
```

Events: `'connect'`, `'data'`, `'error'`, `'close'`.

## Choosing a Transport

For most applications, use **Intermediate + Obfuscation**:

```ts
const transport = new ObfuscatedTransport(
  new IntermediateTransport(),
  'intermediate',
);
```

This combination provides a good balance of simplicity, reliability, and DPI resistance.

| Consideration | Recommended Transport |
|--------------|----------------------|
| General use | Intermediate + Obfuscation |
| Minimal bandwidth | Abridged + Obfuscation |
| Extra security | Padded Intermediate + Obfuscation |
| Debugging / integrity checks | Full (no obfuscation) |

## License

[MIT](../../LICENSE)
