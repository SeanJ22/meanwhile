import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { prepareZipQueues, type ZipQueueInput } from "../lib/control-plane/zip-queue.ts";
import type { CandidateUniverse } from "../lib/hunt/candidate-universe.ts";
import type { StampedZipRow } from "../lib/coverage/zip-tier.ts";
import { applicableDivisions, projectOntoZip } from "../lib/hunt/zip-projection.ts";
import { COVERAGE_TIER_NEXT_STEP } from "../lib/coverage/tier.ts";
import { emptyStateSnapshot } from "../lib/control-plane/readiness/compute.ts";
import { READINESS_DERIVATION_CONTRACT } from "../lib/control-plane/readiness/model.ts";

const root = new URL("../", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const ledger = json("data/derived/zip-coverage-tiers.json") as { zips: Record<string, StampedZipRow> };
const geometry = json("data/derived/zip-division-ids.json") as { zips: Record<string, string[]> };
function input(zip: string, stateCode = "az", lane: ZipQueueInput["lane"] = "existing-completion"): ZipQueueInput {
  const citation = `data/states/${stateCode}/hunt/${stateCode}-candidate-universe-2026.json`;
  return {
    zip, stateCode, lane, stamp: ledger.zips[zip] ?? null, overlappingDivisions: geometry.zips[zip],
    corpus: { universe: json(citation) as CandidateUniverse, citation }, freshness: { stamp: null, corpus: null },
  };
}
const sampleInputs = () => [input("03255", "nh"), input("07866", "nj"), input("85641"), input("85701"), input("85122", "az", "new-expansion")];

test("prepared committed ZIP queues reproduce their evidence artifact without outbound acquisition", () => {
  const originalFetch = globalThis.fetch;
  const attempts: unknown[] = [];
  globalThis.fetch = ((request: unknown) => { attempts.push(request); throw new Error("Unexpected outbound acquisition"); }) as typeof fetch;
  try {
    const queues = prepareZipQueues(sampleInputs());
    assert.deepEqual(queues, json("docs/evidence/fleet-zip-queue.example.json").queues);
    assert.deepEqual(attempts, []);
    assert.equal(queues.existingCompletion.length, 4);
    assert.equal(queues.newExpansion.length, 1);
    for (const row of [...queues.existingCompletion, ...queues.newExpansion]) {
      assert.equal(row.stampedTier, ledger.zips[row.zip].tier);
      assert.equal(row.tierNextStep, COVERAGE_TIER_NEXT_STEP[ledger.zips[row.zip].tier]);
      assert.equal(row.activation, "NOT_AUTHORIZED");
      assert.equal(row.nextAutomaticAction, null);
      assert.equal(row.retryAt, null);
      assert.equal(row.completionVerified, false);
      assert.ok(row.gaps.some((gap) => gap.includes("freshness is unknown")));
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("another ZIP reuses named canonical candidacies and sources across jurisdictions, preserving authority scope", () => {
  const selected = [input("85701"), input("85641"), input("85122", "az", "new-expansion")];
  const result = prepareZipQueues(selected);
  const expansion = result.newExpansion[0];
  assert.ok(expansion.geometryHeld);
  assert.ok(expansion.heldProjection!.applicable > 0, "A vacuous projection is not this proof");
  const direct = projectOntoZip({ zip: "85122", universe: selected[2].corpus!.universe,
    citation: selected[2].corpus!.citation,
    divisions: applicableDivisions({ stateCode: "az", overlapping: geometry.zips["85122"] }).divisions });
  assert.deepEqual(expansion.heldProjection, direct.projection);
  const expectedIds = direct.candidacies.map((c) => `candidacy:${c.id}`).sort();
  assert.deepEqual(expansion.sharedRefs.filter((ref) => ref.startsWith("candidacy:")), expectedIds);
  assert.ok(result.sharedResearch.some((ref) => ref.kind === "candidacy" && ref.zipConsumers.length === 3));
  assert.ok(result.sharedResearch.some((ref) => ref.kind === "source-corpus" && ref.zipConsumers.length === 3));
  assert.equal(new Set(result.sharedResearch.map((ref) => ref.ref)).size, result.sharedResearch.length);
  assert.deepEqual(prepareZipQueues([...selected].reverse()).sharedResearch, result.sharedResearch);
});

test("missing geometry and corpus preserve unknowns despite successful state-only projection", () => {
  const missing = { ...input("85122"), stamp: null, overlappingDivisions: undefined };
  const row = prepareZipQueues([missing]).existingCompletion[0];
  assert.equal(row.stampedTier, "UNKNOWN");
  assert.equal(row.geometryHeld, false);
  assert.ok(row.gaps.some((gap) => gap.includes("does not establish local applicability")));
  assert.equal(row.completionVerified, false);
  const noCorpus = prepareZipQueues([{ ...missing, corpus: null }]).existingCompletion[0];
  assert.equal(noCorpus.heldProjection, null);
  assert.equal(noCorpus.heldProjectionCheck, null);
  assert.equal(noCorpus.coverageEvidence, null);
});

test("unavailable readiness is not treated as unwalked source or trusted readiness", () => {
  const unavailable = prepareZipQueues([{ ...input("85122"), readiness: { kind: "UNAVAILABLE", detail: "fixture store unavailable" } }]).existingCompletion[0];
  assert.equal(unavailable.readinessStatus, "UNAVAILABLE");
  assert.ok(unavailable.gaps.some((gap) => gap.includes("fixture store unavailable")));
  assert.deepEqual(unavailable.stateCapabilityGaps, []);
});

test("trusted readiness preserves state scope without inventing a ZIP-specific assertion", () => {
  const snapshot = emptyStateSnapshot({ state: "az", stateName: "Arizona", publishedAt: "2026-09-01T00:00:00Z", publisher: "isolated fixture", capabilities: [] });
  assert.equal(snapshot.derivationContract, READINESS_DERIVATION_CONTRACT);
  const row = prepareZipQueues([{ ...input("85122"), readiness: { kind: "HELD", snapshot, source: "isolated fixture" } }]).existingCompletion[0];
  assert.equal(row.readinessStatus, "HELD");
  assert.equal(row.zipReadiness, null);
  assert.ok(row.gaps.some((gap) => gap.includes("no row for this ZIP")));
  assert.throws(() => prepareZipQueues([{ ...input("85122"), readiness: { kind: "HELD", snapshot: { ...snapshot, state: "nh" }, source: "isolated fixture" } }]), /different state/);
});

test("stale evidence remains intact and duplicate or wrong-state preparations fail explicitly", () => {
  const original = input("85701");
  const stale = prepareZipQueues([{ ...original, freshness: { stamp: { fresh: false, asOf: original.stamp!.stampedAt, ageDays: 50, staleAfterDays: 45 }, corpus: null } }]).existingCompletion[0];
  assert.deepEqual(stale.coverageEvidence, original.stamp!.evidence);
  assert.ok(stale.gaps.some((gap) => gap.includes("revalidate before relying")));
  assert.throws(() => prepareZipQueues([original, { ...original, lane: "new-expansion" }]), /Duplicate ZIP/);
  assert.throws(() => prepareZipQueues([{ ...original, stateCode: "nh" }]), /different state/);
  assert.throws(() => prepareZipQueues([{ ...original, zip: "123" }]), /Invalid ZIP/);
});
