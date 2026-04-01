import crypto from 'node:crypto';
import {
  sha1,
  aesIgeEncrypt,
  aesIgeDecrypt,
  rsaPad,
  factorizePQ,
  modPow,
  isGoodPrime,
  isGoodGa,
  randomBytes,
} from '@mtproto2/crypto';
import type { RsaPublicKey } from '@mtproto2/crypto';
import { TLReader, TLWriter } from '@mtproto2/binary';

// Constructor IDs from mtproto.tl
const CID = {
  req_pq_multi: 0xbe7e8ef1,
  resPQ: 0x05162463,
  req_DH_params: 0xd712e4be,
  server_DH_params_ok: 0xd0e8075c,
  server_DH_inner_data: 0xb5890dba,
  p_q_inner_data_dc: 0xa9f55f95,
  client_DH_inner_data: 0x6643b654,
  set_client_DH_params: 0xf5045f1f,
  dh_gen_ok: 0x3bcbf734,
  dh_gen_retry: 0x46dc1fb9,
  dh_gen_fail: 0xa69dae02,
} as const;

export interface AuthKeyResult {
  authKey: Buffer;
  authKeyId: Buffer;
  serverSalt: bigint;
  timeOffset: number;
}

/**
 * Type for the send callback: takes serialized request bytes,
 * returns the raw response bytes from the server.
 */
export type SendFunction = (data: Buffer) => Promise<Buffer>;

/**
 * Options for AuthKeyExchange constructor.
 */
export interface AuthKeyExchangeOptions {
  /** Send callback: serializes and sends data, returns response. */
  send: SendFunction;
  /** RSA public keys to use for encryption. */
  rsaKeys: RsaPublicKey[];
  /** Data center ID (default: 2). */
  dcId?: number;
  /**
   * For testing only: override the nonce (16 bytes).
   * If not provided, a random nonce is generated.
   */
  _testNonce?: Buffer;
  /**
   * For testing only: override the new_nonce (32 bytes).
   * If not provided, a random new_nonce is generated.
   */
  _testNewNonce?: Buffer;
}

/**
 * Convert a bigint to a big-endian byte array with minimal encoding.
 * TL bytes fields use the minimal representation.
 */
function bigintToBytes(value: bigint): Buffer {
  if (value === 0n) return Buffer.alloc(1, 0);
  const hex = value.toString(16);
  const paddedHex = hex.length % 2 === 0 ? hex : '0' + hex;
  return Buffer.from(paddedHex, 'hex');
}

/**
 * Convert a big-endian byte Buffer to a bigint.
 */
function bytesToBigint(buf: Buffer): bigint {
  if (buf.length === 0) return 0n;
  return BigInt('0x' + buf.toString('hex'));
}

/**
 * Convert a bigint to a big-endian Buffer of exactly the given byte length.
 */
function bigintToFixedBuffer(value: bigint, length: number): Buffer {
  const hex = value.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex, 'hex');
}

/**
 * Derive the temporary AES key and IV used for DH exchange inner encryption.
 *
 * tmp_aes_key = SHA1(new_nonce + server_nonce) + SHA1(server_nonce + new_nonce)[0:12]
 * tmp_aes_iv = SHA1(server_nonce + new_nonce)[12:20] + SHA1(new_nonce + new_nonce) + new_nonce[0:4]
 */
export function deriveTmpAesKeyIv(
  newNonce: Buffer,
  serverNonce: Buffer,
): { key: Buffer; iv: Buffer } {
  const hash1 = sha1(Buffer.concat([newNonce, serverNonce]));
  const hash2 = sha1(Buffer.concat([serverNonce, newNonce]));
  const hash3 = sha1(Buffer.concat([newNonce, newNonce]));

  const key = Buffer.concat([
    hash1,                  // 20 bytes
    hash2.subarray(0, 12),  // 12 bytes
  ]); // = 32 bytes

  const iv = Buffer.concat([
    hash2.subarray(12, 20),  // 8 bytes
    hash3,                   // 20 bytes
    newNonce.subarray(0, 4), // 4 bytes
  ]); // = 32 bytes

  return { key, iv };
}

/**
 * Compute the server salt from new_nonce and server_nonce.
 * XOR the first 8 bytes of each, interpret as little-endian int64.
 */
export function computeServerSalt(
  newNonce: Buffer,
  serverNonce: Buffer,
): bigint {
  const buf = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = newNonce[i]! ^ serverNonce[i]!;
  }
  return buf.readBigInt64LE(0);
}

/**
 * AuthKeyExchange implements the MTProto 2.0 Diffie-Hellman auth key negotiation.
 *
 * The 9-step protocol:
 * 1. Client sends req_pq_multi(nonce)
 * 2. Server responds with resPQ(nonce, server_nonce, pq, fingerprints)
 * 3. Client factors PQ into p, q
 * 4. Client sends req_DH_params with RSA_PAD encrypted p_q_inner_data_dc
 * 5. Server responds with server_DH_params_ok (AES-IGE encrypted DH params)
 * 6. Client decrypts to get g, dh_prime, g_a, server_time
 * 7. Client validates DH parameters
 * 8. Client generates b, computes g_b and auth_key
 * 9. Client sends set_client_DH_params, server responds with dh_gen_ok/retry/fail
 */
export class AuthKeyExchange {
  private readonly send: SendFunction;
  private readonly rsaKeys: RsaPublicKey[];
  private readonly dcId: number;
  private readonly _testNonce?: Buffer;
  private readonly _testNewNonce?: Buffer;

  constructor(opts: AuthKeyExchangeOptions) {
    this.send = opts.send;
    this.rsaKeys = opts.rsaKeys;
    this.dcId = opts.dcId ?? 2;
    this._testNonce = opts._testNonce;
    this._testNewNonce = opts._testNewNonce;
  }

  /**
   * Execute the full auth key exchange protocol.
   * Returns the auth key, auth key ID, server salt, and time offset.
   */
  async execute(): Promise<AuthKeyResult> {
    // Step 1: Generate nonce and send req_pq_multi
    const nonce = this._testNonce ?? randomBytes(16);

    const reqPqWriter = new TLWriter(64);
    reqPqWriter.writeConstructorId(CID.req_pq_multi);
    reqPqWriter.writeInt128(nonce);

    const resPqData = await this.send(reqPqWriter.toBuffer());

    // Step 2: Parse resPQ
    const resPqReader = new TLReader(resPqData);
    const resPqCid = resPqReader.readConstructorId();
    if (resPqCid !== CID.resPQ) {
      throw new Error(
        `Expected resPQ (0x${CID.resPQ.toString(16)}), got 0x${resPqCid.toString(16).padStart(8, '0')}`,
      );
    }

    const resPqNonce = resPqReader.readInt128();
    if (!crypto.timingSafeEqual(resPqNonce, nonce)) {
      throw new Error('Nonce mismatch in resPQ');
    }

    const serverNonce = resPqReader.readInt128();
    const pqBytes = resPqReader.readBytes();
    const pq = bytesToBigint(pqBytes);

    // Read the fingerprints vector
    const fingerprints = resPqReader.readVector<bigint>(() => resPqReader.readInt64());

    // Find a matching RSA key
    const rsaKey = this.findRsaKey(fingerprints);
    if (!rsaKey) {
      throw new Error('No matching RSA key found for server fingerprints');
    }

    // Step 3: Factor PQ
    const [p, q] = factorizePQ(pq);

    // Step 4: Build and encrypt p_q_inner_data_dc, send req_DH_params
    const newNonce = this._testNewNonce ?? randomBytes(32);

    const pBytes = bigintToBytes(p);
    const qBytes = bigintToBytes(q);

    // Serialize p_q_inner_data_dc
    const innerWriter = new TLWriter(512);
    innerWriter.writeConstructorId(CID.p_q_inner_data_dc);
    innerWriter.writeBytes(pqBytes);
    innerWriter.writeBytes(pBytes);
    innerWriter.writeBytes(qBytes);
    innerWriter.writeInt128(nonce);
    innerWriter.writeInt128(serverNonce);
    innerWriter.writeInt256(newNonce);
    innerWriter.writeInt32(this.dcId);

    const innerData = innerWriter.toBuffer();

    // RSA_PAD encrypt the inner data
    const encryptedInner = rsaPad(innerData, rsaKey);

    // Send req_DH_params
    const reqDhWriter = new TLWriter(512);
    reqDhWriter.writeConstructorId(CID.req_DH_params);
    reqDhWriter.writeInt128(nonce);
    reqDhWriter.writeInt128(serverNonce);
    reqDhWriter.writeBytes(pBytes);
    reqDhWriter.writeBytes(qBytes);
    reqDhWriter.writeInt64(rsaKey.fingerprint);
    reqDhWriter.writeBytes(encryptedInner);

    const dhParamsData = await this.send(reqDhWriter.toBuffer());

    // Step 5: Parse server_DH_params_ok
    const dhParamsReader = new TLReader(dhParamsData);
    const dhParamsCid = dhParamsReader.readConstructorId();
    if (dhParamsCid !== CID.server_DH_params_ok) {
      throw new Error(
        `Expected server_DH_params_ok (0x${CID.server_DH_params_ok.toString(16)}), got 0x${dhParamsCid.toString(16).padStart(8, '0')}`,
      );
    }

    const dhNonce = dhParamsReader.readInt128();
    if (!crypto.timingSafeEqual(dhNonce, nonce)) {
      throw new Error('Nonce mismatch in server_DH_params_ok');
    }

    const dhServerNonce = dhParamsReader.readInt128();
    if (!crypto.timingSafeEqual(dhServerNonce, serverNonce)) {
      throw new Error('Server nonce mismatch in server_DH_params_ok');
    }

    const encryptedAnswer = dhParamsReader.readBytes();

    // Step 6: Decrypt the DH answer
    const { key: tmpAesKey, iv: tmpAesIv } = deriveTmpAesKeyIv(newNonce, serverNonce);

    const decryptedAnswer = aesIgeDecrypt(encryptedAnswer, tmpAesKey, tmpAesIv);

    // The decrypted answer is: SHA1(answer) (20 bytes) + answer + padding
    const answerHash = decryptedAnswer.subarray(0, 20);
    // We need to parse the answer to determine its length, then verify the hash
    const answerReader = new TLReader(decryptedAnswer.subarray(20));

    const answerCid = answerReader.readConstructorId();
    if (answerCid !== CID.server_DH_inner_data) {
      throw new Error(
        `Expected server_DH_inner_data (0x${CID.server_DH_inner_data.toString(16)}), got 0x${answerCid.toString(16).padStart(8, '0')}`,
      );
    }

    const innerNonce = answerReader.readInt128();
    if (!crypto.timingSafeEqual(innerNonce, nonce)) {
      throw new Error('Nonce mismatch in server_DH_inner_data');
    }

    const innerServerNonce = answerReader.readInt128();
    if (!crypto.timingSafeEqual(innerServerNonce, serverNonce)) {
      throw new Error('Server nonce mismatch in server_DH_inner_data');
    }

    const g = answerReader.readInt32();
    const dhPrimeBytes = answerReader.readBytes();
    const gaBytes = answerReader.readBytes();
    const serverTime = answerReader.readInt32();

    // Verify the SHA1 hash of the answer
    const answerData = decryptedAnswer.subarray(20, 20 + answerReader.position);
    const computedAnswerHash = sha1(answerData);
    if (!crypto.timingSafeEqual(answerHash, computedAnswerHash)) {
      throw new Error('Answer hash verification failed');
    }

    const dhPrime = bytesToBigint(dhPrimeBytes);
    const ga = bytesToBigint(gaBytes);

    // Step 7: Validate DH parameters
    if (!isGoodPrime(dhPrime, g)) {
      throw new Error('DH prime validation failed');
    }

    if (!isGoodGa(ga, dhPrime)) {
      throw new Error('g_a validation failed');
    }

    // Compute time offset
    const timeOffset = serverTime - Math.floor(Date.now() / 1000);

    // Step 8: Generate b, compute g_b and auth_key
    let retryId = 0n;
    const maxRetries = 10;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const b = bytesToBigint(randomBytes(256));
      const gb = modPow(BigInt(g), b, dhPrime);

      // Validate g_b
      if (!isGoodGa(gb, dhPrime)) {
        throw new Error('g_b validation failed');
      }

      const authKey = bigintToFixedBuffer(modPow(ga, b, dhPrime), 256);

      // Step 9: Send set_client_DH_params
      const clientInnerWriter = new TLWriter(512);
      clientInnerWriter.writeConstructorId(CID.client_DH_inner_data);
      clientInnerWriter.writeInt128(nonce);
      clientInnerWriter.writeInt128(serverNonce);
      clientInnerWriter.writeInt64(retryId);
      clientInnerWriter.writeBytes(bigintToBytes(gb));

      const clientInnerData = clientInnerWriter.toBuffer();

      // Encrypt: SHA1(data) + data + padding (to align to 16 bytes)
      const clientInnerHash = sha1(clientInnerData);
      const unpadded = clientInnerHash.length + clientInnerData.length;
      const paddingLen = (16 - (unpadded % 16)) % 16;
      const padding = randomBytes(paddingLen);

      const toEncrypt = Buffer.concat([clientInnerHash, clientInnerData, padding]);
      const encryptedClient = aesIgeEncrypt(toEncrypt, tmpAesKey, tmpAesIv);

      const setClientWriter = new TLWriter(512);
      setClientWriter.writeConstructorId(CID.set_client_DH_params);
      setClientWriter.writeInt128(nonce);
      setClientWriter.writeInt128(serverNonce);
      setClientWriter.writeBytes(encryptedClient);

      const dhGenData = await this.send(setClientWriter.toBuffer());

      // Parse the response
      const dhGenReader = new TLReader(dhGenData);
      const dhGenCid = dhGenReader.readConstructorId();

      const dhGenNonce = dhGenReader.readInt128();
      if (!crypto.timingSafeEqual(dhGenNonce, nonce)) {
        throw new Error('Nonce mismatch in DH gen response');
      }

      const dhGenServerNonce = dhGenReader.readInt128();
      if (!crypto.timingSafeEqual(dhGenServerNonce, serverNonce)) {
        throw new Error('Server nonce mismatch in DH gen response');
      }

      const newNonceHash = dhGenReader.readInt128();

      // aux_hash = first 8 bytes of SHA1(auth_key), per MTProto spec
      const auxHash = sha1(authKey).subarray(0, 8);

      if (dhGenCid === CID.dh_gen_ok) {
        // Verify new_nonce_hash1 = SHA1(new_nonce + 0x01 + aux_hash)[4:20]
        const expectedHash = sha1(
          Buffer.concat([newNonce, Buffer.from([0x01]), auxHash]),
        ).subarray(4, 20);

        if (!crypto.timingSafeEqual(newNonceHash, expectedHash)) {
          throw new Error('new_nonce_hash1 verification failed');
        }

        const authKeyId = sha1(authKey).subarray(12, 20);
        const serverSalt = computeServerSalt(newNonce, serverNonce);

        return { authKey, authKeyId, serverSalt, timeOffset };
      } else if (dhGenCid === CID.dh_gen_retry) {
        // Verify new_nonce_hash2 = SHA1(new_nonce + 0x02 + aux_hash)[4:20]
        const expectedHash = sha1(
          Buffer.concat([newNonce, Buffer.from([0x02]), auxHash]),
        ).subarray(4, 20);

        if (!crypto.timingSafeEqual(newNonceHash, expectedHash)) {
          throw new Error('new_nonce_hash2 verification failed');
        }

        // Set retry_id to auth_key_aux_hash as int64 LE
        retryId = auxHash.readBigInt64LE(0);
        // Continue the loop to retry
      } else if (dhGenCid === CID.dh_gen_fail) {
        // Verify new_nonce_hash3 = SHA1(new_nonce + 0x03 + aux_hash)[4:20]
        const expectedHash = sha1(
          Buffer.concat([newNonce, Buffer.from([0x03]), auxHash]),
        ).subarray(4, 20);

        if (!crypto.timingSafeEqual(newNonceHash, expectedHash)) {
          throw new Error('new_nonce_hash3 verification failed');
        }

        throw new Error('DH key exchange failed (dh_gen_fail)');
      } else {
        throw new Error(
          `Unexpected DH gen response: 0x${dhGenCid.toString(16).padStart(8, '0')}`,
        );
      }
    }

    throw new Error(`DH key exchange failed after ${maxRetries} retries`);
  }

  /**
   * Find an RSA key that matches one of the server's fingerprints.
   */
  private findRsaKey(fingerprints: bigint[]): RsaPublicKey | null {
    for (const fp of fingerprints) {
      for (const key of this.rsaKeys) {
        // Compare fingerprints — handle signed/unsigned int64
        if (key.fingerprint === fp) {
          return key;
        }
        // Also compare unsigned representations
        const keyFpUnsigned = key.fingerprint & 0xFFFFFFFFFFFFFFFFn;
        const fpUnsigned = fp & 0xFFFFFFFFFFFFFFFFn;
        if (keyFpUnsigned === fpUnsigned) {
          return key;
        }
      }
    }
    return null;
  }
}
