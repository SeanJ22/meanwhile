import { openFixturePgRepositories } from "./helpers/pg-repositories.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { createLedger } from "../lib/control-plane/budget.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  DurableSpendHolds,
  JobSpend,
  SETTLED_HOLD_RETENTION_MS,
  SPEND_HOLD_STALE_MS,
  SPEND_HOLD_WINDOW_MS,
  decideHold,
  readLiveSpendHolds,
  releaseOpenJobs,
  spendHoldsTableEnabled,
  type BudgetLine,
  type BudgetLines,
  type InProcessSpendHoldStore,
} from "../lib/control-plane/expansion/spend-holds.ts";
import {
  ADMIT_SPEND_HOLD_FUNCTION_DDL,
  ADMIT_SPEND_HOLD_MARKER,
  BOOTSTRAP_DDL,
  BOOTSTRAP_VERSION,
  DECLARED_TABLES,
  SPEND_HOLDS_INDEXES,
  SPEND_HOLDS_INDEXES_DDL,
  SPEND_HOLDS_MOVE_DDL,
  SPEND_HOLDS_TABLE_DDL,
  spendHoldDeadSql,
  spendHoldLiveSql,
} from "../lib/control-plane/repository/pg-schema.ts";
import { pgSpendHoldRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";

const NOW = "2026-10-06T12:00:00.000Z";
const at = (ms: number): string => new Date(Date.parse(NOW) + ms).toISOString();
const heldRows = (r: { readonly spendHolds?: unknown }) => (r.spendHolds as InProcessSpendHoldStore).rows();
const send = (budgetUsd: number, extra: Partial<BudgetLine> = {}): BudgetLine =>
  ({ key: "send:one", label: "the Bisbee Send", budgetUsd, historicalUsd: 0, historyReadAt: NOW, ...extra });
const area = (budgetUsd: number, extra: Partial<BudgetLine> = {}): BudgetLine =>
  ({ key: "area:zip-85603", label: "ZIP 85603", budgetUsd, historicalUsd: 0, historyReadAt: NOW, ...extra });

function table(now: () => string, env: Record<string, string> = {}) {
  const repos = createMemoryRepositories();
  return { repos, spend: new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now, sleep: async () => undefined, env }) };
}

/* ------------------------------------------------------------ (a) atomic admission */

test("concurrent admissions on one line admit exactly what fits, and every one lands in the table, not the ledger row", async () => {
  const { repos, spend } = table(() => NOW);
  const line = send(0.7);
  const verdicts = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    new JobSpend(spend, `job-${i}`, `ob-${i}`, { sends: [line], areas: i % 2 ? [area(100)] : [] }).admit(0.1, `job ${i}`)));
  assert.equal(verdicts.filter((v) => v.admit).length, 7, "$0.70 holds exactly seven $0.10 jobs");
  assert.equal(Object.keys(heldRows(repos)).length, 7);
  await assert.rejects(repos.budget.read(), /no shared budget has been installed/, "the ledger row was never written");
});

/** A fake database that answers the admission as `cp_admit_spend_hold` would, and records every statement. */
function fakeDb(decision: unknown) {
  const seen: { text: string; params: readonly unknown[] }[] = [];
  const sql: Sql = {
    query: async (text, params = []) => {
      seen.push({ text, params });
      return text.includes("cp_admit_spend_hold(") ? [{ decision }] : [];
    },
  };
  return { seen, store: pgSpendHoldRepository(sql) };
}

test("Postgres: an admission is ONE statement calling cp_admit_spend_hold with the hold, the lines and the rule's lengths", async () => {
  const { seen, store } = fakeDb({ admit: true, hold: null });
  const lines: BudgetLines = { sends: [send(5, { lifetime: true })], areas: [area(3)] };
  await store.admit({ holdId: "job#0", jobId: "job", obligationId: "ob", lines, usd: 0.25, what: "one Scout job" }, NOW);
  assert.equal(seen.length, 1, "decide and write are one round trip");
  assert.match(seen[0]!.text, /^SELECT cp_admit_spend_hold\(\$1::jsonb, \$2::jsonb, \$3::timestamptz, \$4::bigint, \$5::bigint, \$6::bigint, \$7::integer\)/);
  const [hold, sentLines, now, windowMs, staleMs, retentionMs] = seen[0]!.params;
  assert.deepEqual(JSON.parse(hold as string), { holdId: "job#0", jobId: "job", obligationId: "ob", usd: 0.25, what: "one Scout job" });
  assert.deepEqual(JSON.parse(sentLines as string), {
    sends: [{ key: "send:one", budgetUsd: 5, historicalUsd: 0, historyReadAt: NOW, lifetime: true }],
    areas: [{ key: "area:zip-85603", budgetUsd: 3, historicalUsd: 0, historyReadAt: NOW, lifetime: false }],
  });
  assert.deepEqual([now, windowMs, staleMs, retentionMs], [NOW, SPEND_HOLD_WINDOW_MS, SPEND_HOLD_STALE_MS, SETTLED_HOLD_RETENTION_MS]);
  /* A worst case that is not a measured amount reaches the database as null, and is refused in decideHold's words. */
  const invalid = fakeDb({ admit: false, refusal: "AMOUNT" });
  const refused = await invalid.store.admit({ holdId: "x#0", jobId: "x", obligationId: "ob", lines, usd: Number.NaN, what: "a job" }, NOW);
  assert.equal(JSON.parse(invalid.seen[0]!.params[0] as string).usd, null);
  assert.deepEqual(refused, decideHold(createLedger({ hosts: [] }), { holdId: "x#0", jobId: "x", obligationId: "ob", lines, usd: Number.NaN, what: "a job", now: NOW }).result);
});

test("Postgres: the database's refusals are worded exactly as decideHold words the same state", async () => {
  /* A ledger holding $0.95 on both lines: the Send has $0.05 left, the area $2.05. */
  const prior = { holdId: "p#0", jobId: "p", obligationId: "ob", keys: ["send:one", "area:zip-85603"], usd: 0.95, heldAt: NOW, what: "p", settled: null };
  const ledger = { ...createLedger({ hosts: [] }), spendHolds: { [prior.holdId]: prior } };
  const cases: { lines: BudgetLines; usd: number; db: unknown }[] = [
    { lines: { sends: [send(1), send(1, { key: "send:two", label: "another Send", historicalUsd: 0.99 })], areas: [] }, usd: 0.5, db: { admit: false, refusal: "SEND", left: 0.05 } },
    { lines: { sends: [], areas: [area(3)] }, usd: 2.5, db: { admit: false, refusal: "AREA", left: 2.05, position: 0 } },
    { lines: { sends: [send(10, { key: "send:other" }), send(1, { lifetime: true, label: "the hunt" })], areas: [area(30)] }, usd: 0.5, db: { admit: false, refusal: "AREA", left: 0.05, position: 1 } },
  ];
  for (const c of cases) {
    const input = { holdId: "new#0", jobId: "new", obligationId: "ob", lines: c.lines, usd: c.usd, what: "one Scout job" };
    const expected = decideHold(ledger, { ...input, now: NOW }).result;
    assert.equal(expected.admit, false);
    assert.deepEqual(await fakeDb(c.db).store.admit(input, NOW), expected);
  }
  /* A decision the store cannot read is a failure, never an admission. */
  await assert.rejects(fakeDb({ admit: false, refusal: "SOMETHING" }).store.admit({ holdId: "q#0", jobId: "q", obligationId: "ob", lines: cases[0]!.lines, usd: 1, what: "w" }, NOW));
});

test("Postgres: settle is one UPDATE by job (first hold by time, the rest zero), release one DELETE, and live reads filter in the database", async () => {
  const { seen, store } = fakeDb(null);
  await store.settle({ jobId: "job", usd: 0.02, costRecordedAt: at(1_000) }, NOW);
  assert.match(seen[0]!.text, /row_number\(\) OVER \(ORDER BY h\.held_at, h\.hold_id COLLATE "C"\)/, "ordered as settleHolds orders, by bytes");
  assert.match(seen[0]!.text, /WHERE h\.job_id = \$4 AND h\.cost_recorded_at IS NULL/);
  assert.match(seen[0]!.text, /CASE WHEN mine\.n = 1 THEN greatest\(0, \$5::numeric\) ELSE 0 END/);
  assert.deepEqual(seen[0]!.params.slice(3), ["job", 0.02, at(1_000)]);
  assert.match(seen[1]!.text, /^DELETE FROM cp_spend_holds x WHERE x\.hold_id IN \(SELECT h\.hold_id FROM cp_spend_holds h[\s\S]*LIMIT \$4::integer\)/, "a settle sweeps, bounded");
  seen.length = 0;
  await store.settle({ jobId: "job", usd: null, costRecordedAt: NOW }, NOW);
  assert.equal(seen.length, 1, "unmeasured: nothing is settled (the holds stand); only the sweep runs");
  assert.match(seen[0]!.text, /^DELETE/);
  seen.length = 0;
  await store.release("job#0", NOW);
  assert.deepEqual([seen[0]!.text, seen[0]!.params], ["DELETE FROM cp_spend_holds WHERE hold_id = $1 RETURNING hold_id", ["job#0"]]);
  seen.length = 0;
  await store.liveFor(["send:one", "send:one", "area:z"], NOW);
  assert.match(seen[0]!.text, /WHERE h\.keys && \$4::text\[\] AND \(\(cardinality/, "the GIN overlap on the lines asked for");
  assert.deepEqual(seen[0]!.params, [at(-SPEND_HOLD_WINDOW_MS), at(-SPEND_HOLD_STALE_MS), at(-SETTLED_HOLD_RETENTION_MS), ["send:one", "area:z"]]);
  assert.deepEqual(await store.liveFor([], NOW), {}, "no lines, no read");
});

test("the admission function: locks each line in one order, deletes what no longer counts on them, then decides as decideHold does", () => {
  const ddl = ADMIT_SPEND_HOLD_FUNCTION_DDL;
  assert.match(ddl, /array_agg\(DISTINCT e->>'key' ORDER BY e->>'key'\)/, "the lines, sorted, so two admissions never deadlock");
  assert.match(ddl, /pg_advisory_xact_lock\(hashtextextended\('cp_spend_holds:' \|\| k, 0\)\)/, "held to the end of the statement's transaction");
  assert.ok(ddl.indexOf("pg_advisory_xact_lock") < ddl.indexOf("DELETE FROM cp_spend_holds"), "locked before anything is read or deleted");
  assert.match(ddl, /WHERE d\.keys && line_keys AND [\s\S]*? LIMIT prune_limit/, "the dead holds on its lines, bounded");
  assert.ok(ddl.indexOf("LIMIT prune_limit") < ddl.indexOf("Idempotent by hold id"), "an expired hold of the same id is gone before idempotence is judged");
  assert.match(ddl, /round\(\(\(l->>'budgetUsd'\)::numeric - [\s\S]*?\* 1000000000\) \/ 1000000000/, "left normalized at nanodollar precision, as leftUsd");
  assert.match(ddl, /h\.cost_recorded_at > \(l->>'historyReadAt'\)::timestamptz THEN h\.settled_usd/, "settled spend counts only after the line's history read");
  assert.match(ddl, /coalesce\(\(l->>'lifetime'\)::boolean, false\) OR h\.held_at >= win/, "lifetime lines have no window");
  assert.match(ddl, /IF line_left >= amount THEN fits := true; EXIT;/, "one Send with room suffices");
  assert.match(ddl, /IF line_left IS NULL OR line_left < amount THEN/, "every area and lifetime Send must have room");
  assert.match(ddl, /ORDER BY part, n/, "areas first, then lifetime Sends, as everyLineMustFit orders them");
  assert.match(ddl, /ON CONFLICT \(hold_id\) DO NOTHING/);
  assert.match(ddl, new RegExp(`prosrc LIKE '%${ADMIT_SPEND_HOLD_MARKER}%'`), "replaced only when the installed body is not this one");
  assert.match(ddl, new RegExp(`-- ${ADMIT_SPEND_HOLD_MARKER}`));
  /* Live and dead are exact complements. */
  assert.equal(spendHoldLiveSql("h", "w", "s", "k"),
    "((cardinality(h.lifetime_keys) > 0 OR h.held_at >= w) AND CASE WHEN h.cost_recorded_at IS NULL THEN h.held_at >= s ELSE h.cost_recorded_at >= k END)");
  assert.equal(spendHoldDeadSql("h", "w", "s", "k"),
    "((h.cost_recorded_at IS NULL AND h.held_at < s) OR (h.cost_recorded_at IS NOT NULL AND h.cost_recorded_at < k) OR (cardinality(h.lifetime_keys) = 0 AND h.held_at < w))");
});

/* ------------------------------------------------------------ (b) never accumulated */

test("settled and stale holds are deleted: many rounds of admit and settle leave only what still counts", async () => {
  let now = NOW;
  const { repos, spend } = table(() => now);
  const line = send(5, { lifetime: true });
  let most = 0;
  for (let round = 0; round < 60; round += 1) {
    const jobs = Array.from({ length: 10 }, (_, i) => new JobSpend(spend, `scout:${round}:${i}`, `ob-${i}`, { sends: [line], areas: [] }));
    for (const job of jobs) assert.equal((await job.admit(0.04, "a job")).admit, true, `round ${round}`);
    /* Half the round's jobs settle; the round is then killed, so the rest never do. */
    for (const job of jobs.slice(0, 5)) assert.equal(await spend.settle(job.jobId, 0.01, now), null);
    most = Math.max(most, Object.keys(heldRows(repos)).length);
    now = at((round + 1) * 30 * 60_000);
  }
  /* 30-minute rounds: a settled hold counts 6 h (12 rounds x 5), an unsettled one 2 h (4 rounds x 5), plus the round in flight. */
  assert.ok(most <= 12 * 5 + 4 * 5 + 10, `the table stays bounded (most ${most} rows over 600 holds taken)`);
  now = at(61 * 30 * 60_000 + SETTLED_HOLD_RETENTION_MS);
  assert.ok((await spend.sweep())! > 0, "the sweep deletes, it does not only hide");
  assert.deepEqual(heldRows(repos), {}, "once nothing counts, nothing is kept");
});

test("a round's end settles its open jobs and sweeps; nothing is read off or written to the ledger row", async () => {
  let now = NOW;
  const { repos, spend } = table(() => now);
  const job = new JobSpend(spend, "scout:r:0:ob", "ob", { sends: [send(1)], areas: [] });
  await job.admit(0.04, "a job");
  now = at(60_000);
  assert.deepEqual(await releaseOpenJobs(spend, [job], now), []);
  assert.equal(heldRows(repos)["scout:r:0:ob#0"]?.settled?.usd, 0);
  now = at(SETTLED_HOLD_RETENTION_MS + 120_000);
  assert.equal(await spend.sweep(), 1);
  assert.deepEqual(heldRows(repos), {});
  await assert.rejects(repos.budget.read(), /no shared budget has been installed/);
});

/* ------------------------------------------------------------ (c) the one-time move */

test("the v24 move: the ledger row is locked, its holds copied (an id already moved is kept), emptied with the revision bumped, and a re-run finds nothing", () => {
  const ddl = SPEND_HOLDS_MOVE_DDL;
  assert.match(ddl, /SELECT value->'spendHolds' INTO held FROM cp_budget WHERE id = 'shared-budget-ledger' FOR UPDATE;/, "a writer mid compare-and-set waits, then retries on the emptied row");
  assert.match(ddl, /IF held IS NULL OR jsonb_typeof\(held\) <> 'object' OR held = '\{\}'::jsonb THEN RETURN; END IF;/, "nothing to move: no write, no revision");
  assert.match(ddl, /FROM jsonb_each\(held\) AS e[\s\S]*ON CONFLICT \(hold_id\) DO NOTHING;/);
  assert.match(ddl, /UPDATE cp_budget SET value = jsonb_set\(value, '\{spendHolds\}', '\{\}'::jsonb\), revision = revision \+ 1, changed_at = now\(\)/);
  assert.ok(ddl.indexOf("INSERT INTO cp_spend_holds") < ddl.indexOf("UPDATE cp_budget"), "copied before the row is emptied");
  assert.doesNotMatch(ddl, /'\{hosts|vendors|credentials/, "the ledger row's other fields are untouched");
});

function recordingSql() {
  const statements: string[] = [];
  const sql: Sql = {
    query: async (text) => {
      statements.push(text);
      return text.includes("indisvalid") ? [{ valid: true, building: false }] : [];
    },
  };
  return { sql, statements };
}

test("the bootstrap runs the move by default and skips it behind WTP_SPEND_HOLDS_TABLE=0", async () => {
  const before = process.env.WTP_SPEND_HOLDS_TABLE;
  try {
    delete process.env.WTP_SPEND_HOLDS_TABLE;
    const on = recordingSql();
    await openFixturePgRepositories(on.sql, NOW);
    assert.ok(on.statements.includes(SPEND_HOLDS_MOVE_DDL));
    assert.ok(on.statements.includes(ADMIT_SPEND_HOLD_FUNCTION_DDL));
    const versionAt = on.statements.findIndex(text => text.startsWith("INSERT INTO cp_schema_version"));
    assert.ok(versionAt >= 0);
    assert.match(on.statements[versionAt]!, new RegExp(`VALUES \\(true, ${BOOTSTRAP_VERSION},`));
    assert.ok(on.statements.every((text, index) => !BOOTSTRAP_DDL.includes(text) || index < versionAt),
      "the schema version is recorded only after every bootstrap statement");
    process.env.WTP_SPEND_HOLDS_TABLE = "0";
    const off = recordingSql();
    await openFixturePgRepositories(off.sql, NOW);
    assert.ok(!off.statements.includes(SPEND_HOLDS_MOVE_DDL), "the way back leaves the holds on the row");
    assert.ok(off.statements.includes(SPEND_HOLDS_TABLE_DDL), "the table still exists, so switching on later needs no other step");
  } finally {
    if (before === undefined) delete process.env.WTP_SPEND_HOLDS_TABLE; else process.env.WTP_SPEND_HOLDS_TABLE = before;
  }
});

/* ------------------------------------------------------------ (d) the switch */

test("WTP_SPEND_HOLDS_TABLE=0 keeps the ledger row path; anything else is the table", async () => {
  assert.equal(spendHoldsTableEnabled({}), true);
  assert.equal(spendHoldsTableEnabled({ WTP_SPEND_HOLDS_TABLE: "1" }), true);
  assert.equal(spendHoldsTableEnabled({ WTP_SPEND_HOLDS_TABLE: "0" }), false);
  const { repos, spend } = table(() => NOW, { WTP_SPEND_HOLDS_TABLE: "0" });
  const job = new JobSpend(spend, "job", "ob", { sends: [send(1)], areas: [] });
  assert.equal((await job.admit(0.6, "a job")).admit, true);
  assert.deepEqual(Object.keys((await repos.budget.read()).value.spendHolds ?? {}), ["job#0"], "held on the ledger row");
  assert.deepEqual(heldRows(repos), {}, "the table is not touched");
  assert.equal((await new JobSpend(spend, "job2", "ob", { sends: [send(1)], areas: [] }).admit(0.6, "a job")).admit, false, "and the ledger row still caps");
  assert.deepEqual(Object.keys(await readLiveSpendHolds(repos, NOW, { WTP_SPEND_HOLDS_TABLE: "0" })), ["job#0"], "readers follow the switch");
});

test("a holds table the store cannot reach refuses the hold, by name: nothing runs unbudgeted", async () => {
  const repos = createMemoryRepositories();
  const broken = { ...repos.spendHolds!, admit: async () => { throw new Error("connection refused"); } };
  const spend = new DurableSpendHolds({ budget: repos.budget, table: broken, now: () => NOW });
  const verdict = await new JobSpend(spend, "job", "ob", { sends: [], areas: [area(100)] }).admit(0.1, "one Scout job");
  assert.equal(verdict.admit, false);
  assert.match(!verdict.admit ? `${verdict.code} ${verdict.why}` : "", /^SCOPE_BUDGET .*could not be read or written \(connection refused\)/);
});

/* ------------------------------------------------------------ (e) the readers */

test("readers (Admin's Set aside, the round's Fleet window) read live holds from the table, never the ledger row", async () => {
  const { repos, spend } = table(() => NOW);
  /* A stale hold left on the ledger row is not what readers see. */
  const stray = { holdId: "old#0", jobId: "old", obligationId: "ob", keys: ["send:one"], usd: 9, heldAt: NOW, what: "w", settled: null };
  await repos.budget.install({ ...createLedger({ hosts: [] }), spendHolds: { [stray.holdId]: stray } }, NOW);
  await new JobSpend(spend, "live", "ob", { sends: [send(1)], areas: [] }).admit(0.3, "a job");
  const settled = new JobSpend(spend, "done", "ob", { sends: [send(1)], areas: [] });
  await settled.admit(0.3, "a job");
  await spend.settle("done", 0.1, NOW);
  assert.deepEqual(Object.keys(await readLiveSpendHolds(repos, NOW)).sort(), ["done#0", "live#0"]);
  assert.deepEqual(Object.keys(await readLiveSpendHolds(repos, at(SPEND_HOLD_STALE_MS + 1))), ["done#0"], "an unsettled hold past the stale line is not Set aside");
  assert.deepEqual(await readLiveSpendHolds(repos, at(SETTLED_HOLD_RETENTION_MS + 1)), {});
});

/* ------------------------------------------------------------ the schema */

test("schema version 24: cp_spend_holds, its indexes, the admission function and the move, after cp_budget exists", () => {
  assert.ok(BOOTSTRAP_VERSION >= 24);
  assert.ok(DECLARED_TABLES.includes("cp_spend_holds"));
  for (const column of ["hold_id          text PRIMARY KEY", "job_id           text NOT NULL", "keys             text[] NOT NULL",
    "lifetime_keys    text[] NOT NULL DEFAULT '{}'", "usd              numeric NOT NULL", "held_at          timestamptz NOT NULL",
    "settled_usd      numeric,", "cost_recorded_at timestamptz,", "changed_at       timestamptz NOT NULL DEFAULT now()"]) {
    assert.ok(SPEND_HOLDS_TABLE_DDL.includes(column), column);
  }
  assert.deepEqual(SPEND_HOLDS_INDEXES.map((i) => i.name),
    ["cp_spend_holds_keys", "cp_spend_holds_job", "cp_spend_holds_unsettled", "cp_spend_holds_settled", "cp_spend_holds_held_at"]);
  assert.match(SPEND_HOLDS_INDEXES_DDL, /IF to_regclass\('cp_spend_holds_keys'\) IS NULL THEN\s+CREATE INDEX IF NOT EXISTS cp_spend_holds_keys ON cp_spend_holds USING gin \(keys\);/, "a current database takes no lock");
  assert.match(SPEND_HOLDS_INDEXES_DDL, /cp_spend_holds \(held_at\) WHERE cost_recorded_at IS NULL/);
  const order = [SPEND_HOLDS_TABLE_DDL, SPEND_HOLDS_INDEXES_DDL, ADMIT_SPEND_HOLD_FUNCTION_DDL, SPEND_HOLDS_MOVE_DDL].map((s) => BOOTSTRAP_DDL.indexOf(s));
  assert.ok(order.every((i) => i >= 0) && order.every((i, n) => n === 0 || i > order[n - 1]!), "table, indexes, function, then the move");
  assert.ok(BOOTSTRAP_DDL.findIndex((s) => s.includes("CREATE TABLE IF NOT EXISTS cp_budget")) < order[3]!, "the ledger row's table exists before the move reads it");
});
