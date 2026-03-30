import crypto from 'node:crypto';
import {
  aesIgeEncrypt,
  aesIgeDecrypt,
  calcAuthKeyId,
  calcMsgKey,
  deriveAesKeyIv,
  randomBytes,
} from '@kerainmtp/crypto';

/**
 * Encrypt an MTProto 2.0 message.
 *
 * Plaintext layout:
 *   salt (8) + session_id (8) + msg_id (8) + seq_no (4) + message_data_length (4) + message_data + padding (12..1024)
 *
 * Encrypted message layout:
 *   auth_key_id (8) + msg_key (16) + encrypted_data
 */
export function encryptMessage(opts: {
  authKey: Buffer;
  salt: bigint;
  sessionId: bigint;
  msgId: bigint;
  seqNo: number;
  data: Buffer;
}): Buffer {
  const { authKey, salt, sessionId, msgId, seqNo, data } = opts;

  // Build the plaintext header (8 + 8 + 8 + 4 + 4 = 32 bytes) + data
  const headerSize = 32;
  const plaintextNopad = Buffer.alloc(headerSize + data.length);
  plaintextNopad.writeBigInt64LE(salt, 0);
  plaintextNopad.writeBigInt64LE(sessionId, 8);
  plaintextNopad.writeBigInt64LE(msgId, 16);
  plaintextNopad.writeInt32LE(seqNo, 24);
  plaintextNopad.writeInt32LE(data.length, 28);
  data.copy(plaintextNopad, 32);

  // Calculate padding: 12..1024 bytes, total must be divisible by 16
  const unpadded = plaintextNopad.length;
  // Minimum padding is 12 bytes
  let paddingLen = 12 + (16 - ((unpadded + 12) % 16)) % 16;
  // paddingLen is now in [12..27] and (unpadded + paddingLen) % 16 === 0
  const padding = randomBytes(paddingLen);
  const plaintext = Buffer.concat([plaintextNopad, padding]);

  // Calculate msg_key (client -> server, x = 0)
  const msgKey = calcMsgKey(authKey, plaintext, true);

  // Derive AES key and IV
  const { key, iv } = deriveAesKeyIv(authKey, msgKey, true);

  // Encrypt
  const encryptedData = aesIgeEncrypt(plaintext, key, iv);

  // Build final message: auth_key_id (8) + msg_key (16) + encrypted_data
  const authKeyId = calcAuthKeyId(authKey);
  return Buffer.concat([authKeyId, msgKey, encryptedData]);
}

/**
 * Decrypt an MTProto 2.0 message.
 *
 * @param opts.isClient - true if the message was sent by the client (x=0), false for server (x=8)
 *                        For decrypting server messages, use isClient=false.
 */
export function decryptMessage(opts: {
  authKey: Buffer;
  encrypted: Buffer;
  isClient: boolean;
}): {
  salt: bigint;
  sessionId: bigint;
  msgId: bigint;
  seqNo: number;
  data: Buffer;
} {
  const { authKey, encrypted, isClient } = opts;

  if (encrypted.length < 24) {
    throw new Error('Encrypted message too short');
  }

  // Parse: auth_key_id (8) + msg_key (16) + encrypted_data
  // Skip auth_key_id (first 8 bytes), extract msg_key (next 16 bytes)
  const msgKey = encrypted.subarray(8, 24);
  const encryptedData = encrypted.subarray(24);

  if (encryptedData.length % 16 !== 0) {
    throw new Error('Encrypted data length must be a multiple of 16');
  }

  // Derive AES key and IV
  const { key, iv } = deriveAesKeyIv(authKey, msgKey, isClient);

  // Decrypt
  const plaintext = aesIgeDecrypt(encryptedData, key, iv);

  // Verify msg_key
  const computedMsgKey = calcMsgKey(authKey, plaintext, isClient);
  if (!crypto.timingSafeEqual(msgKey, computedMsgKey)) {
    throw new Error('msg_key verification failed');
  }

  // Parse plaintext: salt (8) + session_id (8) + msg_id (8) + seq_no (4) + message_data_length (4) + data
  if (plaintext.length < 32) {
    throw new Error('Decrypted plaintext too short');
  }

  const salt = plaintext.readBigInt64LE(0);
  const sessionId = plaintext.readBigInt64LE(8);
  const msgId = plaintext.readBigInt64LE(16);
  const seqNo = plaintext.readInt32LE(24);
  const dataLength = plaintext.readInt32LE(28);

  if (dataLength < 0 || 32 + dataLength > plaintext.length) {
    throw new Error('Invalid message data length');
  }

  // Verify padding is 12..1024 bytes
  const paddingLen = plaintext.length - 32 - dataLength;
  if (paddingLen < 12 || paddingLen > 1024) {
    throw new Error(`Invalid padding length: ${paddingLen}`);
  }

  const data = Buffer.from(plaintext.subarray(32, 32 + dataLength));

  return { salt, sessionId, msgId, seqNo, data };
}
