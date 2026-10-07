import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { loadBootstrapLookup } from "@/lib/census-geography/reader.ts";
import {
  installOperationalReferenceBundle,
  operationalReferenceBundle,
} from "@/lib/civic-data/operational-references.ts";
import {
  applyDispatchWork,
  assignmentEntry,
  carriedDispatchTargets,
  dispatchWorkReading,
  dispatchWorkSentence,
  dispatchWorkTarget,
  isDispatchWorkReading,
  ownerDispatchWorkOf,
  orderPlaceWork,
  planDispatchWork,
  requirementsFor,
  scopeWorkTarget,
  type DispatchWorkContext,
  type DispatchWorkReading,
  type DispatchWorkTarget,
  type DispatchWorkWorld,
  type DurableRowFacts,
} from "@/lib/control-plane/expansion/dispatch-work.ts";
import {
  ScopeBudgetGate,
  buildTerritoryIndex,
  type CensusUnitTerritory,
  type PlannedScope,
  type TerritoryIndex,
} from "@/lib/control-plane/expansion/membership.ts";
import { readTerritoryIndex } from "@/lib/control-plane/expansion/runner-load.ts";
import { scopeKeyOf, withScopeSet, type ExpansionScopeDecision, type ExpansionScopeGeography } from "@/lib/control-plane/expansion/scopes.ts";
import { stateOfSubject, subjectOfObligationId } from "@/lib/control-plane/expansion/subjects.ts";
import { lookupAction } from "@/lib/control-plane/gateway/registry.ts";
import { deployPreview } from "@/lib/control-plane/deploy-preview.ts";
import { appendResearchIntent, buildResearchIntent } from "@/lib/control-plane/research-view.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";
import { modelLaneClosure } from "@/lib/control-plane/scheduler/model-lane.ts";
import { OWNER_DISPATCH } from "@/lib/control-plane/scheduler/obligation.ts";
import { openOccurrence, resumeOpenOccurrence, planSupersededRetirement, standing, syncObligations } from "@/lib/control-plane/scheduler/durable.ts";
import { parseDispatchTarget } from "@/lib/control-plane/scheduler/dispatch-target.ts";
import { RESEARCH_INTENT_LOG_KEY, readIntents } from "@/lib/control-plane/scheduler/research-policy.ts";
import { buildRegistry, type RegistryPass } from "@/lib/control-plane/scheduler/registry.ts";
import {
  UNREAD_FREE_DISCOVERY_WALKS,
  UNREAD_MEETING_PARTITIONS,
  promotedRegistries,
  trackedStatesFrom,
  trackedStatesFromOperationalReference,
  type MaterializedReading,
  type MeetingPartitionOwnership,
} from "@/lib/control-plane/scheduler/provider-inputs.ts";
import {
  jurisdictionRequirements,
  localJurisdictionsProvider,
} from "@/lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import {
  FREE_WALK_FIRST,
  MEETINGS_DISCOVERY_NAMESPACE,
  meetingsDiscoveryNeedFor,
  meetingsDiscoveryObligationId,
  meetingsDiscoveryProvider,
  paidDiscoveryHold,
  parseMeetingsDiscoveryId,
} from "@/lib/control-plane/scheduler/providers/meetings-discovery.ts";
import {
  candidateEnrichmentProvider,
  preloadCandidateEnrichmentAuthorities,
} from "@/lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { MemoryRoutineDataStore } from "@/lib/civic-data/store.ts";
import { meetingsDiscoveryNeeds } from "@/lib/hunt/meetings-discovery.ts";
import { sourcesOf, type Jurisdiction, type JurisdictionRegistry } from "@/lib/hunt/jurisdiction-universe.ts";

/**
 * Sending the fleet to a geography creates the work it is missing. Runs on recorded data (the jurisdiction registry
 * fixture, the committed Census unit territories and census-geography bootstrap) against in-memory repositories and
 * a fixed clock. No network, no database, no model.
 */

const ROOT = join(import.meta.dirname, "..");
const T0 = "2026-09-23T21:00:00.000Z";
const T1 = "2026-09-23T22:00:00.000Z";
const T2 = "2026-09-23T23:00:00.000Z";

const REGISTRIES = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/jurisdiction-registries.json"), "utf8")) as Record<"az" | "nh" | "nj", JurisdictionRegistry>;

test("a new hunt discovers missing information families without inventing publishers or duplicating a shared custodian", () => {
  const reg = REGISTRIES.az;
  const held = reg.jurisdictions.find(j => j.govClass === "SCHOOL_DISTRICT")!;
  const unknown = { ...held, sourceIds: [] };
  assert.equal(jurisdictionRequirements(reg, unknown).length, 0, "deploying the change does not expand old standing work");
  const missing = jurisdictionRequirements(reg, unknown, UNREAD_MEETING_PARTITIONS, true);
  const directory = missing.filter(r => r.route.routeId === "coverage-discovery:body-directory");
  assert.equal(directory.length, 1, "body discovery has a separate denominator obligation; a roster cannot discharge it");
  assert.deepEqual(missing.filter(r => !directory.includes(r)).map(r => r.source.recordClass).sort(), ["BALLOT_AND_CANDIDATES", "CAMPAIGN_FINANCE", "OFFICEHOLDERS", "PUBLIC_SERVICES", "VOTER_ACCESS"]);
  assert.ok(missing.every(r => r.route.executorClass === "BOUNDED_MODEL_WORKER" && r.source.state === "DISCOVERY_OWED"));
  assert.ok(missing.filter(r => !directory.includes(r)).every(r => /not yet been established/.test(r.source.authorityBasis)));
  const financeKey = held.sourceIds.find(key => sourcesOf(reg, { ...held, sourceIds: [key] })[0].recordClass === "CAMPAIGN_FINANCE");
  assert.ok(financeKey, "the fixture carries its real shared filing route");
  const shared = jurisdictionRequirements(reg, { ...held, sourceIds: [financeKey] }, UNREAD_MEETING_PARTITIONS, true);
  assert.equal(shared.filter(r => r.source.recordClass === "CAMPAIGN_FINANCE").length, 0, "district finance stays with the recorded shared custodian");
});
installOperationalReferenceBundle(operationalReferenceBundle(REGISTRIES));

test("owner-created family work reaches autonomous workers and survives registration and an interrupted occurrence", async () => {
  const reg = REGISTRIES.az;
  const government = { ...reg.jurisdictions.find(j => j.govClass === "SCHOOL_DISTRICT")!, sourceIds: [], bodyId: "fixture:registered-school-board" };
  const requirements = requirementsFor(reg, government, null, UNREAD_MEETING_PARTITIONS, true);
  const repos = createMemoryRepositories();
  for (const requirement of requirements) {
    const obligation = standing(requirement.obligation, T0);
    const plan = obligation.autonomousPlan!;
    assert.equal(plan.contract.schemaVersion, 2);
    assert.equal(plan.contract.subjectId, government.id);
    assert.deepEqual(plan.sources, [], "a registry address is not evidence of a source read");
    if (plan.contract.schemaVersion === 2) {
      assert.equal(plan.contract.extraction.format, "UNSUPPORTED");
      assert.equal(plan.contract.verification.required, false, "no second source: these facts are not judgment calls (§3)");
      assert.deepEqual(plan.contract.sourceScope.observationArtifactIds, []);
    }
    await repos.obligations.put(obligation.id, obligation, T0);
    const occurrence = await openOccurrence(repos, { obligation, dueAt: T0, now: T0 });
    assert.deepEqual(occurrence?.workItem.autonomousPlan, { ...plan, ownerInstructions: [] }, "normal scheduler-created work carries executable discovery/repair instructions");
    const { autonomousPlan: _plan, ...providerReading } = requirement.obligation;
    await syncObligations(repos, [providerReading], T1);
    const retained = (await repos.obligations.mustRead(obligation.id)).value;
    assert.deepEqual(retained.autonomousPlan, plan, "a fresh provider reading cannot erase the Send's instructions");
    const item = await repos.workItems.mustRead(occurrence!.workItem.id);
    const { autonomousPlan: _interrupted, ...withoutPlan } = item.value;
    await repos.workItems.compareAndSet(item.id, item.revision, withoutPlan, T1);
    await resumeOpenOccurrence(repos, retained);
    assert.deepEqual((await repos.workItems.mustRead(item.id)).value.autonomousPlan, { ...plan, ownerInstructions: [] }, "already-open work is repaired without another occurrence or lost evidence");
    if (plan.publication) {
      const before = await repos.workItems.mustRead(item.id);
      const { publication: _missingDoor, ...legacyPlan } = before.value.autonomousPlan!;
      await repos.workItems.compareAndSet(item.id, before.revision, { ...before.value, autonomousPlan: legacyPlan }, T1);
      const assigned = { ...retained, assignments: [{ assignmentKey: "isolated-send", ref: "receipt:isolated-send", relation: "REORDERED" as const, at: T1 }] };
      await resumeOpenOccurrence(repos, assigned);
      const connected = await repos.workItems.mustRead(item.id);
      assert.deepEqual(connected.value.autonomousPlan!.publication, plan.publication, "new normal Send reconnects a retained result to its now-implemented publisher");
      assert.deepEqual(connected.value.autonomousPlan!.contract, legacyPlan.contract, "retained extraction and verification evidence is not rewritten");
      assert.deepEqual(connected.value.autonomousPlan!.ownerInstructions, ["receipt:isolated-send"]);
      await resumeOpenOccurrence(repos, assigned);
      assert.equal((await repos.workItems.mustRead(item.id)).revision, connected.revision, "the normal resume remains idempotent");
    }
  }
});

let territoryAll: TerritoryIndex | null = null;
/** The runner's own territory index over every promoted registry, read once for the file. */
function territory(): TerritoryIndex {
  territoryAll ??= readTerritoryIndex(ROOT, Object.values(REGISTRIES));
  return territoryAll;
}

const PIMA: ExpansionScopeGeography = { type: "county", geoid: "04019", version: "county:2020", label: "Pima County, Arizona", stateAbbr: "AZ" };
const CD6: ExpansionScopeGeography = { type: "congressional_district", geoid: "0406", version: "cd:119", label: "Arizona CD 6", stateAbbr: "AZ" };

/** A selected scope, built by the gateway's own pure step, exactly as `expansion.scope.set` records it. */
function decision(geography: ExpansionScopeGeography, priority = 1, budgetUsd = 5, decidedAt = T0): ExpansionScopeDecision {
  const [made] = withScopeSet([], { geography, priority, budgetUsd, note: null, decidedAt, decidedBy: "adm_test-session", receiptId: `expansion.scope.set:${geography.geoid}` }).scopes;
  return made;
}

async function planned(d: ExpansionScopeDecision): Promise<PlannedScope> {
  assert.notEqual(d.geography.type, "zcta", "this grouping fixture helper takes a container");
  if (d.geography.type === "zcta" || d.geography.type === "state") throw new Error("Use resolveScopes for a ZIP or state hunt");
  const result = await loadBootstrapLookup().zctasForGrouping({ type: d.geography.type, geoid: d.geography.geoid, version: d.geography.version });
  assert.equal(result.status.kind, "OK", `${d.geography.label} resolves in the bootstrap fixture`);
  const fractions = new Map<string, number>();
  for (const o of result.overlaps) if (!o.whole && o.fraction !== null) fractions.set(o.zcta5, o.fraction);
  return {
    kind: "RESOLVED",
    decision: d,
    zctas: new Set(result.overlaps.map((o) => o.zcta5)),
    whole: new Set(result.overlaps.filter((o) => o.whole).map((o) => o.zcta5)),
    fractions,
    states: ["AZ"],
    members: new Set<string>(),
  };
}

/** The two providers dispatch work feeds, exactly as the runner builds them. */
function registryPass(materialized: MaterializedReading, tracked = trackedStatesFromOperationalReference()): RegistryPass {
  return buildRegistry(
    [
      localJurisdictionsProvider({ trackedStates: tracked, materialized: () => materialized, meetingPartitions: UNREAD_MEETING_PARTITIONS }),
      meetingsDiscoveryProvider({ materialized: () => materialized }),
    ],
    { root: ROOT, nowIso: T0 },
  );
}

/** One runner cycle up to the dispatch-work step: read the marked rows, build the corpus, register it. */
async function cycleWorld(repos: ControlPlaneRepositories, now: string, over: Partial<DispatchWorkWorld> = {}) {
  const rows = await repos.obligations.listWhere(["materializedBy"], OWNER_DISPATCH);
  const registry = registryPass({ ids: new Set(rows.map((r) => r.id)) });
  const sync = await syncObligations(repos, registry.obligations, now);
  const durable = new Map<string, DurableRowFacts>();
  for (const row of [...sync.all, ...(sync.outside ?? [])]) durable.set(row.id, { active: row.active, materializedBy: row.materializedBy, assignments: row.assignments });
  const world: DispatchWorkWorld = {
    registries: new Map(Object.entries(REGISTRIES)),
    territory: territory(),
    territoryDetail: null,
    corpus: registry.units.map((u) => ({ id: u.obligation.id, subjectId: u.obligation.subjectId })),
    durable,
    meetingPartitions: UNREAD_MEETING_PARTITIONS,
    ...over,
  };
  return { registry, sync, world };
}

const CONTEXT: DispatchWorkContext = {
  at: T0,
  modelLaneClosed: "paused by owner intent pause-1",
  ceilingUsd: 105,
  ceilingSource: "OVERRIDE",
  writes: "APPLIED",
  planOnlyWhy: null,
};

function identity(r: DispatchWorkReading["targets"][number]["requirements"]): number {
  return r.carried + r.held + r.created + r.deferred + r.failed;
}

test("sending the fleet to Pima County creates what the registry defines there and no clock carries, in the shape syncObligations registers", async () => {
  const repos = createMemoryRepositories();
  const { world } = await cycleWorld(repos, T0);
  const target = scopeWorkTarget(await planned(decision(PIMA)));
  assert.equal(target.kind, "SCOPE");
  if (target.kind !== "SCOPE") throw new Error("Expected the gateway's scope target");
  const legacyPlan = planDispatchWork({ targets: [{ ...target, sourceWorkVersion: undefined }], world });
  assert.ok(legacyPlan.writes.every(write => write.instance.kind === "MEETINGS_DISCOVERY"), "an older instruction acquires no new information-family work merely because code deployed");
  const plan = planDispatchWork({ targets: [target], world });
  const applied = await applyDispatchWork(repos, plan, { now: T0 });
  const reading = dispatchWorkReading(plan, applied, CONTEXT);
  const [pima] = reading.targets;

  assert.ok(pima.units.placed >= 15, `the registered governments certainly in Pima are placed (${pima.units.placed})`);
  for (const name of ["COUNTY OF PIMA", "CITY OF TUCSON", "TUCSON UNIFIED SCHOOL DISTRICT 1"]) assert.ok(pima.units.placedSample.includes(name), `${name} is in Pima`);
  assert.ok(pima.units.unplaced > 0, "registered governments no territory can place (special districts) are counted, never guessed in");
  assert.equal(identity(pima.requirements), pima.requirements.defined, "every requirement instance lands in exactly one state");
  assert.ok(pima.requirements.carried > 0, "Pima's standing custodian clocks are reordered, never created twice");
  assert.equal(pima.requirements.created, pima.requirements.createdThisCycle, "nothing existed before this Send");
  assert.equal(pima.requirements.created, applied.written.length);
  assert.ok(pima.requirements.created > 0);
  const familyDiscovery = applied.written.filter(id => id.includes("#coverage-discovery:"));
  assert.ok(familyDiscovery.length > 0, "the new Send finds missing source families as well as meetings");
  assert.equal(pima.requirements.createdMeetingsDiscovery + familyDiscovery.length, pima.requirements.created, "every newly created row is accounted for without redefining missing work as excluded");
  assert.equal(pima.units.blocked, 0, "every government the lookup puts in Pima is in the AZ registry");
  assert.equal(applied.failed.length, 0);

  const tucson = meetingsDiscoveryObligationId({ jurisdictionId: "az:city:city-of-tucson", basis: "SOURCE_DISCOVERY_OWED" });
  assert.ok(applied.written.includes(tucson), "Tucson's meetings discovery is created");
  assert.ok(!applied.written.some((id) => id.includes("az:city:city-of-phoenix")), "Phoenix is not in Pima County and gets nothing");

  for (const id of applied.written) {
    const row = await repos.obligations.mustRead(id);
    const instance = plan.writes.find((w) => w.instance.obligation.id === id)!.instance;
    assert.deepEqual(
      row.value,
      standing({ ...instance.obligation, assignments: [assignmentEntry(target, "CREATED", T0)] }, T0),
      `${id} is exactly the row syncObligations would register, marked, recording the Send that created it (MW-001)`,
    );
    assert.equal(row.value.materializedBy, OWNER_DISPATCH);
    assert.equal(row.value.active, true);
    assert.equal(stateOfSubject(row.value.subjectId), "AZ");
    assert.equal(subjectOfObligationId(id), row.value.subjectId, "Admin recovers the government from the id");
  }

  /* The need is the gap ledger's own: the same derivation, the same basis. */
  const need = meetingsDiscoveryNeedFor(REGISTRIES.az, "az:city:city-of-tucson");
  assert.equal(need?.basis, "SOURCE_DISCOVERY_OWED");
  assert.equal(parseMeetingsDiscoveryId(tucson)?.jurisdictionId, need?.jurisdictionId);
});

test("created work joins the corpus through its providers next cycle: scheduled, never re-registered, never retired", async () => {
  const repos = createMemoryRepositories();
  const first = await cycleWorld(repos, T0);
  const plan = planDispatchWork({ targets: [scopeWorkTarget(await planned(decision(PIMA)))], world: first.world });
  const applied = await applyDispatchWork(repos, plan, { now: T0 });
  assert.ok(applied.written.length > 0);

  const next = await cycleWorld(repos, T1);
  const corpus = new Set(next.registry.obligations.map((o) => o.id));
  for (const id of applied.written) assert.ok(corpus.has(id), `${id} is emitted by its provider next cycle`);
  assert.equal(next.sync.registered.filter((id) => applied.written.includes(id)).length, 0, "a created row is never registered a second time");
  assert.equal((next.sync.outside ?? []).filter((row) => row.materializedBy === OWNER_DISPATCH).length, 0, "no created row falls outside the corpus");
  const retirement = planSupersededRetirement({
    outside: next.sync.outside ?? [],
    corpus: next.registry.units.map((u) => ({ providerId: u.providerId, obligationId: u.obligation.id })),
    providers: next.registry.byProvider,
  });
  assert.equal(retirement.retire.filter((r) => applied.written.includes(r.obligationId)).length, 0, "the retirement planners never see the owner's work as superseded");
  const discovery = next.registry.byProvider.find((p) => p.providerId === "meetings-discovery");
  assert.equal(discovery?.readFailure, null);
  assert.equal(discovery?.units, applied.written.filter((id) => id.startsWith(MEETINGS_DISCOVERY_NAMESPACE)).length);

  /* Removing the scope (it is simply no longer a target) undoes nothing: the rows stay owed. */
  const after = await cycleWorld(repos, T2);
  for (const id of applied.written) assert.equal((await repos.obligations.mustRead(id)).value.active, true, `${id} stays owed after the scope is gone`);
  assert.ok(after.registry.obligations.some((o) => o.id === applied.written[0]));
});

test("sending the same scope twice creates nothing new, and overlapping geographies share one row per requirement", async () => {
  const repos = createMemoryRepositories();
  const pima = scopeWorkTarget(await planned(decision(PIMA)));
  const first = await cycleWorld(repos, T0);
  const once = await applyDispatchWork(repos, planDispatchWork({ targets: [pima], world: first.world }), { now: T0 });
  assert.ok(once.written.length > 0);

  const second = await cycleWorld(repos, T1);
  const again = planDispatchWork({ targets: [pima, { ...pima, key: `${pima.key}#resent` }], world: second.world });
  const twice = await applyDispatchWork(repos, again, { now: T1 });
  assert.equal(twice.written.length, 0, "the same Send, twice, writes nothing");
  const reading = dispatchWorkReading(again, twice, { ...CONTEXT, at: T1 });
  for (const t of reading.targets) {
    assert.equal(t.requirements.createdThisCycle, 0);
    assert.equal(t.requirements.created, once.written.length, "what exists is counted as created, cumulatively");
  }

  /* The two scopes overlap: a requirement both hold is written once, under the first. */
  const fresh = createMemoryRepositories();
  const both = await cycleWorld(fresh, T0);
  const cd6 = scopeWorkTarget(await planned(decision(CD6, 2)));
  const overlapping = planDispatchWork({ targets: [pima, cd6], world: both.world });
  const ids = overlapping.writes.map((w) => w.instance.obligation.id);
  assert.equal(new Set(ids).size, ids.length, "each requirement is queued once however many geographies hold it");
  const shared = overlapping.targets[1].instances.filter((p) => overlapping.targets[0].instances.some((q) => q.instance.obligation.id === p.instance.obligation.id));
  assert.ok(shared.length > 0, "Pima and CD 6 share governments");
});

test("all missing requirements are created in one pass without a cycle window", async () => {
  const repos = createMemoryRepositories();
  const pima = scopeWorkTarget(await planned(decision(PIMA)));
  const first = await cycleWorld(repos, T0);
  const plan = planDispatchWork({ targets: [pima], world: first.world });
  assert.ok(plan.writes.length > 10);
  const applied = await applyDispatchWork(repos, plan, { now: T0 });
  assert.equal(applied.written.length, plan.writes.length);
  assert.equal(applied.deferred.length, 0);
  const reading = dispatchWorkReading(plan, applied, CONTEXT).targets[0];
  assert.equal(reading.requirements.createdThisCycle, plan.writes.length);
  assert.doesNotMatch(reading.says.join(" "), /per cycle|work window|at most/);
  const second = await cycleWorld(repos, T1);
  assert.equal(planDispatchWork({ targets: [pima], world: second.world }).writes.length, 0);
});

test("a geography in a state with no promoted registry is blocked by name, and nothing is invented for it", async () => {
  /* Arizona unregistered: the same Census units, and no registry to say what they owe. */
  const withoutAz = readTerritoryIndex(ROOT, [REGISTRIES.nh, REGISTRIES.nj], ["AZ", "NH", "NJ"]);
  const repos = createMemoryRepositories();
  const { world } = await cycleWorld(repos, T0);
  const plan = planDispatchWork({
    targets: [scopeWorkTarget(await planned(decision(PIMA)))],
    world: { ...world, territory: withoutAz, registries: new Map([["nh", REGISTRIES.nh], ["nj", REGISTRIES.nj]]) },
  });
  const [pima] = dispatchWorkReading(plan, null, CONTEXT).targets;
  assert.equal(pima.units.placed, 0);
  assert.equal(pima.requirements.defined, 0, "no requirement exists that no registry defines");
  assert.equal(plan.writes.length, 0, "nothing is invented");
  const [blocked] = pima.blocked;
  assert.equal(blocked.code, "NO_JURISDICTION_REGISTRY");
  assert.match(blocked.dataset, /promoted AZ jurisdiction registry/);
  assert.ok((blocked.units ?? 0) > 5, `the Census units certainly in Pima are counted (${blocked.units})`);
  assert.ok(blocked.sample.includes("COUNTY OF PIMA"));
  assert.equal(pima.units.blocked, blocked.units);
  assert.match(pima.says.join(" "), /Promoting its registry is the whole change that unblocks them/);

  /* The lookup did not resolve it: blocked, and the count itself is unknown, never zero. */
  const unresolved: PlannedScope = { kind: "UNRESOLVED", decision: decision(PIMA), why: "the Census geography is not published yet", states: ["AZ"], members: new Set() };
  const u = dispatchWorkReading(planDispatchWork({ targets: [scopeWorkTarget(unresolved)], world }), null, CONTEXT).targets[0];
  assert.equal(u.blocked[0].code, "GEOGRAPHY_UNRESOLVED");
  assert.equal(u.units.blocked, null);
  assert.match(u.blocked[0].dataset, /published Census geography lookup/);

  /* The territory files could not be read. */
  const t = dispatchWorkReading(
    planDispatchWork({ targets: [scopeWorkTarget(await planned(decision(PIMA)))], world: { ...world, territory: null, territoryDetail: "ENOENT census-unit-zips.json" } }),
    null,
    CONTEXT,
  ).targets[0];
  assert.equal(t.blocked[0].code, "TERRITORY_UNREADABLE");
  assert.match(t.blocked[0].why, /ENOENT census-unit-zips\.json/);

  /* A DISPATCH to a state with no registry, and one that names no state at all. */
  const illinois = dispatchWorkTarget({ intentId: "i-il", note: "deep dive on Illinois", requestedAt: T0 });
  const pimaWords = dispatchWorkTarget({ intentId: "i-pima", note: "Pima County", requestedAt: T0 });
  const d = planDispatchWork({ targets: [illinois, pimaWords], world: { ...world, censusUnitsByState: new Map([["IL", 6963]]) } });
  const [il, words] = dispatchWorkReading(d, null, CONTEXT).targets;
  assert.equal(il.blocked[0].code, "NO_JURISDICTION_REGISTRY");
  assert.equal(il.blocked[0].units, 6963);
  assert.match(il.blocked[0].why, /Illinois has no promoted jurisdiction registry/);
  assert.equal(words.blocked[0].code, "NO_STATE_NAMED");
  assert.equal(d.writes.length, 0);
  assert.equal(ownerDispatchWorkOf(dispatchWorkReading(d, null, CONTEXT), "i-il")?.blocked[0]?.code, "NO_JURISDICTION_REGISTRY");
});

test("a promoted registry the runtime's reader refuses is named as that, never used and never called missing", async () => {
  const promoted = promotedRegistries();
  assert.ok("registries" in promoted);
  if (!("registries" in promoted)) return;
  assert.deepEqual([...promoted.registries.keys()], ["az", "nh", "nj"], "every promoted registry, read through the providers' own accessor");
  assert.equal(promoted.refused.size, 0);

  const repos = createMemoryRepositories();
  const { world } = await cycleWorld(repos, T0);
  const refused = new Map([["az", "OPERATIONAL_REFERENCE_STATE_NOT_REGISTERED:az"]]);
  const readable = new Map([["nh", REGISTRIES.nh], ["nj", REGISTRIES.nj]]);
  const plan = planDispatchWork({
    targets: [scopeWorkTarget(await planned(decision(PIMA))), dispatchWorkTarget({ intentId: "i-az", note: "Arizona", requestedAt: T0 })],
    world: { ...world, territory: readTerritoryIndex(ROOT, [REGISTRIES.nh, REGISTRIES.nj], ["AZ", "NH", "NJ"]), registries: readable, refusedRegistries: refused },
  });
  const [dispatch, scope] = dispatchWorkReading(plan, null, CONTEXT).targets;
  for (const t of [scope, dispatch]) {
    assert.equal(t.blocked[0].code, "REGISTRY_NOT_READ", `${t.label}: a refused registry is not a missing one`);
    assert.match(t.blocked[0].dataset, /operational-reference registry reader/);
    assert.match(t.blocked[0].why, /OPERATIONAL_REFERENCE_STATE_NOT_REGISTERED:az/);
  }
  assert.equal(plan.writes.length, 0, "nothing is planned from a registry the providers could not keep in the corpus");
});

test("a Census unit the registry does not carry is blocked NOT_IN_REGISTRY, with the registry named", () => {
  const reg: JurisdictionRegistry = {
    ...REGISTRIES.az,
    jurisdictions: REGISTRIES.az.jurisdictions.filter((j) => j.id === "az:county:county-of-pima"),
    counts: { COUNTY: 1 },
  };
  const units: CensusUnitTerritory[] = [
    { pid6: "1", name: "COUNTY OF PIMA", type: "COUNTY", state: "AZ", zips: ["85701"], method: "county GEOID 04019" },
    { pid6: "2", name: "TOWN OF SOMEWHERE", type: "MUNICIPAL", state: "AZ", zips: ["85701"], method: "place GEOID 0499999" },
  ];
  const index = buildTerritoryIndex([reg], units);
  assert.deepEqual(index.unjoinedUnitsByState?.get("AZ")?.map((u) => u.name), ["TOWN OF SOMEWHERE"]);
  const scope: PlannedScope = {
    kind: "RESOLVED",
    decision: decision(PIMA),
    zctas: new Set(["85701"]),
    whole: new Set(["85701"]),
    fractions: new Map(),
    states: ["AZ"],
    members: new Set(),
  };
  const world: DispatchWorkWorld = {
    registries: new Map([["az", reg]]),
    territory: index,
    territoryDetail: null,
    corpus: [],
    durable: new Map(),
    meetingPartitions: UNREAD_MEETING_PARTITIONS,
  };
  const [t] = dispatchWorkReading(planDispatchWork({ targets: [scopeWorkTarget(scope)], world }), null, CONTEXT).targets;
  assert.equal(t.units.placed, 1);
  assert.equal(t.blocked[0].code, "NOT_IN_REGISTRY");
  assert.deepEqual(t.blocked[0].sample, ["TOWN OF SOMEWHERE"]);
  assert.equal(t.units.blocked, 1);

  /* ZCTAs that place no government at all are a gap in the territory data, never an empty geography. */
  const nowhere: PlannedScope = { ...scope, zctas: new Set(["99999"]), whole: new Set(["99999"]) };
  const [empty] = dispatchWorkReading(planDispatchWork({ targets: [scopeWorkTarget(nowhere)], world }), null, CONTEXT).targets;
  assert.equal(empty.blocked[0].code, "NO_GOVERNMENT_PLACED");
  assert.equal(empty.units.blocked, null, "the count is unknown, never zero");
  assert.match(empty.blocked[0].why, /never a geography with no government/);

  /* A DISPATCH whose words match no registered government says so, and creates nothing. */
  const [words] = dispatchWorkReading(
    planDispatchWork({ targets: [dispatchWorkTarget({ intentId: "i-z", note: "Arizona zzqx", requestedAt: T0 })], world }),
    null,
    CONTEXT,
  ).targets;
  assert.equal(words.requirements.defined, 0);
  assert.match(words.says.join(" "), /No registered government in Arizona carries these words, so nothing was created/);
});

test("creating work opens no paid lane: the owner's PAUSE stands, nothing but obligations is written, and paid discovery waits for the free walk", async () => {
  const repos = createMemoryRepositories();
  const pause = buildResearchIntent("PAUSE", T0, "adm_owner", null);
  assert.equal((await appendResearchIntent(repos, pause, T0)).ok, true);
  const intentsBefore = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY);

  const { world } = await cycleWorld(repos, T0);
  const obligationsBefore = (await repos.obligations.list()).length;
  const plan = planDispatchWork({ targets: [scopeWorkTarget(await planned(decision(PIMA, 1, 0)))], world });
  const applied = await applyDispatchWork(repos, plan, { now: T0 });
  assert.ok(applied.written.length > 0);

  assert.deepEqual(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY), intentsBefore, "no intent is appended: the PAUSE is never lifted");
  assert.equal(readIntents(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).paused, true);
  assert.equal((await repos.obligations.list()).length, obligationsBefore + applied.written.length, "only obligations were written");
  assert.equal((await repos.workItems.list()).length, 0, "no work item");
  assert.equal((await repos.routeTasks.list()).length, 0, "no route task");
  assert.equal((await repos.attempts.list()).length, 0, "no attempt");
  assert.equal((await repos.costs.readAll()).length, 0, "no charge");
  assert.equal((await repos.scoutResults.readAll()).length, 0, "no Scout ran");

  /* The lane stays closed on the same facts: the PAUSE stands. */
  const closure = modelLaneClosure({
    dry: false,
    noModel: false,
    credentialConfigured: true,
    credentialVar: "WTP_WORKERS_ANTHROPIC_API_KEY",
    paused: true,
    pauseIntentId: pause.intentId,
    runnerPaused: false,
    runnerPauseIntentId: null,
    unreadableControls: [],
  });
  assert.notEqual(closure, null, "the paid lane is closed");

  /* Reuse prior free discoveries; no requirement to exhaust free routes before appropriate paid work. */
  const discovery = applied.written.find((id) => id.startsWith(MEETINGS_DISCOVERY_NAMESPACE))!;
  const jurisdictionId = parseMeetingsDiscoveryId(discovery)!.jurisdictionId;
  assert.equal(paidDiscoveryHold(discovery, UNREAD_FREE_DISCOVERY_WALKS)?.code, FREE_WALK_FIRST);
  const walks = (outcome: "FOUND" | "WALKED_NOT_FOUND" | "NOT_WALKED") => ({ latestFor: (id: string) => (id === jurisdictionId ? outcome : "NOT_WALKED" as const), source: "test" });
  assert.equal(paidDiscoveryHold(discovery, walks("NOT_WALKED")), null, "the owner permits paid tools before exhausting free routes");
  assert.equal(paidDiscoveryHold(discovery, walks("FOUND"))?.code, FREE_WALK_FIRST);
  assert.equal(paidDiscoveryHold(discovery, walks("WALKED_NOT_FOUND")), null, "a failed free route does not end the obligation");
  assert.equal(paidDiscoveryHold("freshness:jurisdiction:az:county:county-of-pima#ballot-and-candidates-1", UNREAD_FREE_DISCOVERY_WALKS), null, "no other work is held by it");

  /* When the lane opens, the scope's own budget binds the created subjects — a $0 budget holds all paid work there. */
  const gate = new ScopeBudgetGate({
    scopes: [{ key: scopeKeyOf(PIMA), label: "Pima", budgetUsd: 0, resolved: true, members: new Set([jurisdictionId]), states: ["AZ"], historicalUsd: 0 }],
    worstCaseUsd: 0.6,
  });
  assert.equal(gate.admit(discovery, jurisdictionId).admit, false);

  /* And the receipt says why the created work waits, and which budgets bind it — the Send's own among them. */
  const [t] = dispatchWorkReading(plan, applied, CONTEXT).targets;
  const says = t.says.join(" ");
  assert.match(says, /need a model and wait: paused by owner intent pause-1/);
  assert.match(says, /\$105\.00 rolling 24-hour ceiling \(your dial\) first, then this Send's own \$0\.00 rolling 24-hour budget over the work it reached, and this geography's\./);
  assert.doesNotMatch(says, /no per-assignment budget/);
  assert.match(says, /without waiting for free routes to fail/);
});

test("a cycle that may not write plans, counts and writes nothing", async () => {
  const repos = createMemoryRepositories();
  const { world } = await cycleWorld(repos, T0);
  const plan = planDispatchWork({ targets: [scopeWorkTarget(await planned(decision(PIMA)))], world });
  const reading = dispatchWorkReading(plan, null, { ...CONTEXT, writes: "PLAN_ONLY", planOnlyWhy: "the scheduled blackout" });
  assert.equal(reading.written, 0);
  assert.equal(reading.deferred, plan.writes.length);
  assert.equal(reading.targets[0].requirements.deferred, plan.writes.length);
  assert.match(reading.targets[0].says[0], /Planned only, nothing written this cycle: the scheduled blackout/);
  assert.equal((await repos.obligations.listWhere(["materializedBy"], OWNER_DISPATCH)).length, 0);
});

test("a DISPATCH naming a registered state creates there, counts it on the owner's record, and carries its remainder forward", async () => {
  const repos = createMemoryRepositories();
  const { world } = await cycleWorld(repos, T0);
  const pimaAz = dispatchWorkTarget({ intentId: "i-1", note: "Pima Arizona", requestedAt: T0 });
  assert.deepEqual([...(pimaAz as Extract<DispatchWorkTarget, { kind: "DISPATCH" }>).target.states], ["az"]);
  const plan = planDispatchWork({ targets: [pimaAz], world });
  const applied = await applyDispatchWork(repos, plan, { now: T0 });
  const reading = dispatchWorkReading(plan, applied, CONTEXT);
  const [t] = reading.targets;
  assert.ok(t.units.placed > 0, "every AZ government whose id carries 'pima'");
  assert.equal(t.requirements.createdThisCycle, plan.writes.length);
  assert.equal(t.requirements.deferred, 0);
  assert.ok(t.reordered.obligations > 0, "the standing work the words match is counted as reordered");
  assert.equal(t.reordered.of, world.corpus.length);

  const work = ownerDispatchWorkOf(reading, "i-1");
  assert.equal(work?.key, "dispatch:i-1");
  assert.equal(work?.created, plan.writes.length);
  assert.equal(work?.deferred, t.requirements.deferred);

  const carried = carriedDispatchTargets(reading);
  assert.equal(carried.length, 0, "all creation and assignment marks finished in this cycle");
  assert.equal(
    carriedDispatchTargets({
      ...reading,
      targets: reading.targets.map((x) => ({ ...x, requirements: { ...x.requirements, deferred: 0 }, assignment: { recordedThisCycle: 0, marksDeferred: 0, marksFailed: 0 } })),
    }).length,
    0,
  );
  /* A Send is carried until every row it reached records it, even with nothing left to create. */
  assert.equal(
    carriedDispatchTargets({
      ...reading,
      targets: reading.targets.map((x) => ({ ...x, requirements: { ...x.requirements, deferred: 0 }, assignment: { recordedThisCycle: 0, marksDeferred: 2, marksFailed: 0 } })),
    }).length,
    1,
  );
  /* A Send with a remainder still to create is carried; taking it back stops that, and taking back a different Send does not. */
  const withRemainder = { ...reading, targets: reading.targets.map((x) => ({ ...x, requirements: { ...x.requirements, deferred: 2 } })) };
  assert.equal(carriedDispatchTargets(withRemainder).length, 1, "a Send with a remainder is carried");
  assert.equal(carriedDispatchTargets(withRemainder, new Set(["i-1"])).length, 0, "a Send the owner took back (CANCEL_DISPATCH) is no longer carried");
  assert.equal(carriedDispatchTargets(withRemainder, new Set(["another"])).length, 1, "taking back one Send leaves the others carried");
  assert.equal(carriedDispatchTargets({ nonsense: true }).length, 0, "an unreadable prior reading carries nothing, never throws");
  assert.equal(isDispatchWorkReading(reading), true);

  assert.match(dispatchWorkSentence(t), /created \d+ of \d+ requirement\(s\) the registry defines here \(\d+ this cycle\); reordered \d+ of \d+ standing obligations; 0 of \d+ governments blocked by missing data\./);
});

/** The rule the provider has always used, restated here as an independent oracle: no existing id may move. */
function legacyIds(reg: JurisdictionRegistry): Set<string> {
  const out = new Set<string>();
  for (const j of reg.jurisdictions) {
    const sources = sourcesOf(reg, j);
    const scheduledHere = j.govClass === "STATE" || j.govClass === "COUNTY" || sources.some((s) => s.scope === "THIS_JURISDICTION" && s.recordClass !== "MEETINGS");
    if (!scheduledHere) continue;
    const kept = sources.filter((s) => s.recordClass !== "MEETINGS" && s.scope !== "STATEWIDE" && !(s.scope === "PER_COUNTY" && j.govClass !== "COUNTY"));
    kept.forEach((s, n) => out.add(`freshness:jurisdiction:${j.id}#${s.routeId ?? `${s.recordClass.toLowerCase().replace(/_/g, "-")}-${n}`}`));
  }
  return out;
}

test("local-jurisdictions schedules the tracked states it is handed, keeps every existing id, and names a tracked state with no registry", () => {
  const all = buildRegistry([localJurisdictionsProvider()], { root: ROOT, nowIso: T0 });
  const expected = new Set([...legacyIds(REGISTRIES.az), ...legacyIds(REGISTRIES.nh), ...legacyIds(REGISTRIES.nj)]);
  assert.deepEqual(new Set(all.units.map((u) => u.obligation.id)), expected, "no standing id moved: every next-due, occurrence and debt row keeps its key");
  assert.equal(all.byProvider[0].readFailure, null);

  const two = buildRegistry([localJurisdictionsProvider({ trackedStates: trackedStatesFrom(["AZ", "nh"], "a test coverage set") })], { root: ROOT, nowIso: T0 });
  assert.ok(two.units.length > 0);

  const withCo = buildRegistry([localJurisdictionsProvider({ trackedStates: trackedStatesFrom(["az", "co"], "a test coverage set") })], { root: ROOT, nowIso: T0 });
  assert.match(withCo.byProvider[0].readFailure ?? "", /co could not be read .*JURISDICTION_REGISTRY_NOT_READ:co: no reviewed registry, and its registration was not read/, "a tracked state with no registry is named");
  assert.ok(withCo.units.some((u) => u.obligation.subjectId.startsWith("az:")), "and the rest still schedule");

  const none = buildRegistry([localJurisdictionsProvider({ trackedStates: trackedStatesFrom([], "an empty coverage set") })], { root: ROOT, nowIso: T0 });
  assert.equal(none.units.length, 0);
  assert.match(none.byProvider[0].readFailure ?? "", /names no tracked state — a failed read/, "an empty tracked set is a failed read, never 'track nothing'");

  /* A requirement the owner's dispatch materialized in an UNTRACKED state keeps the id tracking would give it. */
  const nj = REGISTRIES.nj.jurisdictions.find((j) => j.govClass === "COUNTY")!;
  const [req] = jurisdictionRequirements(REGISTRIES.nj, nj);
  const materialized = buildRegistry(
    [localJurisdictionsProvider({ trackedStates: trackedStatesFrom(["az"], "t"), materialized: () => ({ ids: new Set([req.obligationId]) }) })],
    { root: ROOT, nowIso: T0 },
  );
  assert.ok(materialized.units.some((u) => u.obligation.id === req.obligationId));
  assert.ok(legacyIds(REGISTRIES.nj).has(req.obligationId), "the same id the tracked state's standing clock carries");
});

test("a meetings route with a known address is carried by what the partition wiring says, and held when it cannot be read", () => {
  const base = REGISTRIES.az;
  const j: Jurisdiction = { ...base.jurisdictions.find((x) => x.id === "az:city:city-of-tucson")!, sourceIds: ["MEETINGS:THIS_JURISDICTION:adapted-test"] };
  const reg: JurisdictionRegistry = {
    ...base,
    sourceCatalog: {
      ...base.sourceCatalog,
      "MEETINGS:THIS_JURISDICTION:adapted-test": {
        recordClass: "MEETINGS",
        authority: "the city clerk",
        authorityBasis: "test",
        scope: "THIS_JURISDICTION",
        routeId: null,
        url: "https://example.gov/meetings",
        state: "ADAPTED",
        owed: null,
        citation: "test",
      },
    },
  };
  const owner = (o: "PARTITION" | "NONE" | "UNKNOWN"): MeetingPartitionOwnership => ({ ownerOf: () => o, source: "test" });
  assert.equal(jurisdictionRequirements(reg, j, owner("UNKNOWN"))[0].carriage, "HELD_UNREAD_WIRING", "never a second clock beside a partition that may own it");
  assert.equal(jurisdictionRequirements(reg, j, owner("PARTITION"))[0].carriage, "MEETING_PARTITION");
  const none = jurisdictionRequirements(reg, j, owner("NONE"))[0];
  assert.equal(none.carriage, "HERE", "the only clock these meetings have");
  assert.equal(none.obligationId, "freshness:jurisdiction:az:city:city-of-tucson#meetings-adapted-0", "never the retired positional meetings-<n> shape");
  assert.equal(jurisdictionRequirements(REGISTRIES.az, REGISTRIES.az.jurisdictions.find((x) => x.id === "az:city:city-of-tucson")!).some((r) => r.source.recordClass === "MEETINGS"), false, "a DISCOVERY_OWED meetings source is discovery, not a route here");
});

test("the meetings-discovery provider emits exactly the materialized needs, in the registry derivation's shape", () => {
  const empty = meetingsDiscoveryProvider().enumerate({ root: ROOT, nowIso: T0 });
  assert.equal(empty.obligations.length, 0);
  assert.match(empty.emptyReason ?? "", /mission map/);

  const unreadable = meetingsDiscoveryProvider({ materialized: () => ({ unreadable: "store down" }) }).enumerate({ root: ROOT, nowIso: T0 });
  assert.match(unreadable.readFailure ?? "", /could not be read \(store down\)/);

  const needs = meetingsDiscoveryNeeds([REGISTRIES.az]);
  const own = needs.find((n) => n.basis === "SOURCE_DISCOVERY_OWED")!;
  const noSite = needs.find((n) => n.basis === "NO_MEETINGS_SOURCE_RECORDED")!;
  const ids = [meetingsDiscoveryObligationId(own), meetingsDiscoveryObligationId(noSite)];
  const wrongBasis = `${MEETINGS_DISCOVERY_NAMESPACE}${own.jurisdictionId}#find-own-site`;
  const pass = buildRegistry([meetingsDiscoveryProvider({ materialized: () => ({ ids: new Set([...ids, wrongBasis, "freshness:jurisdiction:x#y"]) }) })], { root: ROOT, nowIso: T0 });
  assert.deepEqual(pass.units.map((u) => u.obligation.id).sort(), [...ids].sort(), "a need whose basis moved, and another provider's id, are not emitted");
  for (const u of pass.units) {
    assert.equal(u.obligation.recordClass, "meetings-discovery");
    assert.equal(u.route.open.kind, "NOT_MACHINE_EXECUTABLE");
  }
  const ownUnit = pass.units.find((u) => u.obligation.subjectId === own.jurisdictionId)!;
  assert.equal(ownUnit.route.open.kind === "NOT_MACHINE_EXECUTABLE" ? ownUnit.route.open.target : null, own.ownWebAddress);
  assert.equal(ownUnit.route.routeId, "own-site-meetings");
  assert.equal(pass.units.find((u) => u.obligation.subjectId === noSite.jurisdictionId)!.route.routeId, "find-own-site");
});

test("candidate enrichment enumerates the tracked states and names one with no ballot authority", async () => {
  await preloadCandidateEnrichmentAuthorities({ store: new MemoryRoutineDataStore(), bypassCache: true, now: T0 });
  const y = candidateEnrichmentProvider({ trackedStates: trackedStatesFrom(["az", "co"], "a test coverage set") }).enumerate({ root: ROOT, nowIso: T0 });
  assert.match(y.readFailure ?? "", /CO is tracked \(a test coverage set\) and no canonical candidate ballot authority is registered for it/);
  assert.match(y.readFailure ?? "", /a dataset gap, never an election with no candidates/);
});

test("syncObligations keeps the owner's mark when a provider's signals move", async () => {
  const repos = createMemoryRepositories();
  const o = { id: "freshness:meetings-discovery:az:city:city-of-tucson#own-site-meetings", recordClass: "meetings-discovery", subjectId: "az:city:city-of-tucson", routeId: "own-site-meetings", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null };
  await repos.obligations.put(o.id, standing({ ...o, materializedBy: OWNER_DISPATCH }, T0), T0);
  const sync = await syncObligations(repos, [{ ...o, observedChangeRateHours: 48 }], T1);
  assert.deepEqual(sync.refreshed.map((r) => r.id), [o.id], "the moved signal is refreshed");
  assert.equal((await repos.obligations.mustRead(o.id)).value.materializedBy, OWNER_DISPATCH, "and the mark that keeps the row owed survives");
});

test("place work is ordered by the owner's target first, then by completion", () => {
  const places = [
    { key: "az.cd.06", receiptId: "target", items: [{ checklistId: "GOV-01", state: "published" as const }, { checklistId: "GOV-01", state: "unpublished" as const }, { checklistId: "GOV-01", state: "missing" as const }] },
    { key: "az.zcta.10001", receiptId: "lowest", items: [{ checklistId: "GOV-01", state: "missing" as const }] },
    { key: "az.zcta.10002", receiptId: "middle", items: [{ checklistId: "GOV-01", state: "published" as const }, { checklistId: "GOV-01", state: "missing" as const }] },
  ];
  const config = { placeTargets: [{ key: "az.cd.06", goalPercent: 95, setAt: T0, receiptId: "owner-target" }] };
  assert.deepEqual(orderPlaceWork(config, places), ["target", "lowest", "middle"]);
  assert.deepEqual(orderPlaceWork({ placeTargets: [{ ...config.placeTargets[0], key: "geo:az.congressional_district.06" }] }, places),
    ["target", "lowest", "middle"], "the existing v6 hunt key and checklist place key identify the same target");
  assert.deepEqual(orderPlaceWork({}, places), ["lowest", "target", "middle"], "an item the government does not publish leaves the count, so target and middle tie at half and the key breaks it");
  assert.deepEqual(orderPlaceWork({ placeTargets: [{ ...config.placeTargets[0], goalPercent: 40 }] }, places),
    ["lowest", "target", "middle"], "a reached owner target returns to ordinary completion order");
  assert.deepEqual(orderPlaceWork({}, [{ ...places[0], items: [{ checklistId: "GOV-01", state: "missing" }] },
    { ...places[1], items: [{ checklistId: "GOV-01", state: "published" }] }]), ["target", "lowest"], "new captures rerank places");
  assert.throws(() => orderPlaceWork({ placeTargets: [{}] }, places), /PLACE_TARGETS_UNREADABLE/);
});

test("the gateway and the preview say the Send creates all missing work, and name no machine constant", () => {
  const set = lookupAction("expansion.scope.set")!.definition;
  const deploy = lookupAction("fleet.deployHere")!.definition;
  assert.match(set.does, /creates the work the registry defines there that no clock carries yet/);
  assert.match(set.doesNot, /all missing work for the requested geography/);
  assert.match(deploy.does, /creates the work\s+that state's registry defines/);
  assert.match(deploy.doesNot, /Without a state in your words it only reorders/);

  const withState = deployPreview({ note: "Arizona", obligations: [], obligationsRead: true, ceilings: { rolling24HourModelUsd: 105 } });
  assert.match(withState.creates[0].says, /the runner creates the work the promoted registry defines and no clock carries yet/);
  assert.equal(withState.creates[0].measured, false, "the console holds no registry, so the count is the runner's");
  const noState = deployPreview({ note: "Pima County", obligations: [], obligationsRead: true, ceilings: { rolling24HourModelUsd: 105 } });
  assert.match(noState.creates[0].says, /your words name no state/);
  assert.equal(parseDispatchTarget("Pima County").states.length, 0);
});
