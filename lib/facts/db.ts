import { createHash } from "node:crypto";
import { isVersionedSelectStatement } from "../db/versioned-query.ts";
import { neonConfig, Pool } from "../db/client.ts";
import type { FactDb, Query } from "./publish.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { installDatabaseClientAccounting, withCallerSite, withDatabaseQuery } from "../db/transfer-by-caller.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import { serverReaderValue } from "../reader/memory.ts";

const pools = new Map<string, Pool>();
const prepared = new Map<string, string>();
let preparedRefused = false;

/**
 * A long statement a worker runs for every page: on a pooled transaction client its text crosses each connection once,
 * and every later run sends only its parameters. Returns the text unchanged.
 */
export function preparedStatement(text: string): string {
  if (!prepared.has(text)) prepared.set(text, `meanwhile_${createHash("sha256").update(text).digest("hex").slice(0, 32)}`);
  return text;
}

/** The named form of a registered statement, or the plain text and parameters for every other statement. */
export function statementConfig(text: string, params: readonly unknown[]): { readonly name?: string; readonly text: string; readonly values: unknown[] } {
  const name = preparedRefused ? undefined : prepared.get(text);
  return name ? { name, text, values: [...params] } : { text, values: [...params] };
}

/** A connection that cannot hold a named statement (26000, 42P05) sends the full text from then on; the failed build stays queued. */
export function refusePreparedStatement(error: unknown): void {
  const code = (error as { code?: unknown } | null)?.code;
  if (preparedRefused || (code !== "26000" && code !== "42P05")) return;
  preparedRefused = true;
  console.error("Named statements refused by the database connection; sending full statement text", { code });
}

/** The pg client's own `query_timeout` error: the statement may still be running on the server. */
function isQueryReadTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === "Query read timeout";
}

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
      const query: Query = (text, params = []) => withDatabaseQuery(text, async () => {
        if(text.length>20000 && isVersionedSelectStatement(text))preparedStatement(text);
        try { return (await client.query(statementConfig(text, params))).rows; }
        catch (error) { refusePreparedStatement(error); throw error; }
      });
      let broken: Error | undefined;
      try {
        await query("BEGIN");
        const out = await work(query);
        await query("COMMIT");
        return out;
      } catch (error) {
        // A statement past the client's read bound still occupies the connection, so a ROLLBACK would only queue behind
        // it for another full bound. Closing the connection ends the server's transaction instead.
        if (isQueryReadTimeout(error)) broken = error as Error;
        else await query("ROLLBACK").catch((rollback: unknown) => { broken = rollback instanceof Error ? rollback : new Error(String(rollback)); });
        throw error;
      } finally {
        client.release(broken);
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
  serverReaderValue("place-combined", () => new Map()).clear();
  serverReaderValue("place-rows", () => new Map()).clear();
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
