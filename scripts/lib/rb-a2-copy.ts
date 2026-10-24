import { readFile } from "node:fs/promises";
import { Client } from "pg";
import type { Query } from "../../lib/facts/publish.ts";
import { identitySourceTables, identityEventTables, readerIdentityMigration, placeBoundaryMigration } from "../../tests/helpers/reader-identity-db.ts";

/** The socket and role are fixed to this workspace's disposable PostgreSQL.
 * A copy never consults DATABASE_URL or opens a production write connection. */
export async function openMapCopy(name: string, reset = true) {
  if (!/^[a-z][a-z0-9_]{1,32}$/.test(name)) throw new Error("Invalid local copy name");
  const client = new Client({ host: "/workspace/.cache/rb-a2-postgres/socket", port: 55439, user: "rb_a2_copy", database: "postgres" });
  await client.connect();
  const schema = `rb_a2_${name}`;
  const exec = async (sql: string) => { await client.query(sql); };
  if (reset) {
    await exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await exec(`CREATE SCHEMA "${schema}"`);
  }
  await exec(`SET search_path TO "${schema}",public`);
  if (reset) {
    await exec(await readFile("lib/db/migrations/0035_r1_fact_store.sql", "utf8"));
    await identitySourceTables({ exec }); await identityEventTables({ exec }); await exec(readerIdentityMigration());
    await exec(placeBoundaryMigration());
    await exec(await readFile("lib/db/migrations/RB-A10_zip_locations.sql", "utf8"));
  }
  const query: Query = async (text, params = []) => (await client.query(text, [...params])).rows as Record<string, unknown>[];
  const transaction = async <T>(run: (query: Query) => Promise<T>): Promise<T> => {
    await exec("BEGIN");
    try { const result = await run(query); await exec("COMMIT"); return result; }
    catch (error) { await exec("ROLLBACK"); throw error; }
  };
  return { query, transaction, exec, close: () => client.end() };
}
