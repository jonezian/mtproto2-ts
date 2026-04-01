import { AesCtr, randomBytes } from '@mtproto2/crypto';
import { Transport } from '../abstract.js';
import { TcpConnection } from './connection.js';

/**
 * Magic bytes for each transport protocol (used in obfuscated init).
 */
export const TRANSPORT_MAGIC = {
  abridged: 0xefefefef,
  intermediate: 0xeeeeeeee,
  padded: 0xdddddddd,
} as const;

export type TransportMagicName = keyof typeof TRANSPORT_MAGIC;

/**
 * Banned 4-byte prefixes for the obfuscated init (these look like HTTP/TLS).
 */
const BANNED_FIRST_BYTES = new Set([
  0x44414548, // HEAD
  0x54534f50, // POST
  0x20544547, // GET
  0x4954504f, // OPTI
  0xdddddddd, // padded intermediate magic
  0xeeeeeeee, // intermediate magic
  0x02010316, // TLS
]);

/**
 * Generate the 64-byte obfuscation init payload.
 *
 * Returns { initBytes, encryptor, decryptor } where initBytes is the
 * 64-byte buffer to send as the first message, and encryptor/decryptor
 * are AES-CTR ciphers for subsequent traffic.
 */
export function generateObfuscatedInit(
  magic: number,
): { initBytes: Buffer; encryptor: AesCtr; decryptor: AesCtr } {
  let initBytes: Buffer;

  // Keep generating until we get a valid init
  for (;;) {
    initBytes = randomBytes(64);

    // bytes[0] must not be 0xef
    if (initBytes[0] === 0xef) continue;

    // First 4 bytes must not match any banned pattern
    const first4 = initBytes.readUInt32BE(0);
    if (BANNED_FIRST_BYTES.has(first4)) continue;

    // bytes[4:8] must not be 0x00000000
    const second4 = initBytes.readUInt32LE(4);
    if (second4 === 0x00000000) continue;

    break;
  }

  // Encrypt key = bytes[8:40], encrypt IV = bytes[40:56]
  const encryptKey = Buffer.alloc(32);
  initBytes.copy(encryptKey, 0, 8, 40);
  const encryptIv = Buffer.alloc(16);
  initBytes.copy(encryptIv, 0, 40, 56);

  // Reversed bytes[8:56] => reversed buffer
  const toReverse = Buffer.alloc(48);
  initBytes.copy(toReverse, 0, 8, 56);
  const reversed = Buffer.from(toReverse).reverse();

  // Decrypt key = reversed[0:32], decrypt IV = reversed[32:48]
  const decryptKey = Buffer.alloc(32);
  reversed.copy(decryptKey, 0, 0, 32);
  const decryptIv = Buffer.alloc(16);
  reversed.copy(decryptIv, 0, 32, 48);

  // Create AES-CTR ciphers
  const encryptor = new AesCtr(encryptKey, encryptIv);
  const decryptor = new AesCtr(decryptKey, decryptIv);

  // Write transport magic into plaintext initBytes BEFORE encryption
  const magicBuf = Buffer.alloc(4);
  magicBuf.writeUInt32LE(magic, 0);
  magicBuf.copy(initBytes, 56);

  // Encrypt the 64 bytes (including magic) with the encrypt cipher
  const encrypted = encryptor.encrypt(initBytes);

  // Overwrite initBytes[56:64] with encrypted[56:64]
  // Bytes 0:55 remain plaintext (contain keys), bytes 56:64 are encrypted (contain magic)
  encrypted.copy(initBytes, 56, 56, 64);

  return { initBytes, encryptor, decryptor };
}

/**
 * Obfuscated transport wrapper.
 *
 * Wraps any transport to apply AES-256-CTR obfuscation, making the
 * protocol undetectable by DPI (deep packet inspection).
 */
export class ObfuscatedTransport extends Transport {
  private innerTransport: Transport;
  private tcp: TcpConnection;
  private encryptor: AesCtr | null = null;
  private decryptor: AesCtr | null = null;
  private magic: number;

  constructor(innerTransport: Transport, magic?: TransportMagicName | number) {
    super();
    this.innerTransport = innerTransport;

    if (typeof magic === 'string') {
      this.magic = TRANSPORT_MAGIC[magic];
    } else if (typeof magic === 'number') {
      this.magic = magic;
    } else {
      // Default: detect from inner transport class name
      this.magic = TRANSPORT_MAGIC.intermediate;
    }

    this.tcp = new TcpConnection();
  }

  get isConnected(): boolean {
    return this.tcp.isConnected;
  }

  async connect(host: string, port: number): Promise<void> {
    await this.tcp.connect(host, port);

    const { initBytes, encryptor, decryptor } = generateObfuscatedInit(this.magic);
    this.encryptor = encryptor;
    this.decryptor = decryptor;

    this.tcp.on('data', (data: Buffer) => {
      const decrypted = this.decryptor!.decrypt(data);
      const frames = this.innerTransport.decodePacket(decrypted);
      for (const frame of frames) {
        this.emit('data', frame);
      }
    });

    this.tcp.on('error', (err: Error) => this.emit('error', err));
    this.tcp.on('close', () => this.emit('close'));

    // Send the 64-byte init
    this.tcp.write(initBytes);
    this.emit('connect');
  }

  send(payload: Buffer): void {
    const framed = this.encodePacket(payload);
    this.tcp.write(framed);
  }

  close(): void {
    this.tcp.close();
  }

  encodePacket(payload: Buffer): Buffer {
    // Frame with the inner transport, then encrypt
    const framed = this.innerTransport.encodePacket(payload);
    return this.encryptor!.encrypt(framed);
  }

  decodePacket(data: Buffer): Buffer[] {
    // Decrypt, then decode with inner transport
    const decrypted = this.decryptor!.decrypt(data);
    return this.innerTransport.decodePacket(decrypted);
  }
}
