/** Next builds separate module contexts for pages, APIs and instrumentation. The server has one shelf. */
const slot = Symbol.for("meanwhile.reader.memory");
const server = globalThis as typeof globalThis & { [slot]?: Map<string, unknown> };
const resident = server[slot] ??= new Map<string, unknown>();

export function serverReaderValue<T>(key: string, create: () => T): T {
  if (!resident.has(key)) resident.set(key, create());
  return resident.get(key) as T;
}
