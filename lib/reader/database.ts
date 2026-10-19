import { neonConfig, Pool } from "@neondatabase/serverless";
import type { ReadOnlyQuery, Statement } from "../control-plane/admin-view/promoted-slices.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { serverReaderValue } from "./memory.ts";

let installed: ReadOnlyQuery | null | undefined;

async function queryWithDeadline(pool: Pool, statements: readonly Statement[], deadlineMs: number) {
  const timeout = new Error("READER_DATABASE_TIMEOUT");
  timeout.name = "TimeoutError";
  let expired = false, release: ((error?: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; release?.(timeout); reject(timeout); }, deadlineMs);
  });
  const read = async () => {
    const client = await pool.connect();
    if (expired) { client.release(); throw timeout; }
    let released = false;
    release = error => { if (!released) { released = true; client.release(error); } };
    try {
      if (statements.length === 1) {
        const statement = statements[0];
        return [(await client.query(statement.text, [...statement.params])).rows];
      }
      await client.query("BEGIN READ ONLY");
      const rows = [];
      for (const statement of statements) rows.push((await client.query(statement.text, [...statement.params])).rows);
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      if (!expired && statements.length !== 1) await client.query("ROLLBACK").catch(() => {});
      release(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally { release(); }
  };
  // QueryConfig in this driver does not support per-query timeouts. Discard an active
  // client at the deadline so its unfinished protocol response cannot reach another read.
  try { return await Promise.race([read(), deadline]); }
  finally { clearTimeout(timer!); }
}

/** A caller already holding a read-only connection can supply it; undefined restores the configured socket pool. */
export function installReaderDatabaseQuery(query: ReadOnlyQuery | null | undefined): void {
  installed = query;
}

/** Reuse the database connection and binary WebSocket transport beside the functions. */
export function readerDatabaseQuery(deadlineMs?: number): ReadOnlyQuery | null {
  if (installed !== undefined) return installed;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  installDatabaseTransferCounter();
  neonConfig.webSocketConstructor ??= globalThis.WebSocket;
  const pool = serverReaderValue("database-pool", () => new Pool({
    connectionString, max: 4, allowExitOnIdle: true,
    options: "-c default_transaction_read_only=on",
  }));
  return async statements => {
    if (deadlineMs !== undefined) return queryWithDeadline(pool, statements, deadlineMs);
    if (statements.length === 1) {
      const statement = statements[0];
      return [(await pool.query(statement.text, [...statement.params])).rows];
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const rows = [];
      for (const statement of statements) rows.push((await client.query(statement.text, [...statement.params])).rows);
      await client.query("COMMIT");
      return rows;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  };
}
