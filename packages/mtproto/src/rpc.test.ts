import { describe, it, expect, vi, afterEach } from 'vitest';
import { RpcHandler, RpcError } from './rpc.js';

describe('RpcHandler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve promise when handleResult is called', async () => {
    const handler = new RpcHandler();
    const resultData = Buffer.from('result data');

    const promise = handler.register(1n, 'test.method');
    expect(handler.pendingCount).toBe(1);

    const found = handler.handleResult(1n, resultData);
    expect(found).toBe(true);
    expect(handler.pendingCount).toBe(0);

    const result = await promise;
    expect(result).toEqual(resultData);
  });

  it('should reject promise when handleError is called', async () => {
    const handler = new RpcHandler();

    const promise = handler.register(2n, 'test.errorMethod');

    const found = handler.handleError(2n, 400, 'PHONE_NUMBER_INVALID');
    expect(found).toBe(true);

    await expect(promise).rejects.toThrow(RpcError);
    await expect(promise).rejects.toThrow('RPC error 400: PHONE_NUMBER_INVALID');
  });

  it('should reject promise on timeout', async () => {
    vi.useFakeTimers();
    const handler = new RpcHandler();

    const promise = handler.register(3n, 'test.slowMethod', 1000);
    expect(handler.pendingCount).toBe(1);

    vi.advanceTimersByTime(1000);

    await expect(promise).rejects.toThrow('RPC timeout for test.slowMethod');
    expect(handler.pendingCount).toBe(0);
  });

  it('should reject all pending promises on cancelAll', async () => {
    const handler = new RpcHandler();

    const p1 = handler.register(10n, 'method1');
    const p2 = handler.register(20n, 'method2');
    const p3 = handler.register(30n, 'method3');
    expect(handler.pendingCount).toBe(3);

    handler.cancelAll('connection lost');
    expect(handler.pendingCount).toBe(0);

    await expect(p1).rejects.toThrow('connection lost');
    await expect(p2).rejects.toThrow('connection lost');
    await expect(p3).rejects.toThrow('connection lost');
  });

  it('should return false for unknown msgId in handleResult', () => {
    const handler = new RpcHandler();
    const found = handler.handleResult(999n, Buffer.alloc(0));
    expect(found).toBe(false);
  });

  it('should return false for unknown msgId in handleError', () => {
    const handler = new RpcHandler();
    const found = handler.handleError(999n, 500, 'INTERNAL');
    expect(found).toBe(false);
  });

  it('should clear timeout when result arrives before timeout', async () => {
    vi.useFakeTimers();
    const handler = new RpcHandler();

    const promise = handler.register(5n, 'test.fast', 5000);

    // Result arrives after 100ms
    vi.advanceTimersByTime(100);
    handler.handleResult(5n, Buffer.from('ok'));

    const result = await promise;
    expect(result).toEqual(Buffer.from('ok'));

    // Advancing past timeout should not cause issues
    vi.advanceTimersByTime(10000);
    expect(handler.pendingCount).toBe(0);
  });
});
