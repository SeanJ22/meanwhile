import assert from "node:assert/strict";
import test from "node:test";
import { planZipAcquisition, ZIP_ACQUISITION_PLAN_CONTRACT, type ZipAcquisitionPlanInput } from "../lib/control-plane/zip-acquisition-plan.ts";
import { ZIP_COMPLETION_REQUIREMENTS, type PreparedZip, type PreparedZipQueues } from "../lib/control-plane/zip-queue.ts";
import type { RegisteredUnit } from "../lib/control-plane/scheduler/registry.ts";
import { ENRICHMENT_FIELDS, type CandidateUniverse, type EnrichmentState } from "../lib/hunt/candidate-universe.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { FreshnessOccurrence } from "../lib/control-plane/scheduler/durable.ts";

/**
 * planZipAcquisition is still-supported read-only planning that ships in
 * lib/control-plane/zip-acquisition-plan.ts. The retired promotion-pipeline
 * scheduler providers (candidate-enrichment / meetings / campaign-finance) and
 * the meetings snapshot are gone, so the earlier fixture, which built its input
 * from the real registry, could not run. This replacement drives the SAME
 * planning contract from fully ISOLATED synthetic inputs — no registry build,
 * no snapshot, no network, no database — exactly the still-supported behavior
 * the retirement must not have deleted.
 */

const enrichment = (state: EnrichmentState) =>
  Object.fromEntries(ENRICHMENT_FIELDS.map((field) => [field, { state, checkedAt: null, sourceUrl: null }]));
const candidacy = (id: string, provenance: readonly string[], state: EnrichmentState) =>
  ({ id, provenance, enrichment: enrichment(state) }) as unknown as CandidateUniverse["candidacies"][number];
const corpus = (candidacies: readonly unknown[]) => ({ candidacies }) as unknown as CandidateUniverse;
const unit = (obligationId: string, subjectId: string, recordClass: string, routeId: string, providerId = recordClass): RegisteredUnit =>
  ({
    providerId,
    obligation: { id: obligationId },
    record: { subjectId, recordClass },
    route: { routeId, executorClass: "DETERMINISTIC", executorReason: "test", label: "test", citation: "test-fixture", open: { kind: "HTTP_GET", url: "https://example.invalid/x" } },
  }) as unknown as RegisteredUnit;
const zip = (z: string): PreparedZip =>
  ({ zip: z, tierNextStep: "docs/zip-playbook.md#next", completionRequirements: ZIP_COMPLETION_REQUIREMENTS, gaps: [`${z}-gap`] }) as unknown as PreparedZip;

/** One tree exercising every assignment class the planner distinguishes. */
function isolatedInput(overrides: Partial<ZipAcquisitionPlanInput> = {}): ZipAcquisitionPlanInput {
  const units: RegisteredUnit[] = [
    unit("enr-1", "cand-A", "candidate-enrichment", "route-enr-1", "candidate-enrichment"),
    unit("enr-2", "cand-A", "candidate-enrichment", "route-enr-2", "candidate-enrichment"),
    unit("meet-1", "body-X", "meetings", "route-meet-1", "meetings"),
    // Two rows sharing ONE obligation id — a provider collision, not a portfolio.
    unit("col-1", "cand-COL", "candidate-enrichment", "route-col-a", "candidate-enrichment"),
    unit("col-1", "cand-COL", "candidate-enrichment", "route-col-b", "candidate-enrichment"),
  ];
  const queues = {
    generatedAt: "2026-09-01T00:00:00.000Z",
    existingCompletion: [zip("85701")],
    newExpansion: [zip("85702")],
    sharedResearch: [
      { ref: "candidacy:cand-A", kind: "candidacy", canonicalId: "cand-A", zipConsumers: ["85701", "85702"] },
      { ref: "jurisdiction:ocd-Y", kind: "jurisdiction", canonicalId: "ocd-Y", zipConsumers: ["85701"] },
      { ref: "candidacy:cand-MISS", kind: "candidacy", canonicalId: "cand-MISS", zipConsumers: ["85703"] },
      { ref: "candidacy:cand-NOENR", kind: "candidacy", canonicalId: "cand-NOENR", zipConsumers: ["85701"] },
      { ref: "candidacy:cand-DUP", kind: "candidacy", canonicalId: "cand-DUP", zipConsumers: ["85701", "85702", "85703"] },
      { ref: "candidacy:cand-COL", kind: "candidacy", canonicalId: "cand-COL", zipConsumers: ["85701"] },
      { ref: "source-corpus:data/src/doc-1.json", kind: "source-corpus", canonicalId: "data/src/doc-1.json", zipConsumers: ["85701"] },
    ],
  } as unknown as PreparedZipQueues;
  return {
    queues,
    registry: { units, byProvider: [] },
    corpora: [corpus([
      candidacy("cand-A", ["data/src/doc-1.json — row 5"], "UNWORKED"),
      candidacy("cand-NOENR", ["data/src/doc-2.json — row 1"], "FOUND"),
      candidacy("cand-DUP", ["data/src/doc-3.json — row 1"], "UNWORKED"),
      candidacy("cand-DUP", ["data/src/doc-3.json — row 2"], "UNWORKED"),
    ])],
    meetings: [{ bodyId: "body-X", ocdId: "ocd-Y" }],
    historical: {
      source: "tests/isolated-fixture",
      occurrences: [
        { id: "occ-ok", obligationId: "enr-1", routeTaskId: "rt-ok", workItemId: "wi-ok", openedAt: "2026-08-01T00:00:00.000Z", closedAt: "2026-08-02T00:00:00.000Z" },
        { id: "occ-bad", obligationId: "enr-1", routeTaskId: "rt-missing", workItemId: "wi-ok", openedAt: "2026-08-03T00:00:00.000Z", closedAt: null },
      ] as unknown as FreshnessOccurrence[],
      workItems: [{ id: "wi-ok", subject: "cand-A" }] as unknown as WorkItem[],
      routeTasks: [{ id: "rt-ok", workItemId: "wi-ok", routeId: "route-enr-1", state: "CLOSED_YIELDED" }] as unknown as RouteTask[],
    },
    ...overrides,
  };
}

const bindingFor = (plan: ReturnType<typeof planZipAcquisition>, ref: string) => plan.bindings.find((b) => b.ref === ref)!;

test("isolated planning resolves each assignment class from synthetic inputs, with no network or registration", () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("NETWORK_FORBIDDEN"); }) as typeof fetch;
  try {
    const input = isolatedInput();
    const serialized = JSON.stringify(input);
    const plan = planZipAcquisition(input);

    // Pure planning: never registers, activates or observes runtime; never mutates input.
    assert.equal(plan.contract, ZIP_ACQUISITION_PLAN_CONTRACT);
    assert.equal(plan.mode, "PLAN_ONLY");
    assert.equal(plan.activation, "NOT_AUTHORIZED");
    assert.equal(plan.runtimeObservation, "UNKNOWN");
    assert.equal(JSON.stringify(input), serialized, "Pure planning must not mutate its input");

    // A held candidacy with enrichment obligations is a DIRECT_SUBJECT assignment
    // that carries its whole obligation portfolio (both representations).
    const direct = bindingFor(plan, "candidacy:cand-A");
    assert.equal(direct.assignment, "DIRECT_SUBJECT");
    assert.deepEqual(direct.obligationIds, ["enr-1", "enr-2"]);

    // A jurisdiction only ever resolves to its meeting obligation, never to
    // territory/officeholder/ballot/funding coverage.
    assert.equal(bindingFor(plan, "jurisdiction:ocd-Y").assignment, "MEETINGS_ONLY");
    assert.deepEqual(bindingFor(plan, "jurisdiction:ocd-Y").obligationIds, ["meet-1"]);

    // Absence of a typed edge is a NAMED missing assignment, never a fabricated one.
    assert.equal(bindingFor(plan, "candidacy:cand-MISS").assignment, "MISSING_ASSIGNMENT");
    assert.deepEqual(bindingFor(plan, "candidacy:cand-MISS").obligationIds, []);

    // Fully-found enrichment with no owed obligation is distinct from missing.
    assert.equal(bindingFor(plan, "candidacy:cand-NOENR").assignment, "NO_OWED_ENRICHMENT");

    // Duplicate canonical corpus rows are AMBIGUOUS, not silently merged.
    assert.equal(bindingFor(plan, "candidacy:cand-DUP").assignment, "AMBIGUOUS");
    assert.deepEqual(bindingFor(plan, "candidacy:cand-DUP").obligationIds, []);

    // A provider collision (two rows, one obligation id) is AMBIGUOUS, never assigned.
    assert.equal(bindingFor(plan, "candidacy:cand-COL").assignment, "AMBIGUOUS");
    assert.deepEqual(bindingFor(plan, "candidacy:cand-COL").obligationIds, []);

    // A source-corpus edge reuses downstream enrichment ids but is NOT a
    // source-universe reacquisition assignment.
    const source = bindingFor(plan, "source-corpus:data/src/doc-1.json");
    assert.equal(source.assignment, "MISSING_ASSIGNMENT");
    assert.deepEqual(source.obligationIds, []);
    assert.deepEqual(source.downstreamReuseObligationIds, ["enr-1", "enr-2"]);

    // Each assigned obligation id appears exactly once across plan units.
    const unitIds = plan.units.map((u) => u.obligationId);
    assert.deepEqual([...unitIds].sort(), ["enr-1", "enr-2", "meet-1"]);
    assert.equal(new Set(unitIds).size, unitIds.length);

    // Historical task links are validated against real committed rows; a
    // mismatched occurrence stays visibly unresolved rather than fabricated.
    const enr1 = plan.units.find((u) => u.obligationId === "enr-1")!;
    assert.deepEqual(enr1.historicalTasks.map((t) => t.routeTaskId), ["rt-ok"]);
    assert.deepEqual(enr1.unresolvedHistoricalLinks, ["occ-bad"]);

    // ZIP completion requirements never receive a typed coverage assignment
    // from matched candidate/meeting work.
    assert.equal(plan.coverageAssignments.length, 2);
    assert.ok(plan.coverageAssignments.every((row) => row.assignment === "MISSING_TYPED_COVERAGE_ASSIGNMENT" && row.obligationIds.length === 0));

    // The counts summarize exactly what the bindings say.
    assert.equal(plan.counts.references, 7);
    assert.equal(plan.counts.directAssignments, 1);
    assert.equal(plan.counts.meetingsOnlyAssignments, 1);
    assert.equal(plan.counts.missingReferenceAssignments, 2);
    assert.equal(plan.counts.ambiguousReferences, 2);
    assert.equal(plan.counts.noOwedEnrichment, 1);
    assert.equal(plan.counts.uniqueExistingObligationIds, 3);
    assert.equal(plan.counts.historicalTaskLinks, 1);
    assert.equal(plan.counts.unresolvedHistoricalLinks, 1);
    assert.equal(plan.counts.missingCoverageAssignments, 2);
    assert.equal(plan.counts.sourceReuseOnlyReferences, 1);
  } finally { globalThis.fetch = savedFetch; }
});

test("adding a duplicate corpus row turns a direct candidacy ambiguous without touching other assignments", () => {
  const input = isolatedInput();
  const withDuplicateA: ZipAcquisitionPlanInput = {
    ...input,
    corpora: [corpus([
      candidacy("cand-A", ["data/src/doc-1.json — row 5"], "UNWORKED"),
      candidacy("cand-A", ["data/src/doc-1.json — row 6"], "UNWORKED"), // second canonical row
      candidacy("cand-NOENR", ["data/src/doc-2.json — row 1"], "FOUND"),
    ])],
  };
  const plan = planZipAcquisition(withDuplicateA);
  assert.equal(bindingFor(plan, "candidacy:cand-A").assignment, "AMBIGUOUS");
  assert.deepEqual(bindingFor(plan, "candidacy:cand-A").obligationIds, []);
  // The unrelated meeting assignment is unchanged.
  assert.equal(bindingFor(plan, "jurisdiction:ocd-Y").assignment, "MEETINGS_ONLY");
});
