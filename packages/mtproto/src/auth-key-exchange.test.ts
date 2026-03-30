import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  sha1,
  aesIgeEncrypt,
  aesIgeDecrypt,
  modPow,
  randomBytes,
  factorizePQ,
} from '@kerainmtp/crypto';
import { TLReader, TLWriter } from '@kerainmtp/binary';
import {
  AuthKeyExchange,
  deriveTmpAesKeyIv,
  computeServerSalt,
} from './auth-key-exchange.js';
import type { SendFunction } from './auth-key-exchange.js';

// Constructor IDs (must match the ones in auth-key-exchange.ts)
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

const VECTOR_CID = 0x1cb5c415;

// ─── Test Helpers ──────────────────────────────────────────────────────

/**
 * A known 2048-bit safe prime used by Telegram.
 */
const KNOWN_DH_PRIME = BigInt(
  '0x' +
  'C71CAEB9C6B1C9048E6C522F70F13F73980D40238E3E21C14934D037563D930F' +
  '48198A0AA7C14058229493D22530F4DBFA336F6E0AC925139543AED44CCE7C37' +
  '20FD51F69458705AC68CD4FE6B6B13ABDC9746512969328454F18FAF8C595F64' +
  '2477FE96BB2A941D5BCD1D4AC8CC49880708FA9B378E3C4F3A9060BEE67CF9A4' +
  'A4A695811051907E162753B56B0F6B410DBA74D8A84B2A14B3144E0EF1284754' +
  'FD17ED950D5965B4B9DD46582DB1178D169C6BC465B0D6FF9CA3928FEF5B9AE4' +
  'E418FC15E83EBEA0F87FA9FF5EED70050DED2849F47BF959D956850CE929851F' +
  '0D8115F635B105EE2E4E15D04B2454BF6F4FADF034B10403119CD8E3B92FCC5B',
);

const G = 3;

function bigintToBytes(value: bigint): Buffer {
  if (value === 0n) return Buffer.alloc(1, 0);
  const hex = value.toString(16);
  const paddedHex = hex.length % 2 === 0 ? hex : '0' + hex;
  return Buffer.from(paddedHex, 'hex');
}

function bytesToBigint(buf: Buffer): bigint {
  if (buf.length === 0) return 0n;
  return BigInt('0x' + buf.toString('hex'));
}

function bigintToFixedBuffer(value: bigint, length: number): Buffer {
  const hex = value.toString(16).padStart(length * 2, '0');
  return Buffer.from(hex, 'hex');
}

// A mock RSA key pair for testing
// We use a large N so rsaPad always succeeds quickly (val < n is likely)
const MOCK_RSA_N = BigInt(
  '0x' + 'FF'.repeat(256), // Maximum 2048-bit value — val < n almost always true
);
const MOCK_RSA_E = 65537n;
const MOCK_RSA_FINGERPRINT = -3414540481677787639n;

interface MockServerState {
  nonce: Buffer;
  serverNonce: Buffer;
  newNonce: Buffer;
  a: bigint; // server's DH secret
  authKey: Buffer | null;
}

interface MockServerOptions {
  badNonce?: boolean;
  badServerNonceInDhInner?: boolean;
  badDhPrime?: boolean;
  badGa?: boolean;
  dhGenResult?: 'ok' | 'retry' | 'fail';
  retryThenOk?: boolean;
}

/**
 * Create a mock server that follows the MTProto auth key exchange protocol.
 * The newNonce is provided by the test via _testNewNonce on the AuthKeyExchange.
 * The mock server needs to know it to encrypt the DH inner data.
 */
function createMockServer(
  testNonce: Buffer,
  testNewNonce: Buffer,
  options?: MockServerOptions,
): { send: SendFunction; state: MockServerState } {
  const serverNonce = randomBytes(16);
  const a = bytesToBigint(randomBytes(256)); // server's DH private key

  const state: MockServerState = {
    nonce: testNonce,
    serverNonce,
    newNonce: testNewNonce,
    a,
    authKey: null,
  };

  let step = 0;
  let retryCount = 0;

  const send: SendFunction = async (data: Buffer): Promise<Buffer> => {
    const reader = new TLReader(data);
    const cid = reader.readConstructorId();

    if (cid === CID.req_pq_multi && step === 0) {
      step = 1;
      const clientNonce = reader.readInt128();

      const responseNonce = options?.badNonce ? randomBytes(16) : clientNonce;

      // PQ = p * q (use small known factorizable composite)
      const p = 1000003n;
      const q = 1000033n;
      const pq = p * q;
      const pqBytes = bigintToBytes(pq);

      const w = new TLWriter(256);
      w.writeConstructorId(CID.resPQ);
      w.writeInt128(responseNonce);
      w.writeInt128(serverNonce);
      w.writeBytes(pqBytes);
      // Fingerprints vector
      w.writeUInt32(VECTOR_CID);
      w.writeInt32(1);
      w.writeInt64(MOCK_RSA_FINGERPRINT);

      return w.toBuffer();
    } else if (cid === CID.req_DH_params && step === 1) {
      step = 2;

      const clientNonce = reader.readInt128();
      if (!crypto.timingSafeEqual(clientNonce, state.nonce)) {
        throw new Error('Mock server: nonce mismatch in req_DH_params');
      }

      // Read but skip the rest - we don't decrypt RSA in the mock
      reader.readInt128(); // server_nonce
      reader.readBytes(); // p
      reader.readBytes(); // q
      reader.readInt64();  // fingerprint
      reader.readBytes(); // encrypted_data

      const { key: tmpKey, iv: tmpIv } = deriveTmpAesKeyIv(testNewNonce, serverNonce);

      // Build server_DH_inner_data
      const dhPrime = options?.badDhPrime ? 123456789n : KNOWN_DH_PRIME;

      let ga: bigint;
      if (options?.badGa) {
        ga = 1n; // obviously bad g_a
      } else {
        ga = modPow(BigInt(G), a, KNOWN_DH_PRIME);
      }

      const serverTime = Math.floor(Date.now() / 1000);

      const innerWriter = new TLWriter(1024);
      innerWriter.writeConstructorId(CID.server_DH_inner_data);
      innerWriter.writeInt128(
        options?.badServerNonceInDhInner ? randomBytes(16) : state.nonce,
      );
      innerWriter.writeInt128(serverNonce);
      innerWriter.writeInt32(G);
      innerWriter.writeBytes(bigintToBytes(dhPrime));
      innerWriter.writeBytes(bigintToBytes(ga));
      innerWriter.writeInt32(serverTime);

      const innerData = innerWriter.toBuffer();
      const innerHash = sha1(innerData);

      // Pad to 16 bytes
      const unpadded = innerHash.length + innerData.length;
      const paddingLen = (16 - (unpadded % 16)) % 16;
      const padding = randomBytes(paddingLen);
      const toEncrypt = Buffer.concat([innerHash, innerData, padding]);

      const encrypted = aesIgeEncrypt(toEncrypt, tmpKey, tmpIv);

      const respWriter = new TLWriter(512);
      respWriter.writeConstructorId(CID.server_DH_params_ok);
      respWriter.writeInt128(state.nonce);
      respWriter.writeInt128(serverNonce);
      respWriter.writeBytes(encrypted);

      return respWriter.toBuffer();
    } else if (cid === CID.set_client_DH_params && step === 2) {
      const clientNonce = reader.readInt128();
      if (!crypto.timingSafeEqual(clientNonce, state.nonce)) {
        throw new Error('Mock server: nonce mismatch in set_client_DH_params');
      }

      reader.readInt128(); // server_nonce
      const encryptedData = reader.readBytes();

      // Decrypt client_DH_inner_data
      const { key: tmpKey, iv: tmpIv } = deriveTmpAesKeyIv(testNewNonce, serverNonce);
      const decrypted = aesIgeDecrypt(encryptedData, tmpKey, tmpIv);

      // Parse: SHA1(20) + client_DH_inner_data
      const innerReader = new TLReader(decrypted.subarray(20));
      const innerCid = innerReader.readConstructorId();
      if (innerCid !== CID.client_DH_inner_data) {
        throw new Error('Mock server: bad client_DH_inner_data CID');
      }

      innerReader.readInt128(); // nonce
      innerReader.readInt128(); // server_nonce
      innerReader.readInt64();  // retry_id
      const gbBytes = innerReader.readBytes();
      const gb = bytesToBigint(gbBytes);

      // Compute auth_key = pow(g_b, a, dh_prime)
      const authKey = bigintToFixedBuffer(modPow(gb, a, KNOWN_DH_PRIME), 256);
      state.authKey = authKey;

      const authKeySha1 = sha1(authKey);

      let dhGenResult = options?.dhGenResult ?? 'ok';
      if (options?.retryThenOk) {
        retryCount++;
        if (retryCount === 1) {
          dhGenResult = 'retry';
        } else {
          dhGenResult = 'ok';
        }
      }

      const respWriter = new TLWriter(256);

      if (dhGenResult === 'ok') {
        const hash = sha1(Buffer.concat([testNewNonce, Buffer.from([0x01]), authKeySha1]));
        respWriter.writeConstructorId(CID.dh_gen_ok);
        respWriter.writeInt128(state.nonce);
        respWriter.writeInt128(serverNonce);
        respWriter.writeInt128(hash.subarray(4, 20));
      } else if (dhGenResult === 'retry') {
        const hash = sha1(Buffer.concat([testNewNonce, Buffer.from([0x02]), authKeySha1]));
        respWriter.writeConstructorId(CID.dh_gen_retry);
        respWriter.writeInt128(state.nonce);
        respWriter.writeInt128(serverNonce);
        respWriter.writeInt128(hash.subarray(4, 20));
      } else {
        const hash = sha1(Buffer.concat([testNewNonce, Buffer.from([0x03]), authKeySha1]));
        respWriter.writeConstructorId(CID.dh_gen_fail);
        respWriter.writeInt128(state.nonce);
        respWriter.writeInt128(serverNonce);
        respWriter.writeInt128(hash.subarray(4, 20));
      }

      return respWriter.toBuffer();
    }

    throw new Error(`Mock server: unexpected CID 0x${cid.toString(16).padStart(8, '0')} at step ${step}`);
  };

  return { send, state };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('deriveTmpAesKeyIv', () => {
  it('should derive 32-byte key and 32-byte IV', () => {
    const newNonce = randomBytes(32);
    const serverNonce = randomBytes(16);

    const { key, iv } = deriveTmpAesKeyIv(newNonce, serverNonce);

    expect(key.length).toBe(32);
    expect(iv.length).toBe(32);
  });

  it('should produce deterministic output for the same inputs', () => {
    const newNonce = Buffer.alloc(32, 0xAA);
    const serverNonce = Buffer.alloc(16, 0xBB);

    const result1 = deriveTmpAesKeyIv(newNonce, serverNonce);
    const result2 = deriveTmpAesKeyIv(newNonce, serverNonce);

    expect(result1.key).toEqual(result2.key);
    expect(result1.iv).toEqual(result2.iv);
  });

  it('should produce correct key from known vectors', () => {
    const newNonce = Buffer.alloc(32, 0x01);
    const serverNonce = Buffer.alloc(16, 0x02);

    const hash1 = sha1(Buffer.concat([newNonce, serverNonce]));
    const hash2 = sha1(Buffer.concat([serverNonce, newNonce]));
    const hash3 = sha1(Buffer.concat([newNonce, newNonce]));

    const expectedKey = Buffer.concat([hash1, hash2.subarray(0, 12)]);
    const expectedIv = Buffer.concat([
      hash2.subarray(12, 20),
      hash3,
      newNonce.subarray(0, 4),
    ]);

    const { key, iv } = deriveTmpAesKeyIv(newNonce, serverNonce);

    expect(key).toEqual(expectedKey);
    expect(iv).toEqual(expectedIv);
  });

  it('should produce different outputs for different inputs', () => {
    const newNonce1 = Buffer.alloc(32, 0x01);
    const newNonce2 = Buffer.alloc(32, 0x02);
    const serverNonce = Buffer.alloc(16, 0xFF);

    const result1 = deriveTmpAesKeyIv(newNonce1, serverNonce);
    const result2 = deriveTmpAesKeyIv(newNonce2, serverNonce);

    expect(result1.key).not.toEqual(result2.key);
    expect(result1.iv).not.toEqual(result2.iv);
  });
});

describe('computeServerSalt', () => {
  it('should XOR first 8 bytes of new_nonce and server_nonce', () => {
    const newNonce = Buffer.alloc(32, 0);
    const serverNonce = Buffer.alloc(16, 0);

    expect(computeServerSalt(newNonce, serverNonce)).toBe(0n);
  });

  it('should produce correct salt with known values', () => {
    const newNonce = Buffer.alloc(32, 0xFF);
    const serverNonce = Buffer.alloc(16, 0x00);

    // 0xFF XOR 0x00 = 0xFF for all 8 bytes
    // As little-endian int64: -1n
    const salt = computeServerSalt(newNonce, serverNonce);
    expect(salt).toBe(-1n);
  });

  it('should XOR correctly with mixed values', () => {
    const newNonce = Buffer.alloc(32, 0);
    const serverNonce = Buffer.alloc(16, 0);

    newNonce[0] = 0xAB;
    newNonce[1] = 0xCD;
    serverNonce[0] = 0x12;
    serverNonce[1] = 0x34;

    const expected = Buffer.alloc(8, 0);
    expected[0] = 0xAB ^ 0x12;
    expected[1] = 0xCD ^ 0x34;
    const expectedSalt = expected.readBigInt64LE(0);

    expect(computeServerSalt(newNonce, serverNonce)).toBe(expectedSalt);
  });
});

describe('AuthKeyExchange', () => {
  describe('nonce verification', () => {
    it('should throw when resPQ nonce does not match', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send } = createMockServer(testNonce, testNewNonce, { badNonce: true });

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      await expect(exchange.execute()).rejects.toThrow('Nonce mismatch in resPQ');
    });

    it('should throw when server_DH_inner_data has wrong nonce', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send } = createMockServer(testNonce, testNewNonce, {
        badServerNonceInDhInner: true,
      });

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      await expect(exchange.execute()).rejects.toThrow(/[Nn]once mismatch/);
    });
  });

  describe('DH parameter validation', () => {
    it('should throw when DH prime is bad', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send } = createMockServer(testNonce, testNewNonce, { badDhPrime: true });

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      await expect(exchange.execute()).rejects.toThrow('DH prime validation failed');
    });

    it('should throw when g_a is bad', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send } = createMockServer(testNonce, testNewNonce, { badGa: true });

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      await expect(exchange.execute()).rejects.toThrow('g_a validation failed');
    });
  });

  describe('RSA key matching', () => {
    it('should throw when no RSA key matches server fingerprints', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send } = createMockServer(testNonce, testNewNonce);

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: 999n, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      await expect(exchange.execute()).rejects.toThrow('No matching RSA key found');
    });
  });

  describe('dh_gen_fail handling', () => {
    it('should throw on dh_gen_fail', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send } = createMockServer(testNonce, testNewNonce, { dhGenResult: 'fail' });

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      await expect(exchange.execute()).rejects.toThrow('DH key exchange failed (dh_gen_fail)');
    });
  });

  describe('dh_gen_retry handling', () => {
    it('should retry on dh_gen_retry and succeed on next attempt', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send } = createMockServer(testNonce, testNewNonce, { retryThenOk: true });

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      const result = await exchange.execute();

      expect(result.authKey).toBeInstanceOf(Buffer);
      expect(result.authKey.length).toBe(256);
      expect(result.authKeyId).toBeInstanceOf(Buffer);
      expect(result.authKeyId.length).toBe(8);
    });
  });

  describe('full successful exchange', () => {
    it('should complete a full auth key exchange with mocked server', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send, state } = createMockServer(testNonce, testNewNonce);

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      const result = await exchange.execute();

      // Validate auth key
      expect(result.authKey).toBeInstanceOf(Buffer);
      expect(result.authKey.length).toBe(256);

      // Validate auth key ID = SHA1(auth_key)[12:20]
      const expectedAuthKeyId = sha1(result.authKey).subarray(12, 20);
      expect(result.authKeyId).toEqual(expectedAuthKeyId);

      // Validate time offset is small (since mock server uses current time)
      expect(Math.abs(result.timeOffset)).toBeLessThan(5);

      // Validate server salt = XOR of first 8 bytes of new_nonce and server_nonce
      const expectedSalt = computeServerSalt(testNewNonce, state.serverNonce);
      expect(result.serverSalt).toBe(expectedSalt);

      // Validate that the server computed the same auth key
      expect(result.authKey).toEqual(state.authKey);
    });

    it('should produce consistent auth key ID', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const { send } = createMockServer(testNonce, testNewNonce);

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      const result = await exchange.execute();

      // auth_key_id must be exactly sha1(auth_key)[12:20]
      const sha1Hash = sha1(result.authKey);
      expect(result.authKeyId).toEqual(sha1Hash.subarray(12, 20));
      expect(result.authKeyId.length).toBe(8);
    });
  });

  describe('PQ factorization step', () => {
    it('should correctly factor known PQ values', () => {
      const p = 1000003n;
      const q = 1000033n;
      const pq = p * q;

      const [factorP, factorQ] = factorizePQ(pq);

      expect(factorP).toBe(p);
      expect(factorQ).toBe(q);
    });
  });

  describe('key derivation for inner encryption', () => {
    it('should produce AES key/iv that can encrypt then decrypt', () => {
      const newNonce = randomBytes(32);
      const serverNonce = randomBytes(16);

      const { key, iv } = deriveTmpAesKeyIv(newNonce, serverNonce);

      const data = Buffer.alloc(32, 0x42);
      const encrypted = aesIgeEncrypt(data, key, iv);
      const decrypted = aesIgeDecrypt(encrypted, key, iv);

      expect(decrypted).toEqual(data);
    });

    it('should match the MTProto specification formula', () => {
      const newNonce = crypto.randomBytes(32);
      const serverNonce = crypto.randomBytes(16);

      const sha1_a = sha1(Buffer.concat([newNonce, serverNonce]));
      const sha1_b = sha1(Buffer.concat([serverNonce, newNonce]));
      const sha1_c = sha1(Buffer.concat([newNonce, newNonce]));

      const specKey = Buffer.concat([sha1_a, sha1_b.subarray(0, 12)]);
      const specIv = Buffer.concat([
        sha1_b.subarray(12, 20),
        sha1_c,
        newNonce.subarray(0, 4),
      ]);

      const { key, iv } = deriveTmpAesKeyIv(newNonce, serverNonce);

      expect(key).toEqual(specKey);
      expect(iv).toEqual(specIv);
    });
  });

  describe('TL serialization', () => {
    it('should serialize req_pq_multi correctly', () => {
      const nonce = randomBytes(16);
      const w = new TLWriter(64);
      w.writeConstructorId(CID.req_pq_multi);
      w.writeInt128(nonce);

      const buf = w.toBuffer();
      const r = new TLReader(buf);

      expect(r.readConstructorId()).toBe(CID.req_pq_multi);
      expect(r.readInt128()).toEqual(nonce);
    });

    it('should serialize p_q_inner_data_dc correctly', () => {
      const pq = bigintToBytes(1000003n * 1000033n);
      const p = bigintToBytes(1000003n);
      const q = bigintToBytes(1000033n);
      const nonce = randomBytes(16);
      const serverNonce = randomBytes(16);
      const newNonce = randomBytes(32);

      const w = new TLWriter(256);
      w.writeConstructorId(CID.p_q_inner_data_dc);
      w.writeBytes(pq);
      w.writeBytes(p);
      w.writeBytes(q);
      w.writeInt128(nonce);
      w.writeInt128(serverNonce);
      w.writeInt256(newNonce);
      w.writeInt32(2);

      const buf = w.toBuffer();
      const r = new TLReader(buf);

      expect(r.readConstructorId()).toBe(CID.p_q_inner_data_dc);
      expect(bytesToBigint(r.readBytes())).toBe(1000003n * 1000033n);
      expect(bytesToBigint(r.readBytes())).toBe(1000003n);
      expect(bytesToBigint(r.readBytes())).toBe(1000033n);
      expect(r.readInt128()).toEqual(nonce);
      expect(r.readInt128()).toEqual(serverNonce);
      expect(r.readInt256()).toEqual(newNonce);
      expect(r.readInt32()).toBe(2);
    });

    it('should serialize client_DH_inner_data correctly', () => {
      const nonce = randomBytes(16);
      const serverNonce = randomBytes(16);
      const retryId = 42n;
      const gb = bigintToBytes(modPow(3n, 100n, KNOWN_DH_PRIME));

      const w = new TLWriter(512);
      w.writeConstructorId(CID.client_DH_inner_data);
      w.writeInt128(nonce);
      w.writeInt128(serverNonce);
      w.writeInt64(retryId);
      w.writeBytes(gb);

      const buf = w.toBuffer();
      const r = new TLReader(buf);

      expect(r.readConstructorId()).toBe(CID.client_DH_inner_data);
      expect(r.readInt128()).toEqual(nonce);
      expect(r.readInt128()).toEqual(serverNonce);
      expect(r.readInt64()).toBe(retryId);
      const readGb = r.readBytes();
      expect(bytesToBigint(readGb)).toBe(modPow(3n, 100n, KNOWN_DH_PRIME));
    });
  });

  describe('error cases', () => {
    it('should throw on unexpected constructor ID in resPQ position', async () => {
      const send: SendFunction = async () => {
        const w = new TLWriter(64);
        w.writeConstructorId(0xDEADBEEF);
        w.writeInt128(randomBytes(16));
        w.writeInt128(randomBytes(16));
        return w.toBuffer();
      };

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
      });

      await expect(exchange.execute()).rejects.toThrow('Expected resPQ');
    });

    it('should throw on unexpected constructor ID in DH gen response', async () => {
      const testNonce = randomBytes(16);
      const testNewNonce = randomBytes(32);
      const serverNonce = randomBytes(16);
      const a = bytesToBigint(randomBytes(256));
      let step = 0;

      const send: SendFunction = async (data: Buffer) => {
        const reader = new TLReader(data);
        const cid = reader.readConstructorId();

        if (cid === CID.req_pq_multi && step === 0) {
          step = 1;
          const clientNonce = reader.readInt128();

          const p = 1000003n;
          const q = 1000033n;
          const pq = p * q;

          const w = new TLWriter(256);
          w.writeConstructorId(CID.resPQ);
          w.writeInt128(clientNonce);
          w.writeInt128(serverNonce);
          w.writeBytes(bigintToBytes(pq));
          w.writeUInt32(VECTOR_CID);
          w.writeInt32(1);
          w.writeInt64(MOCK_RSA_FINGERPRINT);
          return w.toBuffer();
        } else if (cid === CID.req_DH_params && step === 1) {
          step = 2;
          const clientNonce = reader.readInt128();

          reader.readInt128();
          reader.readBytes();
          reader.readBytes();
          reader.readInt64();
          reader.readBytes();

          const { key: tmpKey, iv: tmpIv } = deriveTmpAesKeyIv(testNewNonce, serverNonce);
          const ga = modPow(BigInt(G), a, KNOWN_DH_PRIME);

          const innerWriter = new TLWriter(1024);
          innerWriter.writeConstructorId(CID.server_DH_inner_data);
          innerWriter.writeInt128(clientNonce);
          innerWriter.writeInt128(serverNonce);
          innerWriter.writeInt32(G);
          innerWriter.writeBytes(bigintToBytes(KNOWN_DH_PRIME));
          innerWriter.writeBytes(bigintToBytes(ga));
          innerWriter.writeInt32(Math.floor(Date.now() / 1000));

          const innerData = innerWriter.toBuffer();
          const innerHash = sha1(innerData);
          const unpadded = innerHash.length + innerData.length;
          const paddingLen = (16 - (unpadded % 16)) % 16;
          const toEncrypt = Buffer.concat([innerHash, innerData, randomBytes(paddingLen)]);
          const encrypted = aesIgeEncrypt(toEncrypt, tmpKey, tmpIv);

          const respWriter = new TLWriter(512);
          respWriter.writeConstructorId(CID.server_DH_params_ok);
          respWriter.writeInt128(clientNonce);
          respWriter.writeInt128(serverNonce);
          respWriter.writeBytes(encrypted);
          return respWriter.toBuffer();
        } else if (cid === CID.set_client_DH_params && step === 2) {
          const clientNonce = reader.readInt128();

          const w = new TLWriter(64);
          w.writeConstructorId(0xDEADBEEF);
          w.writeInt128(clientNonce);
          w.writeInt128(serverNonce);
          w.writeInt128(randomBytes(16));
          return w.toBuffer();
        }

        throw new Error('Unexpected');
      };

      const exchange = new AuthKeyExchange({
        send,
        rsaKeys: [{ fingerprint: MOCK_RSA_FINGERPRINT, n: MOCK_RSA_N, e: MOCK_RSA_E }],
        dcId: 2,
        _testNonce: testNonce,
        _testNewNonce: testNewNonce,
      });

      await expect(exchange.execute()).rejects.toThrow('Unexpected DH gen response');
    });
  });
});
