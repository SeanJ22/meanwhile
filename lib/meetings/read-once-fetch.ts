import { createRequire } from "node:module";

interface ByteSpool {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...values: (string | Uint8Array)[]): unknown;
    get(url: string): { bytes: Uint8Array } | undefined;
  };
  close(): void;
}

export type ReadOnceFetch = typeof fetch & { readonly distinctReads: () => number; readonly close: () => void };

/** SQLite's anonymous TEMP file retains fetched bytes once, with a bounded page cache. Closing the connection
 * or exiting the child removes it; no named scratch files survive a killed calendar program. */
export function readOncePerRun(base: typeof fetch): ReadOnceFetch {
  type Held = { readonly status: number; readonly statusText: string; readonly headers: [string, string][] };
  const reads = new Map<string, Promise<Held>>();
  let spool: ByteSpool | null = null, closed = false;
  let count = 0;
  const bytes = () => {
    if (closed) throw new Error("AGENDA_READ_CACHE_CLOSED");
    if (spool === null) {
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => ByteSpool };
      spool = new DatabaseSync(":memory:");
      spool.exec("PRAGMA temp_store=FILE; PRAGMA temp.cache_size=-8192; CREATE TEMP TABLE agenda_bytes(url TEXT PRIMARY KEY, bytes BLOB NOT NULL)");
    }
    return spool;
  };
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (closed) throw new Error("AGENDA_READ_CACHE_CLOSED");
    const url = String(input instanceof Request ? input.url : input);
    let read = reads.get(url);
    if (!read) {
      count++;
      read = (async () => {
        const response = await base(input, init);
        bytes().prepare("INSERT INTO agenda_bytes(url,bytes) VALUES(?,?)")
          .run(url, new Uint8Array(await response.arrayBuffer()));
        return { status: response.status, statusText: response.statusText, headers: [...response.headers.entries()] as [string, string][] };
      })();
      reads.set(url, read);
    }
    const held = await read;
    const nullBody = held.status === 204 || held.status === 205 || held.status === 304;
    const body = nullBody ? null : bytes().prepare("SELECT bytes FROM agenda_bytes WHERE url=?").get(url)?.bytes;
    if (!nullBody && body === undefined) throw new Error("AGENDA_READ_CACHE_MISSING");
    return new Response(body?.slice() ?? null, { status: held.status, statusText: held.statusText, headers: held.headers });
  }) as ReadOnceFetch;
  Object.defineProperties(wrapped, {
    distinctReads: { value: () => count },
    close: { value: () => { closed = true; spool?.close(); spool = null; reads.clear(); } },
  });
  return wrapped;
}
