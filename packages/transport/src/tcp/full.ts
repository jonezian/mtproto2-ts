import { Transport } from '../abstract.js';
import { TcpConnection } from './connection.js';
import { crc32 } from '../crc32.js';

/**
 * Full transport — includes sequence numbers and CRC32 verification.
 *
 * No init bytes needed.
 *
 * Frame format:
 *   - 4 bytes LE: total length (12 + payload.length)
 *   - 4 bytes LE: sequence number (starts at 0, incremented per packet sent)
 *   - Payload bytes
 *   - 4 bytes LE: CRC32 of everything before the CRC32
 */
export class FullTransport extends Transport {
  private tcp: TcpConnection;
  private recvBuf = Buffer.alloc(0);
  private sendSeq = 0;
  private recvSeq = 0;

  constructor() {
    super();
    this.tcp = new TcpConnection();
  }

  get isConnected(): boolean {
    return this.tcp.isConnected;
  }

  async connect(host: string, port: number): Promise<void> {
    this.sendSeq = 0;
    this.recvSeq = 0;

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

    // No init bytes for Full transport
    this.emit('connect');
  }

  send(payload: Buffer): void {
    this.tcp.write(this.encodePacket(payload));
  }

  close(): void {
    this.tcp.close();
  }

  encodePacket(payload: Buffer): Buffer {
    const totalLen = 12 + payload.length; // 4 (len) + 4 (seq) + payload + 4 (crc)
    const frame = Buffer.alloc(totalLen);

    frame.writeUInt32LE(totalLen, 0);
    frame.writeUInt32LE(this.sendSeq, 4);
    payload.copy(frame, 8);

    // CRC32 of everything before the CRC32 field
    const crcValue = crc32(frame.subarray(0, totalLen - 4));
    frame.writeUInt32LE(crcValue, totalLen - 4);

    this.sendSeq++;
    return frame;
  }

  decodePacket(data: Buffer): Buffer[] {
    if (data.length > 0) {
      this.recvBuf = Buffer.concat([this.recvBuf, data]);
    }

    const results: Buffer[] = [];

    while (this.recvBuf.length >= 12) {
      const totalLen = this.recvBuf.readUInt32LE(0);

      if (totalLen < 12) {
        this.emit('error', new Error(`Invalid full transport frame length: ${totalLen}`));
        this.recvBuf = Buffer.alloc(0);
        break;
      }

      if (this.recvBuf.length < totalLen) {
        break; // Partial frame
      }

      // Verify CRC32
      const frameCrc = this.recvBuf.readUInt32LE(totalLen - 4);
      const computedCrc = crc32(this.recvBuf.subarray(0, totalLen - 4));

      if (frameCrc !== computedCrc) {
        this.emit(
          'error',
          new Error(
            `CRC32 mismatch: expected 0x${computedCrc.toString(16).padStart(8, '0')}, ` +
              `got 0x${frameCrc.toString(16).padStart(8, '0')}`,
          ),
        );
        this.recvBuf = this.recvBuf.subarray(totalLen);
        continue;
      }

      // Verify sequence number
      const seq = this.recvBuf.readUInt32LE(4);
      if (seq !== this.recvSeq) {
        this.emit(
          'error',
          new Error(`Sequence number mismatch: expected ${this.recvSeq}, got ${seq}`),
        );
      }
      this.recvSeq++;

      // Extract payload: bytes 8 to totalLen - 4
      const payloadLen = totalLen - 12;
      const payload = Buffer.alloc(payloadLen);
      this.recvBuf.copy(payload, 0, 8, 8 + payloadLen);
      results.push(payload);

      this.recvBuf = this.recvBuf.subarray(totalLen);
    }

    return results;
  }
}
