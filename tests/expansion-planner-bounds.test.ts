import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadBootstrapLookup } from "../lib/census-geography/reader.ts";
import { declaredWorkMembers } from "../lib/control-plane/expansion/declared-work-scope.ts";
import { applyDispatchWork, dispatchWorkReading, planDispatchWork, scopeWorkTarget, type DurableRowFacts } from "../lib/control-plane/expansion/dispatch-work.ts";
import { planExpansion, type ResolvedScope, type Territory } from "../lib/control-plane/expansion/membership.ts";
import { withScopeSet } from "../lib/control-plane/expansion/scopes.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { createPlannerSpool, plannerMap, plannerSet } from "../lib/control-plane/scheduler/planner-spool.ts";
import { UNREAD_MEETING_PARTITIONS } from "../lib/control-plane/scheduler/provider-inputs.ts";
import { standing } from "../lib/control-plane/scheduler/durable.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";

const NOW = "2026-10-20T03:00:00.000Z";
function scope(): Extract<ResolvedScope, { kind: "RESOLVED" }> {
  const decision = withScopeSet([], { geography: { type: "zcta", geoid: "85635", version: "zcta:2020", label: "ZIP 85635", stateAbbr: "AZ" },
    priority: 1, budgetUsd: 50, note: null, decidedAt: NOW, decidedBy: "adm_test", receiptId: "test-send" }).scopes[0];
  return { kind: "RESOLVED", decision, states: ["NH", "AZ"], zctas: new Set(["85635"]), whole: new Set(["85635"]), fractions: new Map() };
}

test("expansion counts a streamed territory with indexed memberships and bounded reading samples", async () => {
  const planner = await createPlannerSpool();
  try {
    const obligations = planner.table<{ id: string; subjectId: string }>("test-work", row => row.id);
    const bySubject = new Map<string, Territory>();
    for (let n = 0; n < 2_000; n += 1) {
      const subjectId = `az:city:${String(n).padStart(5, "0")}`;
      obligations.add({ id: `work:${n}`, subjectId });
      bySubject.set(subjectId, { subjectId, name: `City ${String(1_999 - n).padStart(5, "0")}`, govClass: "CITY", stateCode: "AZ", zctas: new Set(["85635"]), shares: new Map() });
    }
    const plan = planExpansion({ planner, now: NOW, scopes: [scope()], malformedScopes: 0, lookup: { source: "published", versionId: "fixture", detail: null },
      territory: { bySubject, statewide: new Set(), unplaced: new Map(), unregisteredUnitsByState: new Map() }, territoryDetail: null, obligations: obligations.rows });
    assert.equal(plan.scopes[0].members instanceof Set, false);
    assert.equal(plan.placedSubjects instanceof Set, false);
    assert.equal(plan.placementOf("az:city:01999"), 0);
    assert.equal(plan.scopes[0].members.size, 2_000);
    const reading = plan.reading.scopes[0];
    assert.equal(reading.work?.registeredObligations, 2_000);
    assert.equal(reading.work?.subjectIdsComplete, false);
    assert.ok(reading.work!.subjectIds.length < 2_000);
    assert.equal(reading.coverage?.withWork, 2_000);
    assert.equal(reading.coverage?.registeredByClass.CITY, 2_000);
    assert.equal(reading.coverage?.withWorkSample[0].name, "City 00000");
    assert.equal(reading.coverage?.zctasWithLocalWork, 1);
    assert.equal(reading.coverage?.gapZctas, 0);
  } finally { await planner.close(); }
});

test("shared standing work uses the spool for its lookup memo and per-Send subject memberships", async () => {
  const planner = await createPlannerSpool();
  try {
    const work = planner.table<{ id: string; subjectId: string; scopeDivisions: string[] }>("test-shared-work", row => row.id);
    for (let n = 0; n < 1_000; n += 1) work.add({ id: `shared:${n}`, subjectId: `shared:${n}`, scopeDivisions: ["ocd-division/country:us/state:az"] });
    const lookup = loadBootstrapLookup(); let reads = 0;
    const original = lookup.groupingsForZcta.bind(lookup);
    lookup.groupingsForZcta = async (...args) => { reads += 1; return original(...args); };
    const first = scope(), second = { ...first, decision: { ...first.decision, key: "second-send" } };
    const members = await declaredWorkMembers([first, second], work.rows, lookup, new Map(), planner);
    assert.equal(reads, 1, "overlapping Sends reuse one disk lookup without retaining a national cache");
    assert.equal(members.get(first.decision.key)?.size, 1_000);
    assert.equal(members.get(first.decision.key) instanceof Set, false);
    assert.equal(members.get(second.decision.key)?.has("shared:999"), true);
  } finally { await planner.close(); }
});

test("dispatch spools only each government's own routes and applies marks by exact obligation reads", async () => {
  const planner = await createPlannerSpool();
  try {
    const registries = JSON.parse(readFileSync(new URL("./fixtures/jurisdiction-registries.json", import.meta.url), "utf8")) as Record<string, JurisdictionRegistry>;
    const bySubject = new Map<string, Territory>();
    for (const reg of [registries.az, registries.nh]) for (const j of reg.jurisdictions.slice(0, 6)) bySubject.set(j.id,
      { subjectId: j.id, name: j.name, stateCode: reg.stateCode, govClass: j.govClass, zctas: new Set(["85635"]), shares: new Map() });
    const members = plannerSet(planner, "test-members", bySubject.keys());
    const world = { registries: plannerMap(planner, "test-registries", [["az", registries.az], ["nh", registries.nh]]),
      territory: { bySubject, statewide: new Set<string>(), unplaced: new Map<string, string>(), unregisteredUnitsByState: new Map() }, territoryDetail: null,
      corpus: new DiskRows<{ id: string; subjectId: string }>(() => []), durable: plannerMap<DurableRowFacts>(planner, "test-durable"), meetingPartitions: UNREAD_MEETING_PARTITIONS };
    const target = scopeWorkTarget({ ...scope(), members });
    const plan = planDispatchWork({ planner, targets: [target], world });
    assert.ok(plan.writes instanceof DiskRows);
    assert.ok(plan.targets[0].instances instanceof DiskRows);
    assert.ok(plan.targets[0].units.placed instanceof DiskRows);
    for (const unit of plan.targets[0].units.placed) {
      assert.equal(unit.reg.jurisdictions.length, 1);
      assert.equal(unit.reg.jurisdictions[0].id, unit.jurisdiction.id);
      assert.deepEqual(Object.keys(unit.reg.sourceCatalog).sort(), [...new Set(unit.jurisdiction.sourceIds)].sort());
    }
    const repos = createMemoryRepositories();
    const applied = await applyDispatchWork(repos, plan, { now: NOW });
    assert.ok(applied.written instanceof DiskRows);
    assert.equal(applied.written.length, plan.writes.length);
    assert.equal(applied.failed.length, 0);
    const extra = { id: "freshness:test:shared#route", subjectId: "shared:finance" };
    members.add(extra.subjectId);
    await repos.obligations.put(extra.id, standing({ ...extra, recordClass: "candidate-enrichment", routeId: "route", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, NOW), NOW);
    const row = await repos.obligations.mustRead(extra.id);
    world.durable.set(extra.id, { active: true, assignments: row.value.assignments });
    const next = planDispatchWork({ planner, targets: [target], world: { ...world, corpus: [extra] } });
    repos.obligations.list = async () => { throw Error("country read forbidden"); };
    const marked = await applyDispatchWork(repos, next, { now: NOW });
    assert.equal(marked.marked?.length, 1);
    assert.equal(marked.markFailed?.length, 0);
    assert.equal((await repos.obligations.mustRead(extra.id)).value.assignments?.[0].assignmentKey, target.key);
    const reading = dispatchWorkReading(next, marked, { at: NOW, writes: "APPLIED", planOnlyWhy: null, modelLaneClosed: null, ceilingUsd: 50, ceilingSource: "FALLBACK" });
    assert.equal(reading.targets[0].assignment?.recordedThisCycle, marked.written.length + 1);
    assert.ok(Array.isArray(reading.targets[0].units.placedSample));
    assert.ok(JSON.stringify(reading).includes(target.key));
  } finally { await planner.close(); }
});
