import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import type { FactDb, Query } from "./publish.ts";

let pool: Pool | null = null;

/** The reader database over the pooled WebSocket client, so each publish is one real transaction. */
export function readerFactDb(url: string | undefined = process.env.DATABASE_URL): FactDb & { readonly query: Query } {
  if (!url) throw new Error("FACT_STORE_DATABASE_URL_MISSING");
  if (!neonConfig.webSocketConstructor) neonConfig.webSocketConstructor = globalThis.WebSocket;
  pool ??= new Pool({ connectionString: url, max: 4 });
  const held = pool;
  return {
    query: async (text, params = []) => (await held.query(text, [...params])).rows,
    async transaction(work) {
      const client = await held.connect();
      try {
        await client.query("BEGIN");
        const out = await work(async (text, params = []) => (await client.query(text, [...params])).rows);
        await client.query("COMMIT");
        return out;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

let installed: Query | null | undefined;

/** Reads of the reader database's facts over HTTP; null when no reader database is configured. */
export function factReader(): Query | null {
  if (installed !== undefined) return installed;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const sql = neon(url);
  return async (text, params = []) => (await sql.query(text, [...params])) as Record<string, unknown>[];
}

/** A process that already holds a fact connection (a test's database, a script's pool) reads through it. */
export function installFactReader(query: Query | null | undefined): void {
  installed = query;
}

export const statementQuery = (run: (statements: readonly { readonly text: string; readonly params: readonly unknown[] }[]) => Promise<readonly (readonly Record<string, unknown>[])[]>): Query =>
  async (text, params = []) => (await run([{ text, params }]))[0] ?? [];

/** Moves whenever a fact is written or leaves the live set. */
export async function factsVersion(query: Query | null): Promise<string> {
  if (query === null) return "facts:none";
  const [row] = await query("SELECT coalesce(max(id), 0) AS newest, count(*) FILTER (WHERE status = 'live') AS live FROM fact");
  return `facts:${row?.newest ?? 0}.${row?.live ?? 0}`;
}
