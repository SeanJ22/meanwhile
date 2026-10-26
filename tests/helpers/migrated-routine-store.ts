import { installKeyedRows } from "./keyed-rows.ts";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "@neondatabase/serverless";
import { PostgresRoutineDataStore } from "../../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import type { RuntimeAuthorityEnvelope } from "../../lib/civic-data/runtime-authority.ts";
import { factDb } from "./fact-db.ts";
import { COUNT_SCHEMA_SOURCE } from "../../lib/control-plane/repository/migrations/RB-A8.ts";

/** The production adapter and actual fact, page and integrity migrations, with only the HTTP transport kept local. */
export async function withMigratedRoutineStore(
  contract: string,
  run: (store: PostgresRoutineDataStore, vault: MemoryEvidenceStore, pg: PGlite) => Promise<void>,
): Promise<void> {
  const { pg } = await factDb();
  for (const file of ["0025_typical_fixer.sql", "0026_lame_sunset_bain.sql", "0027_pdc_candidate_history_shape.sql", "0028_wise_ikaris.sql", "0029_unchanged_confirmation_receipts.sql", "DB-05_source_hash.sql", "DB-05_source_checks.sql", "0031_civic_payload_parts.sql"]) {
    await pg.exec(readFileSync(new URL(`../../lib/db/migrations/${file}`, import.meta.url), "utf8"));
  }
  const readerFunctions = readFileSync(new URL("../../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8")
    .split("--> statement-breakpoint").filter(sql => /^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql));
  for (const sql of readerFunctions) await pg.exec(sql);
  await pg.exec(readFileSync(COUNT_SCHEMA_SOURCE,"utf8"));
  // Use the actual migration's table and triggers: scoped field copies must
  // observe every candidate, event and pointer write in these adapter tests.
  const readVersions=readFileSync(new URL("../../lib/db/migrations/DB-01_read_versions.sql",import.meta.url),"utf8")
    .split("--> statement-breakpoint").map(statement=>statement.trim())
    .filter(statement=>/^CREATE (?:TABLE civic_data_clock_versions\b|FUNCTION civic_data_clock_changed\b|TRIGGER civic_data_(?:candidate|event|pointer)_clock_changed\b)/.test(statement));
  for(const statement of readVersions)await pg.exec(statement);
  await installKeyedRows(pg);
  await pg.exec(readFileSync(new URL("../../lib/db/migrations/DB-05_member_office_rows.sql",import.meta.url),"utf8"));
  await pg.exec(readFileSync(new URL("../../lib/db/migrations/DB-05_federal_money_rows.sql",import.meta.url),"utf8").replaceAll("--> statement-breakpoint",""));
  await pg.exec(readFileSync(new URL("../../lib/db/migrations/DB-05_lookup_rows.sql",import.meta.url),"utf8"));
  await pg.exec(readFileSync(new URL("../../lib/db/migrations/DB-05_venue_rows.sql",import.meta.url),"utf8"));
  const priorFetch = neonConfig.fetchFunction;
  const names = ["DATABASE_URL", "WTP_DB_ROLE", "WTP_VITAL_SIGNS_REPORT", "WTP_RUNTIME_MODE", "WTP_CONTROL_PLANE_DATABASE_URL"];
  const priorEnvironment = new Map(names.map(name => [name, process.env[name]]));
  process.env.DATABASE_URL = `postgresql://local:local@ep-migration-test.us-east-2.aws.neon.tech/fixture-${randomUUID()}`;
  process.env.WTP_DB_ROLE = "local";
  process.env.WTP_RUNTIME_MODE = "staging";
  process.env.WTP_CONTROL_PLANE_DATABASE_URL = "postgresql://local:local@localhost/control-test";
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  type Statement = { query: string; params?: unknown[] };
  const serveRequest = async (_url: unknown, init: { body: string }) => {
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
  };
  // PGlite has one connection. describeQuery uses the unnamed statement without
  // query()'s mutex, so a concurrent description can interrupt another request's
  // Parse/Bind/Execute sequence. Keep each complete HTTP request on that session.
  let requests: Promise<unknown> = Promise.resolve();
  neonConfig.fetchFunction = ((_url: unknown, init: { body: string }) => {
    const response = requests.then(() => serveRequest(_url, init));
    requests = response.catch(() => undefined);
    return response;
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
