import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { installedOperationalReferenceStateCodes, requiredJurisdictionRegistry, JURISDICTION_REFERENCE_SCOPE } from "../lib/civic-data/operational-references.ts";
import { plannerStateOf, withRegistryState } from "../lib/control-plane/scheduler/registry-state-planner.ts";
import { createPlannerSpool, plannerMap } from "../lib/control-plane/scheduler/planner-spool.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { persistDebts, scanOccurrences, standing, syncObligations, type StandingObligation, type SyncPlannerSink } from "../lib/control-plane/scheduler/durable.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";

const NOW = "2026-10-20T03:00:00.000Z";
const ownership = () => ({ source: "fixture own-state ownership", ownerOf: () => "UNKNOWN" as const, bodyIdFor: () => null, reasonFor: () => "fixture", readStates: async () => {}, release: () => {} });

test("packet government IDs partition by their canonical state while the federal packet stays federal", () => {
  assert.equal(plannerStateOf("freshness:hunt-packet:ocd-division/country:us/state:ca/county:alameda#hunter"), "ca");
  assert.equal(plannerStateOf("freshness:hunt-packet:ocd-division/country:us/territory:pr/municipio:san_juan#hunter"), "pr");
  assert.equal(plannerStateOf("freshness:meetings-discovery:government:US-NH:330001#calendar"), "nh");
  assert.equal(plannerStateOf("freshness:hunt-packet:ocd-division/country:us#hunter"), "us");
});

test("reviewed source hydration releases the previous state's facts before the next state and on failure", async () => {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/jurisdiction-registries.json", import.meta.url), "utf8")) as Record<string, JurisdictionRegistry>;
  const trackedStates = new Set(["az", "nh"]), seen: string[] = [];
  for (const state of trackedStates) {
    await withRegistryState({ state, root: process.cwd(), trackedStates, registration: false, ownership: ownership(),
      readReviewedState: async requested => {
        assert.deepEqual(installedOperationalReferenceStateCodes(), [], "no prior state's source facts survive into this read");
        return { registry: fixtures[requested], versionId: "fixture", scope: JURISDICTION_REFERENCE_SCOPE };
      } }, async authority => {
      assert.equal(authority.failure, null);
      assert.deepEqual(installedOperationalReferenceStateCodes(), [state]);
      assert.equal(requiredJurisdictionRegistry(state).stateCode.toLowerCase(), state);
      assert.equal(authority.registry?.stateCode.toLowerCase(), state);
      seen.push(state);
    });
    assert.deepEqual(installedOperationalReferenceStateCodes(), []);
  }
  assert.deepEqual(seen, ["az", "nh"]);
  await assert.rejects(withRegistryState({ state: "az", root: process.cwd(), trackedStates, registration: false, ownership: ownership(),
    readReviewedState: async () => ({ registry: fixtures.az, versionId: "fixture", scope: JURISDICTION_REFERENCE_SCOPE }) }, async () => { throw new Error("visitor failed"); }), /visitor failed/);
  assert.deepEqual(installedOperationalReferenceStateCodes(), [], "a failed consumer releases the same source facts");
});

test("country registration and debt results stay on disk and unchanged registration keeps one paged snapshot", async () => {
  const repos = createMemoryRepositories(), planner = await createPlannerSpool();
  try {
    const corpus = planner.table<StandingObligation>("fixture-corpus", row => row.id);
    for (let n = 0; n < 1_000; n++) {
      const row = standing({ id: `work:${n}`, subjectId: `place:${n}`, recordClass: "meetings", routeId: null, active: true,
        readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, NOW);
      corpus.add(row); await repos.obligations.put(row.id, row, NOW);
    }
    const sink: SyncPlannerSink = { all: planner.table("all", row => row.id), outside: planner.table("outside", row => row.id),
      registered: planner.table("registered", row => row), alreadyDurable: planner.table("durable", row => row), refreshed: planner.table("refreshed", row => row.id) };
    let pages = 0; const readPages = repos.obligations.listChangedSince!.bind(repos.obligations);
    repos.obligations.listChangedSince = async (...args) => { pages++; return readPages(...args); };
    repos.obligations.read = async () => { throw new Error("per-row registration reread forbidden"); };
    const synced = await syncObligations(repos, corpus.rows, NOW, { sink });
    assert.equal(pages, 1); assert.ok(synced.all instanceof DiskRows); assert.equal(synced.all.length, 1_000);
    assert.equal(synced.refreshed.length, 0); assert.equal(synced.outside?.length, 0);
    const debts = corpus.rows.map(row => recordFailure(null, { obligationId: row.id, cause: "UPSTREAM_ERROR", detail: "held source failure", target: "example.gov", dueAt: NOW, now: NOW }));
    const persisted = await persistDebts(repos, debts, NOW, null, new Map(), 3, planner);
    assert.equal(persisted.written, 1_000); assert.ok(persisted.cleared instanceof DiskRows);
    const retired = plannerMap(planner, "retire-reasons", corpus.rows.map(row => [row.id, "source authority moved"] as const));
    const cleared = await persistDebts(repos, [], NOW, null, retired, 3, planner);
    assert.equal(cleared.written, 0); assert.ok(cleared.clearedAsRetired instanceof DiskRows); assert.equal(cleared.clearedAsRetired.length, 1_000);
    const scanned = await scanOccurrences(repos, { obligations: synced.all, settledRouteTaskIds: new Set(), neverClaimedRouteTaskIds: new Set(), planner });
    assert.ok(scanned.settled instanceof DiskRows); assert.ok(scanned.abandoned instanceof DiskRows);
  } finally { await planner.close(); }
});
