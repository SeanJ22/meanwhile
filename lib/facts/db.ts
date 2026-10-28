import { neonConfig, Pool } from "../db/client.ts";
import type { FactDb, Query } from "./publish.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { installDatabaseClientAccounting, withCallerSite, withDatabaseQuery } from "../db/transfer-by-caller.ts";
import { readerDatabaseQuery } from "../reader/database.ts";

const pools = new Map<string, Pool>();

/** The reader database over the pooled WebSocket client, so each publish is one real transaction. */
export function readerFactDb(url: string | undefined = process.env.DATABASE_URL): FactDb & { readonly query: Query } {
  if (!url) throw new Error("FACT_STORE_DATABASE_URL_MISSING");
  installDatabaseClientAccounting(neonConfig, installDatabaseTransferCounter);
  if (!neonConfig.webSocketConstructor) neonConfig.webSocketConstructor = globalThis.WebSocket;
  let held = pools.get(url);
  if (!held) pools.set(url, held = new Pool({ connectionString: url, max: 4, allowExitOnIdle: true, connectionTimeoutMillis: 10_000, statement_timeout: 30_000, query_timeout: 31_000 }));
  const pool = held;
  return {
    query: (text, params = []) => withDatabaseQuery(text, async () => {
      const client = await pool.connect();
      let failure: Error | undefined;
      try { return (await client.query(text, [...params])).rows; }
      catch (error) { failure = error instanceof Error ? error : new Error(String(error)); throw error; }
      finally { client.release(failure); }
    }),
    transaction: work => withCallerSite(async () => {
      const client = await pool.connect();
      const query: Query = (text, params = []) => withDatabaseQuery(text, async () => (await client.query(text, [...params])).rows);
      try {
        await query("BEGIN");
        const out = await work(query);
        await query("COMMIT");
        return out;
      } catch (error) {
        await query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }),
  };
}

let installed: Query | null | undefined;

/** Fact reads share the reader's version-checked, read-only connection. */
export function factReader(): Query | null {
  if (installed !== undefined) return installed;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  const selected = readerDatabaseQuery();
  if (!selected) return null;
  return statementQuery(selected);
}

/** A process that already holds a fact connection (a test's database, a script's pool) reads through it. */
export function installFactReader(query: Query | null | undefined): void {
  installed = query;
}

export const statementQuery = (run: (statements: readonly { readonly text: string; readonly params: readonly unknown[] }[]) => Promise<readonly (readonly Record<string, unknown>[])[]>): Query =>
  async (text, params = []) => (await run([{ text, params }]))[0] ?? [];

/** A scope's version (a state's code or `comment`), moved by the database whenever a fact there enters or leaves the live set. */
export async function factsVersion(query: Query | null, scope: string): Promise<string> {
  if (query === null) return "facts:none";
  const [row] = await query("SELECT version FROM fact_watermark WHERE scope = $1", [scope]);
  return `facts:${scope}:${row?.version ?? 0}`;
}

/** Where a named pass last read up to; null before its first pass. */
export async function readPassCursor(query: Query, name: string): Promise<string | null> {
  const [row] = await query("SELECT position FROM pass_cursor WHERE name = $1", [name]);
  return row ? String(row.position) : null;
}

export async function writePassCursor(query: Query, name: string, position: string): Promise<void> {
  await query("INSERT INTO pass_cursor (name, position) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET position = EXCLUDED.position", [name, position]);
}
