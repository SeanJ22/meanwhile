import { neonConfig, Pool, type PoolClient } from "../db/client.ts";
import type { ReadOnlyQuery, Statement } from "../control-plane/admin-view/promoted-slices.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { serverReaderValue } from "./memory.ts";
import { installDatabaseClientAccounting, withCallerSite, withDatabaseQuery } from "../db/transfer-by-caller.ts";
import { versionedSelect } from "../db/versioned-query.ts";
import { shareVersionedRows } from "../db/versioned-rows.ts";

let installed: ReadOnlyQuery | null | undefined;

const queryOn = (client: PoolClient, text: string, params: readonly unknown[] = []) =>
  withDatabaseQuery(text, async () => (await client.query(text, [...params])).rows);

async function queryWithDeadline(pool: Pool, connection: string, statements: readonly Statement[], deadlineMs?: number) {
  if (statements.length === 0) return [];
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
      if (statements.length > 1) await queryOn(client, "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const selected = versionedSelect(connection);
      const rows = [];
      for (const statement of statements) rows.push(await selected((text, params) => {
        if (expired) throw timeout;
        return queryOn(client, text, params);
      }, statement.text, statement.params));
      if (statements.length > 1) await queryOn(client, "COMMIT");
      return rows;
    } catch (error) {
      if (!expired && statements.length > 1) await queryOn(client, "ROLLBACK").catch(() => {});
      release(error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally { release(); }
  };
  // QueryConfig in this driver does not support per-query timeouts. Discard an active
  // client at the deadline so its unfinished protocol response cannot reach another read.
  try { return deadline === null ? await read() : await Promise.race([read(), deadline]); }
  finally { clearTimeout(timer); }
}

const readerConnectionError = (error: Error) =>
  console.error(`Reader database connection failed: ${error.message}`);

/** A caller already holding a read-only connection can supply it; undefined restores the configured socket pool. */
export function installReaderDatabaseQuery(query: ReadOnlyQuery | null | undefined): void {
  installed = query;
}

/** Reuse the database connection and binary WebSocket transport beside the functions. */
export function readerDatabaseQuery(deadlineMs?: number): ReadOnlyQuery | null {
  if (installed !== undefined) return installed;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  return databaseReadOnlyQuery(connectionString, deadlineMs);
}

/** The same row-version protocol also serves explicit control-plane evidence reads. */
export function databaseReadOnlyQuery(connectionString: string, deadlineMs?: number): ReadOnlyQuery {
  installDatabaseClientAccounting(neonConfig, installDatabaseTransferCounter);
  neonConfig.webSocketConstructor ??= globalThis.WebSocket;
  const pool = serverReaderValue(`database-pool:${connectionString}`, () => {
    const created = new Pool({
      connectionString, max: 4, allowExitOnIdle: true,
      options: "-c default_transaction_read_only=on",
    });
    // A dropped or refused connection fails only the read using it. An unheard error
    // event would end the function and every other reader it is serving.
    created.on("error", readerConnectionError);
    created.on("connect", (client: PoolClient) => client.on("error", readerConnectionError));
    return created;
  });
  return statements => withCallerSite(() => queryWithDeadline(pool, connectionString, statements, deadlineMs));
}

/** SQL-shaped adapter for readers which issue one parameterized statement at a time. */
export function databaseReadOnlySql(connectionString: string, deadlineMs?: number) {
  return serverReaderValue(`database-sql:${connectionString}:${deadlineMs ?? ""}`, () => {
    const read = databaseReadOnlyQuery(connectionString, deadlineMs);
    const sql = { query: async (text: string, params: readonly unknown[] = []) =>
      (await read([{ text, params }]))[0] ?? [] };
    shareVersionedRows(sql, connectionString);
    return sql;
  });
}
