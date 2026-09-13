import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { planZipAcquisition, type ZipAcquisitionPlanInput } from "../lib/control-plane/zip-acquisition-plan.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { candidateEnrichmentProvider } from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { meetingsProvider } from "../lib/control-plane/scheduler/providers/meetings.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { readSnapshot } from "../lib/meetings/snapshot.ts";
import type { CandidateUniverse } from "../lib/hunt/candidate-universe.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = (path: string) => JSON.parse(readFileSync(new URL(path, new URL("../", import.meta.url)), "utf8"));
const historicalSource = "data/control-plane/freshness-shadow/aggregates";
function latest<T>(directory: string): T[] {
  const rows = new Map<string, { id: string; revision: number; value: T }>();
  for (const name of readdirSync(`${root}/${historicalSource}/${directory}`).filter(name => name.endsWith(".json"))) {
    const row = json(`${historicalSource}/${directory}/${name}`);
    if (!rows.has(row.id) || rows.get(row.id)!.revision < row.revision) rows.set(row.id, row);
  }
  return [...rows.values()].sort((a,b) => a.id.localeCompare(b.id)).map(row => row.value);
}
function committedInput(): ZipAcquisitionPlanInput {
  return {
    queues: json("docs/evidence/fleet-zip-queue.example.json").queues,
    registry: buildRegistry([candidateEnrichmentProvider(), localJurisdictionsProvider(), meetingsProvider(), campaignFinanceProvider()],
      { root, nowIso: "2026-09-01T00:00:00.000Z" }),
    corpora: ["az", "nh", "nj"].map(state => json(`data/states/${state}/hunt/${state}-candidate-universe-2026.json`) as CandidateUniverse),
    meetings: readSnapshot(root)!.meetings,
    historical: { source: historicalSource, occurrences: latest("occurrences"), workItems: latest("work-items"), routeTasks: latest("route-tasks") },
  };
}

test("real registry output produces reproducible ZIP assignments without any network or registration", () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("NETWORK_FORBIDDEN"); }) as typeof fetch;
  try {
    const input = committedInput();
    const serialized = JSON.stringify(input);
    const plan = planZipAcquisition(input);
    assert.deepEqual(plan, json("docs/evidence/fleet-zip-acquisition-plan.example.json").plan);
    assert.equal(JSON.stringify(input), serialized, "Pure planning must not mutate input registry/store/queues");
    const actualIds = new Set(input.registry.units.map(unit => unit.obligation.id));
    assert.ok(plan.units.length > 0);
    assert.ok(plan.units.every(unit => actualIds.has(unit.obligationId)));
    assert.equal(new Set(plan.units.map(unit => unit.obligationId)).size, plan.units.length);
    assert.ok(plan.units.some(unit => unit.historicalTasks.length > 0), "Must demonstrate actual historical route IDs, not generated IDs");
    const realTaskIds = new Set(input.historical.routeTasks.map(task => task.id));
    assert.ok(plan.units.flatMap(unit => unit.historicalTasks).every(link => realTaskIds.has(link.routeTaskId)));
    assert.equal(plan.activation, "NOT_AUTHORIZED");
    assert.equal(plan.runtimeObservation, "UNKNOWN");
    assert.equal(plan.coverageAssignments.length, 5);
  } finally { globalThis.fetch = oldFetch; }
});

test("shared records resolve once; multiple source representations remain separate existing obligations", () => {
  const input = committedInput(); const plan = planZipAcquisition(input);
  const shared = plan.bindings.find(row => row.kind === "candidacy" && row.zipConsumers.length === 3 && row.obligationIds.length > 1)!;
  assert.ok(shared);
  const expected = input.registry.units.filter(unit => unit.record.subjectId === shared.ref.slice("candidacy:".length)).map(unit => unit.obligation.id).sort();
  assert.deepEqual(shared.obligationIds, expected);
  for (const id of expected) assert.equal(plan.units.filter(unit => unit.obligationId === id).length, 1);
  const source = plan.bindings.find(row => row.kind === "source-corpus" && row.downstreamReuseObligationIds.length > 0)!;
  assert.ok(source);
  assert.equal(source.assignment, "MISSING_ASSIGNMENT");
  assert.deepEqual(source.obligationIds, [], "Enrichment is not source-universe reacquisition");
  assert.ok(plan.coverageAssignments.every(row => row.obligationIds.length === 0));
});

test("duplicate canonical IDs become ambiguous; provider failure remains visible instead of fabricated assignments", () => {
  const input = committedInput();
  const matched = input.registry.units.find(unit => input.queues.sharedResearch.some(ref => ref.kind === "candidacy" && ref.canonicalId === unit.record.subjectId))!;
  const duplicate = planZipAcquisition({ ...input, registry: { ...input.registry, units: [...input.registry.units, matched] } });
  const row = duplicate.bindings.find(row => row.ref === `candidacy:${matched.record.subjectId}`)!;
  assert.equal(row.assignment, "AMBIGUOUS"); assert.deepEqual(row.obligationIds, []);
  const ambiguousCorpus = planZipAcquisition({ ...input, corpora: [...input.corpora, input.corpora[0]] });
  assert.ok(ambiguousCorpus.bindings.some(row => row.kind === "candidacy" && row.assignment === "AMBIGUOUS"));
  assert.ok(ambiguousCorpus.bindings.some(row => row.kind === "source-corpus" && row.assignment === "AMBIGUOUS" && row.downstreamReuseObligationIds.length === 0));
  const failed = planZipAcquisition({ ...input, registry: { units: [], byProvider: [{ providerId: "candidate-enrichment", describe: "fixture", records: 0, units: 0, readFailure: "fixture input unreadable", emptyReason: null }] } });
  assert.equal(failed.units.length, 0); assert.equal(failed.providers[0].readFailure, "fixture input unreadable");
  assert.ok(failed.counts.missingReferenceAssignments > 0);
});

test("historical occurrence must resolve its real task, work item, route and subject before reporting an executable link", () => {
  const input = committedInput(); const baseline = planZipAcquisition(input);
  const unit = baseline.units.find(unit => unit.historicalTasks.length > 0)!;
  const routeTaskId = unit.historicalTasks[0].routeTaskId;
  const changed = planZipAcquisition({ ...input, historical: { ...input.historical,
    routeTasks: input.historical.routeTasks.map(task => task.id === routeTaskId ? { ...task, workItemId: "mismatched-fixture" } : task) } });
  const row = changed.units.find(row => row.obligationId === unit.obligationId)!;
  assert.ok(!row.historicalTasks.some(link => link.routeTaskId === routeTaskId));
  assert.ok(row.unresolvedHistoricalLinks.length > 0);
});
