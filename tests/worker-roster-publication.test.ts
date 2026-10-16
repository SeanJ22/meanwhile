import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
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
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishOwedRosterFacts } from "../lib/civic-data/worker-roster-publication.ts";
import { readRegistryRuntimePrior, registryRuntimeCandidate, REGISTRY_RUNTIME_SCOPE, type RegistryRuntimePrior, type RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { readAllAssignmentSources } from "../lib/control-plane/assignment-read.ts";
import { buildAssignments } from "../lib/control-plane/assignment-view.ts";
import { owedFactItems } from "../lib/civic-data/worker-publication-tasks.ts";
import { collectWorkerRosterReadback, type PublishedWorkerRead } from "../lib/control-plane/worker-reader-readback.ts";

const ROOT = join(import.meta.dirname, "..");

async function seedRosterIdentity(facts: Awaited<ReturnType<typeof factDb>>, prior: RegistryRuntimePrior, bodyId: string) {
  await facts.pg.exec(`CREATE TABLE civic_data_payload_parts (hash text PRIMARY KEY,payload jsonb NOT NULL);
    CREATE TABLE civic_data_promotions (record_class text,scope text,current_version_id text,payload jsonb,PRIMARY KEY(record_class,scope));`);
  await facts.pg.exec(readFileSync(new URL("../lib/db/migrations/R4_meeting_dependencies.sql", import.meta.url), "utf8"));
  const body = prior.payload.registry.bodies.find(row => row.id === bodyId)!;
  assert.ok(body);
  const division = body.ocdId ? new Map(prior.payload.registry.divisions.map(row => [row.ocdId, row])).get(body.ocdId) : undefined;
  assert.ok(!body.ocdId || division, "a body naming a governing division must have that exact registered division");
  await facts.pg.query("INSERT INTO civic_data_promotions VALUES ('REGISTRY_RUNTIME_BINDING',$1,$2,$3::jsonb)",
    [REGISTRY_RUNTIME_SCOPE, prior.versionId, JSON.stringify({ registry: { generatedAt: prior.payload.registry.generatedAt,
      bodies: [body], divisions: division ? [division] : [] } })]);
}

async function proveRosterPublication(partial = false) {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const imported = (await readRegistryRuntimePrior(store, "2026-09-08T12:00:01.000Z"))!;
  // Replay the already deployed placeholder correction before this worker test:
  // the recorded transfer fixture predates it, unlike the production base.
  const divisions = imported.payload.registry.divisions.filter(row => CENSUS_PLACEHOLDER_LABELS[row.label]).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime-bindings", version: "fixture-census-correction", sourceThrough: "2026-09-08T12:00:02.000Z",
    sourceReceipt: { contractVersion: 1, reviewedAt: "2026-09-08T12:00:02.000Z", reviewedBy: "recorded-fixture-control", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: "2026-09-08T12:00:02.000Z", httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Offline fixture: Census LEA 99997 means no school district; retained transfer correction control." })) },
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  const correction = await processRegisteredManualCandidate(store, "registry-runtime-bindings", corrected, "2026-09-08T12:00:02.000Z", imported.versionId);
  assert.ok(correction.promoted, correction.candidate.failureDetail ?? "fixture correction held");
  const prior = (await readRegistryRuntimePrior(store, "2026-09-08T12:01:00.000Z"))!;
  const existing = (projection.payload as RegistryRuntimeReadModel).bodyRosters[0]!;
  const body = prior.payload.registry.bodies.find(body => body.id === existing.bodyId)!;
  assert.ok(body.name);
  const rows = existing.members.map(member => ({ id: member.id, name: member.name, office: member.officeTitle }));
  rows.push({ id: "fixture-new-holder", name: "Morgan Example", office: "Fixture Board Member" });
  if (partial) {
    rows.shift(); // An incomplete update must not erase this prior verified person.
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
  await h.repos.workItems.compareAndSet(current.id, current.revision, { ...current.value, autonomousPlan: { ...plan, ownerInstructions: ["offline-owner-send"], publication: { contractId: "registry-runtime-bindings", bodyId: body.id }, auditScope: "SOURCE_UNIVERSE", contract: { ...plan.contract, requiredFields: ["id", "name", "office"], extraction, verification: { required: true, authorities: [{ id: "register", type: "GOVERNMENT_REGISTER", publisher: "Independent Register", sourceId: "register.example.gov", canonicalUrls: [artifact.canonicalUrl], artifactIds: [artifact.id], authorityEvidenceArtifactIds: [artifact.id], independenceBasis: "DISTINCT_AUTHORITY", independenceExplanation: "Separately published official register retained independently.", extraction, comparison: { kind: "RECORD_VALUES", keyFields: ["id"], fields: ["id", "name", "office"] } }] } } } }, h.now());
  const authorityEvidence = evidenceProjection(await h.runtime.readEvidence(artifact.id));
  const runtime = { ...h.runtime,
    independentContext: async (scope: Parameters<typeof h.runtime.independentContext>[0]) => ({ ...await h.runtime.independentContext(scope), authorityEvidence: [authorityEvidence] }) };
  // The Validator is the last stage for a roster; no auditor is dispatched.
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
  await seedRosterIdentity(facts, prior, body.id);
  installFactReader(facts.query);
  const input = { repos: h.repos, facts, workItemIds: [h.item.id], now: h.now(), readCapture: async (id: string) => {
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
  const deliveredAdmin = buildAssignments(await readAllAssignmentSources(h.repos, { nowIso: h.now(), activation: null, pilotZips: [] }));
  assert.deepEqual(deliveredAdmin.find(row => row.id === h.item.id)?.delivery.records, published[0]!.outcome.records);
  let observations = 0;
  const collector = { items: [(await h.repos.workItems.mustRead(h.item.id)).value], store, now: h.now(), previous: null,
    zipForDivision: async (division: string) => { assert.equal(division, body.ocdId); return "99999"; }, // isolated destination dependency; no geographic proof claimed
    observe: async (input: PublishedWorkerRead) => {
      observations++;
      assert.ok("roster" in input);
      assert.equal(input.roster.bodyId, body.id);
      assert.ok(input.roster.members.some(member => member.name === "Morgan Example"));
      return { confirmed: true, reason: "Isolated public-control observation", responseSha256: "a".repeat(64) };
    } };
  const readback = await collectWorkerRosterReadback(collector);
  assert.equal(readback.witnesses[0]?.approvalId, published[0]!.outcome.workerResultId);
  const deliveredSources = await readAllAssignmentSources(h.repos, { nowIso: h.now(), activation: null, pilotZips: [] });
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
  const admin = buildAssignments(await readAllAssignmentSources(h.repos, { nowIso: h.now(), activation: null, pilotZips: [] }));
  const assignment = admin.find(row => row.id === h.item.id)!;
  assert.ok(assignment, "the normal Admin assignment read includes the worker");
  assert.equal(assignment.state, "WAITING");
  assert.match(assignment.waiting.nextAction, /automatically/);
  assert.ok(assignment.delivery.blockers.some(reason => reason.includes("ROSTER_AUTHORITY_REPLAY_FAILED")));
}

test("ordinary independent workers publish a roster through the existing reader door, preserve prior facts, and reuse the receipt", () => proveRosterPublication());
test("a stranded mixed roster publishes verified members while unresolved identities enter automatic repair", () => proveRosterPublication(true));

test("owed roster work reads one current body without inventing its missing division despite national registry noise", async context => {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  const prior = (await readRegistryRuntimePrior(store, "2026-09-08T12:01:00.000Z"))!;
  const body = prior.payload.registry.bodies.find(row => row.ocdId === null);
  assert.ok(body);
  const h = await autonomousHarness({ clock: "2026-09-08T12:01:00.000Z", response: { text: "{}" } });
  const current = await h.repos.workItems.mustRead(h.item.id);
  const plan = current.value.autonomousPlan!;
  await h.repos.workItems.compareAndSet(current.id, current.revision, { ...current.value,
    autonomousPlan: { ...plan, publication: { contractId: "registry-runtime-bindings", bodyId: body.id } } }, h.now());
  const facts = await factDb();
  context.after(() => facts.pg.close());
  await seedRosterIdentity(facts, prior, body.id);
  let rowsRead = 0, bytesRead = 0;
  const input = { repos: h.repos, facts: { ...facts, query: async (sql: string, params?: readonly unknown[]) => {
    assert.doesNotMatch(sql, /jsonb_array_elements|civic_data_payload_parts|SELECT\s+\*/i);
    const rows = await facts.query(sql, params);
    rowsRead += rows.length;
    bytesRead += Buffer.byteLength(JSON.stringify(rows));
    return rows;
  } }, workItemIds: [h.item.id], now: h.now(),
  readCapture: async () => { throw new Error("no extraction"); }, readHeld: async () => null };
  const report = await publishOwedRosterFacts(input);
  assert.deepEqual(report.map(row => [row.workItemId, row.outcome.status, row.outcome.code, row.outcome.recovery]),
    [[h.item.id, "HELD", "ROSTER_NO_READABLE_SAVED_PAGE", "WORKER"]], "every offered item is reported, never silently skipped");
  assert.equal((await h.repos.workItems.mustRead(h.item.id)).value.publicationOutcome?.code, "ROSTER_NO_READABLE_SAVED_PAGE", "Admin sees why");
  assert.equal(owedFactItems([(await h.repos.workItems.mustRead(h.item.id)).value], [], h.now()).rosters.length, 0, "re-read hourly, not every pass");
  const before = { rowsRead, bytesRead };
  assert.equal(rowsRead, 1);
  assert.ok(bytesRead < 4000, String(bytesRead));
  await facts.pg.query(`INSERT INTO civic_meeting_dependencies
    SELECT 'body','noise:' || id,'US-TX',$1,$2,jsonb_build_object('id','noise:' || id,'name','Unrelated body','ocdId','unrelated-place:' || id)
    FROM generate_series(1,276411) id`, [REGISTRY_RUNTIME_SCOPE, prior.versionId]);
  rowsRead = 0; bytesRead = 0;
  assert.deepEqual(await publishOwedRosterFacts(input), report);
  assert.deepEqual({ rowsRead, bytesRead }, before);
  context.diagnostic(JSON.stringify({ unrelatedBodies: 276411, rowsRead, bytesRead }));
  await facts.pg.query("UPDATE civic_data_promotions SET current_version_id='newer-registry' WHERE record_class='REGISTRY_RUNTIME_BINDING'");
  const stale = await publishOwedRosterFacts(input);
  assert.equal(stale[0]!.outcome.code, "ROSTER_BODY_UNREGISTERED", "stale projected identity cannot authorize publication");
});
