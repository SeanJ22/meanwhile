import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { factDb } from "./helpers/fact-db.ts";
import { autonomousHarness, FIXTURE_URL } from "./helpers/autonomous-fleet.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { registerRouteTask, claimRouteTask, beginAttemptFor, recordArtifactMetadata, disposeRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { dispatchWorkerTask, evidenceProjection, FLEET_POLICY_VERSION } from "../lib/control-plane/workers/runtime.ts";
import { nextAutonomousOperation } from "../lib/control-plane/workers/coordinator.ts";
import { publishOwedRosterFacts } from "../lib/civic-data/worker-roster-publication.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate } from "../lib/registry/runtime-data-plane.ts";
import { CENSUS_PLACEHOLDER_LABELS, isCensusPlaceholderDivision } from "../lib/registry/census-placeholders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";

import { readEveryAssignmentSource } from "./helpers/assignment-sources.ts";
import { buildAssignments } from "../lib/control-plane/assignment-view.ts";
import { owedFactItems } from "../lib/civic-data/worker-publication-tasks.ts";
import { collectWorkerRosterReadback, type PublishedWorkerRead } from "../lib/control-plane/worker-reader-readback.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { stateRegistryRuntimeContractId } from "../lib/civic-data/state-scopes.ts";
import { rowKeyedCivicRecordsFor } from "../lib/civic-data/changes.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { trustedLkgImportUrl } from "../lib/civic-data/trusted-lkg-import.ts";
import { withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { ROW_KEYED_CIVIC_CHANGE_CONTRACT } from "../lib/civic-data/changes.ts";
import { trustedLkgCandidateEnvelopeSha256 } from "../lib/civic-data/trusted-lkg-import.ts";
import { trustedLkgValidatorIds } from "../lib/civic-data/trusted-lkg-import.ts";
import { trustedLkgCandidateId } from "../lib/civic-data/trusted-lkg-import.ts";
import type { CandidateVersionRecord } from "../lib/civic-data/types.ts";
import type { PromotedProjection } from "../lib/civic-data/types.ts";

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

function stateRegistryRuntimeStore(state: string, store = new MemoryRoutineDataStore()): MemoryRoutineDataStore {
  const original = registryTransferImport();
  const payload = registryFixtureForState(state), scope = stateRegistryRuntimeScope(state), contractId = stateRegistryRuntimeContractId(state);
  const civicRecords = rowKeyedCivicRecordsFor("REGISTRY_RUNTIME_BINDING", payload), digest = canonicalCivicDataHash(payload);
  const candidate = { ...original.record.candidate, scope,
    retrieval: { ...original.record.candidate.retrieval, requestedUrl: trustedLkgImportUrl(contractId) },
    normalization: { ...original.record.candidate.normalization, normalizedHash: digest, normalizedPayloadHash: digest,
      inputRecords: civicRecords.length, outputRecords: civicRecords.length, droppedRecords: 0 },
    normalizedPayload: payload, readModel: payload, civicRecords, identities: [],
    horizon: { ...original.record.candidate.horizon, returnedRecords: civicRecords.length },
    sourceProjectionEvidence: { kind: "SOURCE_PROJECTION_CONTRACT" as const, sourceId: original.record.candidate.sourceId, recordClass: original.record.candidate.recordClass, scope },
  };
  Object.assign(candidate, { normalization: withStateRecordHashes(candidate).normalization });
  candidate.changeSet = candidateChangeSet(candidate, null, ROW_KEYED_CIVIC_CHANGE_CONTRACT);
  candidate.bootstrapImport = { ...original.record.candidate.bootstrapImport!, contractId, scope,
    normalizedPayloadSha256: digest, readModelSha256: digest, candidateEnvelopeSha256: trustedLkgCandidateEnvelopeSha256(candidate), validatorIds: trustedLkgValidatorIds(candidate) };
  candidate.id = trustedLkgCandidateId(candidate.bootstrapImport);
  const receipt = { ...original.record.receipt!, candidateId: candidate.id, scope };
  const record = { ...original.record, candidate, receipt, promotedVersion: candidate.id, lastKnownGoodVersion: candidate.id };
  const projection = { ...original.projection, key: `REGISTRY_RUNTIME_BINDING:${scope}`, scope, versionId: candidate.id,
    lastKnownGoodVersionId: candidate.id, payload, receipt };
  const held = store as unknown as { candidates: Map<string, CandidateVersionRecord>; promotions: Map<string, PromotedProjection> };
  held.candidates.set(candidate.id, record);
  held.promotions.set(projection.key, projection);
  return store;
}

const ROOT = join(import.meta.dirname, "..");

async function proveRosterPublication(partial = false) {
  const store = stateRegistryRuntimeStore("AZ");
  const imported = (await readRegistryRuntimePrior(store, "2026-09-08T12:00:01.000Z", "AZ"))!;

  const divisions = imported.payload.registry.divisions.filter(isCensusPlaceholderDivision).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] ?? row.label }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime:AZ", version: "fixture-census-correction", sourceThrough: "2026-09-08T12:00:02.000Z",
    sourceReceipt: { contractVersion: 1, reviewedAt: "2026-09-08T12:00:02.000Z", reviewedBy: "recorded-fixture-control", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: "2026-09-08T12:00:02.000Z", httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Offline fixture: Census LEA 99997 means no school district; retained transfer correction control." })) },
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  const correction = await processRegisteredManualCandidate(store, "registry-runtime:AZ", corrected, "2026-09-08T12:00:02.000Z", imported.versionId);
  assert.ok(correction.promoted, correction.candidate.failureDetail ?? "fixture correction held");
  const prior = (await readRegistryRuntimePrior(store, "2026-09-08T12:01:00.000Z", "AZ"))!;
  const existing = registryFixtureForState("AZ").bodyRosters[0]!;
  const body = prior.payload.registry.bodies.find(body => body.id === existing.bodyId)!;
  assert.ok(body.name);
  const rows = existing.members.map(member => ({ id: member.id, name: member.name, office: member.officeTitle }));
  rows.push({ id: "fixture-new-holder", name: "Morgan Example", office: "Fixture Board Member" });
  if (partial) {
    rows.shift();
    rows.push({ id: "fixture-unresolved-holder", name: "Contact us", office: "Contact information" });
  }
  const text = JSON.stringify({ body: body.name, records: rows });
  const h = await autonomousHarness({ clock: "2026-09-08T12:01:00.000Z", response: { text } });
  const task = createRouteTask({ workItemId: h.item.id, routeId: "independent-register", routeLabel: "Recorded independent roster fixture", target: "https://register.example.gov/roster.json", inherited: false, now: h.now() });
  await registerRouteTask(h.repos, task, h.now());
  const claim = await claimRouteTask(h.repos, { routeTaskId: task.id, holder: "independent-register", now: h.now(), ttlMs: 120000 });
  const attempt = await beginAttemptFor(h.repos, { routeTaskId: task.id, workItemId: h.item.id, lease: claim.lease.value, worker: { role: "SCOUT", provider: "fixture", version: "1", instance: "independent-register" }, methodVersion: 56, policyVersion: FLEET_POLICY_VERSION, now: h.now() });
  const authorityText = JSON.stringify({ publisher: "Independent Register", records: rows });
  const { artifact } = recordAcquisition({ canonicalUrl: task.target, retrievedAt: h.now(), httpStatus: 200, contentType: "application/json", sourceId: "register.example.gov", methodRouteId: task.routeId, workItemId: h.item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, authorityText);
  await putArtifact(h.store, h.item.project, artifact, Buffer.from(authorityText));
  await recordArtifactMetadata(h.repos, { artifactId: artifact.id, workItemId: h.item.id, routeTaskId: task.id, attemptId: attempt.id, tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: artifact.retrievedAt }, h.now());
  const at = h.now();
  await disposeRouteTask(h.repos, { routeTaskId: task.id, attemptId: attempt.id, expectedTaskRevision: (await h.repos.routeTasks.mustRead(task.id)).revision, artifactIds: [artifact.id], now: at, disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null, permission: "ALLOWED", transport: "REACHABLE", note: "Offline recorded authority bytes" } });
  const extraction = { format: "JSON_RECORDS" as const, rowsPointer: "/records", fields: { id: { source: "/id", type: "STRING" as const }, name: { source: "/name", type: "STRING" as const }, office: { source: "/office", type: "STRING" as const } } };
  const current = await h.repos.workItems.mustRead(h.item.id);
  const plan = current.value.autonomousPlan!;
  assert.equal(plan.contract.schemaVersion, 2);
  if (plan.contract.schemaVersion !== 2) throw new Error("fixture contract");
  await h.repos.workItems.compareAndSet(current.id, current.revision, { ...current.value, autonomousPlan: { ...plan, ownerInstructions: ["offline-owner-send"], publication: { contractId: "registry-runtime:AZ", bodyId: body.id }, auditScope: "SOURCE_UNIVERSE", contract: { ...plan.contract, jurisdiction: { ...plan.contract.jurisdiction, state: "AZ" }, requiredFields: ["id", "name", "office"], extraction, verification: { required: true, authorities: [{ id: "register", type: "GOVERNMENT_REGISTER", publisher: "Independent Register", sourceId: "register.example.gov", canonicalUrls: [artifact.canonicalUrl], artifactIds: [artifact.id], authorityEvidenceArtifactIds: [artifact.id], independenceBasis: "DISTINCT_AUTHORITY", independenceExplanation: "Separately published official register retained independently.", extraction, comparison: { kind: "RECORD_VALUES", keyFields: ["id"], fields: ["id", "name", "office"] } }] } } } }, h.now());
  const authorityEvidence = evidenceProjection(await h.runtime.readEvidence(artifact.id));
  const runtime = { ...h.runtime,
    independentContext: async (scope: Parameters<typeof h.runtime.independentContext>[0]) => ({ ...await h.runtime.independentContext(scope), authorityEvidence: [authorityEvidence] }) };

  for (const role of ["ACQUIRER", "PARSER", "VALIDATOR"]) {
    const next = await nextAutonomousOperation(runtime, h.item.id);
    assert.equal(next.task?.workerTask?.role, role, JSON.stringify(next));
    const dispatch = await dispatchWorkerTask(runtime, next.task!);
    assert.equal(dispatch.outcome, "WORKED", JSON.stringify(dispatch));
  }
  const results = await h.repos.workerResults.read(h.item.id);
  assert.deepEqual(results.map(row => row.result.verdict), ["ACQUIRED", "EXTRACTED", "PASS"]);
  const facts = await factDb();
  await ensureFactEntities(facts, ROOT, ["az"]);
  installFactReader(facts.query);
  const input = { repos: h.repos, store, facts, workItemIds: [h.item.id], now: h.now(), readCapture: async (id: string) => {
    const evidence = evidenceProjection(await runtime.readEvidence(id));
    return { evidence, observedAt: evidence.retrievedAt, httpStatus: 200, transport: "REACHABLE", partial: false };
  } };
  if (partial) {
    const stranded = await h.repos.workItems.mustRead(h.item.id);
    await h.repos.workItems.compareAndSet(stranded.id, stranded.revision, { ...stranded.value, publicationOutcome: {
      at: h.now(), workerResultId: results.at(-1)!.id, status: "HELD", code: "ROSTER_READER_IDENTITY_UNRESOLVED",
      detail: "Recorded pre-fix whole-roster identity hold", recovery: "WORKER", candidateId: null, versionId: null,
    } }, h.now());
    assert.equal(owedFactItems([(await h.repos.workItems.mustRead(h.item.id)).value], results, h.now()).rosters.length, 1,
      "the normal runner retries an old whole-roster hold instead of leaving it stranded");
  }
  const whole = async (): Promise<never> => { throw new Error("the whole worker-result log was read"); };
  const published = await publishOwedRosterFacts({ ...input, repos: { ...h.repos, workerResults: { ...h.repos.workerResults, readAll: whole, readSince: whole } } });
  assert.equal(published[0]!.outcome.status, partial ? "PARTIALLY_PUBLISHED" : "PUBLISHED", JSON.stringify(published));
  const delivered = (await readFactRosters(facts.query, [body.id])).rosters[0]!;
  assert.equal(delivered.sourceUrl, FIXTURE_URL);
  assert.deepEqual(delivered.members.map(member => member.name).sort(), rows.filter(row => row.name !== "Contact us").map(row => row.name).sort());
  for (const member of delivered.members) assert.equal(member.fieldSources?.name?.sourceUrl, FIXTURE_URL, "every seat cites the saved page it was read from");
  const deliveredAdmin = buildAssignments(await readEveryAssignmentSource(h.repos, h.now()));
  assert.deepEqual(deliveredAdmin.find(row => row.id === h.item.id)?.delivery.records, published[0]!.outcome.records);
  let observations = 0;
  const collector = { items: [(await h.repos.workItems.mustRead(h.item.id)).value], store, now: h.now(), previous: null,
    zipForDivision: async (division: string) => { assert.equal(division, body.ocdId); return "99999"; },
    observe: async (input: PublishedWorkerRead) => {
      observations++;
      assert.ok("roster" in input);
      assert.equal(input.roster.bodyId, body.id);
      assert.ok(input.roster.members.some(member => member.name === "Morgan Example"));
      return { confirmed: true, reason: "Isolated public-control observation", responseSha256: "a".repeat(64) };
    } };
  const readback = await collectWorkerRosterReadback(collector);
  assert.equal(readback.witnesses[0]?.approvalId, published[0]!.outcome.workerResultId);
  const deliveredSources = await readEveryAssignmentSource(h.repos, h.now());
  assert.equal(buildAssignments({ ...deliveredSources, servedReader: readback }).find(row => row.id === h.item.id)!.delivery.publiclyAvailable.held, true,
    "actual observation joins this exact worker publication in Admin");
  const wrong = { ...readback, witnesses: readback.witnesses.map(w => ({ ...w, versionId: "different-version" })) };
  assert.equal(buildAssignments({ ...deliveredSources, servedReader: wrong }).find(row => row.id === h.item.id)!.delivery.publiclyAvailable.held, false);
  await collectWorkerRosterReadback({ ...collector, now: h.now(), previous: readback });
  assert.equal(observations, 1, "the existing cycle reuses fresh exact public evidence instead of repeating unchanged browser visits");
  assert.deepEqual(await publishOwedRosterFacts(input), published, "restart reuses the durable publication receipt");
  installFactReader(undefined);

  if (partial) {
    assert.deepEqual(await facts.query("SELECT stage, reason FROM blank"), [{ stage: "READ", reason: "NAME_NOT_A_PERSON" }], "navigation text never becomes a person");
    assert.match(published[0]!.outcome.detail, /1 stay open as blanks with their reasons/);
    assert.equal(owedFactItems([(await h.repos.workItems.mustRead(h.item.id)).value], results, h.now()).rosters.length, 0,
      "retained partial results wait for changed worker evidence, not unchanged publication retries");
    return;
  }
  const item = await h.repos.workItems.mustRead(h.item.id);
  await h.repos.workItems.compareAndSet(item.id, item.revision, { ...item.value, publicationOutcome: { ...published[0]!.outcome,
    status: "HELD", code: "STORE_UNAVAILABLE", detail: "Recorded transient fixture", recovery: "PUBLISHER" } }, h.now());
  const retry = await nextAutonomousOperation(runtime, h.item.id);
  assert.equal(retry.action, "STAGED", "publisher outage does not spend another research call: " + JSON.stringify(retry));
  const held = await h.repos.workItems.mustRead(h.item.id);
  await h.repos.workItems.compareAndSet(held.id, held.revision, { ...held.value, publicationOutcome: { ...held.value.publicationOutcome!,
    code: "ROSTER_AUTHORITY_REPLAY_FAILED", recovery: "WORKER" } }, h.now());
  assert.notEqual((await nextAutonomousOperation(runtime, h.item.id)).action, "STAGED", "unfinished verification re-enters automatic repair");
  const admin = buildAssignments(await readEveryAssignmentSource(h.repos, h.now()));
  const assignment = admin.find(row => row.id === h.item.id)!;
  assert.ok(assignment, "the normal Admin assignment read includes the worker");
  assert.equal(assignment.state, "WAITING");
  assert.match(assignment.waiting.nextAction, /automatically/);
  assert.ok(assignment.delivery.blockers.some(reason => reason.includes("ROSTER_AUTHORITY_REPLAY_FAILED")));
}

test("ordinary independent workers publish a roster through the existing reader door, preserve prior facts, and reuse the receipt", () => proveRosterPublication());
test("a stranded mixed roster publishes verified members while unresolved identities enter automatic repair", () => proveRosterPublication(true));

test("owed roster work with nothing readable yet is held with its reason", async () => {
  const store = stateRegistryRuntimeStore("AZ");
  const prior = (await readRegistryRuntimePrior(store, "2026-09-08T12:01:00.000Z", "AZ"))!;
  const h = await autonomousHarness({ clock: "2026-09-08T12:01:00.000Z", response: { text: "{}" } });
  const current = await h.repos.workItems.mustRead(h.item.id);
  const plan = current.value.autonomousPlan!;
  if (plan.contract.schemaVersion !== 2) throw new Error("fixture contract");
  await h.repos.workItems.compareAndSet(current.id, current.revision, { ...current.value,
    autonomousPlan: { ...plan, contract: { ...plan.contract, schemaVersion: 2, jurisdiction: { country: "us", state: "AZ", canonicalId: prior.payload.registry.bodies[0]!.ocdId! } }, publication: { contractId: "registry-runtime:AZ", bodyId: prior.payload.registry.bodies[0]!.id } } }, h.now());
  const report = await publishOwedRosterFacts({ repos: h.repos, store, facts: await factDb(), workItemIds: [h.item.id], now: h.now(),
    readCapture: async () => { throw new Error("no extraction"); }, readHeld: async () => null });
  assert.deepEqual(report.map(row => [row.workItemId, row.outcome.status, row.outcome.code, row.outcome.recovery]),
    [[h.item.id, "HELD", "ROSTER_NO_READABLE_SAVED_PAGE", "WORKER"]], "every offered item is reported, never silently skipped");
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.publicationOutcome?.code, "ROSTER_NO_READABLE_SAVED_PAGE", "Admin sees why");
  assert.equal(owedFactItems([(await h.repos.workItems.mustRead(h.item.id)).value], [], h.now()).rosters.length, 0, "re-read hourly, not every pass");
});
