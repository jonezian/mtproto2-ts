import { randomBytes } from './random.js';
import { sha256 } from './sha.js';
import { aesIgeEncrypt } from './aes-ige.js';
import { modPow } from './dh.js';

export interface RsaPublicKey {
  fingerprint: bigint;
  n: bigint;
  e: bigint;
}

/**
 * Convert a bigint to a big-endian Buffer of the given byte length.
 */
function bigintToBuffer(value: bigint, length: number): Buffer {
  const hex = value.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex, 'hex');
}

/**
 * Convert a Buffer (big-endian) to a bigint.
 */
function bufferToBigint(buf: Buffer): bigint {
  return BigInt('0x' + buf.toString('hex'));
}

/**
 * RSA_PAD encryption per the MTProto 2.0 specification.
 *
 * This implements the RSA_PAD scheme used during auth key exchange to encrypt
 * the p_q_inner_data payload before sending it to the server. Unlike standard
 * PKCS#1 RSA, MTProto uses a custom padding scheme that incorporates AES-IGE
 * and SHA-256 to ensure the padded value is less than the RSA modulus.
 *
 * Algorithm:
 * 1. data_with_padding = data + random_bytes(192 - len(data))
 * 2. data_pad_reversed = reverse(data_with_padding)
 * 3. Loop:
 *    a. temp_key = random_bytes(32)
 *    b. data_with_hash = data_pad_reversed + SHA256(temp_key + data_pad_reversed)
 *    c. aes_encrypted = AES-IGE-encrypt(data_with_hash, temp_key, zero_iv)
 *    d. temp_key_xor = temp_key XOR SHA256(aes_encrypted)
 *    e. key_aes_encrypted = temp_key_xor + aes_encrypted (256 bytes total)
 *    f. val = BigInt(key_aes_encrypted)
 *    g. if val < n: break (otherwise repeat with new random values)
 * 4. result = pow(val, e, n) as 256-byte big-endian
 *
 * @param data - The data to encrypt (must not exceed 192 bytes)
 * @param publicKey - RSA public key with modulus n and exponent e
 * @returns 256-byte encrypted result
 *
 * @example
 * ```ts
 * const encrypted = rsaPad(innerData, { n: rsaModulus, e: 65537n });
 * ```
 */
export function rsaPad(data: Buffer, publicKey: { n: bigint; e: bigint }): Buffer {
  if (data.length > 192) {
    throw new Error('Data must not exceed 192 bytes');
  }

  // Step 1: Pad data to 192 bytes
  const padding = randomBytes(192 - data.length);
  const dataWithPadding = Buffer.concat([data, padding]);

  // Step 2: Reverse the padded data
  const dataPadReversed = Buffer.from(dataWithPadding).reverse();

  // Step 3: Loop until val < n
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // 3a: Generate random temp_key
    const tempKey = randomBytes(32);

    // 3b: data_with_hash = data_pad_reversed + SHA256(temp_key + data_with_padding)
    const hash = sha256(tempKey, dataWithPadding);
    const dataWithHash = Buffer.concat([dataPadReversed, hash]); // 192 + 32 = 224 bytes

    // 3c: AES-IGE encrypt with temp_key and zero IV (32 bytes of zeros)
    const zeroIv = Buffer.alloc(32);
    const aesEncrypted = aesIgeEncrypt(dataWithHash, tempKey, zeroIv);

    // 3d: temp_key_xor = temp_key XOR SHA256(aes_encrypted)
    const aesHash = sha256(aesEncrypted);
    const tempKeyXor = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) {
      tempKeyXor[i] = tempKey[i]! ^ aesHash[i]!;
    }

    // 3e: key_aes_encrypted = temp_key_xor + aes_encrypted (32 + 224 = 256 bytes)
    const keyAesEncrypted = Buffer.concat([tempKeyXor, aesEncrypted]);

    // 3f: Convert to bigint
    const val = bufferToBigint(keyAesEncrypted);

    // 3g: Check val < n
    if (val < publicKey.n) {
      // Step 4: RSA operation
      const result = modPow(val, publicKey.e, publicKey.n);
      return bigintToBuffer(result, 256);
    }
  }
}

/**
 * Telegram's official RSA public keys.
 *
 * These are the server RSA public keys used during the auth key generation
 * step of the MTProto protocol. The client uses these keys to encrypt the
 * p_q_inner_data payload via RSA_PAD. The server selects which key to use
 * by sending its fingerprint in the resPQ response; the client must match
 * one of these fingerprints to proceed with the key exchange.
 *
 * The fingerprint is computed as the lower 64 bits of SHA-1 of the
 * serialized (n, e) pair in TL format.
 *
 * Production keys with e = 65537 (0x10001).
 *
 * Keys sourced from official Telegram clients:
 * - TDLib: td/telegram/net/PublicRsaKeySharedMain.cpp
 * - Telegram Desktop: Telegram/SourceFiles/mtproto/mtproto_dc_options.cpp
 */
export const TELEGRAM_RSA_KEYS: RsaPublicKey[] = [
  {
    // Current production key (July 2021+, fingerprint 0xd09d1d85de64fd85)
    fingerprint: 0xd09d1d85de64fd85n,
    n: 0xe8bb3305c0b52c6cf2afdf7637313489e63e05268e5badb601af417786472e5f93b85438968e20e6729a301c0afc121bf7151f834436f7fda680847a66bf64accec78ee21c0b316f0edafe2f41908da7bd1f4a5107638eeb67040ace472a14f90d9f7c2b7def99688ba3073adb5750bb02964902a359fe745d8170e36876d4fd8a5d41b2a76cbff9a13267eb9580b2d06d10357448d20d9da2191cb5d8c93982961cdfdeda629e37f1fb09a0722027696032fe61ed663db7a37f6f263d370f69db53a0dc0a1748bdaaff6209d5645485e6e001d1953255757e4b8e42813347b11da6ab500fd0ace7e6dfa3736199ccaf9397ed0745a427dcfa6cd67bcb1acff3n,
    e: 65537n,
  },
  {
    // Legacy production key (pre-July 2021, fingerprint 0xc3b42b026ce86b21)
    fingerprint: 0xc3b42b026ce86b21n,
    n: 0xc150023e2f70db7985ded064759cfecf0af328e69a41daf4d6f01b538135a6f91f8f8b2a0ec9ba9720ce352efcf6c5680ffc424bd634864902de0b4bd6d49f4e580230e3ae97d95c8b19442b3c0a10d8f5633fecedd6926a7f6dab0ddb7d457f9ea81b8465fcd6fffeed114011df91c059caedaf97625f6c96ecc74725556934ef781d866b34f011fce4d835a090196e9a5f0e4449af7eb697ddb9076494ca5f81104a305b6dd27665722c46b60e5df680fb16b210607ef217652e60236c255f6a28315f4083a96791d7214bf64c1df4fd0db1944fb26a2a57031b32eee64ad15a8ba68885cde74a5bfc920f6abf59ba5c75506373e7130f9042da922179251fn,
    e: 65537n,
  },
  {
    // Legacy production key (pre-July 2021, fingerprint 0x0bc35f3509f7b7a5)
    fingerprint: 0x0bc35f3509f7b7a5n,
    n: 0xaeec36c8ffc109cb099624685b97815415657bd76d8c9c3e398103d7ad16c9bba6f525ed0412d7ae2c2de2b44e77d72cbf4b7438709a4e646a05c43427c7f184debf72947519680e651500890c6832796dd11f772c25ff8f576755afe055b0a3752c696eb7d8da0d8be1faf38c9bdd97ce0a77d3916230c4032167100edd0f9e7a3a9b602d04367b689536af0d64b613ccba7962939d3b57682beb6dae5b608130b2e52aca78ba023cf6ce806b1dc49c72cf928a7199d22e3d7ac84e47bc9427d0236945d10dbd15177bab413fbf0edfda09f014c7a7da088dde9759702ca760af2b8e4e97cc055c617bd74c3d97008635b98dc4d621b4891da9fb0473047927n,
    e: 65537n,
  },
];
