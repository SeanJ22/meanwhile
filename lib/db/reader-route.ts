import { AsyncLocalStorage } from "node:async_hooks";

const route = new AsyncLocalStorage<string>();

export function withReaderRoute<T>(path: string, read: () => T): T {
  return route.run(path, read);
}

export function currentReaderRoute(): string {
  return route.getStore() ?? "unattributed";
}

export function transferRead(body: string | undefined): string {
  if (!body) return "socket";
  try {
    const request = JSON.parse(body) as { query?: string; params?: unknown[]; queries?: { query: string; params?: unknown[] }[] };
    const reads = (request.queries ?? [request]).map(statement => {
      const query = statement.query ?? "";
      const table = /\b(?:FROM|JOIN)\s+"?((?:civic_data|database_transfer)_[a-z_]+|fact|source_copy)\b/i.exec(query)?.[1]
        ?? /\b(?:FROM|JOIN)\s+"?([a-z_]+)"?/i.exec(query)?.[1] ?? "query";
      const recordClass = statement.params?.find(value => typeof value === "string" && /^[A-Z_]+$/.test(value));
      return recordClass ? `${table}:${recordClass}` : table;
    });
    return [...new Set(reads)].sort().join(",");
  } catch { return "query"; }
}


export interface ReaderSelection {
  readonly states?: readonly string[];
  readonly keys: Set<string>;
  readonly point?: readonly [number, number];
  readonly divisions?: readonly string[];
  readonly place?: import("../place-map/reader.ts").PlaceEntry;
  readonly zip?: string;
  readonly governmentWindow?: readonly [number, number];
}

const selected = new AsyncLocalStorage<ReaderSelection | undefined>();

export const currentReaderSelection = () => selected.getStore();

export function withReaderSelection<T>(selection: ReaderSelection | undefined, read: () => T): T {
  return selected.run(selection, read);
}
