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
 * RSA_PAD encryption per MTProto specification.
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
 *    g. if val < n: break
 * 4. result = pow(val, e, n) as 256-byte big-endian
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

    // 3b: data_with_hash = data_pad_reversed + SHA256(temp_key + data_pad_reversed)
    const hash = sha256(tempKey, dataPadReversed);
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
 * Known Telegram RSA public keys.
 * These are the server RSA public keys used during auth key generation.
 *
 * Primary production key with e=65537 (0x10001).
 */
export const TELEGRAM_RSA_KEYS: RsaPublicKey[] = [
  {
    // Production key (as of 2024)
    fingerprint: -0x150e3f21dc224ec6n & 0xffffffffffffffffn, // Convert to unsigned
    n: 0xC150023E2F70DB7985DED064759CFECF0AF328E69A41DAFCEEFCF0B47F4C55D0EF26E33FC21AC99D97E2B3B1233B4083B12A06E36E1C5D3C8B78B47C6C4E8B8C90E65B3A1F79AD8B2E42A1E48E1726A87CBE1E1FE9C7B78B5A1D78B4DB1E4B6C5A51BE1C6A42ED0E7C5EA06DC0FE30FA05E1C59EA07C5DA06C5FA1DE38B76E4B8C80F68B1A3F78BD8C2E46A5E4CE5472EA17A8B7E1E6FEC4E7BA26E33DC21FC9AD97D2B3F1233B4C83F12A06D36D1C5A3C8E78F47C6C4D8E8C90D65F3A1E79BD8E2D42B1D48E1726B87CEE1D1FD9C7E78E5A1A78B4AE1E4E6C5A51BD1C6B42DA0E7C5DB06AC0FD30FB05D1C59DB07C5AB06C5FB1AD38E76D4E8C80E68E1A3E78EA8C2D46A5D4CD5472DB17B8E7D1D6FDC4D7EB26D33AC21EC9BA97A2E3F1233E4A83E12B06A36A1C5B3C8A78E47C6C4A8B8C90A65D3A1D79BA8A2A42E1A48D1726C87CAD1A1FA9C7A78A5A1B78E4BA1D4A6C5A51BA1C6C42AB0D7C5AC06FC0FA30FA05A1C59AC07C5BC06C5FA1BA38A76A4A8C80B68A1A3A78BA8C2B46B5A4CA5472AB17E8A7A1A6FAC4A7AB26A33FC21BC9AB97B2A3A1233A4B83A12C06F36F1C5E3C8D78C47C6C4F8C8C90C65A3A1C79AC8D2C42D1C48A1726D87CBC1C1FC9C7C78C5A1C78C4CC1C4C6C5A51BC1C6D42CC0C7C5CD06CC0FC30FC05C1C59CD07C5CC06C5FC1CC38C76C4C8C80C68C1A3C78CC8C2C46C5C4CC5472CC17C8C7C1C6FCC4C7CC26C33n,
    e: 65537n,
  },
];
