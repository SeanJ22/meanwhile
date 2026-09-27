import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { autonomousHarness, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { WORKER_READER_CLASSES, type WorkerReaderContract } from "../lib/civic-data/worker-reader-contracts.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { registerRouteTask, claimRouteTask, beginAttemptFor, recordArtifactMetadata, disposeRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { dispatchWorkerTask, evidenceProjection, FLEET_POLICY_VERSION } from "../lib/control-plane/workers/runtime.ts";
import { nextAutonomousOperation } from "../lib/control-plane/workers/coordinator.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readRegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { publishWorkerReaderResults, workerReaderPackage, inheritVerifiedCommentDetails } from "../lib/civic-data/worker-reader-publication.ts";
import { readManualProjectionPrior, type CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../lib/civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { commentAccessEvidenceFor } from "../lib/ask/meeting-knowledge.ts";
import { workerRosterSourceTasks } from "../lib/civic-data/hunt-source-tasks.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { projectedCommentAccessFor, type CommentAccess } from "../lib/registry/comment-access-client.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import type { ResolvedScope } from "../lib/control-plane/expansion/membership.ts";
import { readEverydayRoutingProjection } from "../lib/routing/everyday-data-plane.ts";

async function workerFixture(contractId: WorkerReaderContract, facts: Record<string, string>) {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const prior = (await readRegistryRuntimePrior(store, "2026-09-08T12:01:00.000Z"))!;
  const body = prior.payload.registry.bodies.find(row => row.name)!;
  const rows: Record<string, string>[] = [{ bodyName: body.name!, ...facts }];
  const text = JSON.stringify(rows);
  const fields = Object.fromEntries(Object.keys(rows[0]).map(field => [field, { source: `/${field}`, type: "STRING" as const }]));
  const extraction = { format: "JSON_RECORDS" as const, rowsPointer: "", fields };
  const h = await autonomousHarness({ clock: "2026-09-08T12:01:00.000Z", response: { text }, plan: plan => ({ ...plan,
    ownerInstructions: ["offline-send"], publication: { contractId, bodyId: body.id }, auditScope: "SOURCE_UNIVERSE",
    sources: plan.sources.map(route => ({ ...route, recordClass: WORKER_READER_CLASSES[contractId] })),
    contract: { ...plan.contract, schemaVersion: 2, recordClass: WORKER_READER_CLASSES[contractId], identity: { namespace: contractId, keyFields: ["bodyName"] },
      requiredFields: Object.keys(fields), extraction, verification: { required: true, authorities: [] } } as never }) });
  const task = createRouteTask({ workItemId: h.item.id, routeId: "independent-rule", routeLabel: "Offline independent rule record", target: "https://register.example.gov/rules.json", inherited: false, now: h.now() });
  await registerRouteTask(h.repos, task, h.now());
  const claim = await claimRouteTask(h.repos, { routeTaskId: task.id, holder: "independent-rule", now: h.now(), ttlMs: 120000 });
  const attempt = await beginAttemptFor(h.repos, { routeTaskId: task.id, workItemId: h.item.id, lease: claim.lease.value,
    worker: { role: "SCOUT", provider: "fixture", version: "1", instance: "independent-rule" }, methodVersion: 56, policyVersion: FLEET_POLICY_VERSION, now: h.now() });
  const authorityText = JSON.stringify({ publisher: "Independent Register", records: rows });
  const { artifact } = recordAcquisition({ canonicalUrl: task.target, retrievedAt: h.now(), httpStatus: 200, contentType: "application/json", sourceId: "register.example.gov",
    methodRouteId: task.routeId, workItemId: h.item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, authorityText);
  await putArtifact(h.store, h.item.project, artifact, Buffer.from(authorityText));
  await recordArtifactMetadata(h.repos, { artifactId: artifact.id, workItemId: h.item.id, routeTaskId: task.id, attemptId: attempt.id,
    tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
    canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: artifact.retrievedAt }, h.now());
  const at = h.now();
  await disposeRouteTask(h.repos, { routeTaskId: task.id, attemptId: attempt.id, expectedTaskRevision: (await h.repos.routeTasks.mustRead(task.id)).revision,
    artifactIds: [artifact.id], now: at, disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
      permission: "ALLOWED", transport: "REACHABLE", note: "Offline independent authority fixture" } });
  const item = await h.repos.workItems.mustRead(h.item.id);
  const plan = item.value.autonomousPlan!;
  assert.equal(plan.contract.schemaVersion, 2);
  if (plan.contract.schemaVersion !== 2) throw new Error("fixture contract");
  const ready = { ...plan, contract: { ...plan.contract, verification: { required: true, authorities: [{ id: "rules", type: "STATUTORY_RECORD" as const,
    publisher: "Independent Register", sourceId: artifact.sourceId, canonicalUrls: [artifact.canonicalUrl], artifactIds: [artifact.id], authorityEvidenceArtifactIds: [artifact.id],
    independenceBasis: "DISTINCT_AUTHORITY" as const, independenceExplanation: "Separately retained official rules confirm every published detail.",
    extraction: { ...extraction, rowsPointer: "/records" }, comparison: { kind: "RECORD_VALUES" as const, keyFields: ["bodyName"], fields: Object.keys(fields) } }] } } };
  await h.repos.workItems.compareAndSet(item.id, item.revision, { ...item.value, autonomousPlan: ready }, h.now());
  const authorityEvidence = evidenceProjection(await h.runtime.readEvidence(artifact.id));
  const runtime = { ...h.runtime, independentContext: async (scope: Parameters<typeof h.runtime.independentContext>[0]) => ({
    ...await h.runtime.independentContext(scope), authorityEvidence: [authorityEvidence] }) };
  for (const role of ["ACQUIRER", "PARSER", "VALIDATOR", "ADVERSARIAL_AUDITOR"]) {
    const next = await nextAutonomousOperation(runtime, h.item.id);
    assert.equal(next.task?.workerTask?.role, role, JSON.stringify(next));
    assert.equal((await dispatchWorkerTask(runtime, next.task!)).outcome, "WORKED");
  }
  const results = await h.repos.workerResults.read(h.item.id);
  assert.deepEqual(results.map(row => row.result.verdict), ["ACQUIRED", "EXTRACTED", "PASS", "SURVIVED"]);
  const scope = { kind: "RESOLVED", decision: { sourceWorkVersion: 1, receiptId: "offline-send" } } as ResolvedScope;
  const queued = workerRosterSourceTasks([scope], [(await h.repos.workItems.mustRead(h.item.id)).value], results, h.now());
  assert.equal(queued.length, 1);
  assert.ok(queued[0].command.includes(`--contract=${contractId}`));
  assert.ok(queued[0].command.some(arg => arg === `--worker-results=${h.item.id}`));
  const input = { repos: h.repos, store, contractId, workItemIds: [h.item.id], now: h.now(),
    readCapture: async (id: string) => { const evidence = evidenceProjection(await runtime.readEvidence(id));
      return { evidence, observedAt: evidence.retrievedAt, httpStatus: 200, transport: "REACHABLE", partial: false }; } };
  return { input, h, store, body, rows, scope, results, artifact, ready, prior, runtime };
}

test("independent normal workers automatically publish public-comment rules through the existing reader and retain repair evidence", async () => {
  const { input, h, store, body, rows, scope, results, artifact, ready, prior } = await workerFixture("comment-access", {
    commentPeriod: "YES", commentPeriodDetail: "The board provides a public comment period.", signup: "Sign up before the meeting." });
  const published = await publishWorkerReaderResults(input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  assert.deepEqual(published[0].outcome.records, { added: 1, changed: 0, reused: 0 });
  const read = await readCuratedReaderProjection("comment-access", { store, now: h.now(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("reader missing");
  const rendered = projectedCommentAccessFor(body.ocdId ?? null, body.name ?? undefined, body.id, read.value.records as unknown as CommentAccess[]);
  assert.equal(rendered?.signup, rows[0]["signup"]);
  assert.deepEqual(await publishWorkerReaderResults(input), published, "restart reuses the publication and spends nothing");
  assert.equal(workerRosterSourceTasks([scope], [(await h.repos.workItems.mustRead(h.item.id)).value], results, h.now()).length, 0);
  const parser = results.find(row => row.result.role === "PARSER")!, validator = results.find(row => row.result.role === "VALIDATOR")!, auditor = results.find(row => row.result.role === "ADVERSARIAL_AUDITOR")!;
  const captures = await Promise.all([parser.result.role === "PARSER" ? parser.result.artifactId : "", artifact.id].map(input.readCapture));
  const checked = { plan: ready, parser, validator, auditor, captures, registry: prior, now: h.now() };
  assert.throws(() => workerReaderPackage({ ...checked, captures: captures.slice(0, 1) }), /AUTHORITY_CAPTURE_MISSING/);
  assert.throws(() => workerReaderPackage({ ...checked, captures: captures.map(c => ({ ...c, partial: true })) }), /CAPTURE_STALE_OR_UNPROVEN/);
  assert.throws(() => workerReaderPackage({ ...checked, plan: { ...ready, publication: { contractId: "comment-access", bodyId: "unknown-body" } } }), /CANONICAL_BODY_MISSING/);
  // The current evidence can omit a detail without suppressing its verified
  // neighbours or deleting independently proven last-good instructions.
  const packageNow = workerReaderPackage(checked);
  const currentRule = (packageNow.payload as CuratedReaderProjection).records[0];
  const commentPrior = await readManualProjectionPrior("comment-access", store, h.now());
  const complementary = inheritVerifiedCommentDetails({ ...packageNow, payload: { kind: "comment-access", records: [{ ...currentRule, signup: null }] } }, commentPrior);
  const merged = (complementary.payload as CuratedReaderProjection).records[0];
  assert.equal(merged.signup, rows[0]["signup"]);
  const sources = merged.fieldSources as NonNullable<CommentAccess["fieldSources"]>;
  assert.equal(sources.signup?.retainedFromVersion, commentPrior!.versionId);
  assert.equal(sources.signup?.collectedAt, rendered!.collectedAt, "old proof is not relabeled as a fresh verification");
  const successor = await prepareManualProjectionSuccessor(complementary, store, h.now());
  assert.ok((await processRegisteredManualCandidate(store, "comment-access", successor.candidate, h.now(), successor.expectedBaseVersionId)).promoted);
  await readCuratedReaderProjection("comment-access", { store, now: h.now(), bypassCache: true });
  const spoken = commentAccessEvidenceFor(body.id, body.ocdId ?? null, body.name!);
  assert.equal(spoken.records.find(row => row.accessRule?.field === "signup")?.sourceUrl, sources.signup?.sourceUrl);
});

test("normal service workers publish verified applicability and channels while leaving missing topics visibly unacquired", async () => {
  const { input, store, h } = await workerFixture("everyday-routing", { topicId: "roads-local", serviceZip: "12345",
    service: "Report a damaged public road", serviceAreaEvidence: "The official service directory explicitly covers ZIP 12345.", phone: "555-0100" });
  const result = await publishWorkerReaderResults(input);
  assert.equal(result[0].outcome.status, "PUBLISHED", JSON.stringify(result));
  const read = await readEverydayRoutingProjection({ store, now: h.now(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("reader missing");
  assert.equal(read.value.records.length, 1);
  assert.equal(read.value.denominator?.unacquiredCells, 8);
  assert.equal(read.value.records[0].zip, "12345");
  assert.equal((read.value.records[0].contact as { phone: string }).phone, "555-0100");
  assert.deepEqual(await publishWorkerReaderResults(input), result);
});

test("a service record without a usable channel returns to automatic repair instead of a manual approval queue", async () => {
  const { input, runtime, h } = await workerFixture("everyday-routing", { topicId: "roads-local", serviceZip: "12345",
    service: "Road maintenance", serviceAreaEvidence: "The service territory explicitly includes ZIP 12345." });
  const result = await publishWorkerReaderResults(input);
  assert.equal(result[0].outcome.status, "HELD");
  assert.equal(result[0].outcome.code, "WORKER_PUBLICATION_SERVICE_CHANNEL_MISSING");
  assert.equal(result[0].outcome.recovery, "WORKER");
  assert.notEqual((await nextAutonomousOperation(runtime, h.item.id)).action, "STAGED");
});

test("normal voter-access workers publish the independently verified statewide route through the existing navigation reader", async () => {
  const { input, store, h } = await workerFixture("ballot-navigation", { state: "NH", kind: "REGISTRATION_LINK", url: FIXTURE_URL,
    coverage: "STATEWIDE", coverageEvidence: "The election authority identifies this lookup as serving the entire state." });
  const result = await publishWorkerReaderResults(input);
  assert.equal(result[0].outcome.status, "PUBLISHED", JSON.stringify(result));
  const read = await readCuratedReaderProjection("ballot-navigation", { store, now: h.now(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("reader missing");
  assert.equal(read.value.records[0].kind, "REGISTRATION_LINK");
  assert.equal((read.value.records[0].value as { url: string }).url, FIXTURE_URL);
  assert.deepEqual(await publishWorkerReaderResults(input), result);
});
