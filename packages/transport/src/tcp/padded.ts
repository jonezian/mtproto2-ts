import { randomBytes } from '@mtproto2/crypto';
import { Transport } from '../abstract.js';
import { TcpConnection } from './connection.js';

/**
 * Padded Intermediate transport.
 *
 * Init: sends 0xdddddddd (4 bytes).
 *
 * Frame format:
 *   - 4 bytes LE: total length (payload + padding)
 *   - Payload bytes
 *   - Random padding (0-15 bytes) so that (payload + padding) is 16-byte aligned
 *
 * The length field records payload + padding, NOT including the 4-byte header.
 */
export class PaddedIntermediateTransport extends Transport {
  private tcp: TcpConnection;
  private recvBuf = Buffer.alloc(0);

  constructor() {
    super();
    this.tcp = new TcpConnection();
  }

  get isConnected(): boolean {
    return this.tcp.isConnected;
  }

  async connect(host: string, port: number): Promise<void> {
    await this.tcp.connect(host, port);

    this.tcp.on('data', (data: Buffer) => {
      this.recvBuf = Buffer.concat([this.recvBuf, data]);
      const frames = this.decodePacket(Buffer.alloc(0));
      for (const frame of frames) {
        this.emit('data', frame);
      }
    });

    this.tcp.on('error', (err: Error) => this.emit('error', err));
    this.tcp.on('close', () => this.emit('close'));

    // Send init bytes
    this.tcp.write(Buffer.from([0xdd, 0xdd, 0xdd, 0xdd]));
    this.emit('connect');
  }

  send(payload: Buffer): void {
    this.tcp.write(this.encodePacket(payload));
  }

  close(): void {
    this.tcp.close();
  }

  encodePacket(payload: Buffer): Buffer {
    const paddingLen = (16 - (payload.length % 16)) % 16;
    const totalDataLen = payload.length + paddingLen;
    const frame = Buffer.alloc(4 + totalDataLen);
    frame.writeUInt32LE(totalDataLen, 0);
    payload.copy(frame, 4);
    if (paddingLen > 0) {
      const padding = randomBytes(paddingLen);
      padding.copy(frame, 4 + payload.length);
    }
    return frame;
  }

  decodePacket(data: Buffer): Buffer[] {
    if (data.length > 0) {
      this.recvBuf = Buffer.concat([this.recvBuf, data]);
    }

    const results: Buffer[] = [];

    while (this.recvBuf.length >= 4) {
      const totalDataLen = this.recvBuf.readUInt32LE(0);
      const totalLen = 4 + totalDataLen;

      if (this.recvBuf.length < totalLen) {
        break; // Partial frame
      }

      // The payload is the data minus the padding.
      // totalDataLen is divisible by 16 (payload + padding).
      // We need to know the actual payload size. Since the payload length
      // is always divisible by 4 (TL serialization), and padding is 0-15 bytes,
      // the payload is the portion that IS divisible by 4. But totalDataLen is
      // also divisible by 16. We cannot know the exact payload size from the
      // frame alone — the server includes the full padded block.
      //
      // Per Telegram docs: the payload length is always a multiple of 4,
      // and the total (payload + padding) is a multiple of 16.
      // When DECODING, the entire totalDataLen block is consumed. The receiver
      // must know the message structure to determine the real payload length.
      //
      // In practice for MTProto messages, the payload is self-describing
      // (contains its own length in the encrypted/unencrypted message format).
      // So we pass the full data block (including padding) and let the upper
      // layer trim it.
      const payload = Buffer.alloc(totalDataLen);
      this.recvBuf.copy(payload, 0, 4, 4 + totalDataLen);
      results.push(payload);
      this.recvBuf = this.recvBuf.subarray(totalLen);
    }

    return results;
  }
}
