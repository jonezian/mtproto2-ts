import { sha256 } from './sha.js';

/**
 * Derive AES key and IV from auth_key and msg_key.
 * MTProto 2.0 key derivation.
 *
 * @param authKey  - 2048-bit auth key (256 bytes)
 * @param msgKey   - 16-byte message key
 * @param isClient - true for client->server (x=0), false for server->client (x=8)
 */
export function deriveAesKeyIv(
  authKey: Buffer,
  msgKey: Buffer,
  isClient: boolean,
): { key: Buffer; iv: Buffer } {
  const x = isClient ? 0 : 8;

  const sha256a = sha256(
    msgKey,
    authKey.subarray(x, x + 36),
  );

  const sha256b = sha256(
    authKey.subarray(40 + x, 40 + x + 36),
    msgKey,
  );

  const key = Buffer.concat([
    sha256a.subarray(0, 8),
    sha256b.subarray(8, 24),
    sha256a.subarray(24, 32),
  ]);

  const iv = Buffer.concat([
    sha256b.subarray(0, 8),
    sha256a.subarray(8, 24),
    sha256b.subarray(24, 32),
  ]);

  return { key, iv };
}
