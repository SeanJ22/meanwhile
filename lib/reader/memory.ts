/** Next builds separate module contexts for pages, APIs and instrumentation. The server has one shelf. */
const slot = Symbol.for("meanwhile.reader.memory");
const server = globalThis as typeof globalThis & { [slot]?: Map<string, unknown> };
const resident = server[slot] ??= new Map<string, unknown>();

export function serverReaderValue<T>(key: string, create: () => T): T {
  if (!resident.has(key)) resident.set(key, create());
  return resident.get(key) as T;
}

/** Share cold reads and retain the last verified value while checking for new promotions. */
export function readerMemory<T>(load: () => Promise<T>, refreshMs = 30_000): () => Promise<T> {
  let value: T | undefined, pending: Promise<T> | undefined, checkedAt = 0;
  return () => {
    if (!pending && (value === undefined || Date.now() - checkedAt >= refreshMs)) {
      checkedAt = Date.now();
      pending = Promise.resolve().then(load).then(next => { value = next; return next; }).finally(() => { pending = undefined; });
      if (value !== undefined) void pending.catch(() => undefined);
    }
    return value === undefined ? pending! : Promise.resolve(value);
  };
}
