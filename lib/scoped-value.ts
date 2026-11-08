/**
 * A value that holds for one run of a function. On the server it is Node's AsyncLocalStorage, found at run time so
 * no bundle for a browser imports a Node module. A browser has no AsyncLocalStorage and composes an answer in one
 * synchronous turn, so a stack serves there.
 */
export interface ScopedValue<T> {
  run<R>(value: T, read: () => R): R;
  getStore(): T | undefined;
  enterWith(value: T): void;
}

class SyncScope<T> implements ScopedValue<T> {
  private readonly stack: T[] = [];
  run<R>(value: T, read: () => R): R {
    this.stack.push(value);
    try { return read(); } finally { this.stack.pop(); }
  }
  getStore(): T | undefined { return this.stack.at(-1); }
  enterWith(value: T): void { this.stack[Math.max(0, this.stack.length - 1)] = value; }
}

type Host = { process?: { getBuiltinModule?: (id: string) => unknown } };
const Local = ((globalThis as Host).process?.getBuiltinModule?.("node:async_hooks") as
  { AsyncLocalStorage?: new <T>() => ScopedValue<T> } | undefined)?.AsyncLocalStorage;

export const scopedValue = <T>(): ScopedValue<T> => Local ? new Local<T>() : new SyncScope<T>();
