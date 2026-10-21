import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { PostgresRoutineDataStore } from "../../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import type { RuntimeAuthorityEnvelope } from "../../lib/civic-data/runtime-authority.ts";

/** The production adapter and actual integrity migrations, with only the HTTP transport kept local. */
export async function withMigratedRoutineStore(
  contract: string,
  run: (store: PostgresRoutineDataStore, vault: MemoryEvidenceStore, pg: PGlite) => Promise<void>,
): Promise<void> {
  const pg = new PGlite();
  for (const file of ["0025_typical_fixer.sql", "0026_lame_sunset_bain.sql", "0027_pdc_candidate_history_shape.sql", "0028_wise_ikaris.sql", "0029_unchanged_confirmation_receipts.sql", "0031_civic_payload_parts.sql"]) {
    await pg.exec(readFileSync(new URL(`../../lib/db/migrations/${file}`, import.meta.url), "utf8"));
  }
  const priorFetch = neonConfig.fetchFunction;
  const names = ["DATABASE_URL", "WTP_DB_ROLE", "WTP_VITAL_SIGNS_REPORT", "WTP_RUNTIME_MODE", "WTP_CONTROL_PLANE_DATABASE_URL"];
  const priorEnvironment = new Map(names.map(name => [name, process.env[name]]));
  process.env.DATABASE_URL = "postgresql://local:local@ep-migration-test.us-east-2.aws.neon.tech/neondb";
  process.env.WTP_DB_ROLE = "local";
  process.env.WTP_RUNTIME_MODE = "staging";
  process.env.WTP_CONTROL_PLANE_DATABASE_URL = "postgresql://local:local@localhost/control-test";
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  type Statement = { query: string; params?: unknown[] };
  neonConfig.fetchFunction = (async (_url: unknown, init: { body: string }) => {
    const request = JSON.parse(init.body) as Statement & { queries?: Statement[] };
    // Descriptions share PostgreSQL's unnamed prepared statement and must be
    // read sequentially, just like the transaction's dependent statements.
    const descriptions = new Map<string, Awaited<ReturnType<PGlite["describeQuery"]>>>();
    for (const statement of request.queries ?? [request]) descriptions.set(statement.query, await pg.describeQuery(statement.query));
    const execute = async (client: Pick<PGlite, "query">, statement: Statement) => {
      const description = descriptions.get(statement.query)!;
      // Neon already encoded each parameter as PostgreSQL text. Preserve it
      // rather than applying PGlite's JavaScript-to-PostgreSQL codec again.
      const serializers = Object.fromEntries(description.queryParams.map(type => [type.dataTypeID, (value: unknown) => String(value)]));
      const result = await client.query<Record<string, unknown>>(statement.query, statement.params ?? [], { serializers });
      return { command: statement.query.trim().split(/\s+/)[0].toUpperCase(), rowCount: result.affectedRows ?? result.rows.length, rowAsArray: true,
        fields: result.fields.map(field => ({ name: field.name, dataTypeID: field.dataTypeID })),
        rows: result.rows.map(row => result.fields.map(field => {
          const value = row[field.name];
          return value == null ? null : field.dataTypeID === 3802 || field.dataTypeID === 114 ? JSON.stringify(value)
            : typeof value === "boolean" ? value ? "t" : "f" : value instanceof Date ? value.toISOString() : String(value);
        })) };
    };
    const results = request.queries ? await pg.transaction(async tx => {
      const values = [];
      for (const statement of request.queries!) values.push(await execute(tx, statement));
      return { results: values };
    }) : await execute(pg, request);
    return new Response(JSON.stringify(results), { headers: { "content-type": "application/json" } });
  }) as typeof neonConfig.fetchFunction;
  try {
    const store = new PostgresRoutineDataStore({ purge: async () => ({purged:true}) });
    Object.assign(store as unknown as Record<string, unknown>, { writeAuthority: {
      repo: process.cwd(), sha: execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(), capability: "ROUTINE_CONTRACT", contract, parentPid: process.pid, nonce: "2".repeat(64),
    } satisfies RuntimeAuthorityEnvelope });
    await run(store, new MemoryEvidenceStore(), pg);
  } finally {
    neonConfig.fetchFunction = priorFetch;
    for (const [name, value] of priorEnvironment) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await pg.close();
  }
}
