import { Transport } from '../abstract.js';
import { TcpConnection } from './connection.js';

/**
 * Abridged transport — the simplest MTProto transport.
 *
 * Init: sends 0xef (1 byte).
 *
 * Frame format:
 *   - If payload.length / 4 < 127:  1 byte (length / 4), then payload
 *   - If payload.length / 4 >= 127: 1 byte (0x7f) + 3 bytes LE (length / 4), then payload
 */
export class AbridgedTransport extends Transport {
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

    // Send init byte
    this.tcp.write(Buffer.from([0xef]));
    this.emit('connect');
  }

  send(payload: Buffer): void {
    this.tcp.write(this.encodePacket(payload));
  }

  close(): void {
    this.tcp.close();
  }

  encodePacket(payload: Buffer): Buffer {
    const wordLen = payload.length / 4;

    if (wordLen < 127) {
      const frame = Buffer.alloc(1 + payload.length);
      frame[0] = wordLen;
      payload.copy(frame, 1);
      return frame;
    }

    const frame = Buffer.alloc(4 + payload.length);
    frame[0] = 0x7f;
    frame[1] = wordLen & 0xff;
    frame[2] = (wordLen >> 8) & 0xff;
    frame[3] = (wordLen >> 16) & 0xff;
    payload.copy(frame, 4);
    return frame;
  }

  decodePacket(data: Buffer): Buffer[] {
    if (data.length > 0) {
      this.recvBuf = Buffer.concat([this.recvBuf, data]);
    }

    const results: Buffer[] = [];

    while (this.recvBuf.length > 0) {
      const firstByte = this.recvBuf[0]!;
      let headerSize: number;
      let payloadLen: number;

      if (firstByte < 0x7f) {
        headerSize = 1;
        payloadLen = firstByte * 4;
      } else if (firstByte === 0x7f) {
        if (this.recvBuf.length < 4) {
          break; // Need more data for the header
        }
        headerSize = 4;
        payloadLen =
          (this.recvBuf[1]! | (this.recvBuf[2]! << 8) | (this.recvBuf[3]! << 16)) * 4;
      } else {
        // Invalid first byte
        this.emit('error', new Error(`Invalid abridged length byte: 0x${firstByte.toString(16)}`));
        break;
      }

      const totalLen = headerSize + payloadLen;

      if (this.recvBuf.length < totalLen) {
        break; // Partial frame — wait for more data
      }

      const payload = Buffer.alloc(payloadLen);
      this.recvBuf.copy(payload, 0, headerSize, headerSize + payloadLen);
      results.push(payload);
      this.recvBuf = this.recvBuf.subarray(totalLen);
    }

    return results;
  }
}
