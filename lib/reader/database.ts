import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import type { ReadOnlyQuery, Statement } from "../control-plane/admin-view/promoted-slices.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { serverReaderValue } from "./memory.ts";
import { installDatabaseClientAccounting, withCallerSite, withDatabaseQuery } from "../db/transfer-by-caller.ts";

let installed: ReadOnlyQuery | null | undefined;

const queryOn = (client: PoolClient, text: string, params: readonly unknown[] = []) =>
  withDatabaseQuery(text, async () => (await client.query(text, [...params])).rows);

async function queryWithDeadline(pool: Pool, statements: readonly Statement[], deadlineMs?: number) {
  if (deadlineMs === undefined && statements.length === 1) {
    const statement = statements[0];
    return withDatabaseQuery(statement.text, async () => [(await pool.query(statement.text, [...statement.params])).rows]);
  }
  const timeout = new Error("READER_DATABASE_TIMEOUT");
  timeout.name = "TimeoutError";
  let expired = false, release: ((error?: Error) => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = deadlineMs === undefined ? null : new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; release?.(timeout); reject(timeout); }, deadlineMs);
  });
  const read = async () => {
    const client = await withDatabaseQuery(statements[0]?.text ?? "BEGIN READ ONLY", () => pool.connect());
    if (expired) { client.release(); throw timeout; }
    let released = false;
    release = error => { if (!released) { released = true; client.release(error); } };
    try {
      if (statements.length === 1) {
        const statement = statements[0];
        return [await queryOn(client, statement.text, statement.params)];
      }
      await queryOn(client, "BEGIN READ ONLY");
      const rows = [];
      for (const statement of statements) rows.push(await queryOn(client, statement.text, statement.params));
      await queryOn(client, "COMMIT");
      return rows;
    } catch (error) {
      if (!expired && statements.length !== 1) await queryOn(client, "ROLLBACK").catch(() => {});
      release(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally { release(); }
  };
  // QueryConfig in this driver does not support per-query timeouts. Discard an active
  // client at the deadline so its unfinished protocol response cannot reach another read.
  try { return deadline === null ? await read() : await Promise.race([read(), deadline]); }
  finally { clearTimeout(timer); }
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
  installDatabaseClientAccounting(neonConfig, installDatabaseTransferCounter);
  neonConfig.webSocketConstructor ??= globalThis.WebSocket;
  const pool = serverReaderValue(`database-pool:${connectionString}`, () => new Pool({
    connectionString, max: 4, allowExitOnIdle: true,
    options: "-c default_transaction_read_only=on",
  }));
  return statements => withCallerSite(() => queryWithDeadline(pool, statements, deadlineMs));
}
