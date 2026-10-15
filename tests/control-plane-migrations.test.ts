import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyControlPlaneMigrations, controlPlaneMigrationHash, productionControlPlaneTarget } from "../scripts/control-plane-migrations.mts";
import { BOOTSTRAP_DDL, CONTROL_READS_EXPAND_DDL, CP_MIGRATIONS_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { ADMIN_SECTIONS_STRIP_DDL } from "../lib/control-plane/repository/admin-config.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { pgSpendRepository } from "../lib/control-plane/repository/model-charges.ts";
import { pricedModelCharge } from "../lib/control-plane/fleet-safety.ts";
import { costRecordId } from "../lib/control-plane/spend-window.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { cacheHitRateByRole } from "../lib/control-plane/research-metrics.ts";

const connection = "postgresql://writer:fixture@ep-dark-night-aeo1ekz3.c-2.us-east-2.aws.neon.tech/control";
const buildEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", NETLIFY: "true", CONTEXT: "production", BRANCH: "main", WTP_CONTROL_PLANE_DATABASE_URL: connection };
const expandArgs = ["--target=production", "--phase=expand", "--production-build"];
const committed = (path: string) => readFileSync(path);
const now = "2026-10-15T12:00:00.000Z";
const entry = (id: string): CostEntry => ({ attemptId: id, routeTaskId: `task-${id}`, workItemId: "work", routeId: null,
  source: "api.anthropic.com", jurisdiction: "place", project: "freshness", role: "SCOUT", model: "claude-haiku-4-5-20251001",
  recordedAt: now, cost: { ...ZERO_COST, usd: 1, requestCount: 1 } });

test("control-plane migrations use only the declared production context and its separate connection", () => {
  assert.equal(productionControlPlaneTarget(expandArgs, buildEnv), connection);
  const pooled = connection.replace("ep-dark-night-aeo1ekz3.", "ep-dark-night-aeo1ekz3-pooler.");
  assert.equal(productionControlPlaneTarget(expandArgs, { ...buildEnv, WTP_CONTROL_PLANE_DATABASE_URL: pooled }), pooled);
  for (const env of [{ ...buildEnv, CONTEXT: "deploy-preview" }, { ...buildEnv, BRANCH: "feature" },
    { ...buildEnv, WTP_CONTROL_PLANE_DATABASE_URL: undefined, DATABASE_URL: connection },
    { ...buildEnv, WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://writer:fixture@ep-wrong-branch.us-east-2.aws.neon.tech/control" },
    { ...buildEnv, WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://writer:fixture@ep-dry-river-axwtolzc-pooler.us-east-2.aws.neon.tech/neondb" }]) {
    assert.throws(() => productionControlPlaneTarget(expandArgs, env), /REFUSED/);
  }
  assert.throws(() => productionControlPlaneTarget(["--phase=expand"], buildEnv), /REFUSED/);
});

test("committed journal hashes cover both phase definitions", () => {
  const journal = JSON.parse(readFileSync("lib/control-plane/repository/migrations/meta/_journal.json", "utf8"));
  for (const row of journal.entries) assert.equal(row.hash, controlPlaneMigrationHash(row.phase));
});

test("uncommitted migrations and contract checks refuse before a database opens", async () => {
  let opened = false;
  const withDatabase = async <T>(_connection: string, _operation: (sql: Sql) => Promise<T>): Promise<T> => { opened = true; throw Error("unexpected database"); };
  await assert.rejects(applyControlPlaneMigrations(expandArgs, { env: buildEnv, committed: () => Buffer.from("changed"), withDatabase }), /differs from its committed/);
  await assert.rejects(applyControlPlaneMigrations(["--target=production", "--phase=contract", "--production-runtime"], {
    env: { ...buildEnv, WTP_RUNTIME_MODE: "production", WTP_CONTROL_PLANE_DATABASE_URL: connection }, committed, withDatabase,
    beforeContract: async () => { throw Error("not serving"); },
  }), /not serving/);
  assert.equal(opened, false);
});

test("dry migration only reads an existing control plane and reports a pending committed phase", async () => {
  const queries: string[] = [];
  await applyControlPlaneMigrations([...expandArgs, "--dry"], { env: buildEnv, committed,
    withDatabase: async (_connection, operation) => operation({ query: async statement => {
      queries.push(statement);
      return statement.includes("to_regclass") ? [{ schema: "cp_schema_version", journal: null }] : [];
    } }),
  });
  assert.equal(queries.length, 1);
  assert.ok(queries.every(query => query.startsWith("SELECT")));
});

test("wrong database, applied hash drift and missing expand never issue DDL", async () => {
  for (const scenario of ["database", "hash", "phase"] as const) {
    const queries: string[] = [];
    const phase = scenario === "phase" ? "contract" : "expand";
    await assert.rejects(applyControlPlaneMigrations(
      phase === "expand" ? expandArgs : ["--target=production", "--phase=contract", "--production-runtime"], {
        env: { ...buildEnv, WTP_RUNTIME_MODE: "production" }, committed, beforeContract: async () => {},
        withDatabase: async (_connection, operation) => operation({ query: async statement => {
          queries.push(statement);
          if (statement.includes("to_regclass")) return [{ schema: scenario === "database" ? null : "cp_schema_version", journal: "cp_migrations" }];
          return scenario === "hash" ? [{ id: "CP-01_expand", hash: "changed" }] : [];
        } }),
      }), /REFUSED/);
    assert.ok(queries.every(query => query.startsWith("SELECT")));
  }
});

test("expand retains old writers; contract catches overlap prices, deletes temporary capture and archives closed work", async () => {
  const db = new PGlite();
  const sql = { query: async (statement: string, params: readonly unknown[] = []) => (await db.query<Record<string, unknown>>(statement, [...params])).rows };
  const queries: string[] = [];
  try {
    const skipped = new Set([...CONTROL_READS_EXPAND_DDL, ADMIN_SECTIONS_STRIP_DDL, CP_MIGRATIONS_DDL]);
    for (const statement of BOOTSTRAP_DDL) if (!skipped.has(statement)) await sql.query(statement.replace("CREATE INDEX CONCURRENTLY", "CREATE INDEX"));
    await sql.query("CREATE TABLE cp_spend_window (id text PRIMARY KEY, value jsonb)");
    const first = entry("before");
    const stored = { ...pricedModelCharge(first, costRecordId(first))!, usd: 7, knownUsd: 7 };
    await sql.query("INSERT INTO cp_spend_window VALUES ('model-charges',$1::jsonb)", [JSON.stringify({ charges: [stored] })]);
    await sql.query("INSERT INTO cp_log_costs(log_key,record_id,position,recorded_at,record) VALUES ('work','before',0,$1,$2::jsonb)", [now, JSON.stringify(first)]);
    await sql.query("INSERT INTO cp_occurrences(id,revision,updated_at,value) VALUES ('done',1,$1,$2::jsonb)", [now, JSON.stringify({ occurrenceId: "done", workItemId: "work-done", routeTaskId: "task-done", closedAt: now })]);
    await sql.query("INSERT INTO cp_work_items(id,revision,updated_at,value) VALUES ('work-done',1,$1,'{}')", [now]);
    await sql.query("INSERT INTO cp_route_tasks(id,revision,updated_at,value) VALUES ('task-done',1,$1,$2::jsonb)", [now, JSON.stringify({ workItemId: "work-done", state: "DISPOSED" })]);
    const watched = { query: async (statement: string, params?: readonly unknown[]) => { queries.push(statement); return sql.query(statement, params); } };
    const withDatabase = async <T>(_connection: string, operation: (value: Sql) => Promise<T>) => operation(watched);
    await applyControlPlaneMigrations(expandArgs, { env: buildEnv, committed, withDatabase });
    const beforeRepeat = queries.length;
    await applyControlPlaneMigrations(expandArgs, { env: buildEnv, committed, withDatabase });
    assert.ok(queries.slice(beforeRepeat).every(query => query.startsWith("SELECT")), "completed migration retries do not write");
    assert.equal((await sql.query("SELECT count(*) AS n FROM cp_occurrences"))[0].n, 1);
    assert.ok((await sql.query("SELECT to_regclass('cp_spend_window') AS held"))[0].held);
    const next = entry("during");
    const nextPriced = { ...pricedModelCharge(next, costRecordId(next))!, usd: 11, knownUsd: 11 };
    await sql.query("INSERT INTO cp_log_costs(log_key,record_id,position,recorded_at,record) VALUES ('work','during',1,$1,$2::jsonb)", [now, JSON.stringify(next)]);
    await sql.query("UPDATE cp_spend_window SET value = $1::jsonb", [JSON.stringify({ charges: [stored, nextPriced] })]);
    const spend = pgSpendRepository(sql);
    const query = { since: "2026-10-14T12:00:00.000Z", until: now };
    assert.equal((await spend.aggregate(query)).usd, 18, "the deployed reader sees exact overlap prices before contract");
    const contractArgs = ["--target=production", "--phase=contract", "--production-runtime"];
    const contractDeps = { env: { ...buildEnv, WTP_RUNTIME_MODE: "production", WTP_CONTROL_PLANE_DATABASE_URL: connection },
      committed, withDatabase, beforeContract: async () => {} };
    await applyControlPlaneMigrations(contractArgs, contractDeps);
    await applyControlPlaneMigrations(contractArgs, contractDeps);
    assert.deepEqual((await sql.query("SELECT id FROM cp_migrations ORDER BY id")).map(row => row.id), ["CP-01_contract", "CP-01_expand"]);
    assert.equal((await spend.aggregate(query)).usd, 18);
    assert.deepEqual((await spend.metrics(query)).cache, cacheHitRateByRole({ costs: [stored.metered, nextPriced.metered], results: [] }));
    assert.deepEqual(await sql.query("SELECT to_regclass('cp_spend_window') AS old, to_regclass('cp01_spend_capture') AS queue"), [{ old: null, queue: null }]);
    assert.equal((await sql.query("SELECT count(*) AS n FROM cp_occurrences"))[0].n, 0);
    assert.equal((await sql.query("SELECT count(*) AS n FROM cp_occurrences_archive"))[0].n, 1);
    assert.ok(queries.filter(text => text.startsWith("SELECT held.charge") || text.startsWith("SELECT log_key, position, record")).every(text => text.includes("LIMIT 100")));
  } finally { await db.close(); }
});
