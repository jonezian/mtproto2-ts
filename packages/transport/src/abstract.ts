import { EventEmitter } from 'node:events';

export interface TransportEvents {
  data: (payload: Buffer) => void;
  error: (err: Error) => void;
  close: () => void;
  connect: () => void;
}

/**
 * Abstract base class for MTProto transport protocols.
 *
 * Each transport defines its own framing format and must handle
 * TCP stream buffering (partial reads / concatenated frames).
 */
export abstract class Transport extends EventEmitter {
  /** Connect to a Telegram server. */
  abstract connect(host: string, port: number): Promise<void>;

  /** Send an already-framed payload over the connection. */
  abstract send(payload: Buffer): void;

  /** Close the connection. */
  abstract close(): void;

  /** Whether the transport is currently connected. */
  abstract get isConnected(): boolean;

  /**
   * Encode a message payload into the transport frame.
   * The returned buffer includes length headers / CRC / etc.
   */
  abstract encodePacket(payload: Buffer): Buffer;

  /**
   * Decode received data from transport frames.
   * Must handle partial reads (TCP stream buffering).
   * Returns an array of decoded payloads (may be empty if data is incomplete).
   */
  abstract decodePacket(data: Buffer): Buffer[];
}
