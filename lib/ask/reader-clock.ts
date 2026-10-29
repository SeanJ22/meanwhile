import { AsyncLocalStorage } from "node:async_hooks";

const readerZone = new AsyncLocalStorage<string | undefined>();

/** A browser supplies its IANA zone; invalid input cannot reach Intl formatting. */
export function withReaderTimeZone<T>(value: string | null | undefined, run: () => T): T {
  let zone: string | undefined;
  if (value && value.length < 100) {
    try { zone = new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone; }
    catch { /* Older callers keep the source's recorded zone. */ }
  }
  return readerZone.run(zone, run);
}

export function currentReaderTimeZone(): string | undefined { return readerZone.getStore(); }
