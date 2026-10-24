/** Two read-only production parity comparisons. Byte savings are measured separately on the production copy. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const [beforeArgument, afterArgument, connectionArgument, outputArgument] = process.argv.slice(2);
const beforeRoot = resolve(beforeArgument!), afterRoot = resolve(afterArgument!), output = resolve(outputArgument!);
const connection = JSON.parse(await readFile(resolve(connectionArgument!), "utf8"));
assert.equal(connection.branchId, "br-delicate-lab-ax02xuo5");
const url = connection.url;
assert.equal(new URL(url).username, "readonly");
assert.equal(new URL(url).searchParams.has("options"), false);
process.env.DATABASE_URL = url;
process.env.WTP_VITAL_SIGNS_REPORT = "1";
delete process.env.WTP_CIVIC_READ_CACHE_URL;
delete process.env.WTP_CIVIC_READ_CACHE_TOKEN;
const sql = neon(url), dialect = new PgDialect();
const imported = (root: string, path: string) => import(pathToFileURL(join(root, path)).href);
const { canonicalCivicDataHash } = await imported(afterRoot, "lib/civic-data/canonical-hash.ts");
const { civicRecordsFor } = await imported(afterRoot, "lib/civic-data/changes.ts");
const { REGISTRY_STATES } = await imported(afterRoot, "lib/civic-data/state-scopes.ts");
const { keepNeonBytesInProcess } = await imported(afterRoot, "lib/db/transfer-by-caller.ts");
keepNeonBytesInProcess();
const now = new Date().toISOString();
const comparisons = [];
for (const state of ["AZ", "OH"]) {
  const results = [];
  for (const root of [beforeRoot, afterRoot]) {
    const { PostgresRoutineDataStore } = await imported(root, "lib/civic-data/store.ts");
    const { readRegistryRuntimePrior } = await imported(root, "lib/registry/runtime-data-plane.ts");
    const store = new PostgresRoutineDataStore();
    // DB-01's migration is not yet on production. Disable disposable copies
    // for these parity reads; every statement runs in a read-only transaction.
    Object.assign(store, { readCache: null, db: { execute: async (statement: SQL) => {
      const query = dialect.sqlToQuery(statement);
      assert.match(query.sql.trim(), /^(WITH|SELECT)\b/i);
      return (await sql.transaction([sql.query(query.sql, query.params)], { readOnly: true, fullResults: true }))[0];
    } } });
    const prior = await readRegistryRuntimePrior(store, now, state);
    assert.ok(prior);
    const records = civicRecordsFor("REGISTRY_RUNTIME_BINDING", prior.payload);
    results.push({ versionId: prior.versionId, resultHash: canonicalCivicDataHash(prior),
      payloadHash: canonicalCivicDataHash(prior.payload), records: records.length,
      idsHash: createHash("sha256").update(JSON.stringify(records.map((row: {key: string}) => row.key).sort())).digest("hex"),
      bodies: prior.payload.registry.bodies.length, divisions: prior.payload.registry.divisions.length,
      executives: prior.payload.statewideExecutives.length, rosters: prior.payload.bodyRosters?.length ?? 0,
      rosterMembers: (prior.payload.bodyRosters ?? []).reduce((sum: number, row: {members: readonly unknown[]}) => sum + row.members.length, 0) });
  }
  assert.deepEqual(results[1], results[0], `${state}: complete registry result and every ID must be unchanged`);
  comparisons.push({ state, before: results[0], after: results[1], unchanged: true });
  console.log(JSON.stringify({ state, ...results[1], unchanged: true }));
}
const [counts] = await sql.transaction([sql.query(`SELECT e.state, count(*)::int AS live_facts
  FROM fact f JOIN entity e ON e.id=f.entity_id WHERE f.status='live' GROUP BY e.state ORDER BY e.state`)], { readOnly: true });
const byState = new Map((counts as {state: string; live_facts: number}[]).map(row => [row.state, row.live_facts]));
const result = { measuredAt: now, databaseHost: new URL(url).hostname,
  readOnly: true, cacheEnabled: false, note: "Production parity before deployment; DB-01 migration and cache savings exercised only on the isolated production copy.",
  comparisons, countsByState: REGISTRY_STATES.map((state: string) => ({ state, liveFacts: byState.get(state) ?? 0 })) };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
