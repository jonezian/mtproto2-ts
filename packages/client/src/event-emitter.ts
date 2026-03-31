import { EventEmitter } from 'node:events';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A type-safe event emitter that wraps Node.js EventEmitter.
 *
 * @example
 * ```ts
 * interface MyEvents {
 *   'data': (payload: Buffer) => void;
 *   'error': (err: Error) => void;
 *   'close': () => void;
 * }
 *
 * class MyClass extends TypedEventEmitter<MyEvents> { }
 * ```
 */
export class TypedEventEmitter<
  Events extends Record<string, (...args: any[]) => void>,
> extends EventEmitter {
  override on<K extends keyof Events & string>(
    event: K,
    listener: Events[K],
  ): this {
    return super.on(event, listener);
  }

  override off<K extends keyof Events & string>(
    event: K,
    listener: Events[K],
  ): this {
    return super.off(event, listener);
  }

  override once<K extends keyof Events & string>(
    event: K,
    listener: Events[K],
  ): this {
    return super.once(event, listener);
  }

  override emit<K extends keyof Events & string>(
    event: K,
    ...args: Parameters<Events[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}
