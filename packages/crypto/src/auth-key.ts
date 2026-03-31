import { sha1 } from './sha.js';
import { sha256 } from './sha.js';

/**
 * Calculate auth_key_id from auth_key.
 *
 * The auth_key_id is a unique identifier for an auth key, computed as the
 * last 8 bytes of SHA-1(auth_key). It is included in every encrypted
 * MTProto message so the server can identify which auth key was used
 * for encryption without attempting decryption.
 *
 * Formula: auth_key_id = SHA1(auth_key)[12:20]
 *
 * @param authKey - The 256-byte (2048-bit) auth key
 * @returns 8-byte Buffer containing the auth key ID
 *
 * @example
 * ```ts
 * const authKeyId = calcAuthKeyId(authKey);
 * // authKeyId is the last 8 bytes of SHA-1(authKey)
 * ```
 */
export function calcAuthKeyId(authKey: Buffer): Buffer {
  const hash = sha1(authKey);
  return hash.subarray(hash.length - 8);
}

/**
 * Calculate msg_key from auth_key and plaintext (MTProto 2.0).
 *
 * The msg_key is a 16-byte value derived from both the auth_key and the
 * plaintext message data. It serves as an integrity check and is used
 * to derive the AES key and IV for message encryption/decryption.
 *
 * Formula: msg_key = SHA256(substr(auth_key, 88+x, 32) + plaintext)[8:24]
 *
 * The parameter x depends on the message direction:
 * - x = 0 for client-to-server messages
 * - x = 8 for server-to-client messages
 *
 * When verifying a received msg_key, always use `crypto.timingSafeEqual()`
 * to prevent timing side-channel attacks.
 *
 * @param authKey   - 2048-bit auth key (256 bytes)
 * @param plaintext - Serialized message data (including padding)
 * @param isClient  - true for client->server (x=0), false for server->client (x=8)
 * @returns 16-byte Buffer containing the message key
 *
 * @example
 * ```ts
 * // Client sending a message
 * const msgKey = calcMsgKey(authKey, plaintext, true);
 *
 * // Verifying a received message
 * const computed = calcMsgKey(authKey, decryptedPlaintext, false);
 * if (!crypto.timingSafeEqual(receivedMsgKey, computed)) {
 *   throw new Error('msg_key verification failed');
 * }
 * ```
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
