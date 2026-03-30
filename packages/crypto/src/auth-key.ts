import { sha1 } from './sha.js';
import { sha256 } from './sha.js';

/**
 * Calculate auth_key_id from auth_key.
 * auth_key_id = SHA1(auth_key) last 8 bytes.
 */
export function calcAuthKeyId(authKey: Buffer): Buffer {
  const hash = sha1(authKey);
  return hash.subarray(hash.length - 8);
}

/**
 * Calculate msg_key from auth_key and plaintext.
 * msg_key = SHA256(substr(auth_key, 88+x, 32) + plaintext) middle 16 bytes (bytes 8-24).
 *
 * @param authKey   - 2048-bit auth key (256 bytes)
 * @param plaintext - Serialized message data (including padding)
 * @param isClient  - true for client->server (x=0), false for server->client (x=8)
 */
export function calcMsgKey(
  authKey: Buffer,
  plaintext: Buffer,
  isClient: boolean,
): Buffer {
  const x = isClient ? 0 : 8;
  const hash = sha256(authKey.subarray(88 + x, 88 + x + 32), plaintext);
  return hash.subarray(8, 24);
}
