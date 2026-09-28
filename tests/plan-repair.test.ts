import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness, FIXTURE_BODY, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { evaluatePlanRepair, consumePlanRepairs, planRepairBrief, planRepairFailureBrief, type PlanRepairLink } from "../lib/control-plane/workers/plan-repair.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { registerRouteTask, claimRouteTask, beginAttemptFor, disposeRouteTask, recordArtifactMetadata } from "../lib/control-plane/repository/coordinator.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { evidenceProjection, FLEET_POLICY_VERSION, dispatchWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import { nextAutonomousOperation } from "../lib/control-plane/workers/coordinator.ts";
import type { ScoutCandidate, ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { VerificationAuthority } from "../lib/control-plane/workers/types.ts";
import { resolvedHeldAuditAttribution } from "../lib/control-plane/workers/standing.ts";

async function fixture(recordClass = "OFFICIAL_ROSTER") {
  const h = await autonomousHarness({ plan: plan => ({ ...plan, contract: { ...plan.contract, schemaVersion: 2,
    recordClass, verification: { required: true, authorities: [] } } as never }) });
  const task = createRouteTask({ workItemId: h.item.id, routeId: "repair-scout", routeLabel: "Recorded repair proposal fixture", target: FIXTURE_URL, inherited: false, now: h.now() });
  await registerRouteTask(h.repos, task, h.now());
  const claim = await claimRouteTask(h.repos, { routeTaskId: task.id, holder: "repair-scout", now: h.now(), ttlMs: 120000 });
  const attempt = await beginAttemptFor(h.repos, { routeTaskId: task.id, workItemId: h.item.id, lease: claim.lease.value,
    worker: { role: "SCOUT", provider: "recorded-fixture", version: "1", instance: "repair-scout" }, methodVersion: 56, policyVersion: FLEET_POLICY_VERSION, now: h.now() });
  const captured = [];
  for (const [url, body] of [[FIXTURE_URL, FIXTURE_BODY], ["https://register.example.gov/roster.json", JSON.stringify({ publisher: "State Register", records: JSON.parse(FIXTURE_BODY) })]]) {
    const { artifact } = recordAcquisition({ canonicalUrl: url, retrievedAt: h.now(), httpStatus: 200, contentType: "application/json", sourceId: new URL(url).host,
      methodRouteId: "scout:fetch_public", workItemId: h.item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, body);
    await putArtifact(h.store, h.item.project, artifact, Buffer.from(body));
    await recordArtifactMetadata(h.repos, { artifactId: artifact.id, workItemId: h.item.id, routeTaskId: task.id, attemptId: attempt.id, tier: artifact.tier,
      contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: artifact.retrievedAt }, h.now());
    captured.push(artifact);
  }
  const at = h.now();
  await disposeRouteTask(h.repos, { routeTaskId: task.id, attemptId: attempt.id, expectedTaskRevision: (await h.repos.routeTasks.mustRead(task.id)).revision,
    artifactIds: captured.map(artifact => artifact.id), now: at, disposition: { disposition: "INGESTED", attemptId: attempt.id, at,
      artifactIds: captured.map(artifact => artifact.id), observation: null, permission: "ALLOWED", transport: "REACHABLE", note: "Actual fixture bytes retained; no civic approval asserted." } });
  const extraction = { format: "JSON_RECORDS" as const, rowsPointer: "", fields: { id: { source: "/id", type: "STRING" as const }, name: { source: "/name", type: "STRING" as const } } };
  const authority: VerificationAuthority = { id: "state-register", type: "GOVERNMENT_REGISTER", publisher: "State Register", sourceId: "register.example.gov",
    canonicalUrls: [captured[1].canonicalUrl], artifactIds: [captured[1].id], authorityEvidenceArtifactIds: [captured[1].id], independenceBasis: "DISTINCT_AUTHORITY",
    independenceExplanation: "A separately captured government register supplies independently published roster fields.",
    extraction: { ...extraction, rowsPointer: "/records" }, comparison: { kind: "RECORD_VALUES", keyFields: ["id"], fields: ["id", "name"] } };
  const candidate: ScoutCandidate = { routeId: "repair-roster", title: "Recorded official roster", url: FIXTURE_URL, procedure: "GET actual official roster", relevance: "The existing official roster question",
    permission: "ALLOWED", permissionReading: "Actual capture allowed", evidenceArtifactIds: captured.map(artifact => artifact.id), observedOn: at.slice(0, 10), recordClass, deterministic: true, unverified: ["Independent workers have not checked the repaired contract"],
    contractRepair: { schemaVersion: 1, sourceArtifactId: captured[0].id, extraction, authorities: [authority] } };
  const scout: ScoutResult = { formatVersion: 1, attemptId: attempt.id, obligationId: task.id, routeTaskId: task.id, workItemId: h.item.id, subjectId: h.item.subject,
    routeId: "repair-scout", recordClass, providerId: null, reason: "Fixture repair evidence", outcome: "ROUTE_CANDIDATE", stoppedBy: "MODEL",
    rungs: captured.map((artifact, index) => ({ index, rung: "linked-documents-or-bulk-download", tool: "fetch_public", target: artifact.canonicalUrl,
      observed: "HTTP 200 actual fixture bytes", artifactIds: [artifact.id], note: null, at: artifact.retrievedAt, ok: true, permission: "ALLOWED", transport: "REACHABLE", httpStatus: 200 })),
    distinctEvidenceRungs: 1, candidates: [candidate], findings: [], nextRungs: [], unverified: [], narrative: "Fixture-only instruction repair proposal", worker: { provider: "recorded-fixture", model: "none", modelReported: null },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 0, toolCalls: 2 }, usd: 0, elapsedMs: 0,
    artifactIds: captured.map(artifact => artifact.id), methodCandidateIds: [], refusal: null, startedAt: attempt.value.startedAt, recordedAt: at };
  await h.repos.scoutResults.append(scout.obligationId, scout.attemptId, scout, at);
  const evidence = await Promise.all(captured.map(async artifact => evidenceProjection(await h.runtime.readEvidence(artifact.id))));
  const consume = (scouts = [scout], now = h.now(), registeredPublisherAddressFor?: (subjectId: string) => string | null) => consumePlanRepairs({ repos: h.repos, scouts, now,
    ...(registeredPublisherAddressFor ? { registeredPublisherAddressFor } : {}), readCapture: async id => ({
    evidence: evidenceProjection(await h.runtime.readEvidence(id)), permission: "ALLOWED", transport: "REACHABLE", httpStatus: 200, partial: false }) });
  return { h, candidate, scout, evidence, authority, extraction, consume };
}

test("a newly dispatched source instruction can acquire an executable successor without inventing prior observations", async () => {
  const f = await fixture();
  const row = await f.h.repos.workItems.mustRead(f.h.item.id);
  const plan = row.value.autonomousPlan!;
  if (plan.contract.schemaVersion !== 2) throw new Error("GENERALIZED_FIXTURE_REQUIRED");
  const unobserved = { ...plan, sources: [], acquisition: [], contract: { ...plan.contract,
    sourceScope: { ...plan.contract.sourceScope, sourceId: "unobserved:roster", canonicalUrls: [], observationArtifactIds: [] },
    extraction: { format: "UNSUPPORTED" as const, mediaType: "unobserved", fields: {}, reason: "Mapping remains to be discovered" } } };
  await f.h.repos.workItems.compareAndSet(row.id, row.revision, { ...row.value, autonomousPlan: unobserved }, f.h.now());
  const result = await f.consume();
  assert.equal(result[0].code, "REPAIR_SUCCESSOR_REGISTERED", JSON.stringify(result));
  const child = (await f.h.repos.workItems.mustRead(result[0].successorWorkItemId!)).value;
  assert.equal(child.autonomousPlan!.sources[0].observation.artifactId, f.evidence[0].artifactId);
  const next = await nextAutonomousOperation(f.h.runtime, child.id);
  assert.equal(next.task?.workerTask?.role, "ACQUIRER");
  assert.equal((await dispatchWorkerTask(f.h.runtime, next.task!)).outcome, "WORKED");
  assert.notEqual(child.state, "VERIFIED_COMPLETE", "executable instructions are not publication or completed coverage");
});

test("saved local-jurisdiction roster shape with no initial URL uses only an exact registered host and completed Scout bytes", async () => {
  const f = await fixture();
  const row = await f.h.repos.workItems.mustRead(f.h.item.id);
  const plan = row.value.autonomousPlan!;
  if (plan.contract.schemaVersion !== 2) throw new Error("GENERALIZED_FIXTURE_REQUIRED");
  const unobserved = { ...plan, seedUrls: [], sources: [], acquisition: [], contract: { ...plan.contract,
    sourceScope: { ...plan.contract.sourceScope, sourceId: "unobserved:coverage-discovery:officeholders",
      canonicalUrls: [], observationArtifactIds: [] },
    extraction: { format: "UNSUPPORTED" as const, mediaType: "unobserved", fields: {}, reason: "Discover real source bytes" } } };
  await f.h.repos.workItems.compareAndSet(row.id, row.revision, { ...row.value, autonomousPlan: unobserved }, f.h.now());
  const registered = await f.consume([f.scout], f.h.now(), () => "http://fixture-clerk.example.gov");
  assert.equal(registered[0]?.code, "REPAIR_SUCCESSOR_REGISTERED", JSON.stringify(registered));
  const child = (await f.h.repos.workItems.mustRead(registered[0]!.successorWorkItemId!)).value;
  assert.equal(child.autonomousPlan?.sources[0]?.url, FIXTURE_URL);
  assert.equal(child.autonomousPlan?.acquisition[0]?.held[0]?.inheritedFromWorkItemId, f.h.item.id);
  assert.equal(child.autonomousPlan?.contract.schemaVersion, 2);
});

test("registered publisher fallback refuses a different host even if the captured proposal cites it", async () => {
  const f = await fixture();
  const original = f.h.item.autonomousPlan!;
  if (original.contract.schemaVersion !== 2) throw new Error("GENERALIZED_FIXTURE_REQUIRED");
  const plan = { ...original, seedUrls: [], sources: [], acquisition: [], contract: { ...original.contract,
    sourceScope: { ...original.contract.sourceScope, canonicalUrls: [] } } };
  assert.throws(() => evaluatePlanRepair({ plan, candidate: f.candidate, evidence: f.evidence, now: f.h.now(),
    registeredPublisherAddress: "http://unrelated.example.gov" }), /REPAIR_REGISTERED_PUBLISHER_HOST_MISMATCH/);
});

test("completed Scout repair retains parent instructions and creates one ordinary successor that really acquires, parses and verifies", async () => {
  const f = await fixture(); const original = f.h.item.autonomousPlan;
  const admitted = await f.consume(); assert.equal(admitted[0].code, "REPAIR_SUCCESSOR_REGISTERED", JSON.stringify(admitted));
  const childId = admitted[0].successorWorkItemId!;
  assert.notEqual(childId, f.h.item.id);
  assert.deepEqual((await f.h.repos.workItems.mustRead(f.h.item.id)).value.autonomousPlan, original);
  const attemptsBefore = (await f.h.repos.attempts.list()).length;
  assert.deepEqual(await f.consume(), [], "Already handled immutable proposals do not consume the cycle budget.");
  assert.equal((await f.h.repos.attempts.list()).length, attemptsBefore, "Proposal replay never creates an acquisition or worker Attempt.");
  assert.equal((await f.h.repos.workItems.list()).length, 2);
  const waiting = await nextAutonomousOperation(f.h.runtime, f.h.item.id);
  assert.equal(waiting.action, "BLOCKED");
  assert.equal(waiting.task, null, "A delegated parent cannot consume another paid Scout slot.");
  assert.match(waiting.reason, /REPAIR_WAITING_ON_SUCCESSOR/);
  for (const role of ["ACQUIRER", "PARSER", "VALIDATOR"]) {
    const next = await nextAutonomousOperation(f.h.runtime, childId);
    assert.equal(next.task?.workerTask?.role, role, JSON.stringify(next));
    assert.equal((await dispatchWorkerTask(f.h.runtime, next.task!)).outcome, "WORKED");
  }
  const results = await f.h.repos.workerResults.read(childId);
  assert.deepEqual(results.map(record => record.result.verdict), ["ACQUIRED", "EXTRACTED", "PASS"]);
  const child = (await f.h.repos.workItems.mustRead(childId)).value;
  const childContract = child.autonomousPlan!.contract;
  assert.equal(childContract.schemaVersion, 2);
  if (childContract.schemaVersion !== 2) throw new Error("GENERALIZED_FIXTURE_REQUIRED");
  const artifacts = await f.h.repos.artifacts.readAll(); const items = (await f.h.repos.workItems.list()).map(row => row.value);
  const attribution = { repos: f.h.repos, artifacts, items, artifactId: f.evidence[0].artifactId, contract: childContract, workItemId: childId };
  const resolved = await resolvedHeldAuditAttribution(attribution);
  assert.equal(resolved.owner.id, childId, "The successor's completed Acquirer result supplies its audit attribution.");
  assert.equal(resolved.primary.workItemId, f.h.item.id, "The immutable capture keeps its original WorkItem attribution.");
  await assert.rejects(resolvedHeldAuditAttribution({ ...attribution, workItemId: f.h.item.id }), /SCOPE_MISMATCH/);
  await assert.rejects(resolvedHeldAuditAttribution({ ...attribution, items: items.map(item => item.id === childId ? { ...item, subject: "wrong-subject" } : item) }), /SUBJECT_MISMATCH/);
  const runtime = { ...f.h.runtime, independentContext: async (scope: Parameters<typeof f.h.runtime.independentContext>[0]) => ({
    ...await f.h.runtime.independentContext(scope), authorityEvidence: [f.evidence[1]],
  }) };
  const audit = await nextAutonomousOperation(runtime, childId);
  assert.equal(audit.task?.workerTask?.role, "ADVERSARIAL_AUDITOR");
  assert.equal((await dispatchWorkerTask(runtime, audit.task!)).outcome, "WORKED");
  assert.equal((await f.h.repos.workerResults.read(childId)).at(-1)?.result.verdict, "SURVIVED");
  assert.equal((await f.h.repos.promotionPipeline.readAll()).length, 0, "Instruction repair grants no publication approval.");
});

test("repair refuses fabricated, stale, missing, unsupported and self-verifying evidence without altering required verification", async () => {
  const f = await fixture();
  const evaluate = (candidate = f.candidate, evidence = f.evidence, now = f.h.now()) => evaluatePlanRepair({ plan: f.h.item.autonomousPlan!, candidate, evidence, now });
  const repair = f.candidate.contractRepair as Record<string, unknown>;
  assert.throws(() => evaluate({ ...f.candidate, contractRepair: { ...repair, subjectId: "different" } }), /REPAIR_PROPOSAL_INVALID/);
  assert.throws(() => evaluate(f.candidate, f.evidence.slice(0, 1)), /REPAIR_EVIDENCE_BOUND/);
  assert.throws(() => evaluate(f.candidate, f.evidence.map((row, index) => index ? row : { ...row, text: "fabricated" })), /HASH_MISMATCH/);
  assert.throws(() => evaluate(f.candidate, f.evidence, "2026-09-06T18:00:00.000Z"), /STALE/);
  assert.throws(() => evaluate({ ...f.candidate, contractRepair: { ...repair, extraction: { format: "UNSUPPORTED", mediaType: "application/pdf", reason: "Missing PDF parser", fields: {} } } }), /ADAPTER_IMPLEMENTATION_REQUIRED/);
  assert.throws(() => evaluate({ ...f.candidate, contractRepair: { ...repair, extraction: { ...f.extraction, rowsPointer: "/nonexistent" } } }), /EXTRACTION_REFUSED/);
  assert.throws(() => evaluate({ ...f.candidate, contractRepair: { ...repair, authorities: [{ ...f.authority, sourceId: f.evidence[0].sourceId, artifactIds: [f.evidence[0].artifactId] }] } }), /AUTHORITY_BURDEN_MISMATCH/);
  const partial = evaluate({ ...f.candidate, contractRepair: { ...repair, authorities: [] } });
  assert.equal(partial.contract.verification.required, true); assert.deepEqual(partial.unresolved, ["EXTERNAL_VERIFICATION_MISSING", "UNVERIFIED_ROSTER_MEMBERS:2"]);
  assert.match(planRepairBrief(f.h.item.autonomousPlan!), /contractRepair/);
});

test("a roster repair schedules only profile URLs grounded in exact official href spans", async () => {
  const f = await fixture();
  const { createHash } = await import("node:crypto");
  const text = `<table><tr><th>ID</th><th>Name</th><th>Profile</th></tr><tr><td>1</td><td>Ada One</td><td><a href="/council/ada">Profile</a></td></tr><tr><td>2</td><td>Bea Two</td><td><a href="/council/bea">Profile</a></td></tr></table>`;
  const primary = { ...f.evidence[0], text, contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}` };
  const extraction = { format: "HTML_TABLE" as const, tableIndex: 0, headerRows: 1, fields: {
    id: { source: 0, type: "STRING" as const }, name: { source: 1, type: "STRING" as const },
    websiteUrl: { source: 2, type: "STRING" as const, attribute: "href" as const },
  } };
  const candidate = { ...f.candidate, evidenceArtifactIds: [primary.artifactId],
    contractRepair: { schemaVersion: 1 as const, sourceArtifactId: primary.artifactId, extraction, authorities: [] } };
  const repaired = evaluatePlanRepair({ plan: f.h.item.autonomousPlan!, candidate, evidence: [primary], now: f.h.now() });
  assert.equal(repaired.profileRoutes.length, 2);
  assert.deepEqual(repaired.profileRoutes.map(route => route.url), [new URL("/council/ada", primary.canonicalUrl).href, new URL("/council/bea", primary.canonicalUrl).href]);
  assert.ok(repaired.profileRoutes.every(route => route.observation.artifactId === primary.artifactId && route.observation.quote.includes(route.observedLocator)));
  assert.deepEqual(repaired.unresolved, ["EXTERNAL_VERIFICATION_MISSING", "UNVERIFIED_ROSTER_MEMBERS:2"]);
});

test("repair admits established school publishers and independent official records but refuses invented publishers and repeated source bytes", async () => {
  const f = await fixture();
  const plan = f.h.item.autonomousPlan!;
  if (plan.contract.schemaVersion !== 2) throw new Error("GENERALIZED_FIXTURE_REQUIRED");
  const repair = f.candidate.contractRepair as Record<string, unknown>;
  const authority = { ...f.authority, sourceId: "school.example.edu", canonicalUrls: ["https://school.example.edu/register.json"] };
  const evidence = [f.evidence[0], { ...f.evidence[1], sourceId: authority.sourceId, canonicalUrl: authority.canonicalUrls[0] }];
  const candidate = { ...f.candidate, contractRepair: { ...repair, authorities: [authority] } };
  assert.throws(() => evaluatePlanRepair({ plan, candidate, evidence, now: f.h.now() }), /AUTHORITY_NOT_INDEPENDENT/,
    "A model-proposed .edu host alone is not an established official publisher.");
  const established = { ...plan, sources: [...plan.sources, { ...plan.sources[0], sourceId: authority.sourceId, publisher: authority.publisher, url: authority.canonicalUrls[0] }] };
  assert.equal(evaluatePlanRepair({ plan: established, candidate, evidence, now: f.h.now() }).unresolved.length, 0);

  const independentRecord = { ...f.authority, sourceId: f.evidence[0].sourceId, publisher: plan.contract.sourceScope.publisher,
    canonicalUrls: [new URL("/independent-register.json", f.evidence[0].canonicalUrl).href], independenceBasis: "INDEPENDENT_OFFICIAL_RECORD" as const };
  const samePublisherEvidence = [f.evidence[0], { ...f.evidence[1], sourceId: independentRecord.sourceId, canonicalUrl: independentRecord.canonicalUrls[0] }];
  // Its independently acquired record also has to identify the established publisher.
  const { createHash } = await import("node:crypto");
  const text = JSON.stringify({ publisher: independentRecord.publisher, records: JSON.parse(FIXTURE_BODY) });
  samePublisherEvidence[1] = { ...samePublisherEvidence[1], text, contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}` };
  const separate = { ...f.candidate, contractRepair: { ...repair, authorities: [independentRecord] } };
  assert.equal(evaluatePlanRepair({ plan, candidate: separate, evidence: samePublisherEvidence, now: f.h.now() }).unresolved.length, 0);
  assert.throws(() => evaluatePlanRepair({ plan, candidate: separate,
    evidence: [samePublisherEvidence[0], { ...samePublisherEvidence[1], text: f.evidence[0].text, contentHash: f.evidence[0].contentHash }], now: f.h.now() }), /AUTHORITY_NOT_INDEPENDENT/);
});

test("old content identity needs a real completed fetch rung for fresh observation; inherited replay cannot refresh it", async () => {
  const f = await fixture();
  const future = "2026-09-06T18:00:00.000Z";
  assert.equal((await f.consume([f.scout], future))[0].code, "REPAIR_EVIDENCE_STALE");
  assert.deepEqual(await f.consume([f.scout], future), [], "A refused immutable proposal is not reevaluated every cycle.");
  const forged = await fixture();
  const futureRungs = forged.scout.rungs.map(rung => ({ ...rung, at: future }));
  assert.equal((await forged.consume([{ ...forged.scout, rungs: futureRungs }], future))[0].code, "REPAIR_EVIDENCE_STALE", "Fabricated rung beyond completed Attempt cannot reobserve old bytes.");
  const missing = { ...f.scout, attemptId: "not-a-completed-attempt" };
  assert.deepEqual(await f.consume([missing]), []);
  assert.equal((await f.h.repos.workItems.list()).length, 1);
});

test("completed fresh fetch can reobserve unchanged old bytes without rewriting their immutable acquisition time", async () => {
  const f = await fixture();
  f.h.advanceTo("2026-09-06T18:00:00.000Z");
  const task = createRouteTask({ workItemId: f.h.item.id, routeId: "real-reobservation-fixture", routeLabel: "Actual repeated fixture fetch", target: FIXTURE_URL, inherited: false, now: f.h.now() });
  await registerRouteTask(f.h.repos, task, f.h.now());
  const claim = await claimRouteTask(f.h.repos, { routeTaskId: task.id, holder: "repeat", now: f.h.now(), ttlMs: 120000 });
  const attempt = await beginAttemptFor(f.h.repos, { routeTaskId: task.id, workItemId: f.h.item.id, lease: claim.lease.value,
    worker: { role: "SCOUT", provider: "recorded-fixture", version: "1", instance: "repeat" }, methodVersion: 56, policyVersion: FLEET_POLICY_VERSION, now: f.h.now() });
  const rungs = [];
  for (const [index, prior] of f.evidence.entries()) {
    const { artifact } = recordAcquisition({ canonicalUrl: prior.canonicalUrl, retrievedAt: f.h.now(), httpStatus: 200, contentType: "application/json", sourceId: prior.sourceId,
      methodRouteId: prior.methodRouteId, workItemId: f.h.item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, prior.text);
    await putArtifact(f.h.store, f.h.item.project, artifact, Buffer.from(prior.text));
    assert.equal(artifact.id, prior.artifactId);
    await recordArtifactMetadata(f.h.repos, { artifactId: artifact.id, workItemId: f.h.item.id, routeTaskId: task.id, attemptId: attempt.id,
      tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl,
      partial: false, recordedAt: artifact.retrievedAt }, f.h.now());
    rungs.push({ ...f.scout.rungs[index], at: artifact.retrievedAt });
  }
  const at = f.h.now();
  await disposeRouteTask(f.h.repos, { routeTaskId: task.id, attemptId: attempt.id, expectedTaskRevision: (await f.h.repos.routeTasks.mustRead(task.id)).revision,
    artifactIds: f.scout.artifactIds, now: at, disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: f.scout.artifactIds,
      observation: null, permission: "ALLOWED", transport: "REACHABLE", note: "Actual repeat fixture captures, not inherited reads." } });
  const repeated = { ...f.scout, attemptId: attempt.id, routeTaskId: task.id, obligationId: task.id, rungs, startedAt: attempt.value.startedAt, recordedAt: at };
  await f.h.repos.scoutResults.append(task.id, attempt.id, repeated, at);
  const observed = await f.consume([repeated], f.h.now());
  assert.equal(observed[0].code, "REPAIR_SUCCESSOR_REGISTERED", JSON.stringify(observed));
  assert.equal(evidenceProjection(await f.h.runtime.readEvidence(f.evidence[0].artifactId)).retrievedAt, f.evidence[0].retrievedAt);
});

test("successors preserve Detective burdens and continue beyond three repairs only on new evidence", async () => {
  const f = await fixture();
  const row = await f.h.repos.workItems.mustRead(f.h.item.id);
  const detective = { question: { id: "unresolved-identity", text: "Official canonical identity remains owed", subjectId: f.h.item.subject } } as never;
  const priorPlan = { ...row.value.autonomousPlan!, detective: [detective] };
  await f.h.repos.workItems.compareAndSet(row.id, row.revision, { ...row.value, autonomousPlan: priorPlan }, f.h.now());
  const first = await f.consume();
  const child = (await f.h.repos.workItems.mustRead(first[0].successorWorkItemId!)).value;
  assert.deepEqual(child.autonomousPlan!.detective, [detective]);
  assert.match(first[0].detail, /PARENT_DETECTIVE_BURDENS_RETAINED/);
  const bounded = await fixture();
  const current = await bounded.h.repos.workItems.mustRead(bounded.h.item.id);
  const link = (depth: number, parentWorkItemId: string) => ({ depth, parentWorkItemId, rootWorkItemId: "retained-root",
    proposalHash: `older-evidence-${depth}`, authority: "WORK_INSTRUCTIONS_ONLY" as const,
    scoutAttemptId: `prior-scout-${depth}`, sourceArtifactId: `prior-source-${depth}`, retainedEvidenceIds: [], admittedAt: bounded.h.now(), unresolved: [] });
  await bounded.h.repos.workItems.put("retained-root", { ...current.value, id: "retained-root" }, bounded.h.now());
  const one = { ...current.value, id: "retained-one", planRepair: link(1, "retained-root") };
  const two = { ...current.value, id: "retained-two", planRepair: link(2, "retained-one") };
  await bounded.h.repos.workItems.put(one.id, one, bounded.h.now());
  await bounded.h.repos.workItems.put(two.id, two, bounded.h.now());
  const atBound = { ...current.value, planRepair: link(3, "retained-two") };
  await bounded.h.repos.workItems.compareAndSet(current.id, current.revision, atBound, bounded.h.now());
  const result = await bounded.consume();
  assert.equal(result[0].code, "REPAIR_SUCCESSOR_REGISTERED", JSON.stringify(result));
  const continued = (await bounded.h.repos.workItems.mustRead(result[0].successorWorkItemId!)).value;
  assert.equal((continued as typeof continued & { planRepair: PlanRepairLink }).planRepair.depth, 4);
  assert.equal(continued.autonomousPlan?.contract.schemaVersion === 2 && continued.autonomousPlan.contract.verification.required, true);
  assert.equal((await bounded.h.repos.workItems.list()).length, 5);
  assert.equal((await f.h.repos.workItems.list()).length, 2);
});

test("repair refuses unchanged ancestor proposals and invalid lineage without clearing the obligation", async () => {
  for (const invalid of [false, true]) {
    const f = await fixture();
    const row = await f.h.repos.workItems.mustRead(f.h.item.id);
    const evaluated = evaluatePlanRepair({ plan: row.value.autonomousPlan!, candidate: f.candidate, evidence: f.evidence, now: f.h.now() });
    const root = { ...row.value, id: "prior-root" };
    await f.h.repos.workItems.put(root.id, root, f.h.now());
    const planRepair = { depth: 1, parentWorkItemId: invalid ? "missing-parent" : root.id, rootWorkItemId: root.id,
      proposalHash: invalid ? "different" : evaluated.proposalHash, authority: "WORK_INSTRUCTIONS_ONLY" as const,
      scoutAttemptId: "prior-scout", sourceArtifactId: f.evidence[0].artifactId, retainedEvidenceIds: [], admittedAt: f.h.now(), unresolved: [] };
    const linked = { ...row.value, planRepair };
    await f.h.repos.workItems.compareAndSet(row.id, row.revision, linked, f.h.now());
    assert.equal((await f.consume())[0].code, invalid ? "REPAIR_LINEAGE_INVALID" : "REPAIR_UNCHANGED_PROPOSAL_NEEDS_NEW_EVIDENCE");
    assert.equal((await f.h.repos.workItems.list()).length, 2);
    assert.deepEqual((await f.h.repos.workItems.mustRead(row.id)).value.autonomousPlan, row.value.autonomousPlan);
    const inherited = planRepairFailureBrief((await f.h.repos.workItems.mustRead(row.id)).value).join("\n");
    assert.match(inherited, invalid ? /REPAIR_LINEAGE_INVALID/ : /REPAIR_UNCHANGED_PROPOSAL_NEEDS_NEW_EVIDENCE/);
    assert.match(inherited, /do not resubmit the unchanged proposal/);
  }
});

test("seven already observed proposals cannot starve an older actionable repair", async () => {
  const f = await fixture();
  const completed = (await f.h.repos.attempts.mustRead(f.scout.attemptId)).value;
  const handled: ScoutResult[] = [];
  for (let index = 0; index < 8; index++) {
    const id = `fixture-refused-${index}`;
    await f.h.repos.attempts.put(id, { ...completed, id }, f.h.now());
    handled.push({ ...f.scout, attemptId: id, candidates: [{ ...f.candidate, recordClass: "WRONG_CLASS" }] });
  }
  const first = await f.consume([f.scout, ...handled]);
  assert.equal(first.length, 7);
  assert.ok(first.every(row => row.code === "REPAIR_CANDIDATE_SCOPE_MISMATCH"));
  const next = await f.consume([f.scout, ...handled]);
  assert.deepEqual(next.map(row => row.code), ["REPAIR_CANDIDATE_SCOPE_MISMATCH", "REPAIR_SUCCESSOR_REGISTERED"]);
  assert.deepEqual(await f.consume([f.scout, ...handled]), []);
});

test("successor creation is atomic and an interrupted older registration is recoverable", async () => {
  const f = await fixture();
  const originalPut = f.h.repos.workItems.put.bind(f.h.repos.workItems);
  let persistedId: string | null = null;
  f.h.repos.workItems.put = async (id, item, now) => {
    const persisted = await originalPut(id, item, now);
    if (id !== f.h.item.id) {
      persistedId = id;
      assert.ok(item.autonomousPlan, "The sole child-row write already contains its validated executable plan.");
      throw new Error("FIXTURE_INTERRUPTION_AFTER_ROW_COMMIT");
    }
    return persisted;
  };
  assert.equal((await f.consume())[0].code, "FIXTURE_INTERRUPTION_AFTER_ROW_COMMIT");
  f.h.repos.workItems.put = originalPut;
  assert.ok(persistedId);
  assert.deepEqual(await f.consume(), [], "A committed complete child survives a caller interruption.");
  const child = await f.h.repos.workItems.mustRead(persistedId!);
  const { autonomousPlan, ...incomplete } = child.value;
  assert.ok(autonomousPlan);
  await f.h.repos.workItems.compareAndSet(child.id, child.revision, incomplete, f.h.now());
  const blocked = await nextAutonomousOperation(f.h.runtime, f.h.item.id);
  assert.match(blocked.reason, /REPAIR_SUCCESSOR_LINK_INVALID/);
  const recovered = await f.consume();
  assert.equal(recovered[0].code, "REPAIR_SUCCESSOR_REGISTERED", JSON.stringify(recovered));
  assert.equal(recovered[0].successorWorkItemId, child.id);
  assert.deepEqual((await f.h.repos.workItems.mustRead(child.id)).value.autonomousPlan, autonomousPlan);
  assert.equal((await f.h.repos.workItems.list()).length, 2);
});

test("Scout contract-repair context contains executable typed grammar rather than unspecified objects", async () => {
  const f = await fixture(); const context = planRepairBrief(f.h.item.autonomousPlan!);
  for (const required of ['"rowsPointer"', '"source":"/id"', '"type":"STRING"', '"rowTag"', '"tableIndex":0', '"headerRows":1',
    '"delimiter":","', '"id":"replace-with-register-id"', '"type":"GOVERNMENT_REGISTER"', '"publisher"',
    '"comparison":{"kind":"RECORD_VALUES","keyFields":["id"],"fields":["id","name"]}', '"authorityEvidenceArtifactIds"']) {
    assert.ok(context.includes(required), `Missing model-visible grammar: ${required}`);
  }
});

test("service and voter-access discovery can admit independently replayed repair instructions", async () => {
  for (const recordClass of ["SERVICE_CONTACT", "VOTER_ACCESS_ROUTE"]) {
    const f = await fixture(recordClass);
    assert.match(planRepairBrief(f.h.item.autonomousPlan!), /CONTRACT REPAIR remains owed/);
    const admitted = await f.consume();
    assert.equal(admitted[0].code, "REPAIR_SUCCESSOR_REGISTERED", JSON.stringify(admitted));
    const child = (await f.h.repos.workItems.mustRead(admitted[0].successorWorkItemId!)).value;
    assert.equal(child.autonomousPlan?.contract.recordClass, recordClass);
    assert.equal(child.autonomousPlan?.contract.schemaVersion, 2);
    assert.notEqual(child.state, "VERIFIED_COMPLETE", "repair admission must still execute independent workers");
    assert.equal((await nextAutonomousOperation(f.h.runtime, child.id)).task?.workerTask?.role, "ACQUIRER");
  }
});
