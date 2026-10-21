import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CONTROL_READS_BACKFILL_DDL } from "../lib/control-plane/repository/control-reads-backfill.ts";
import { pgAggregateRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { stampDebtStates } from "../lib/control-plane/repository/migrations/DT-01.ts";
import { recordFailure, type FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";
import { debtStateOf, persistDebts, type StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";

const NOW = "2026-10-20T12:00:00.000Z";
const LATER = "2026-10-20T13:00:00.000Z";
const failure = (obligationId: string, at = NOW): FreshnessDebt => recordFailure(null, {
  obligationId, cause: "UPSTREAM_ERROR", detail: "host refused", target: "meetings-1", dueAt: NOW, now: at });

async function database() {
  const db = new PGlite();
  await db.exec(CONTROL_READS_BACKFILL_DDL[0]);
  for (const table of ["cp_debts", "cp_obligations"])
    await db.exec(`CREATE TABLE ${table}(id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now())`);
  const sql: Sql = { query: async (text, params = []) => (await db.query(text, [...params])).rows };
  const planner = (state: string) => ({ planningState: state,
    debts: pgAggregateRepository<FreshnessDebt>(sql, "FreshnessDebt", "cp_debts", { state }) }) as unknown as ControlPlaneRepositories;
  const obligation = (id: string, subjectId: string) => sql.query("INSERT INTO cp_obligations(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)",
    [id, NOW, JSON.stringify({ id, subjectId, active: true } as unknown as StandingObligation)]);
  const row = async (id: string) => ((await sql.query("SELECT revision, value FROM cp_debts WHERE id=$1", [id])) as { revision: number; value: FreshnessDebt }[])[0];
  return { db, sql, planner, obligation, row };
}

test("a state's planner saves its debts twice, including debts saved before they carried a state", async () => {
  const { db, sql, planner, obligation, row } = await database();
  try {
    const ak = "freshness:jurisdiction:ak:county:kenai#meetings-1", nj = "freshness:jurisdiction:nj:county:essex#meetings-1";
    await obligation(ak, "ak:county:kenai"); await obligation(nj, "nj:county:essex");
    await sql.query("INSERT INTO cp_debts(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)", [ak, NOW, JSON.stringify(failure(ak))]);
    assert.equal((await planner("ak").debts.list()).length, 0, "a debt without a state is not in its state's list");

    const failed = failure(ak, LATER);
    assert.deepEqual(await persistDebts(planner("ak"), [failed], LATER), { written: 1, cleared: [], clearedAsRetired: [] });
    assert.equal((await row(ak)).value.state, "ak");
    assert.equal((await row(ak)).revision, 2);
    assert.deepEqual((await planner("ak").debts.list()).map(held => held.id), [ak]);

    assert.deepEqual(await persistDebts(planner("ak"), [failed], LATER), { written: 0, cleared: [], clearedAsRetired: [] }, "run 2 writes nothing and does not crash");
    assert.deepEqual(await persistDebts(planner("nj"), [failure(nj)], NOW), { written: 1, cleared: [], clearedAsRetired: [] });
    assert.equal((await row(nj)).value.state, "nj");
    assert.deepEqual((await planner("ak").debts.list()).map(held => held.id), [ak], "each state lists only its own");
  } finally { await db.close(); }
});

test("a debt that fails again keeps its state when saved, and a discharged debt is found by its state", async () => {
  const { db, planner, obligation, row } = await database();
  try {
    const id = "freshness:jurisdiction:az:place:tempe#meetings-1";
    await obligation(id, "az:place:tempe");
    await persistDebts(planner("az"), [failure(id)], NOW);
    const second = recordFailure((await row(id)).value, { obligationId: id, cause: "UPSTREAM_ERROR", detail: "again", target: "meetings-1", dueAt: NOW, now: LATER });
    await persistDebts(planner("az"), [second], LATER);
    assert.equal((await row(id)).value.consecutiveFailures, 2);
    assert.equal((await row(id)).value.state, "az");
    assert.deepEqual(await persistDebts(planner("az"), [], LATER), { written: 0, cleared: [id], clearedAsRetired: [] });
    assert.equal((await row(id)).value.consecutiveFailures, 0);
  } finally { await db.close(); }
});

test("DT-01 gives old debts the state of their obligation, once, and changes nothing else", async () => {
  const { db, sql, obligation, row } = await database();
  try {
    const ids = { ak: "freshness:jurisdiction:ak:county:kenai#meetings-1", nh: "freshness:jurisdiction:nh:county:coos#meetings-1",
      system: "freshness:ask-gap:national#ask-1", orphan: "freshness:jurisdiction:ca:county:orphan#meetings-1",
      named: "hunt:packet:government:US-AZ:04019", already: "freshness:jurisdiction:nj:county:essex#meetings-1" };
    await obligation(ids.ak, "ak:county:kenai"); await obligation(ids.nh, "nh:county:coos");
    await obligation(ids.system, "national"); await obligation(ids.named, "government:US-AZ:04019"); await obligation(ids.already, "nj:county:essex");
    for (const id of Object.values(ids)) await sql.query("INSERT INTO cp_debts(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb)",
      [id, NOW, JSON.stringify(id === ids.already ? { ...failure(id), state: "nj" } : failure(id))]);
    const before = await Promise.all(Object.values(ids).map(async id => (await row(id))));

    assert.equal(await stampDebtStates(sql), 2, "only the AK and NH debts needed a state");
    assert.equal((await row(ids.ak)).value.state, "ak");
    assert.equal((await row(ids.nh)).value.state, "nh");
    assert.equal((await row(ids.ak)).revision, 2);
    for (const id of [ids.system, ids.orphan, ids.named, ids.already]) assert.deepEqual(await row(id), before[Object.values(ids).indexOf(id)]);
    const { state: _ak, ...akWithoutState } = (await row(ids.ak)).value;
    assert.deepEqual(akWithoutState, before[0].value);
    assert.equal(await stampDebtStates(sql), 0, "a second pass changes nothing");
    assert.deepEqual(((await sql.query("SELECT id FROM cp_debts WHERE cp_control_state(value)='ak'")) as { id: string }[]).map(held => held.id), [ids.ak]);
  } finally { await db.close(); }
});

test("a debt's state comes from its id, then the planner that saves it, then its obligation's subject", () => {
  assert.equal(debtStateOf("hunt:packet:government:US-AZ:04019", "ca"), "az");
  assert.equal(debtStateOf("freshness:jurisdiction:ak:county:kenai#meetings-1", "ak"), "ak");
  assert.equal(debtStateOf("freshness:jurisdiction:ak:county:kenai#meetings-1", undefined), "ak");
  assert.equal(debtStateOf("freshness:ask-gap:national#ask-1", "system"), null);
  assert.equal(debtStateOf("freshness:ask-gap:national#ask-1", undefined), null);
  assert.equal(debtStateOf("ob-0", undefined), null);
});

test("without a planning state a debt still finds its held row by id and keeps unstated debts unstated", async () => {
  const repos = createMemoryRepositories();
  const id = "freshness:ask-gap:national#ask-1";
  await persistDebts(repos, [failure(id)], NOW);
  assert.equal((await repos.debts.mustRead(id)).value.state, undefined);
  assert.deepEqual(await persistDebts(repos, [failure(id)], NOW), { written: 0, cleared: [], clearedAsRetired: [] });
});
