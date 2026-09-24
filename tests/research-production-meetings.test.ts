import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { retainMeetingFetchBytes, meetingResearchWitness } from "../lib/civic-data/meeting-research-evidence.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { retainRoutineMeetingForWorkers } from "../lib/control-plane/workers/routine-meeting-intake.ts";
import { PIMA_LEGISTAR_CONTRACT } from "../lib/control-plane/workers/held-meeting-contract.ts";
import { runHeldWorkerFleetCycle, standingFleetRuntime } from "../lib/control-plane/workers/standing.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import { projectFactChains, collectFactChains } from "../lib/control-plane/promotion/fact-chain.ts";
import { readApprovedResearchMeetingPartition, approvedResearchMeetingPartition, RESEARCH_MEETING_ACTIVATION } from "../lib/control-plane/promotion/production-meetings.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { repairMeetingReaderProjectionReadbacks } from "../lib/civic-data/reader-verification.ts";
import { promoteMeetingPartitions } from "../scripts/ingest.ts";
import type { FactFreshnessReading } from "../lib/control-plane/promotion/fact-freshness.ts";

test("routine acquisition bytes reach independent workers, approved facts, the sole partition door and Reader readback", async t => {
  const vaultRoot = mkdtempSync(join(tmpdir(), "fleet-pdc-intake-"));
  t.after(() => rmSync(vaultRoot, { recursive: true, force: true }));
  const repos = createMemoryRepositories(); const store = new DurableEvidenceStore(vaultRoot);
  const bytes = new Uint8Array(readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url)));
  const url = "https://webapi.legistar.com/v1/pima/events";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { "Content-Type": "application/json" } });
  const captured = await retainMeetingFetchBytes(() => captureSourceAcquisitions(run => run("legistar", async () => {
    await fetch(url); return "existing-fetch-result";
  })), "legistar", value => value === url).finally(() => { globalThis.fetch = originalFetch; });
  assert.equal(captured.value.value, "existing-fetch-result"); assert.equal(captured.responses.length, 1);
  assert.deepEqual(captured.responses[0].bytes, bytes); assert.deepEqual(captured.refusals, []);
  const methodVersion = JSON.parse(readFileSync("data/method/knowledge.json", "utf8")).version as number;
  const partition = meetingPartitionForRow("legistar", PIMA_LEGISTAR_CONTRACT.subjectId);
  let clock = Date.parse("2026-09-05T18:00:00.000Z"); const now = () => new Date(clock += 1000).toISOString();
  const first = await retainRoutineMeetingForWorkers({ repos, store, subjectId: partition.bodyId, methodVersion,
    now, candidateVersionId: "fixture-candidate-one", response: { ...captured.responses[0], retrievedAt: now() } });
  const second = await retainRoutineMeetingForWorkers({ repos, store, subjectId: partition.bodyId, methodVersion,
    now, candidateVersionId: "fixture-candidate-two", response: { ...captured.responses[0], retrievedAt: now() } });
  assert.ok(first && second); assert.equal(first.artifactId, second.artifactId);
  assert.notEqual(first.attemptId, second.attemptId, "Real repeated acquisition receipts remain distinct.");
  const priorAttemptCount = (await repos.attempts.list()).length;
  assert.equal(await retainRoutineMeetingForWorkers({ repos, store, subjectId: partition.bodyId, methodVersion,
    now, candidateVersionId: "fixture-candidate-two", response: { ...captured.responses[0], retrievedAt: now() } }), null);
  assert.equal((await repos.attempts.list()).length, priorAttemptCount, "A repeated candidate import creates no synthetic acquisition receipt.");
  assert.equal((await repos.workItems.list()).length, 1); assert.equal((await repos.obligations.list()).length, 0, "No second acquisition clock.");
  const runtime = { ...standingFleetRuntime({ root: process.cwd(), vaultRoot, repos, now }), requireModelAudit: false };
  const results = await runHeldWorkerFleetCycle(process.cwd(), runtime, true, { maximumDispatches: 3 });
  assert.equal(results.length, 3); assert.ok(results.every(result => result.outcome === "WORKED"), JSON.stringify(results));
  const workers = await repos.workerResults.readAll();
  assert.deepEqual(workers.map(worker => worker.result.verdict), ["EXTRACTED", "PASS", "SURVIVED"]);
  const read = researchVaultResolver(repos, store, "freshness");
  const options = { now: now(), registryBodyIds: new Set([partition.bodyId]),
    readArtifactText: async (id: string) => Buffer.from((await read(id)).bytes).toString("utf8"),
    readAcquisition: async (id: string) => (await read(id)).artifact,
    freshness: async (scope: { recordClass: "meeting-times" | "agendas"; subjectId: string }): Promise<FactFreshnessReading> => ({
      ...scope, obligationId: partition.id, state: "FRESH", hold: false, reason: "Recorded fixture permanent acquisition receipt",
      obligation: null, cadenceHours: 24, cadenceBasis: "permanent fixture", lastSuccessfulAcquisitionAt: now(), nextDueAt: null,
      staleAfter: null, debt: null, retryAt: null, sourceFailureWithoutFalseEmpty: false,
    }) };
  const report = await projectFactChains(repos, options);
  assert.equal(report.counts.byStage.APPROVED_FOR_PROMOTION, 36, JSON.stringify(report.offers.filter(offer => !offer.accepted).slice(0, 2)));
  const approved = await readApprovedResearchMeetingPartition(repos, partition, options, null);
  assert.ok(approved); assert.equal(approved.snapshot.meetings.length, 18);
  const stages = await repos.promotionPipeline.readAll();
  const witness = meetingResearchWitness(partition, approved.snapshot, [first.artifactId], stages, workers);
  assert.ok(witness, "The narrow production intake reads the same exact approved Reader projection.");
  assert.ok(meetingResearchWitness(partition, { ...approved.snapshot, meetings: approved.snapshot.meetings.map(meeting =>
    ({ ...meeting, actingBodies: [] })) }, [first.artifactId], stages, workers), "Independent routine EventItems survive the Events-only fact scope.");
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object"
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  assert.ok(meetingResearchWitness(partition, approved.snapshot, [first.artifactId],
    reorder(stages) as typeof stages, workers), "JSONB key ordering does not change civic facts.");
  const firstApproval = stages.find(stage => stage.stage === "APPROVED_FOR_PROMOTION")!;
  assert.equal(meetingResearchWitness(partition, approved.snapshot, [first.artifactId],
    [...stages, { ...firstApproval, stage: "REFUSED" } as never], workers), null, "A later refusal invalidates an earlier approval.");
  assert.equal(meetingResearchWitness(partition, { ...approved.snapshot, meetings: approved.snapshot.meetings.map((meeting, index) =>
    index ? meeting : { ...meeting, title: "unverified replacement title" }) }, [first.artifactId], stages, workers), null);
  const collection = await collectFactChains(repos, options);
  const base = { partition, collection, states: report.states, now: options.now, previous: null,
    acquisitionByArtifact: new Map([[first.artifactId, await options.readAcquisition(first.artifactId)]]) };
  assert.equal(approvedResearchMeetingPartition({ ...base, states: report.states.slice(1) }), null, "Incomplete approvals cannot replace a whole partition.");
  assert.equal(approvedResearchMeetingPartition({ ...base, now: "2026-09-08T18:00:00.000Z" }), null, "Expired bytes do not become fresh.");
  assert.equal(approvedResearchMeetingPartition({ ...base, acquisitionByArtifact: new Map() }), null, "HTTP provenance is required.");
  assert.equal(approvedResearchMeetingPartition({ ...base, previous: { ...approved.snapshot, generatedAt: now(),
    sources: approved.snapshot.sources.map(source => ({ ...source, acquisitions: source.acquisitions!.map(evidence => ({ ...evidence, rawHash: "a".repeat(64) })) })) } }), null);
  const data = new MemoryRoutineDataStore();
  const carriedId = "legistar:pima:998877";
  const carriedPrior = { ...approved.snapshot.meetings[0], id: carriedId, startsAt: "2026-09-06T20:00:00.000Z" };
  const seeded = await promoteMeetingPartitions({ store: data, partitions: [partition],
    meetings: [...approved.snapshot.meetings, carriedPrior], agendaDocuments: [],
    reports: approved.snapshot.sources.map(source => ({ ...source, error: null })), generatedAt: options.now });
  assert.ok(seeded[0].outcome.promoted, "The carried row starts with an actual independently validated partition authority.");
  const outcomes = await promoteMeetingPartitions({ store: data, partitions: [partition], meetings: approved.snapshot.meetings, agendaDocuments: [],
    reports: approved.snapshot.sources.map(source => ({ ...source, error: null })), generatedAt: now(),
    researchIntake: async (_partition, current, _now, observed) => {
      assert.equal(current!.meetings.length, 19);
      assert.equal(observed.meetings.length, 18);
      assert.ok(current!.meetings.find(meeting => meeting.id === carriedId)?.carried);
      assert.equal(meetingResearchWitness(partition, current!, [first.artifactId], stages, workers), null,
        "Carried LKG rows cannot be claimed as newly audited current source facts.");
      const scoped = meetingResearchWitness(partition, observed, [first.artifactId], stages, workers);
      assert.ok(scoped); assert.equal(scoped.approvedFactCount, 36);
      assert.equal(scoped.evidenceScope, "CURRENT_CAPTURE_MEETING_FACTS");
      assert.equal(scoped.coveredMeetingIds.includes(carriedId), false);
      return { snapshot: current!, activationReceipt: scoped };
    } });
  assert.equal(outcomes[0].outcome.candidate.receipt?.decision, "GOOD", JSON.stringify(outcomes[0].outcome.candidate.receipt));
  assert.ok(outcomes[0].outcome.promoted);
  // The partition door leaves the Reader readback to the pass's one aggregate
  // meetings read, which records the typed receipt on the promoted version.
  assert.equal(outcomes[0].outcome.readerReadback, null);
  const [readback] = await repairMeetingReaderProjectionReadbacks(data, [partition], now(), "a".repeat(40));
  assert.ok(readback?.ok && readback.value.kind === "RECORDED", JSON.stringify(readback));
  assert.equal(readback.value.receipt?.versionId, outcomes[0].outcome.promoted.versionId);
  assert.equal(readback.value.receipt?.status, "PASS", readback.value.receipt?.detail);
  assert.equal((outcomes[0].candidate.readModel as typeof approved.snapshot).meetings.length, 19, "Publication preserves the complete routine partition, including inherited LKG authority.");
  assert.ok(outcomes[0].candidate.dependentChecks.some(check => check.consumer === RESEARCH_MEETING_ACTIVATION && check.passed));
  const failed = await promoteMeetingPartitions({ store: data, partitions: [partition], meetings: [], agendaDocuments: [],
    reports: [{ source: "legistar", ok: false, error: "recorded source wall", failure: "WALL", fetched: 0, normalized: 0,
      drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } }], generatedAt: now(),
    researchIntake: async () => { throw new Error("A failed acquisition must not invoke historical research approval."); } });
  assert.equal(failed[0].outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal(failed[0].outcome.promoted, null);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), approved.snapshot.sources[0].acquisitions![0].rawHash);
});
