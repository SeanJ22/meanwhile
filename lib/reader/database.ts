import { neonConfig, Pool } from "@neondatabase/serverless";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { serverReaderValue } from "./memory.ts";

/** Reuse the database connection and binary WebSocket transport beside the functions. */
export function readerDatabaseQuery(): ReadOnlyQuery | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  installDatabaseTransferCounter();
  neonConfig.webSocketConstructor ??= globalThis.WebSocket;
  const pool = serverReaderValue("database-pool", () => new Pool({
    connectionString, max: 4, allowExitOnIdle: true,
    options: "-c default_transaction_read_only=on",
  }));
  return async statements => {
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
