import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDirectMigration, directNeonConnectionUrl,
  DirectMigrationNotCommitted, DirectMigrationOutcomeUnknown,
  type DirectMigrationClient, type DirectMigrationPool,
} from "../lib/db/direct-migration.ts";

const input = { tag: "0031_publication_search_backfill", when: 1790597493973, hash: "sha256-exact", statements: ["INSERT INTO derived VALUES (1)"] };

function client(run: (sql: string, values?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>): DirectMigrationClient {
  return { query: async (sql, values) => ({ rows: await run(sql, values) }), release: () => undefined };
}

function pool(...clients: DirectMigrationClient[]): DirectMigrationPool & { readonly connects: () => number } {
  let next = 0;
  return {
    connect: async () => { const chosen = clients[next++]; if (!chosen) throw new Error("NO_TEST_CLIENT"); return chosen; },
    connects: () => next,
  };
}

test("normal direct migration commits statements and exact journal in one transaction", async () => {
  const calls: string[] = [];
  const p = pool(client(async (sql) => { calls.push(sql); return []; }));
  assert.equal(await applyDirectMigration({ ...input, pool: p }), "COMMITTED");
  assert.deepEqual(calls.slice(0, 3), ["BEGIN", "SET LOCAL lock_timeout = '30s'", "SELECT pg_advisory_xact_lock(hashtextextended($1,0))"]);
  assert.equal(calls.filter(x => x === input.statements[0]).length, 1);
  assert.ok(calls.includes("SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at=$1"), "the locked transaction checks for a concurrent applier");
  assert.ok(calls.at(-2)?.startsWith("INSERT INTO drizzle.__drizzle_migrations"));
  assert.equal(calls.at(-1), "COMMIT");
  assert.equal(p.connects(), 1);
});

test("a concurrent applier that won the advisory lock is recognized without repeating any statement", async () => {
  let workCalls = 0;
  const p = pool(client(async sql => {
    if (sql === input.statements[0]) workCalls++;
    return sql.startsWith("SELECT hash FROM") ? [{ hash: input.hash }] : [];
  }));
  assert.equal(await applyDirectMigration({ ...input, pool: p }), "RECONCILED_COMMITTED");
  assert.equal(workCalls, 0);
  assert.equal(p.connects(), 1);
});

test("a conflicting locked journal receipt stops before any migration statement", async () => {
  let workCalls = 0;
  const p = pool(client(async sql => {
    if (sql === input.statements[0]) workCalls++;
    return sql.startsWith("SELECT hash FROM") ? [{ hash: "different" }] : [];
  }));
  await assert.rejects(applyDirectMigration({ ...input, pool: p }), DirectMigrationOutcomeUnknown);
  assert.equal(workCalls, 0);
  assert.equal(p.connects(), 1);
});

test("connection loss before COMMIT with absent journal is refused without retry", async () => {
  let workCalls = 0;
  const main = client(async sql => {
    if (sql === input.statements[0]) { workCalls++; throw new Error("connection lost before commit"); }
    if (sql === "ROLLBACK") throw new Error("connection lost");
    return [];
  });
  const recovery = client(async sql => sql.startsWith("SELECT hash FROM") ? [] : []);
  const p = pool(main, recovery);
  await assert.rejects(applyDirectMigration({ ...input, pool: p }), DirectMigrationNotCommitted);
  assert.equal(workCalls, 1);
  assert.equal(p.connects(), 2);
});

test("lost COMMIT acknowledgment is accepted only after matching journal and lock", async () => {
  const recoveryCalls: string[] = [];
  const main = client(async sql => {
    if (sql === "COMMIT") throw new Error("acknowledgment lost");
    return [];
  });
  const recovery = client(async sql => {
    recoveryCalls.push(sql);
    return sql.startsWith("SELECT hash FROM") ? [{ hash: input.hash }] : [];
  });
  assert.equal(await applyDirectMigration({ ...input, pool: pool(main, recovery) }), "RECONCILED_COMMITTED");
  assert.ok(recoveryCalls.indexOf("SELECT pg_advisory_xact_lock(hashtextextended($1,0))") < recoveryCalls.findIndex(x => x.startsWith("SELECT hash FROM")));
});

test("recovery advisory-lock timeout leaves the outcome UNKNOWN", async () => {
  const main = client(async sql => { if (sql === "COMMIT") throw new Error("acknowledgment lost"); return []; });
  const recovery = client(async sql => { if (sql.startsWith("SELECT pg_advisory_xact_lock")) throw Object.assign(new Error("lock timeout"), { code: "55P03" }); return []; });
  await assert.rejects(applyDirectMigration({ ...input, pool: pool(main, recovery) }), DirectMigrationOutcomeUnknown);
});

test("a conflicting or duplicate journal row never proves commit", async () => {
  for (const rows of [[{ hash: "different" }], [{ hash: input.hash }, { hash: input.hash }]]) {
    const main = client(async sql => { if (sql === "COMMIT") throw new Error("acknowledgment lost"); return []; });
    const recovery = client(async sql => sql.startsWith("SELECT hash FROM") ? rows : []);
    await assert.rejects(applyDirectMigration({ ...input, pool: pool(main, recovery) }), DirectMigrationOutcomeUnknown);
  }
});

test("an explicit SQL failure with acknowledged ROLLBACK is not reconciled as committed", async () => {
  const p = pool(client(async sql => { if (sql === input.statements[0]) throw new Error("syntax error"); return []; }));
  await assert.rejects(applyDirectMigration({ ...input, pool: p }), DirectMigrationNotCommitted);
  assert.equal(p.connects(), 1);
});

test("direct Neon URL preserves credential and database while leaving the pooler", () => {
  const original = "postgresql://owner:secret@ep-example-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require";
  const direct = new URL(directNeonConnectionUrl(original));
  assert.equal(direct.hostname, "ep-example.c-4.us-east-2.aws.neon.tech");
  assert.equal(direct.username, "owner");
  assert.equal(direct.password, "secret");
  assert.equal(direct.pathname, "/neondb");
  assert.throws(() => directNeonConnectionUrl("postgresql://owner@example.com/neondb"), /DIRECT_MIGRATION_NEON_HOST_REQUIRED/);
});
