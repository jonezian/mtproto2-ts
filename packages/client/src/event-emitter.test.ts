import { describe, it, expect, vi } from 'vitest';
import { TypedEventEmitter } from './event-emitter.js';

type TestEvents = {
  'data': (payload: Buffer) => void;
  'error': (err: Error) => void;
  'close': () => void;
  'count': (n: number) => void;
};

class TestEmitter extends TypedEventEmitter<TestEvents> {}

describe('TypedEventEmitter', () => {
  describe('on / emit', () => {
    it('should emit and receive events', () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.on('close', handler);
      emitter.emit('close');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should pass arguments to the listener', () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.on('count', handler);
      emitter.emit('count', 42);
      expect(handler).toHaveBeenCalledWith(42);
    });

    it('should pass Buffer payloads correctly', () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      const buf = Buffer.from([0xAA, 0xBB]);
      emitter.on('data', handler);
      emitter.emit('data', buf);
      expect(handler).toHaveBeenCalledWith(buf);
    });

    it('should pass Error payloads correctly', () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      const err = new Error('test error');
      emitter.on('error', handler);
      emitter.emit('error', err);
      expect(handler).toHaveBeenCalledWith(err);
    });

    it('should support multiple listeners for the same event', () => {
      const emitter = new TestEmitter();
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      emitter.on('close', handler1);
      emitter.on('close', handler2);
      emitter.emit('close');
      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('should call listeners in order of registration', () => {
      const emitter = new TestEmitter();
      const order: number[] = [];
      emitter.on('close', () => order.push(1));
      emitter.on('close', () => order.push(2));
      emitter.on('close', () => order.push(3));
      emitter.emit('close');
      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('off', () => {
    it('should remove a specific listener', () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.on('close', handler);
      emitter.off('close', handler);
      emitter.emit('close');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not affect other listeners when removing one', () => {
      const emitter = new TestEmitter();
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      emitter.on('count', handler1);
      emitter.on('count', handler2);
      emitter.off('count', handler1);
      emitter.emit('count', 5);
      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith(5);
    });
  });

  describe('once', () => {
    it('should fire a listener only once', () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.once('close', handler);
      emitter.emit('close');
      emitter.emit('close');
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should pass arguments when using once', () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.once('count', handler);
      emitter.emit('count', 99);
      expect(handler).toHaveBeenCalledWith(99);
    });
  });

  describe('emit return value', () => {
    it('should return true when there are listeners', () => {
      const emitter = new TestEmitter();
      emitter.on('close', () => {});
      expect(emitter.emit('close')).toBe(true);
    });

    it('should return false when there are no listeners', () => {
      const emitter = new TestEmitter();
      expect(emitter.emit('close')).toBe(false);
    });
  });

  describe('inheritance', () => {
    it('should be an instance of EventEmitter', () => {
      const emitter = new TestEmitter();
      expect(emitter).toBeInstanceOf(TestEmitter);
    });

    it('should support removeAllListeners', () => {
      const emitter = new TestEmitter();
      const handler = vi.fn();
      emitter.on('close', handler);
      emitter.on('count', handler);
      emitter.removeAllListeners();
      emitter.emit('close');
      emitter.emit('count', 1);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
