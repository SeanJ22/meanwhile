import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { armAssignmentBudget, assignmentCycleReading, assignmentMembership, type AssignmentBudgetSpec } from "../lib/control-plane/expansion/assignment-budget.ts";
import { hasAssignmentReceipt, publishAssignmentCycleReading, readAssignmentCycleHeader, readAssignmentCyclePage, readAssignmentForSend } from "../lib/control-plane/expansion/assignment-reading.ts";
import { createPlannerSpool } from "../lib/control-plane/scheduler/planner-spool.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { evaluateAssignmentFromRecords, evaluateAssignmentFromRecordsCooperatively, evaluateMissionDone, evaluateMissionDoneCooperatively, memberRecordsForSend } from "../lib/control-plane/assignment-completion.ts";
import { RESEARCH_STATE_ID, type ResearchState } from "../lib/control-plane/scheduler/research-policy.ts";
import { DIGEST_LOG_KEY } from "../lib/control-plane/admin-data.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pgAggregateRepository, pgAppendOnlyRepository } from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { FreshnessCycleOutcome, OwnerDigestRecord } from "../lib/control-plane/owner-surface.ts";
import { confirmReceipt } from "../lib/control-plane/gateway/confirmation.ts";
import type { ActionReceipt } from "../lib/control-plane/gateway/contract.ts";
import type { ObligationAssignment } from "../lib/control-plane/scheduler/obligation.ts";
import { assertNeededProductionRead } from "../scripts/rh01-network.mjs";
import { eachStore } from "./control-plane-fixtures.ts";

const now = "2026-10-20T16:00:00.000Z", cycleId = `freshness-cycle:assignment-bounds:${now}`;
const key = "zcta:2020/85635", ref = "scope:target";
async function snapshot(repos: ControlPlaneRepositories) {
  const planner = await createPlannerSpool();
  try {
    const source = planner.table<{ id: string; subjectId: string; assignments: ObligationAssignment[] }>("source", row => row.id);
    for (let n = 0; n < 70; n++) source.add({ id: `work:${n}`, subjectId: `place:${n}`,
      assignments: [{ assignmentKey: n === 69 ? key : `historical:${n}`, ref: n === 69 ? ref : `old:${n}`, relation: "CREATED", at: now }] });
    const membership = assignmentMembership(source.rows, [], planner);
    assert.equal(membership.byKey instanceof Map, false); assert.equal(membership.byInstruction instanceof Map, false);
    assert.equal(membership.byKey.size, 70);
    assert.equal(membership.byKey.keys().take(2).toArray().length, 2, "disk membership keys expose native iterator helpers");
    assert.equal(membership.byInstruction.values().take(1).toArray()[0].created.size, 1);
    const spec: AssignmentBudgetSpec = { key, ref, kind: "SCOPE", label: "Target", budgetUsd: 5, sentAt: now };
    const gate = armAssignmentBudget({ now, specs: [spec], membership, charges: [], worstCaseUsd: 1, intentsReadable: true, planner });
    let completions = 0;
    const reading = assignmentCycleReading({ at: now, now, gate, specs: [spec], membership, charges: [], intentsReadable: true, planner,
      completionFor: assignmentKey => { completions++; return { kind: "COMPLETE", assignmentKey, members: 1, satisfied: [], map: { owed: 1, unfilled: 0, stale: 0, before: 7 } }; } });
    assert.equal(typeof reading.assignments[Symbol.asyncIterator], "function"); assert.equal(reading.assignments.length, 70);
    assert.equal(completions, 0, "constructing the state header does not synchronously evaluate historical Sends");
    const header = await publishAssignmentCycleReading(repos, { cycleId, finishedAt: now, testedSha: null }, reading);
    assert.equal(completions, 70, "page and exact-receipt indexes reuse each frozen completion once");
    assert.equal(header.details?.rows, 70); assert.equal(header.assignments.length, 25);
    assert.ok(!header.assignments.some(row => row.key === key), "the requested Send is deliberately beyond every bounded example");
    await repos.researchState.put(RESEARCH_STATE_ID, { assignments: header } as ResearchState, now);
    await repos.ownerDigests.append(DIGEST_LOG_KEY, cycleId, { formatVersion: 1, digestId: cycleId, writtenAt: now,
      headline: "Native Send reading", lines: [], cycleOk: true, testedSha: null,
      runtimeOutcome: { kind: "FRESHNESS_CYCLE", cycleId, research: { lanes: null, assignmentDetails: header.details } } as FreshnessCycleOutcome }, now);
    return header;
  } finally { await planner.close(); }
}

async function assertExact(repos: ControlPlaneRepositories) {
  const header = await readAssignmentCycleHeader(repos);
  const own = await readAssignmentForSend(repos, header, key, ref);
  assert.equal(own?.completion?.kind, "COMPLETE");
  assert.equal(own?.completion && "map" in own.completion ? own.completion.map?.before : null, 7);
  assert.equal(await readAssignmentForSend(repos, header, key, "older-instruction"), null);
  assert.equal(await hasAssignmentReceipt(repos, header, ref), true);
  const receipt = { type: "expansion.scope.set", outcome: "QUEUED", receiptId: ref, subject: key, label: "Hunt here",
    startedAt: now, completedAt: now, openedWork: [], says: "Saved", huntScores: [{ placeKey: "geo:az.zcta.85635", scopeKey: key,
      assignmentRef: ref, label: "Target", before: { captured: 0, owed: 1, percent: 0, observedAt: now } }] } as unknown as ActionReceipt;
  const confirmation = await confirmReceipt(repos, receipt, Date.parse(now), async () => ({ captured: 1, owed: 1, percent: 100, observedAt: now }));
  assert.equal(confirmation.state, "applied"); assert.match(confirmation.words, /^Done\./);
  const first = await readAssignmentCyclePage(repos, { cycleId, page: 0 });
  assert.equal(first.kind, "READ");
  if (first.kind === "READ") { assert.equal(first.value.total, 70); assert.equal(first.value.rows.length, 32); assert.equal(first.value.nextPage, 1); }
  const last = await readAssignmentCyclePage(repos, { cycleId, page: 2 });
  assert.equal(last.kind, "READ");
  if (last.kind === "READ") { assert.equal(last.value.rows.length, 6); assert.equal(last.value.rows.at(-1)?.key, key); assert.equal(last.value.nextPage, null); }
}

test("historical Send membership and Admin point confirmations remain complete beyond bounded examples in Memory and File", async () => {
  for (const [, repos] of await eachStore("rh01-assignment-reading-")) { await snapshot(repos); await assertExact(repos); }
});

test("PostgreSQL exact Send, receipt and Admin page reads pass the native needed-read guard", async () => {
  const pg = new PGlite(); let guard = false;
  try {
    await pg.exec(`CREATE TABLE cp_log_heads(log_table text,log_key text,next_position bigint,PRIMARY KEY(log_table,log_key));
      CREATE TABLE cp_log_owner_digests(log_key text,record_id text,position bigint,recorded_at timestamptz,record jsonb,changed_at timestamptz DEFAULT now(),PRIMARY KEY(log_key,record_id));
      CREATE TABLE cp_research_state(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL,changed_at timestamptz DEFAULT now());`);
    const sql = { query: async (text: string, params: readonly unknown[] = []) => {
      if (guard) assertNeededProductionRead(text);
      return (await pg.query(text, [...params])).rows;
    } };
    const repos = { ...createMemoryRepositories(), researchState: pgAggregateRepository<ResearchState>(sql, "ResearchState", "cp_research_state"),
      ownerDigests: pgAppendOnlyRepository<OwnerDigestRecord>(sql, "owner_digests") };
    await snapshot(repos); guard = true; await assertExact(repos);
  } finally { await pg.close(); }
});

test("legacy Send arrays are filtered before transfer and retain revision fencing", async () => {
  for (const [, repos] of await eachStore("rh01-assignment-legacy-")) {
    const published = await snapshot(repos), state = await repos.researchState.mustRead(RESEARCH_STATE_ID);
    const own = await readAssignmentForSend(repos, published, key, ref); assert.ok(own);
    const { details, ...legacy } = published; assert.ok(details);
    await repos.researchState.compareAndSet(RESEARCH_STATE_ID, state.revision, { ...state.value, assignments: { ...legacy,
      assignments: [...published.assignments, own] } }, now);
    const header = await readAssignmentCycleHeader(repos);
    assert.equal((await readAssignmentForSend(repos, header, key, ref))?.key, key);
    assert.equal(await hasAssignmentReceipt(repos, header, ref), true);
    const current = await repos.researchState.mustRead(RESEARCH_STATE_ID);
    await repos.researchState.compareAndSet(RESEARCH_STATE_ID, current.revision, { ...current.value, beatAt: now }, now);
    await assert.rejects(readAssignmentForSend(repos, header, key, ref), /ASSIGNMENT_READING_CHANGED/);
  }
});


test("a country Send yields between bounded member batches without changing completion or mission truth", async () => {
  const planner = await createPlannerSpool();
  try {
    const count = 257, source = planner.table<{ id: string; subjectId: string; assignments: ObligationAssignment[] }>("batch-source", row => row.id);
    for (let n = 0; n < count; n++) source.add({ id: `work:${String(n).padStart(4,"0")}`, subjectId: `place:${n}`,
      assignments: [{ assignmentKey: key, ref, relation: "CREATED", at: now }] });
    const membership = assignmentMembership(source.rows, [], planner);
    let lookedUp = 0;
    const rows = memberRecordsForSend(key, membership, id => { lookedUp++; return { id, lastWorkedAt: now, nextDueAt: now }; }, ref, planner);
    assert.equal(lookedUp, 0, "no full Send is hydrated before the first cooperative consumer asks for a member");
    let observedAtYield = -1;
    const observation = new Promise<void>(resolve => setImmediate(() => { observedAtYield = lookedUp; resolve(); }));
    const input = { assignmentKey: key, obligations: rows, debtFor: () => null, now };
    const actual = await evaluateAssignmentFromRecordsCooperatively(input);
    await observation;
    assert.ok(observedAtYield > 0 && observedAtYield <= 64, `native callbacks ran after ${observedAtYield} member reads`);
    assert.equal(lookedUp, count);
    assert.deepEqual(actual, evaluateAssignmentFromRecords(input));
    assert.equal(lookedUp, count, "repeatable reads use only the frozen selected member records");
    const mission = { ...input, map: { owed: count, unfilled: 3, stale: 1, before: 7 } };
    assert.deepEqual(await evaluateMissionDoneCooperatively(mission), evaluateMissionDone(mission));
    assert.ok(rows instanceof DiskRows);
  } finally { await planner.close(); }
});

test("native Send gates keep history, membership, holds and counters as disk point views", async () => {
  const planner = await createPlannerSpool();
  try {
    const membership = assignmentMembership([{ id: "own", subjectId: "place", assignments: [{ assignmentKey: key, ref, relation: "CREATED", at: now }] }], [], planner);
    const spec: AssignmentBudgetSpec = { key, ref, kind: "SCOPE", label: "Target", budgetUsd: 5, sentAt: now };
    const gate = armAssignmentBudget({ now, specs: (function* () { yield spec; })(), membership, charges: [], worstCaseUsd: 1, intentsReadable: true, planner,
      reachedThisCycle: new Map([["own", [key]]]) });
    const held = gate as unknown as Record<string, unknown>;
    for (const field of ["specs", "keysOf", "refsOf", "historical", "cycleUsd", "cycleUnmeasured", "reserved", "reservations", "admittedBy", "refusedBy", "malformed", "reachedThisCycle"])
      assert.equal(held[field] instanceof Map || held[field] instanceof Set, false, `${field} must not retain a country keyed collection`);
    assert.ok(gate.armedReading().specs instanceof DiskRows);
    assert.deepEqual([...gate.armedReading().specs], [spec]);
    assert.deepEqual(gate.admit("own"), { admit: true, runsUnder: key, keys: [key] });
    assert.equal(gate.state(key)?.heldUsd, 1);
    gate.settle("own", 2);
    assert.equal(gate.state(key)?.spentUsd, 2); assert.equal(gate.state(key)?.heldUsd, 0);
    assert.equal(gate.state(key)?.admitted, 1);
  } finally { await planner.close(); }
});


test("unreadable promised Send pages and malformed headers stay unavailable rather than becoming empty readings", async () => {
  const repos = createMemoryRepositories(), header = await snapshot(repos);
  assert.ok(header.details);
  const readRecent = repos.ownerDigests.readRecent.bind(repos.ownerDigests);
  repos.ownerDigests.readRecent = async (log, count) => log === `${header.details!.logKey}:0` ? [] : readRecent(log, count);
  await assert.rejects(readAssignmentCyclePage(repos, { cycleId, page: 0 }), /ASSIGNMENT_READING_PAGE_INVALID/);
  const readExact = repos.ownerDigests.readRecentWhere.bind(repos.ownerDigests);
  repos.ownerDigests.readRecentWhere = async (...args) => args[0].startsWith(`${header.details!.logKey}:ref:`)
    ? [{ digestId: "wrong", freshnessDetails: { cycleId, section: header.details!.section, page: 0, rows: [] } } as unknown as OwnerDigestRecord] : readExact(...args);
  await assert.rejects(readAssignmentForSend(repos, header, key, ref), /ASSIGNMENT_READING_IDENTITY_INVALID/);
  const current = await repos.researchState.mustRead(RESEARCH_STATE_ID);
  await repos.researchState.compareAndSet(RESEARCH_STATE_ID, current.revision, { assignments: { formatVersion: 1 } } as ResearchState, now);
  await assert.rejects(readAssignmentCycleHeader(repos), /ASSIGNMENT_READING_HEADER_INVALID/);
});
