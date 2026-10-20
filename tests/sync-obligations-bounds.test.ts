import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pgAggregateRepository } from "../lib/control-plane/repository/pg-store.ts";
import { createPlannerSpool, plannerSet, type PlannerSpool } from "../lib/control-plane/scheduler/planner-spool.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { closeAbandonedOccurrences, loadDebts, openOccurrence, persistDebts, planHeldRouteRetirement, planRetiredResidue, planSupersededRetirement,
  scanRecoveryTaskMetadata, settleRetirements, standing, syncObligations,
  type StandingObligation, type StandingObligationHeader, type SyncPlannerSink } from "../lib/control-plane/scheduler/durable.ts";
import { recordFailure, type FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask, type RouteTask } from "../lib/control-plane/route-task.ts";
import { assertNeededProductionRead } from "../scripts/rh01-network.mjs";
import { eachStore } from "./control-plane-fixtures.ts";

const now = "2026-10-20T13:00:00.000Z", later = "2026-10-20T14:00:00.000Z";
const definition = (id: string): FreshnessObligation => ({ id, subjectId: id, routeId: "fixture", recordClass: "fixture",
  active: true, lastWorkedAt: null, readerImpactAt: null, observedChangeRateHours: null });
const sink = (planner: Awaited<ReturnType<typeof createPlannerSpool>>): SyncPlannerSink => ({
  all: planner.table<StandingObligation>("all", row => row.id), registered: planner.table<string>("registered", row => row),
  alreadyDurable: planner.table<string>("durable", row => row), refreshed: planner.table<{ id: string; changed: readonly string[] }>("refreshed", row => row.id),
  outside: planner.table<StandingObligationHeader>("outside", row => row.id),
});

test("a streaming corpus hydrates bounded exact-ID scopes and registers every definition", async () => {
  const repos = createMemoryRepositories(), planner = await createPlannerSpool(), scopes: string[][] = [];
  const read = repos.obligations.readMany!.bind(repos.obligations);
  repos.obligations.readMany = async ids => { scopes.push([...ids]); assert.ok(ids.length <= 100); return read(ids); };
  try {
    const corpus = (function* () { for (let i = 0; i < 205; i++) yield definition(`freshness:fixture:az:scope-${i}`); })();
    const synced = await syncObligations(repos, corpus, now, { exactReads: true, sink: sink(planner) });
    assert.equal(synced.registered.length, 205); assert.equal(synced.all.length, 205);
    assert.ok(scopes.length > 1); assert.equal(scopes.reduce((sum, ids) => sum + ids.length, 0), 205);
    assert.equal(new Set(scopes.flat()).size, 205);
  } finally { await planner.close(); }
});

test("native PostgreSQL synchronization projects outside headers and scopes every complete plan read to exact corpus identities", async () => {
  const db = new PGlite(), planner = await createPlannerSpool(), statements: { text: string; params: unknown[] }[] = [];
  try {
    await db.exec("CREATE TABLE cp_obligations(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL,changed_at timestamptz NOT NULL DEFAULT now())");
    const sql = { query: async (text: string, params: unknown[] = []) => {
      if (/^\s*(?:SELECT|WITH)\b/.test(text)) assertNeededProductionRead(text);
      statements.push({ text, params });
      return (await db.query(text, params)).rows;
    } };
    const base = createMemoryRepositories(), repo = pgAggregateRepository<StandingObligation>(sql, "StandingObligation", "cp_obligations");
    const repos = { ...base, obligations: repo };
    const plan = { fixtureOpaqueSource: "x".repeat(1_000_000) } as unknown as AutonomousWorkPlan;
    const chosen = "freshness:fixture:az:selected", omitted = "freshness:fixture:tx:omitted";
    for (const id of [chosen, omitted]) await repo.put(id, { ...standing(definition(id), now), autonomousPlan: plan,
      nextDueAt: now, occurrenceCount: 8, lastWorkedAt: now, assignments: [{ assignmentKey: "send", ref: "gateway-receipt", relation: "CREATED", at: now }] }, now);
    statements.length = 0;
    const synced = await syncObligations(repos, [{ ...definition(chosen), readerImpactAt: later }], later, { sink: sink(planner) });
    assert.equal(synced.outside?.length, 1);
    const header = [...synced.outside!][0];
    assert.equal(header.id, omitted); assert.equal(header.active, true); assert.equal(Object.hasOwn(header, "autonomousPlan"), false);
    const kept = await repo.mustRead(chosen);
    assert.deepEqual(kept.value.autonomousPlan, plan);
    assert.equal(kept.value.occurrenceCount, 8); assert.equal(kept.value.nextDueAt, now);
    assert.equal(kept.value.readerImpactAt, later);
    assert.deepEqual(kept.value.assignments, header.assignments);
    const scan = statements.find(row => /ORDER BY id ASC\s+LIMIT 100/.test(row.text));
    assert.ok(scan); assert.doesNotMatch(scan.text, /value AS value/);
    const fullReads = statements.filter(row => /SELECT id, revision, updated_at, value(?: AS value)?\s+FROM cp_obligations/.test(row.text));
    assert.ok(fullReads.length > 0);
    assert.ok(fullReads.every(row => /WHERE id(?:\s*=|\s*=ANY)/.test(row.text) && JSON.stringify(row.params).includes(chosen)));
    const planRetirement = planSupersededRetirement({ outside: synced.outside!, corpus: [{ providerId: "fixture", obligationId: chosen }],
      providers: [{ providerId: "fixture", units: 1, readFailure: null, emptyReason: null }], bound: 1, planner });
    assert.ok(planRetirement.retire instanceof DiskRows);
    const applied = await settleRetirements(repos, { items: planRetirement.retire, now: later, planner });
    assert.deepEqual([...applied.retired], [omitted]);
    assert.equal((await repo.mustRead(omitted)).value.active, false);
  } finally { await planner.close(); await db.close(); }
});

test("bounded retirement preserves every omitted obligation, provider hold, held-route owner and inactive residue", async () => {
  for (const [label, repos] of await eachStore("rh01-retirement-bounds-")) {
    const planner = await createPlannerSpool();
    try {
      const current = "freshness:fixture:az:current", gone = "freshness:fixture:tx:gone", unknown = "freshness:unknown:ca:old";
      const meeting = "freshness:jurisdiction:az:city:fixture#meetings-1", inactive = "freshness:fixture:wa:inactive";
      for (const id of [current, gone, unknown, meeting, inactive]) await repos.obligations.put(id, {
        ...standing(definition(id), now), ...(id === inactive ? { active: false, openOccurrenceId: "old-open", retirementReason: "old reason" } : {}),
      }, now);
      const synced = await syncObligations(repos, [definition(current)], later, { sink: sink(planner) });
      assert.ok(synced.all instanceof DiskRows); assert.ok(synced.outside instanceof DiskRows);
      assert.deepEqual(new Set(synced.outside!.map(row => row.id)), new Set([gone, unknown, meeting, inactive]), label);
      const corpus = [{ providerId: "fixture", obligationId: current }, { providerId: "jurisdiction", obligationId: "freshness:jurisdiction:another#meetings-1" }];
      const providers = [{ providerId: "fixture", units: 1, readFailure: null, emptyReason: null }, { providerId: "jurisdiction", units: 1, readFailure: null, emptyReason: null }];
      const moved = planHeldRouteRetirement({ outside: synced.outside!, corpus, providers,
        routes: { bodyIdFor: () => "body", held: new Set(["body"]) }, planner });
      const superseded = planSupersededRetirement({ outside: synced.outside!.filter(row => !moved.owned.has(row.id)), corpus, providers, bound: 1, planner });
      const residue = planRetiredResidue(synced.outside!, planner);
      assert.ok(moved.retire instanceof DiskRows); assert.ok(moved.heldBack instanceof DiskRows); assert.ok(superseded.heldBack instanceof DiskRows); assert.ok(residue instanceof DiskRows);
      assert.deepEqual([...moved.retire].map(row => row.obligationId), [meeting]);
      assert.deepEqual([...superseded.retire].map(row => row.obligationId), [gone]);
      assert.deepEqual([...superseded.heldBack].map(row => [row.obligationId, row.code]), [[unknown, "NO_PROVIDER_NAMESPACE"]]);
      assert.deepEqual([...residue], [{ obligationId: inactive, reason: "old reason" }]);
      const items = new DiskRows(function* () { yield* moved.retire; yield* superseded.retire; });
      let asked = 0;
      const applied = await settleRetirements(repos, { items, now: later, budget: { spent: () => asked++ > 0 }, planner });
      assert.ok(applied.retired instanceof DiskRows); assert.ok(applied.deferred instanceof DiskRows); assert.ok(applied.failed instanceof DiskRows);
      assert.deepEqual([...applied.retired], [meeting]); assert.deepEqual([...applied.deferred], [gone]);
      assert.equal((await repos.obligations.mustRead(gone)).value.active, true);
    } finally { await planner.close(); }
  }
});

async function debtMetadataCycle(repos: ControlPlaneRepositories, planner: PlannerSpool, label: string): Promise<void> {
  const makeDebt = (obligationId: string) => recordFailure(null, { obligationId, cause: "UPSTREAM_ERROR",
    detail: "retained source failure", target: "fixture.gov", dueAt: now, now });
  const first = makeDebt("debt-changed"), cleared = makeDebt("debt-cleared"), retired = makeDebt("debt-retired"), unchanged = makeDebt("debt-unchanged");
  const extension = { futurePlan: { sourceText: "q".repeat(1_000_000) } };
  for (const debt of [first, cleared, retired, unchanged]) await repos.debts.put(debt.obligationId, { ...debt, ...extension }, now);
  const metadata = await loadDebts(repos, planner.table<FreshnessDebt>("debt-metadata", row => row.obligationId));
  assert.ok(metadata instanceof DiskRows);
  assert.deepEqual([...metadata].map(row => row.obligationId).sort(), [first, cleared, retired, unchanged].map(row => row.obligationId).sort(), label);
  for (const debt of metadata) {
    assert.deepEqual(Object.keys(debt).sort(), Object.keys(first).sort(), `${label}: every defined debt scalar is retained`);
    assert.equal(Object.hasOwn(debt, "futurePlan"), false, `${label}: unrelated payloads never enter the country's scheduler snapshot`);
  }
  const result = await persistDebts(repos, (function* () { yield { ...first, detail: "new failure evidence" }; yield unchanged; })(), later,
    null, new Map([[retired.obligationId, "provider owns the replacement"]]), 2, planner);
  assert.equal(result.written, 1); assert.deepEqual([...result.cleared], [cleared.obligationId]);
  assert.deepEqual([...result.clearedAsRetired], [retired.obligationId]);
  assert.ok(result.cleared instanceof DiskRows); assert.ok(result.clearedAsRetired instanceof DiskRows);
  assert.equal((await repos.debts.mustRead(unchanged.obligationId)).revision, 1, "unchanged metadata causes no full-row write");
  assert.equal((await repos.debts.mustRead(first.obligationId)).value.detail, "new failure evidence");
  for (const id of [cleared.obligationId, retired.obligationId]) assert.equal((await repos.debts.mustRead(id)).value.consecutiveFailures, 0);
  for (const debt of [first, cleared, retired, unchanged]) assert.deepEqual(
    (await repos.debts.mustRead(debt.obligationId)).value, {
      ...debt, ...extension,
      ...(debt === first ? { detail: "new failure evidence" } : debt === cleared ? {
        consecutiveFailures: 0, detail: `cleared at ${later}: the obligation was discharged`,
      } : debt === retired ? {
        consecutiveFailures: 0, detail: `cleared at ${later}: the obligation was retired (provider owns the replacement). Not a reading: nothing was refreshed`,
      } : {}),
    }, `${label}: exact hydration preserves a stored extension on every changed row`);
}

async function recoveryMetadata(repos: ControlPlaneRepositories, planner: PlannerSpool, label: string): Promise<void> {
  const makeWork = (kind: string, subject: string, schemaVersion?: number, recordClass = "fixture"): WorkItem => ({
    ...createWorkItem({ project: "freshness", subject, obligation: kind, why: "recovery fixture", now }),
    ...(schemaVersion === undefined ? {} : { autonomousPlan: { contract: { schemaVersion, recordClass },
      sourceCapture: "s".repeat(1_000_000) } as unknown as AutonomousWorkPlan }),
  });
  const held = makeWork("current", "az/place", 2), legacy = makeWork("retired", "az/place", 1, "LEGISTAR_EVENTS"),
    noPlan = makeWork("unplanned", "az/place"), other = makeWork("other", "tx/place", 2);
  for (const item of [held, legacy, noPlan, other]) await repos.workItems.put(item.id, item, now);
  const route = (name: string, workItemId: string) => createRouteTask({ workItemId, routeId: name, routeLabel: name, target: "https://fixture.gov", inherited: false, now });
  const pending = route("plain-pending", held.id), disposed: RouteTask = { ...route("disposed", held.id), state: "DISPOSED", disposition: {
    disposition: "INGESTED", attemptId: "attempt", at: now, artifactIds: ["x".repeat(1_000_000)], observation: null,
    permission: "ALLOWED", transport: "REACHABLE", note: "fixture" } },
    worker: RouteTask = { ...route("worker", held.id), workerTask: { contract: { subjectId: "az/place", sourceCapture: "w".repeat(1_000_000) } } as unknown as RouteTask["workerTask"] },
    otherWorker: RouteTask = { ...route("other-worker", other.id), workerTask: { contract: { subjectId: "tx/place" } } as unknown as RouteTask["workerTask"] };
  for (const task of [pending, disposed, worker, otherWorker]) await repos.routeTasks.put(task.id, task, now);
  const workIds = plannerSet(planner, "recovery-work"), settled = plannerSet(planner, "recovery-settled"), never = plannerSet(planner, "recovery-never");
  await scanRecoveryTaskMetadata(repos, { lifetimeHuntSubjects: new Set(["az/place"]), lifetimeHuntWorkIds: workIds,
    settledTaskIds: settled, neverClaimedTaskIds: never });
  assert.deepEqual(new Set(workIds), new Set([held.id, worker.id]), `${label}: the legacy routine acquisition and other place never enter the lifetime paid-work membership`);
  assert.deepEqual([...settled], [disposed.id], `${label}: an opaque disposition remains settled without its captures`);
  assert.deepEqual([...never], [pending.id], `${label}: only unclaimed plain-code tasks qualify as never claimed`);
  assert.deepEqual((await repos.workItems.mustRead(held.id)).value, held, "read-only recovery preserves every held source plan");
  assert.deepEqual((await repos.routeTasks.mustRead(disposed.id)).value, disposed, "read-only recovery preserves the source proof");
}

test("native PostgreSQL debt and recovery scans pass the actual needed-read guard without source payloads", async () => {
  const db = new PGlite(), planner = await createPlannerSpool(), scans: { text: string; bytes: number }[] = [];
  try {
    for (const name of ["cp_debts", "cp_work_items", "cp_route_tasks"]) await db.exec(
      `CREATE TABLE ${name}(id text PRIMARY KEY,revision bigint NOT NULL,updated_at timestamptz NOT NULL,value jsonb NOT NULL,changed_at timestamptz NOT NULL DEFAULT now())`);
    const sql = { query: async (text: string, params: unknown[] = []) => {
      if (/^\s*(?:SELECT|WITH)\b/.test(text)) assertNeededProductionRead(text);
      const rows = (await db.query(text, params)).rows;
      if (/ORDER BY id ASC\s+LIMIT 100/.test(text)) scans.push({ text, bytes: Buffer.byteLength(JSON.stringify(rows)) });
      return rows;
    } };
    const repos = { ...createMemoryRepositories(), debts: pgAggregateRepository<FreshnessDebt>(sql, "FreshnessDebt", "cp_debts"),
      workItems: pgAggregateRepository<WorkItem>(sql, "WorkItem", "cp_work_items"), routeTasks: pgAggregateRepository<RouteTask>(sql, "RouteTask", "cp_route_tasks") };
    await debtMetadataCycle(repos, planner, "postgres"); await recoveryMetadata(repos, planner, "postgres");
    for (const table of ["cp_debts", "cp_work_items", "cp_route_tasks"]) assert.ok(scans.some(row => row.text.includes(table)), table);
    assert.ok(scans.every(row => row.bytes < 10_000), "global pages contain scalar metadata, never the megabyte payloads");
    assert.ok(scans.every(row => !/\bvalue AS value\b/.test(row.text)), "no scheduler recovery scan transfers a complete aggregate");
  } finally { await planner.close(); await db.close(); }
});

test("native Memory and File debt persistence and recovery match PostgreSQL metadata semantics", async () => {
  for (const [label, repos] of await eachStore("rh01-debt-recovery-bounds-")) {
    const planner = await createPlannerSpool();
    try { await debtMetadataCycle(repos, planner, label); await recoveryMetadata(repos, planner, label); }
    finally { await planner.close(); }
  }
});

test("native abandoned-occurrence closure keeps result identities on disk and preserves live tasks", async () => {
  for (const [label, repos] of await eachStore("rh01-abandoned-bounds-")) {
    const planner = await createPlannerSpool();
    try {
      const id = "freshness:fixture:az:abandoned";
      await repos.obligations.put(id, standing(definition(id), now), now);
      const opened = await openOccurrence(repos, { obligation: (await repos.obligations.mustRead(id)).value, dueAt: now, now });
      assert.ok(opened);
      const owner = await repos.obligations.mustRead(id);
      await repos.obligations.compareAndSet(id, owner.revision, { ...owner.value, openOccurrenceId: null, occurrenceCount: 2 }, later);
      const abandoned = planner.table<{ occurrenceId: string; obligationId: string; sequence: number; movedOnTo: number }>("abandoned-input", row => row.occurrenceId);
      abandoned.add({ occurrenceId: opened.occurrence.id, obligationId: id, sequence: 1, movedOnTo: 2 });
      abandoned.add({ occurrenceId: "already-gone", obligationId: id, sequence: 1, movedOnTo: 2 });
      const before = await repos.routeTasks.mustRead(opened.routeTask.id);
      const result = await closeAbandonedOccurrences(repos, { abandoned: abandoned.rows, now: later, planner });
      assert.ok(result.closed instanceof DiskRows); assert.ok(result.skipped instanceof DiskRows); assert.ok(result.failed instanceof DiskRows);
      assert.deepEqual([...result.closed], [opened.occurrence.id], label);
      assert.deepEqual([...result.skipped], [{ occurrenceId: "already-gone", why: "no longer open" }]);
      assert.deepEqual([...result.failed], []);
      assert.equal((await repos.occurrences.mustRead(opened.occurrence.id)).value.closedAt, later);
      assert.deepEqual(await repos.routeTasks.mustRead(opened.routeTask.id), before, "closing never dispatches or changes the source task");
    } finally { await planner.close(); }
  }
});
