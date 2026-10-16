import { mock } from "node:test";
import { neonConfig, Pool, type PoolClient } from "@neondatabase/serverless";
import { createPgRepositories, type Sql } from "../../lib/control-plane/repository/pg-store.ts";

export async function openFixturePgRepositories(sql: Sql, now: string) {
  const originalFetch = neonConfig.fetchFunction;
  const client = { query: async (text: string, params: readonly unknown[] = []) => ({ rows: await sql.query(text, params) }), release: () => {} };
  const connect = mock.method(Pool.prototype, "connect", async () => client as unknown as PoolClient);
  try {
    neonConfig.fetchFunction = (async (_input: unknown, init?: { body?: string }) => {
      const request = JSON.parse(init?.body ?? "{}") as { query: string; params?: readonly unknown[] };
      const rows = await sql.query(request.query, request.params) as Record<string, unknown>[];
      const names = Object.keys(rows[0] ?? {});
      const fields = names.map(name => ({ name, dataTypeID: 114 }));
      return Response.json({ fields, rows: rows.map(row => names.map(name => JSON.stringify(row[name]))),
        rowCount: rows.length, command: "SELECT", rowAsArray: true });
    }) as typeof neonConfig.fetchFunction;
    return await createPgRepositories("postgresql://fixture:fixture@ep-bootstrap-fixture.us-east-2.aws.neon.tech/test", now);
  } finally { neonConfig.fetchFunction = originalFetch; connect.mock.restore(); }
}
