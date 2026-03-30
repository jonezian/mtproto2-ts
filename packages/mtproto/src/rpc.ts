/**
 * RPC call/result/error handling for MTProto.
 *
 * Manages pending RPC calls and resolves them when results arrive.
 *
 * RPC result format (constructor ID 0xf35c6d01):
 *   constructor_id (4 bytes) + req_msg_id (8 bytes) + result (Object)
 *
 * RPC error format (constructor ID 0x2144ca19):
 *   constructor_id (4 bytes) + error_code (4 bytes) + error_message (string)
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export interface PendingRpc {
  msgId: bigint;
  method: string;
  resolve: (result: Buffer) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class RpcError extends Error {
  constructor(
    public readonly errorCode: number,
    public readonly errorMessage: string,
  ) {
    super(`RPC error ${errorCode}: ${errorMessage}`);
    this.name = 'RpcError';
  }
}

export class RpcHandler {
  private pending = new Map<bigint, PendingRpc>();

  /**
   * Register a pending RPC call. Returns a promise that resolves
   * when handleResult is called with the matching reqMsgId, or rejects
   * on error/timeout.
   */
  register(msgId: bigint, method: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.delete(msgId)) {
          reject(new Error(`RPC timeout for ${method} (msgId=${msgId})`));
        }
      }, timeoutMs);

      this.pending.set(msgId, {
        msgId,
        method,
        resolve,
        reject,
        timeout,
      });
    });
  }

  /**
   * Handle an RPC result for a pending call.
   * Returns true if the reqMsgId was found and resolved.
   */
  handleResult(reqMsgId: bigint, resultData: Buffer): boolean {
    const rpc = this.pending.get(reqMsgId);
    if (!rpc) return false;

    clearTimeout(rpc.timeout);
    this.pending.delete(reqMsgId);
    rpc.resolve(resultData);
    return true;
  }

  /**
   * Handle an RPC error for a pending call.
   * Returns true if the reqMsgId was found and rejected.
   */
  handleError(reqMsgId: bigint, errorCode: number, errorMessage: string): boolean {
    const rpc = this.pending.get(reqMsgId);
    if (!rpc) return false;

    clearTimeout(rpc.timeout);
    this.pending.delete(reqMsgId);
    rpc.reject(new RpcError(errorCode, errorMessage));
    return true;
  }

  /**
   * Cancel all pending RPC calls with the given reason.
   */
  cancelAll(reason: string): void {
    for (const [, rpc] of this.pending) {
      clearTimeout(rpc.timeout);
      rpc.reject(new Error(reason));
    }
    this.pending.clear();
  }

  /**
   * Number of pending RPC calls.
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}
