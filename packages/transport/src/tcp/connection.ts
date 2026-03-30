import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';

/**
 * Low-level TCP connection manager using Node.js `net.Socket`.
 *
 * Emits: 'connect', 'data', 'error', 'close'.
 */
export class TcpConnection extends EventEmitter {
  private socket: Socket | null = null;
  private connected = false;

  constructor() {
    super();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  connect(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new Socket();

      const onError = (err: Error): void => {
        this.connected = false;
        reject(err);
      };

      this.socket.once('error', onError);

      this.socket.connect(port, host, () => {
        this.connected = true;
        this.socket!.removeListener('error', onError);
        this.setupListeners();
        this.emit('connect');
        resolve();
      });
    });
  }

  private setupListeners(): void {
    if (!this.socket) return;

    this.socket.on('data', (data: Buffer) => {
      this.emit('data', data);
    });

    this.socket.on('error', (err: Error) => {
      this.connected = false;
      this.emit('error', err);
    });

    this.socket.on('close', () => {
      this.connected = false;
      this.emit('close');
    });

    this.socket.on('end', () => {
      this.connected = false;
    });
  }

  write(data: Buffer): void {
    if (!this.socket || !this.connected) {
      throw new Error('Socket is not connected');
    }
    this.socket.write(data);
  }

  close(): void {
    if (this.socket) {
      this.connected = false;
      this.socket.destroy();
      this.socket = null;
    }
  }
}
