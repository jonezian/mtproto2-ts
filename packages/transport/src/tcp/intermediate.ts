import { Transport } from '../abstract.js';
import { TcpConnection } from './connection.js';

/**
 * Intermediate transport.
 *
 * Init: sends 0xeeeeeeee (4 bytes).
 *
 * Frame format:
 *   - 4 bytes LE: payload length (NOT divided by 4)
 *   - Then the payload bytes
 */
export class IntermediateTransport extends Transport {
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
    this.tcp.write(Buffer.from([0xee, 0xee, 0xee, 0xee]));
    this.emit('connect');
  }

  send(payload: Buffer): void {
    this.tcp.write(this.encodePacket(payload));
  }

  close(): void {
    this.tcp.close();
  }

  encodePacket(payload: Buffer): Buffer {
    const frame = Buffer.alloc(4 + payload.length);
    frame.writeUInt32LE(payload.length, 0);
    payload.copy(frame, 4);
    return frame;
  }

  decodePacket(data: Buffer): Buffer[] {
    if (data.length > 0) {
      this.recvBuf = Buffer.concat([this.recvBuf, data]);
    }

    const results: Buffer[] = [];

    while (this.recvBuf.length >= 4) {
      const payloadLen = this.recvBuf.readUInt32LE(0);
      const totalLen = 4 + payloadLen;

      if (this.recvBuf.length < totalLen) {
        break; // Partial frame
      }

      const payload = Buffer.alloc(payloadLen);
      this.recvBuf.copy(payload, 0, 4, 4 + payloadLen);
      results.push(payload);
      this.recvBuf = this.recvBuf.subarray(totalLen);
    }

    return results;
  }
}
