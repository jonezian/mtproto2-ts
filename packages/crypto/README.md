# @mtproto2/crypto

Cryptographic primitives for Telegram's MTProto 2.0 protocol.

All operations use the Node.js `node:crypto` built-in module. There are no external dependencies.

## Installation

```bash
npm install @mtproto2/crypto
```

## API

### AES-256-IGE

AES in Infinite Garble Extension mode, used for MTProto message encryption.

```ts
import { aesIgeEncrypt, aesIgeDecrypt } from '@mtproto2/crypto';

// key: 32 bytes, iv: 32 bytes (first 16 = cipher IV, last 16 = plain IV)
// data must be 16-byte aligned
const encrypted = aesIgeEncrypt(data, key, iv);
const decrypted = aesIgeDecrypt(encrypted, key, iv);
```

### AES-256-CTR

Streaming AES-CTR cipher, used for transport obfuscation.

```ts
import { AesCtr } from '@mtproto2/crypto';

// key: 32 bytes, iv: 16 bytes
const ctr = new AesCtr(key, iv);
const encrypted = ctr.encrypt(data);
const decrypted = ctr.decrypt(encrypted);
```

Each `AesCtr` instance maintains internal counter state. Create a new instance for each connection -- never reuse across different (key, IV) contexts.

### RSA-PAD

MTProto RSA_PAD encryption scheme for auth key exchange.

```ts
import { rsaPad, TELEGRAM_RSA_KEYS } from '@mtproto2/crypto';

// data: up to 192 bytes, publicKey: { n: bigint, e: bigint }
const encrypted = rsaPad(data, TELEGRAM_RSA_KEYS[0]);
```

`TELEGRAM_RSA_KEYS` contains Telegram's official server RSA public keys used during the auth key generation step. These are hard-coded per the MTProto specification.

The RSA_PAD algorithm:
1. Pads data to 192 bytes with random bytes
2. Reverses the padded data
3. Loops: generates a random temp_key, computes SHA-256 hash, AES-IGE encrypts, XORs keys
4. Performs modular exponentiation with the RSA public key

### SHA-1 and SHA-256

```ts
import { sha1, sha256 } from '@mtproto2/crypto';

// Accepts multiple buffers (concatenated before hashing)
const hash1 = sha1(data);            // 20 bytes
const hash2 = sha256(data1, data2);  // 32 bytes
```

### Diffie-Hellman

```ts
import { modPow, isGoodPrime, isGoodGa } from '@mtproto2/crypto';

// Modular exponentiation: (base ^ exp) mod mod
const result = modPow(base, exp, mod);

// Validate DH prime (2048-bit, safe prime, valid g)
const primeOk = isGoodPrime(dhPrime, g);

// Validate g_a or g_b range
const gaOk = isGoodGa(ga, dhPrime);
```

`isGoodPrime` performs:
- 2048-bit length check
- Miller-Rabin primality test on dhPrime
- Miller-Rabin primality test on (dhPrime - 1) / 2 (safe prime check)
- Generator validation per the MTProto specification (g=2..7)

`isGoodGa` verifies:
- 1 < g_a < dhPrime - 1
- 2^(2048-64) < g_a < dhPrime - 2^(2048-64)

### PQ Factorization

```ts
import { factorizePQ } from '@mtproto2/crypto';

// Factor a composite number into two primes [p, q] where p < q
const [p, q] = factorizePQ(pq);
```

Uses Pollard's rho algorithm. The `pq` value is a server-provided challenge during auth key exchange.

### Key Derivation

```ts
import { deriveAesKeyIv } from '@mtproto2/crypto';

// MTProto 2.0 key derivation from auth_key and msg_key
// isClient: true for client->server (x=0), false for server->client (x=8)
const { key, iv } = deriveAesKeyIv(authKey, msgKey, isClient);
```

### Auth Key Helpers

```ts
import { calcAuthKeyId, calcMsgKey } from '@mtproto2/crypto';

// auth_key_id = last 8 bytes of SHA-1(auth_key)
const authKeyId = calcAuthKeyId(authKey);

// msg_key = middle 16 bytes (bytes 8-24) of SHA-256(substr(auth_key, 88+x, 32) + plaintext)
const msgKey = calcMsgKey(authKey, plaintext, isClient);
```

### Random Generation

```ts
import { randomBytes, randomBigInt } from '@mtproto2/crypto';

// Cryptographically secure random bytes
const bytes = randomBytes(32);

// Random bigint of exactly N bits (top bit always set)
const big = randomBigInt(2048);
```

## Security Notes

- All random generation uses `crypto.randomBytes()` from the Node.js `node:crypto` module. `Math.random()` is never used.
- msg_key comparisons in the mtproto package use `crypto.timingSafeEqual()` to prevent timing attacks.
- DH validation functions enforce the full set of checks specified by the MTProto protocol documentation.

## License

[MIT](../../LICENSE)
