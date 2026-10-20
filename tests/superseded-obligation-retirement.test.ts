import assert from "node:assert/strict";
import test from "node:test";

import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import { dispatchOne, type RunWork } from "../lib/control-plane/scheduler/dispatch.ts";
import {
  SUPERSEDED_RETIREMENT_BOUND,
  obligationNamespace,
  openOccurrence,
  persistDebts,
  planRetiredResidue,
  planSupersededRetirement,
  retireObligationsByPrefix,
  settleRetirements,
  supersededRetirementReason,
  syncObligations,
  type ProviderReading,
  type StandingObligation,
} from "../lib/control-plane/scheduler/durable.ts";
import {
  isScheduled,
  scheduleObligation,
  type FreshnessObligation,
  type ScheduledObligation,
} from "../lib/control-plane/scheduler/obligation.ts";
import { eachStore } from "./control-plane-fixtures.ts";

const T0 = "2026-09-01T19:36:07.092Z"; // the cycle that walked the route and died
const T1 = "2026-09-23T06:00:00.000Z"; // the cycle that finds the row superseded
const T2 = "2026-09-23T07:00:00.000Z"; // a later cycle
const TTL = 120_000;
const CANDIDATE = "az:2026:state-az:attorney-general:mayes-kris";
const AWAITS = `freshness:candidate-enrichment:${CANDIDATE}#candidate-authored-awaits-site`;
const RECORDED = `freshness:candidate-enrichment:${CANDIDATE}#candidate-site-recorded`;
const WIKI = `freshness:candidate-enrichment:${CANDIDATE}#candidate-wikipedia-api`;
const MEETINGS = "freshness:jurisdiction:az:city:city-of-avondale#meetings-1";

function obligation(id: string, routeId: string): FreshnessObligation {
  return {
    id,
    recordClass: "candidate-enrichment",
    subjectId: CANDIDATE,
    routeId,
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
  };
}

function scheduled(o: FreshnessObligation, now: string): ScheduledObligation {
  const row = scheduleObligation(o, Date.parse(now));
  assert.ok(isScheduled(row));
  return row;
}

const CLEAN: ProviderReading = { providerId: "candidate-enrichment", units: 2, readFailure: null, emptyReason: null };

/** A route walked to a disposition that is not a reading, by a cycle that then died before closing the occurrence. */
const adapterWalk: RunWork = async () => ({
  ranAs: "DETERMINISTIC",
  kind: "DISPOSED",
  disposition: {
    disposition: "REQUIRES_NEW_ADAPTER",
    observation: null,
    permission: "CANNOT_TELL",
    transport: "OTHER_NAMED_FAILURE",
    note: "the fixture route needs an adapter this process does not hold",
  },
  detail: "walked to REQUIRES_NEW_ADAPTER",
});

async function supersededShape(repos: ControlPlaneRepositories) {
  const awaits = obligation(AWAITS, "candidate-authored-awaits-site");
  const sync0 = await syncObligations(repos, [awaits, obligation(WIKI, "candidate-wikipedia-api")], T0);
  assert.deepEqual(sync0.registered, [AWAITS, WIKI]);
  const opened = await openOccurrence(repos, {
    obligation: (await repos.obligations.mustRead(AWAITS)).value,
    dueAt: T0,
    now: T0,
  });
  assert.ok(opened);
  const walked = await dispatchOne(repos, {
    obligation: scheduled(awaits, T0),
    routeTaskId: opened.routeTask.id,
    holder: "freshness-shadow@died",
    now: T0,
    leaseTtlMs: TTL,
    maturity: () => "GRADUATED",
    executor: { lane: "DETERMINISTIC", run: adapterWalk },
  });
  assert.equal(walked.dispositionCommitted, true);
  await repos.debts.put(
    AWAITS,
    recordFailure(null, {
      obligationId: AWAITS,
      cause: "REFUSED_BY_HOST",
      detail: "an earlier occurrence's failure",
      target: "candidate-authored-awaits-site",
      dueAt: T0,
      now: T0,
    }),
    T0,
  );
  return { occurrenceId: opened.occurrence.id, routeTaskId: opened.routeTask.id, workItemId: opened.workItem.id };
}

function supersededCorpus(): FreshnessObligation[] {
  return [obligation(RECORDED, "candidate-site-recorded"), obligation(WIKI, "candidate-wikipedia-api")];
}

function unitsOf(corpus: readonly FreshnessObligation[], providerId = "candidate-enrichment") {
  return corpus.map((o) => ({ providerId, obligationId: o.id }));
}

/** Everything retirement must never write, read back. */
async function untouched(repos: ControlPlaneRepositories, routeTaskId: string, workItemId: string) {
  return {
    task: await repos.routeTasks.mustRead(routeTaskId),
    lease: await repos.leases.read(routeTaskId),
    attempts: (await repos.attempts.list()).filter((row) => row.value.routeTaskId === routeTaskId),
    commits: await repos.dispositions.read(routeTaskId),
    artifacts: await repos.artifacts.read(workItemId),
  };
}

function stored(id: string, over: Partial<StandingObligation> = {}): StandingObligation {
  return {
    ...obligation(id, id.slice(id.indexOf("#") + 1) || "route"),
    nextDueAt: T0,
    occurrenceCount: 0,
    openOccurrenceId: null,
    updatedAt: T0,
    ...over,
  };
}

test("obligationNamespace names the provider-owned prefix of a standing id, and nothing else", () => {
  assert.equal(obligationNamespace(AWAITS), "freshness:candidate-enrichment:");
  assert.equal(obligationNamespace(MEETINGS), "freshness:jurisdiction:");
  assert.equal(obligationNamespace("proof-worker-19924"), null);
  assert.equal(obligationNamespace("freshness:"), null);
  assert.equal(obligationNamespace("freshness::x"), null);
});

test("PLAN: only an active row outside the corpus, owned by a cleanly-read provider, is retired; every other row is held back by name", () => {
  const corpus = [
    ...unitsOf(supersededCorpus()),
    { providerId: "local-jurisdictions", obligationId: "freshness:jurisdiction:az-a#clerk" },
    { providerId: "unschedulable-provider", obligationId: "freshness:unschedulable:a-1#page" },
    { providerId: "campaign-finance", obligationId: "freshness:shared:x#one" },
    { providerId: "candidate-enrichment", obligationId: "freshness:shared:y#two" },
  ];
  const providers: ProviderReading[] = [
    { providerId: "candidate-enrichment", units: 3, readFailure: null, emptyReason: null },
    { providerId: "local-jurisdictions", units: 1, readFailure: "az jurisdictions file failed to parse", emptyReason: null },
    { providerId: "unschedulable-provider", units: 1, readFailure: null, emptyReason: "PRESENT_UNSCHEDULABLE: 7 input row(s)" },
    { providerId: "campaign-finance", units: 1, readFailure: null, emptyReason: null },
  ];
  const plan = planSupersededRetirement({
    outside: [
      stored(AWAITS),
      stored("freshness:candidate-enrichment:gone#retired-already", { active: false }),
      stored(RECORDED),
      stored("freshness:jurisdiction:az-b#clerk"),
      stored("freshness:unschedulable:a-2#page"),
      stored("freshness:meetings:legacy-body"),
      stored("proof-worker-19924"),
      stored("freshness:shared:z#three"),
    ],
    corpus,
    providers,
    bound: 1,
  });
  assert.deepEqual(plan.retire, [{ obligationId: AWAITS, reason: supersededRetirementReason("candidate-enrichment") }]);
  assert.deepEqual(
    plan.heldBack.map((h) => [h.obligationId, h.code]),
    [
      ["freshness:jurisdiction:az-b#clerk", "PROVIDER_NOT_READ_CLEANLY"],
      ["freshness:meetings:legacy-body", "NO_PROVIDER_NAMESPACE"],
      ["freshness:shared:z#three", "AMBIGUOUS_NAMESPACE"],
      ["freshness:unschedulable:a-2#page", "PROVIDER_NOT_READ_CLEANLY"],
      ["proof-worker-19924", "NO_PROVIDER_NAMESPACE"],
    ],
    "an inactive row and a row the corpus still names are neither retired nor held",
  );
  assert.match(Array.from(plan.heldBack)[0].why, /az jurisdictions file failed to parse/);
  assert.match(Array.from(plan.heldBack)[3].why, /PRESENT_UNSCHEDULABLE/);
});

test("PLAN: a provider that would suddenly retire more than the bound holds every row back for a person", () => {
  const corpus = [{ providerId: "candidate-enrichment", obligationId: WIKI }];
  const outside = [stored(AWAITS), stored(`freshness:candidate-enrichment:${CANDIDATE}#candidate-marginalia-index`)];
  const over = planSupersededRetirement({ outside, corpus, providers: [{ ...CLEAN, units: 1 }] });
  assert.equal(SUPERSEDED_RETIREMENT_BOUND, 0.25);
  assert.deepEqual(over.retire, [], "2 of 3 standing is over a 25% bound");
  assert.deepEqual(over.heldBack.map((h) => h.code), ["OVER_RETIREMENT_BOUND", "OVER_RETIREMENT_BOUND"]);
  assert.match(Array.from(over.heldBack)[0].why, /retire 2 of its 3 standing obligations/);

  const wide = Array.from({ length: 6 }, (_, i) => ({ providerId: "candidate-enrichment", obligationId: `${WIKI}-${i}` }));
  const under = planSupersededRetirement({ outside: [stored(AWAITS)], corpus: wide, providers: [{ ...CLEAN, units: 6 }] });
  assert.deepEqual(under.retire.map((r) => r.obligationId), [AWAITS], "1 of 7 standing is inside the bound");
});

test("PLAN: a retired row still pointing at an occurrence is settled under its own retirement reason", () => {
  const items = planRetiredResidue([
    stored("freshness:meetings:a", { active: false, openOccurrenceId: "occ-a", retirementReason: "LEGACY" }),
    stored("freshness:meetings:b", { active: false, openOccurrenceId: null, retirementReason: "LEGACY" }),
    stored("freshness:meetings:c", { active: true, openOccurrenceId: "occ-c" }),
  ]);
  assert.deepEqual(items, [{ obligationId: "freshness:meetings:a", reason: "LEGACY" }]);
});

test("SEEDED: a superseded row with an open occurrence on a settled RouteTask is retired; the occurrence closes unresolved, its debt is tombstoned as retired, and nothing else is written", async () => {
  for (const [label, repos] of await eachStore("wtp-superseded-")) {
    const shape = await supersededShape(repos);
    const before = await untouched(repos, shape.routeTaskId, shape.workItemId);
    assert.equal(before.task.value.state, "DISPOSED");

    const corpus = supersededCorpus();
    const sync = await syncObligations(repos, corpus, T1);
    assert.deepEqual(sync.outside?.map((o) => o.id), [AWAITS], `${label}: sync names the row it no longer walks`);
    const plan = planSupersededRetirement({ outside: sync.outside ?? [], corpus: unitsOf(corpus), providers: [CLEAN], bound: 1 });
    const applied = await settleRetirements(repos, { items: plan.retire, now: T1 });
    assert.deepEqual(applied, { retired: [AWAITS], occurrencesClosed: [shape.occurrenceId], failed: [], deferred: [] });

    const occurrence = (await repos.occurrences.mustRead(shape.occurrenceId)).value;
    assert.equal(occurrence.closedAt, T1);
    assert.equal(occurrence.disposition, null, `${label}: a superseded occurrence is not a reading`);
    assert.match(occurrence.unresolvedReason ?? "", /^SUPERSEDED: provider 'candidate-enrichment'.*nothing was read and nothing was refreshed$/);

    const row = (await repos.obligations.mustRead(AWAITS)).value;
    assert.equal(row.active, false);
    assert.equal(row.nextDueAt, null);
    assert.equal(row.openOccurrenceId, null);
    assert.equal(row.retiredAt, T1);
    assert.equal(row.retirementReason, supersededRetirementReason("candidate-enrichment"));
    assert.equal(row.lastWorkedAt, null, `${label}: the anchor does not move`);

    const persisted = await persistDebts(repos, [], T1, null, new Map([[AWAITS, row.retirementReason ?? ""]]));
    assert.deepEqual(persisted, { written: 0, cleared: [], clearedAsRetired: [AWAITS] });
    const debt = (await repos.debts.mustRead(AWAITS)).value;
    assert.equal(debt.consecutiveFailures, 0);
    assert.match(debt.detail, /^cleared at .*: the obligation was retired \(SUPERSEDED.*\)\. Not a reading: nothing was refreshed$/);
    assert.doesNotMatch(debt.detail, /discharged/);

    assert.deepEqual(
      await untouched(repos, shape.routeTaskId, shape.workItemId),
      before,
      `${label}: the RouteTask, its lease, Attempts, disposition commit and artifacts are exactly as they were`,
    );
    assert.equal((await repos.obligations.mustRead(WIKI)).value.active, true, `${label}: a row the corpus names is untouched`);

    const again = await syncObligations(repos, corpus, T2);
    const replan = planSupersededRetirement({ outside: again.outside ?? [], corpus: unitsOf(corpus), providers: [CLEAN], bound: 1 });
    assert.deepEqual(replan, { retire: [], heldBack: [] }, `${label}: a retired row is history, never planned twice`);
    assert.deepEqual(planRetiredResidue(again.outside ?? []), [], `${label}: and holds nothing open to settle`);
  }
});

test("SEEDED: while the provider cannot read its input, nothing is retired and the occurrence stays open", async () => {
  for (const [label, repos] of await eachStore("wtp-superseded-")) {
    const shape = await supersededShape(repos);
    const corpus = supersededCorpus();
    const sync = await syncObligations(repos, corpus, T1);
    const failing: ProviderReading = { ...CLEAN, readFailure: "Arizona ballot canonical projection read rejected" };
    const plan = planSupersededRetirement({ outside: sync.outside ?? [], corpus: unitsOf(corpus), providers: [failing], bound: 1 });
    assert.deepEqual(plan.retire, []);
    assert.deepEqual(plan.heldBack.map((h) => h.code), ["PROVIDER_NOT_READ_CLEANLY"]);

    const applied = await settleRetirements(repos, { items: plan.retire, now: T1 });
    assert.deepEqual(applied, { retired: [], occurrencesClosed: [], failed: [], deferred: [] });
    assert.equal((await repos.occurrences.mustRead(shape.occurrenceId)).value.closedAt, null, `${label}: still open`);
    assert.equal((await repos.obligations.mustRead(AWAITS)).value.active, true, `${label}: still active`);
    assert.equal((await repos.debts.mustRead(AWAITS)).value.consecutiveFailures, 1, `${label}: debt untouched`);
  }
});

test("SEEDED: a row the legacy prefix retirement left pointing at an open occurrence has it closed under its own reason, and keeps its retirement", async () => {
  for (const [label, repos] of await eachStore("wtp-superseded-")) {
    const shape = await supersededShape(repos);
    await retireObligationsByPrefix(repos, ["freshness:candidate-enrichment:"], T1, "LEGACY TRANSFER");
    const legacy = (await repos.obligations.mustRead(AWAITS)).value;
    assert.equal(legacy.active, false);
    assert.equal(legacy.openOccurrenceId, shape.occurrenceId, `${label}: the legacy path left the occurrence open`);
    assert.equal((await repos.occurrences.mustRead(shape.occurrenceId)).value.closedAt, null);

    const sync = await syncObligations(repos, [], T2);
    const items = planRetiredResidue(sync.outside ?? []);
    assert.deepEqual(items, [{ obligationId: AWAITS, reason: "LEGACY TRANSFER" }]);
    const applied = await settleRetirements(repos, { items, now: T2 });
    assert.deepEqual(applied, { retired: [], occurrencesClosed: [shape.occurrenceId], failed: [], deferred: [] }, `${label}: settled, not retired twice`);
    const occurrence = (await repos.occurrences.mustRead(shape.occurrenceId)).value;
    assert.equal(occurrence.disposition, null);
    assert.match(occurrence.unresolvedReason ?? "", /^LEGACY TRANSFER\. The occurrence closes unresolved/);
    const row = (await repos.obligations.mustRead(AWAITS)).value;
    assert.equal(row.openOccurrenceId, null);
    assert.equal(row.retirementReason, "LEGACY TRANSFER", `${label}: its own retirement stands`);
    assert.equal(row.retiredAt, T1);
  }
});

test("a retirement reverses itself: when the registry emits the id again, sync writes it live and it schedules", async () => {
  for (const [label, repos] of await eachStore("wtp-superseded-")) {
    await supersededShape(repos);
    const corpus = supersededCorpus();
    const sync = await syncObligations(repos, corpus, T1);
    const plan = planSupersededRetirement({ outside: sync.outside ?? [], corpus: unitsOf(corpus), providers: [CLEAN], bound: 1 });
    await settleRetirements(repos, { items: plan.retire, now: T1 });

    const back = await syncObligations(repos, [obligation(AWAITS, "candidate-authored-awaits-site"), ...corpus], T2);
    assert.deepEqual(back.refreshed.find((r) => r.id === AWAITS)?.changed, ["active"]);
    const row = (await repos.obligations.mustRead(AWAITS)).value;
    assert.equal(row.active, true, `${label}: live again`);
    assert.equal(row.retiredAt, undefined);
    assert.equal(row.retirementReason, undefined);
    assert.ok(isScheduled(scheduleObligation(row, Date.parse(T2))), `${label}: and schedulable`);
    assert.deepEqual(back.outside?.map((o) => o.id), [], `${label}: nothing is outside the corpus now`);
  }
});

test("SEEDED: an open occurrence the row's pointer lost is closed too; a retired row holds nothing open", async () => {
  for (const [label, repos] of await eachStore("wtp-superseded-")) {
    const shape = await supersededShape(repos);
    const row = await repos.obligations.mustRead(AWAITS);
    await repos.obligations.compareAndSet(row.id, row.revision, { ...row.value, openOccurrenceId: null }, T0);
    assert.equal((await repos.occurrences.mustRead(shape.occurrenceId)).value.closedAt, null);

    const corpus = supersededCorpus();
    const sync = await syncObligations(repos, corpus, T1);
    const plan = planSupersededRetirement({ outside: sync.outside ?? [], corpus: unitsOf(corpus), providers: [CLEAN], bound: 1 });
    const applied = await settleRetirements(repos, { items: plan.retire, now: T1 });
    assert.deepEqual(applied, { retired: [AWAITS], occurrencesClosed: [shape.occurrenceId], failed: [], deferred: [] }, label);
    const occurrence = (await repos.occurrences.mustRead(shape.occurrenceId)).value;
    assert.equal(occurrence.closedAt, T1, `${label}: the orphan is closed`);
    assert.equal(occurrence.disposition, null);
    const open = (await repos.occurrences.list()).filter((o) => o.value.obligationId === AWAITS && o.value.closedAt === null);
    assert.deepEqual(open, [], `${label}: nothing of the retired row is left open`);
  }
});

test("an interrupted retirement completes on the next cycle: an occurrence already closed is not closed twice, and the pointer clears", async () => {
  for (const [label, repos] of await eachStore("wtp-superseded-")) {
    const shape = await supersededShape(repos);
    const occurrence = await repos.occurrences.mustRead(shape.occurrenceId);
    await repos.occurrences.compareAndSet(
      occurrence.id,
      occurrence.revision,
      { ...occurrence.value, closedAt: T1, unresolvedReason: "closed by the interrupted cycle" },
      T1,
    );
    assert.equal((await repos.obligations.mustRead(AWAITS)).value.openOccurrenceId, shape.occurrenceId);

    const corpus = supersededCorpus();
    const sync = await syncObligations(repos, corpus, T2);
    const plan = planSupersededRetirement({ outside: sync.outside ?? [], corpus: unitsOf(corpus), providers: [CLEAN], bound: 1 });
    const applied = await settleRetirements(repos, { items: plan.retire, now: T2 });
    assert.deepEqual(applied.occurrencesClosed, [], `${label}: not closed a second time`);
    assert.deepEqual(applied.retired, [AWAITS]);
    assert.equal((await repos.occurrences.mustRead(shape.occurrenceId)).value.unresolvedReason, "closed by the interrupted cycle");
    const row = (await repos.obligations.mustRead(AWAITS)).value;
    assert.equal(row.openOccurrenceId, null, `${label}: the dangling pointer is cleared`);
    assert.equal(row.active, false);
  }
});

test("sync names what it did not walk, and cannot under exact reads", async () => {
  for (const [label, repos] of await eachStore("wtp-superseded-")) {
    await syncObligations(repos, [obligation(AWAITS, "candidate-authored-awaits-site"), obligation(WIKI, "candidate-wikipedia-api")], T0);
    const full = await syncObligations(repos, [obligation(WIKI, "candidate-wikipedia-api")], T1);
    assert.deepEqual(full.outside?.map((o) => o.id), [AWAITS], `${label}: the full read sees the row it did not walk`);
    const exact = await syncObligations(repos, [obligation(WIKI, "candidate-wikipedia-api")], T1, { exactReads: true });
    assert.equal(exact.outside, null, `${label}: an exact read cannot see what the registry stopped emitting`);
  }
});

test("persistDebts still says discharged for a discharge, and only a retired row's debt is tombstoned as retired", async () => {
  for (const [label, repos] of await eachStore("wtp-superseded-")) {
    const failure = (id: string) =>
      recordFailure(null, { obligationId: id, cause: "UPSTREAM_ERROR", detail: "x", target: "t", dueAt: T0, now: T0 });
    await repos.debts.put("ob-worked", failure("ob-worked"), T0);
    await repos.debts.put("ob-retired", failure("ob-retired"), T0);
    await repos.debts.put("ob-owed", failure("ob-owed"), T0);
    const persisted = await persistDebts(repos, [failure("ob-owed")], T1, null, new Map([["ob-retired", "RETIRED: x"]]));
    assert.deepEqual(persisted, { written: 0, cleared: ["ob-worked"], clearedAsRetired: ["ob-retired"] }, label);
    assert.equal((await repos.debts.mustRead("ob-worked")).value.detail, `cleared at ${T1}: the obligation was discharged`);
    assert.match((await repos.debts.mustRead("ob-retired")).value.detail, /was retired \(RETIRED: x\)\. Not a reading/);
    assert.equal((await repos.debts.mustRead("ob-owed")).value.consecutiveFailures, 1);
  }
});
