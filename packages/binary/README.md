# @mtproto2/binary

TL binary serialization for MTProto 2.0.

Provides `TLReader` and `TLWriter` for reading and writing Telegram's TL (Type Language) binary format -- the wire encoding used by the MTProto protocol.

## Installation

```bash
npm install @mtproto2/binary
```

## API

### TLWriter

Builds TL-encoded binary buffers. The writer automatically grows its internal buffer as needed, up to `TLWriter.MAX_BUFFER_SIZE` (50 MB).

```ts
import { TLWriter } from '@mtproto2/binary';

const w = new TLWriter();

w.writeConstructorId(0xa677244f);   // Constructor ID (uint32)
w.writeInt32(42);                   // Signed 32-bit integer
w.writeUInt32(100);                 // Unsigned 32-bit integer
w.writeInt64(123456789n);           // Signed 64-bit integer (bigint)
w.writeDouble(3.14);                // 64-bit IEEE 754 double
w.writeInt128(buffer16);            // 16-byte value (nonces)
w.writeInt256(buffer32);            // 32-byte value (keys, hashes)
w.writeString('hello');             // TL-encoded string (UTF-8)
w.writeBytes(Buffer.from([1,2,3])); // TL-encoded byte string
w.writeBool(true);                  // Bool (boolTrue/boolFalse constructors)
w.writeRaw(buffer);                 // Raw bytes (no TL encoding)

w.writeVector([1, 2, 3], (item) => w.writeInt32(item));

const result: Buffer = w.toBuffer();
```

### TLReader

Reads TL-encoded binary buffers. Bounds-checked -- throws `RangeError` if a read would go past the end of the buffer. Byte fields are limited to `TLReader.MAX_BYTES_LENGTH` (10 MB).

```ts
import { TLReader } from '@mtproto2/binary';

const r = new TLReader(buffer);

const cid = r.readConstructorId(); // uint32
const n   = r.readInt32();         // int32
const u   = r.readUInt32();        // uint32
const big = r.readInt64();         // bigint
const d   = r.readDouble();        // double
const n16 = r.readInt128();        // Buffer (16 bytes)
const n32 = r.readInt256();        // Buffer (32 bytes)
const s   = r.readString();        // string
const b   = r.readBytes();         // Buffer
const ok  = r.readBool();          // boolean
const raw = r.readRaw(8);          // Buffer (exact byte count)

const items = r.readVector(() => r.readInt32());

// Inspection
r.position;   // Current byte offset
r.remaining;  // Bytes remaining
r.peekInt32(); // Read int32 without advancing
```

## TL Encoding Rules

### Bytes and Strings

TL uses a variable-length encoding for byte strings:

- **Short form** (length < 254): 1-byte header containing the length, followed by the data, followed by 0-3 bytes of zero-padding to align to a 4-byte boundary.
- **Long form** (length >= 254): 1-byte header `0xFE`, followed by 3 bytes of length (little-endian), followed by the data, followed by 0-3 bytes of zero-padding to align to a 4-byte boundary.

Strings are encoded as bytes using UTF-8.

### Integers

All integer types are encoded in little-endian byte order:
- `int` -- 4 bytes, signed
- `long` -- 8 bytes, signed (bigint in TypeScript)
- `int128` -- 16 bytes, unsigned (Buffer)
- `int256` -- 32 bytes, unsigned (Buffer)
- `double` -- 8 bytes, IEEE 754

### Bool

The `Bool` type uses constructor IDs:
- `boolTrue` = `0x997275b5`
- `boolFalse` = `0xbc799737`

### Vectors

Vectors are prefixed with the constructor ID `0x1cb5c415`, followed by a 4-byte count, followed by the serialized elements.

## Buffer Safety

- `TLReader.MAX_BYTES_LENGTH` (10 MB) -- maximum length for a single `readBytes()` call, preventing memory exhaustion from malformed data.
- `TLWriter.MAX_BUFFER_SIZE` (50 MB) -- maximum total buffer size for a single writer instance.

## License

[MIT](../../LICENSE)
