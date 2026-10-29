import { neon, neonConfig, Pool, type PoolClient } from "../db/client.ts";
import type { ReadOnlyQuery, Statement } from "../control-plane/admin-view/promoted-slices.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { serverReaderValue } from "./memory.ts";
import { installDatabaseClientAccounting, withCallerSite, withDatabaseQuery } from "../db/transfer-by-caller.ts";
import { versionedSelect } from "../db/versioned-query.ts";
import { shareVersionedRows } from "../db/versioned-rows.ts";
import { currentReaderRoute } from "../db/reader-route.ts";

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

// The still-mounted map keeps loading behind an intercepted ballot. Its reads
// must not occupy every connection needed by the reader's foreground action.
const poolLane = () => currentReaderRoute() === "/ballot" ? "ballot" : "shared";

async function ballotHttpRead(connection: string, statement: Statement, deadlineMs?: number) {
  const sql = serverReaderValue(`ballot-http:${connection}`, () => neon(connection));
  const controller = new AbortController();
  const timer = deadlineMs === undefined ? undefined : setTimeout(() => controller.abort(), deadlineMs);
  try {
    return [await versionedSelect(connection)((text, params) => withDatabaseQuery(text, async () =>
      (await sql.transaction([sql.query(text, [...params])], {
        readOnly: true, isolationLevel: "RepeatableRead", fetchOptions: { signal: controller.signal },
      }))[0]), statement.text, statement.params)];
  } catch (error) {
    if (controller.signal.aborted) {
      const timeout = new Error("READER_DATABASE_TIMEOUT");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw error;
  } finally { clearTimeout(timer); }
}

/** A caller already holding a read-only connection can supply it; undefined restores the configured socket pool. */
export function installReaderDatabaseQuery(query: ReadOnlyQuery | null | undefined): void {
  installed = query;
}

/** Foreground ballots use read-only HTTP; other readers reuse their socket transaction. */
export function readerDatabaseQuery(deadlineMs?: number): ReadOnlyQuery | null {
  if (installed !== undefined) return installed;
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  return databaseReadOnlyQuery(connectionString, deadlineMs);
}

/** The same row-version protocol also serves explicit control-plane evidence reads. */
function readOnlyPool(connectionString: string): Pool {
  installDatabaseClientAccounting(neonConfig, installDatabaseTransferCounter);
  neonConfig.webSocketConstructor ??= globalThis.WebSocket;
  return serverReaderValue(`database-pool:${connectionString}`, () => {
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
}

/** Begin handshakes during code loading, without reading or saving civic data. */
export function warmReaderConnections(): Promise<void> {
  const connection = process.env.DATABASE_URL?.trim();
  if (!connection) return Promise.resolve();
  return serverReaderValue(`reader-connection-start:${connection}`, async () => {
    const pool = readOnlyPool(connection);
    const sql = serverReaderValue(`ballot-http:${connection}`, () => neon(connection));
    await Promise.allSettled([
      ...[0, 1].map(async () => { const client = await pool.connect(); client.release(); }),
      withDatabaseQuery("SELECT 1", () => sql.transaction([sql.query("SELECT 1 AS ready")], {
        readOnly: true, isolationLevel: "RepeatableRead", fetchOptions: { signal: AbortSignal.timeout(3000) },
      })),
    ]);
  });
}

export function databaseReadOnlyQuery(connectionString: string, deadlineMs?: number): ReadOnlyQuery {
  const lane = poolLane(), pool = readOnlyPool(connectionString);
  const canonicalBody: ReadOnlyQuery = statements =>
    withCallerSite(() => queryWithDeadline(pool, connectionString, statements, deadlineMs));
  return Object.assign((statements: readonly Statement[]) =>
    lane === "ballot" && statements.length === 1
      ? withCallerSite(() => ballotHttpRead(connectionString, statements[0], deadlineMs))
      : canonicalBody(statements),
  { publicationFingerprints: true as const, canonicalBody });
}

/** Compact Admin reads use one read-only HTTP transaction, including the same driver content-version checks. */
export function databaseHttpReadOnlyQuery(connectionString: string, deadlineMs?: number) {
  const sql = serverReaderValue(`http-read-only:${connectionString}`, () => neon(connectionString));
  const read: ReadOnlyQuery = async statements => {
    if (!statements.length) return [];
    const controller = new AbortController();
    const timer = deadlineMs === undefined ? undefined : setTimeout(() => controller.abort(), deadlineMs);
    try {
      return await withCallerSite(() => withDatabaseQuery(statements[0].text, () => sql.transaction(
        statements.map(statement => sql.query(statement.text, [...statement.params])), {
          readOnly: true, isolationLevel: "RepeatableRead", fetchOptions: { signal: controller.signal },
        })));
    } catch (error) {
      if (controller.signal.aborted) { const timeout = new Error("READER_DATABASE_TIMEOUT"); timeout.name = "TimeoutError"; throw timeout; }
      throw error;
    } finally { clearTimeout(timer); }
  };
  return Object.assign(read, { publicationFingerprints: true as const, canonicalBody: read });
}

export function databaseHttpReadOnlySql(connectionString: string, deadlineMs?: number) {
  return serverReaderValue(`database-http-sql:${connectionString}:${deadlineMs ?? ""}`, () => {
    const read = databaseHttpReadOnlyQuery(connectionString, deadlineMs);
    const sql = { query: async (text: string, params: readonly unknown[] = []) => (await read([{ text, params }]))[0] ?? [] };
    shareVersionedRows(sql, connectionString);
    return sql;
  });
}

/** SQL-shaped adapter for readers which issue one parameterized statement at a time. */
export function databaseReadOnlySql(connectionString: string, deadlineMs?: number) {
  return serverReaderValue(`database-sql:${poolLane()}:${connectionString}:${deadlineMs ?? ""}`, () => {
    const read = databaseReadOnlyQuery(connectionString, deadlineMs);
    const sql = { query: async (text: string, params: readonly unknown[] = []) =>
      (await read([{ text, params }]))[0] ?? [] };
    shareVersionedRows(sql, connectionString);
    return sql;
  });
}
