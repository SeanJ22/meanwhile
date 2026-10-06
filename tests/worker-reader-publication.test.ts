import { createHash } from "node:crypto";
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";
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
import { readRegistryRuntimePrior, registryRuntimeCandidate, type RegistryRuntimePrior } from "../lib/registry/runtime-data-plane.ts";
import { publishWorkerReaderResults, workerReaderPackage, workerReaderPackageWithPulls, inheritVerifiedCommentDetails } from "../lib/civic-data/worker-reader-publication.ts";
import { readManualProjectionPrior, type CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../lib/civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { commentAccessEvidenceFor } from "../lib/ask/meeting-knowledge.ts";
import { workerPublicationTasks } from "../lib/civic-data/worker-publication-tasks.ts";
import { verifiedWorkerRecords } from "../lib/civic-data/worker-publication-evidence.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { projectedCommentAccessFor, type CommentAccess } from "../lib/registry/comment-access-client.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { readEverydayRoutingProjection } from "../lib/routing/everyday-data-plane.ts";
import { publishWorkerRosterResults } from "../lib/civic-data/worker-roster-publication.ts";
import { directoryMeetingHints, workerBodyDirectoryPackage } from "../lib/civic-data/worker-body-directory.ts";
import { filingsForDivisions, officialFilingIssue, type OfficialFiling } from "../lib/civic-data/official-filings.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { OfficialFilings } from "../components/ballot/official-filings.tsx";
import { collectWorkerRosterReadback } from "../lib/control-plane/worker-reader-readback.ts";

async function workerFixture(contractId: WorkerReaderContract | "registry-runtime-bindings", facts: Record<string, string | number> | Record<string, string | number>[] | ((prior: RegistryRuntimePrior, bodyId: string) => Record<string, string | number>[]), classOverride?: "CAMPAIGN_FINANCE_FILING") {
  const { record, projection } = JSON.parse(gunzipSync(readFileSync("tests/fixtures/registry-transfer-import.json.gz")).toString("utf8")) as { record: CandidateVersionRecord; projection: PromotedProjection };
  const store = new MemoryRoutineDataStore();
  Object.assign(store, { candidates: new Map([[record.candidate.id, record]]), promotions: new Map([[projection.key, projection]]) });
  if (contractId === "registry-runtime-bindings") {
  const imported = (await readRegistryRuntimePrior(store, "2026-09-08T12:00:01.000Z"))!;
  // Replay the already deployed placeholder correction before this worker test:
  // the recorded transfer fixture predates it, unlike the production base.
  const divisions = imported.payload.registry.divisions.filter(row => CENSUS_PLACEHOLDER_LABELS[row.label]).map(row => ({ ...row, label: CENSUS_PLACEHOLDER_LABELS[row.label] }));
  const corrected = registryRuntimeCandidate({ contractId: "registry-runtime-bindings", version: "fixture-census-correction", sourceThrough: "2026-09-08T12:00:02.000Z",
    sourceReceipt: { contractVersion: 1, reviewedAt: "2026-09-08T12:00:02.000Z", reviewedBy: "recorded-fixture-control", sources: [...new Set(divisions.map(row => row.provenance!.sourceUrl!))].map(url => ({ requestedUrl: url, finalUrl: url, publisher: "U.S. Census Bureau", sourceClass: "OFFICIAL_PUBLISHER", retrievedAt: "2026-09-08T12:00:02.000Z", httpStatus: 200, rawHash: createHash("sha256").update(JSON.stringify(divisions)).digest("hex"), reviewedEvidence: "Offline fixture: Census LEA 99997 means no school district; retained transfer correction control." })) },
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, bodyRosters: [], rosterReaderDispositions: [], statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  const correction = await processRegisteredManualCandidate(store, "registry-runtime-bindings", corrected, "2026-09-08T12:00:02.000Z", imported.versionId);
  assert.ok(correction.promoted, correction.candidate.failureDetail ?? "fixture correction held");
  }
  const prior = (await readRegistryRuntimePrior(store, "2026-09-08T12:01:00.000Z"))!;
  const directory = contractId === "registry-runtime-bindings";
  const body = prior.payload.registry.bodies.find(row => row.name && (!(directory || contractId === "official-filings") || prior.payload.registry.divisions.some(d => d.ocdId === row.ocdId &&
    (contractId !== "official-filings" || prior.payload.registry.divisions.filter(other => other.state === d.state && other.label.toLowerCase() === d.label.toLowerCase()).length === 1))))!;
  const publisherDivisionId = body.ocdId;
  const division = prior.payload.registry.divisions.find(row => row.ocdId === publisherDivisionId)!;
  const recordClass = classOverride ?? (directory ? "OFFICIAL_BOARD_DIRECTORY" : WORKER_READER_CLASSES[contractId]);
  const supplied = typeof facts === "function" ? facts(prior, body.id) : facts;
  const rows: Record<string, string | number>[] = (Array.isArray(supplied) ? supplied : [supplied]).map(fact => ({ bodyName: body.name!, ...(contractId === "official-filings" ? { jurisdictionName: division.label } : {}), ...(directory ? {
    jurisdictionName: division.label, coverage: "entire jurisdiction", coverageEvidence: `This body serves all of ${division.label}.` } : {}), ...fact }));
  const text = JSON.stringify(rows);
  const fields = Object.fromEntries(Object.keys(rows[0]).map(field => [field, { source: `/${field}`, type: typeof rows[0][field] === "number" ? "NUMBER" as const : "STRING" as const }]));
  const extraction = { format: "JSON_RECORDS" as const, rowsPointer: "", fields };
  const h = await autonomousHarness({ clock: "2026-09-08T12:01:00.000Z", response: { text }, plan: plan => ({ ...plan,
    ownerInstructions: ["offline-send"], publication: { contractId, bodyId: body.id }, auditScope: "SOURCE_UNIVERSE",
    ...(directory ? { directorySubject: { divisionId: body.ocdId, jurisdiction: { id: plan.contract.subjectId,
      stateCode: "NH", name: division.label, govClass: "COUNTY" as const, countyName: null, enumeratedFrom: "offline-fixture", ownWebAddress: FIXTURE_URL,
      sourceIds: [], ocdId: body.ocdId, bodyId: body.id } } } : {}),
    sources: plan.sources.map(route => ({ ...route, recordClass })),
    contract: { ...plan.contract, ...(contractId === "official-filings" ? { jurisdiction: { country: "US", state: division.state, canonicalId: plan.contract.subjectId } } : {}), schemaVersion: 2, recordClass, identity: { namespace: contractId, keyFields: ["bodyName"] },
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
  // §3: the Validator is the last stage for facts that are not judgment calls.
  for (const role of ["ACQUIRER", "PARSER", "VALIDATOR"]) {
    const next = await nextAutonomousOperation(runtime, h.item.id);
    assert.equal(next.task?.workerTask?.role, role, JSON.stringify(next));
    assert.equal((await dispatchWorkerTask(runtime, next.task!)).outcome, "WORKED");
  }
  const results = await h.repos.workerResults.read(h.item.id);
  assert.deepEqual(results.map(row => row.result.verdict), ["ACQUIRED", "EXTRACTED", "PASS"]);
  assert.equal((await nextAutonomousOperation(runtime, h.item.id)).action, "STAGED", "no auditor is dispatched");
  const queued = workerPublicationTasks([(await h.repos.workItems.mustRead(h.item.id)).value], results, h.now());
  assert.equal(queued.length, 1);
  if (!directory) assert.ok(queued[0].command.includes(`--contract=${contractId}`));
  assert.ok(queued[0].command.some(arg => arg === `--${directory ? "worker-rosters" : "worker-results"}=${h.item.id}`));
  const input = { repos: h.repos, store, contractId: contractId as WorkerReaderContract, workItemIds: [h.item.id], now: h.now(),
    readCapture: async (id: string) => { const evidence = evidenceProjection(await runtime.readEvidence(id));
      return { evidence, observedAt: evidence.retrievedAt, httpStatus: 200, transport: "REACHABLE", partial: false }; } };
  return { input, h, store, body, rows, results, artifact, ready, prior, runtime };
}

test("verified directory bodies publish through the normal registry door and create durable scope-bound work without manual admission", async () => {
  const f = await workerFixture("registry-runtime-bindings", [
    { bodyName: "Fixture Advisory Commission", bodyClass: "ADVISORY", homepageUrl: "https://directory.example.gov/commission" },
    { bodyName: "Fixture Partial District Board", bodyClass: "GOVERNING", homepageUrl: "https://directory.example.gov/partial", coverage: "part of this jurisdiction" },
  ]);
  const published = await publishWorkerRosterResults(f.input);
  assert.equal(published[0].outcome.status, "PARTIALLY_PUBLISHED", JSON.stringify(published));
  assert.equal(published[0].outcome.recovery, "WORKER", "unresolved territory automatically returns to evidence repair without holding independently verified bodies");
  assert.match(published[0].outcome.detail, /DIRECTORY_TERRITORY_REQUIRES_REPAIR/);
  const read = (await readRegistryRuntimePrior(f.store, f.h.now()))!;
  const body = read.payload.registry.bodies.find(body => body.name === "Fixture Advisory Commission")!;
  assert.ok(body, "normal typed Reader contains the independently verified body");
  assert.equal(body.ocdId, f.body.ocdId);
  assert.equal(body.homepageUrl, f.rows[0].homepageUrl);
  assert.ok(!read.payload.registry.bodies.some(body => body.name === "Fixture Partial District Board"), "a county association never becomes an unsupported countywide body");
  const hints = directoryMeetingHints([(await f.h.repos.workItems.mustRead(f.h.item.id)).value], read.payload, []);
  assert.equal(hints[0].jurisdictionId, f.h.item.subject);
  assert.equal(hints[0].routes[0].url, body.homepageUrl, "the existing meeting walk inherits the verified new body route");
  assert.equal(hints[0].routes[0].verifyAs, "official-page-events", "normal calendar and crosswalk verification still runs");
  const children = (await f.h.repos.workItems.list()).filter(row => row.id !== f.h.item.id);
  assert.equal(children.length, 3);
  for (const child of children) {
    assert.equal(child.value.subject, f.h.item.subject, "the child keeps the existing scope-budget subject");
    assert.deepEqual(child.value.autonomousPlan?.ownerInstructions, ["offline-send"]);
    assert.equal(child.value.autonomousPlan?.publication?.bodyId, body.id);
    assert.equal(child.value.dependencies[0].upstreamId, f.h.item.id);
    assert.equal((await nextAutonomousOperation(f.runtime, child.id)).action, "SCOUT", "the normal coordinator continues unresolved source discovery");
  }
  assert.deepEqual(await publishWorkerRosterResults(f.input), published, "durable publication prevents duplicate bodies or child work");
  assert.equal((await f.h.repos.workItems.list()).length, 4);
  const parser = f.results.find(row => row.result.role === "PARSER")!;
  const captures = await Promise.all([parser.result.role === "PARSER" ? parser.result.artifactId : "", f.artifact.id].map(f.input.readCapture));
  const checked = { plan: f.ready, parser, captures, prior: f.prior, now: f.h.now() };
  assert.throws(() => workerBodyDirectoryPackage({ ...checked, plan: { ...f.ready, directorySubject: { ...f.ready.directorySubject!, divisionId: "unsupported-division" } } }), /CENSUS_DIVISION_UNRESOLVED/);
  assert.throws(() => workerBodyDirectoryPackage({ ...checked, captures: captures.map(c => ({ ...c, observedAt: "2026-07-01T00:00:00.000Z" })) }), /OUTSIDE_FRESHNESS_WINDOW/);
  const altered = { ...parser, result: parser.result.role === "PARSER" ? { ...parser.result, records: parser.result.records.map(row => ({ ...row, fields: { ...row.fields, coverage: "countywide" } })) } : parser.result };
  // A value that does not replay from its source row stays open instead of publishing; the rest of the row still can.
  assert.equal(verifiedWorkerRecords({ ...checked, parser: altered }).extraction.records.every(row => row.fields.coverage === undefined), true);
});

test("a verified shared directory body serves its exact listed Census divisions without countywide coverage or duplicate identities", async () => {
  let expected: string[] = [];
  const f = await workerFixture("registry-runtime-bindings", (prior, bodyId) => {
    const origin = prior.payload.registry.bodies.find(row => row.id === bodyId)!;
    const division = prior.payload.registry.divisions.find(row => row.ocdId === origin.ocdId)!;
    const peers = prior.payload.registry.divisions.filter(row => row.state === division.state && row.ocdId !== division.ocdId &&
      prior.payload.registry.divisions.filter(other => other.state === row.state && other.label === row.label).length === 1).slice(0, 2);
    assert.equal(peers.length, 2);
    expected = peers.map(row => row.ocdId).sort();
    return [{ bodyName: "Fixture Joint Services Commission", bodyClass: "REGIONAL", homepageUrl: "https://directory.example.gov/shared",
      territoryNames: peers.map(row => row.label).join("; "), coverage: "entire listed divisions",
      coverageEvidence: `Legal service territory: all of ${peers.map(row => row.label).join("; ")}.` }];
  });
  const published = await publishWorkerRosterResults(f.input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  const read = (await readRegistryRuntimePrior(f.store, f.h.now()))!;
  const bodies = read.payload.registry.bodies.filter(row => row.name === "Fixture Joint Services Commission");
  assert.equal(bodies.length, 1);
  assert.deepEqual([bodies[0].ocdId, ...(bodies[0].alsoServesOcdIds ?? [])].sort(), expected);
  assert.ok(!expected.includes(f.body.ocdId!), "finding a body under a government does not assign that government's whole territory");
  assert.equal((await f.h.repos.workItems.list()).length, 4, "one body has one set of downstream work, not one copy per division");
  assert.deepEqual(await publishWorkerRosterResults(f.input), published);
});

test("independent candidate and committee filings automatically publish source facts through the existing promotion and ballot reader", async () => {
  for (const finance of [false, true]) {
    const f = await workerFixture("official-filings", finance
      ? { committeeName: "Fixture Committee", committeeId: "123", filingPeriod: "January–June 2026", documentUrl: FIXTURE_URL, currency: "USD", receipts: 42 }
      : { candidateName: "Fixture Candidate", office: "Town Board", documentUrl: FIXTURE_URL, filingStatus: "Filed" }, finance ? "CAMPAIGN_FINANCE_FILING" : undefined);
    const published = await publishWorkerReaderResults(f.input);
    assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
    const projection = await readCuratedReaderProjection("official-filings", { store: f.store, now: f.h.now(), bypassCache: true });
    assert.equal(projection.kind, "PROMOTED");
    if (projection.kind !== "PROMOTED") throw Error("fixture reader");
    const rows = filingsForDivisions(projection.value.records as unknown as OfficialFiling[], [f.body.ocdId!]);
    assert.equal(rows.length, 1);
    assert.deepEqual(filingsForDivisions(rows, ["ocd-division/country:us/state:zz"]), []);
    const html = renderToStaticMarkup(createElement(OfficialFilings, { rows }));
    assert.ok(html.includes(String(f.rows[0].documentUrl)) && html.includes(finance ? "Fixture Committee" : "Fixture Candidate"));
    assert.ok(html.includes("does not establish a current ballot position"));
    if (finance) {
      assert.ok(html.includes("Reported receipts") && html.includes("42"));
      assert.ok(!html.includes("Reported expenditures"), "missing financial figures never become zero");
      assert.ok(officialFilingIssue({ ...rows[0], facts: { ...rows[0].facts, currency: "unspecified" } }));
    }
    assert.deepEqual(await publishWorkerReaderResults(f.input), published, "published worker result is not repeatedly re-published");
    const observed = await collectWorkerRosterReadback({ items: [(await f.h.repos.workItems.mustRead(f.h.item.id)).value], store: f.store,
      now: f.h.now(), previous: null, zipForDivision: async division => { assert.equal(division, f.body.ocdId); return "99999"; },
      observe: async input => { assert.ok("filings" in input); assert.deepEqual(input.filings, rows);
        return { confirmed: true, reason: "Isolated visible-controls fixture; not a live geographic proof", responseSha256: "a".repeat(64) }; } });
    assert.equal(observed.witnesses[0].approvalId, published[0].outcome.workerResultId);
    assert.equal(observed.witnesses[0].versionId, published[0].outcome.versionId);
  }
});

test("independent normal workers automatically publish public-comment rules through the existing reader and retain repair evidence", async () => {
  const { input, h, store, body, rows, results, artifact, ready, prior } = await workerFixture("comment-access", {
    commentPeriod: "YES", commentPeriodDetail: "The board provides a public comment period.", signup: "Sign up before the meeting." });
  const published = await publishWorkerReaderResults(input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  assert.deepEqual(published[0].outcome.records, { added: 1, changed: 0, reused: 0 });
  assert.equal(published[0].outcome.recordChanges?.length, 1);
  assert.deepEqual(published[0].outcome.acceptedRecordIds, published[0].outcome.recordChanges?.map(row => row.readerId), "public readback uses the exact delivered reader IDs");
  const read = await readCuratedReaderProjection("comment-access", { store, now: h.now(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("reader missing");
  const rendered = projectedCommentAccessFor(body.ocdId ?? null, body.name ?? undefined, body.id, read.value.records as unknown as CommentAccess[]);
  assert.equal(rendered?.signup, rows[0]["signup"]);
  assert.ok(rendered?.fieldSources?.signup?.quote?.includes("Sign up before the meeting."), "CP-05: the parser's saved quote survives publication and the typed reader");
  assert.deepEqual(await publishWorkerReaderResults(input), published, "restart reuses the publication and spends nothing");
  assert.equal(workerPublicationTasks([(await h.repos.workItems.mustRead(h.item.id)).value], results, h.now()).length, 0, "a published extraction is not offered again");
  const parser = results.find(row => row.result.role === "PARSER")!;
  const captures = await Promise.all([parser.result.role === "PARSER" ? parser.result.artifactId : "", artifact.id].map(input.readCapture));
  const checked = { plan: ready, parser, captures, registry: prior, now: h.now() };
  assert.throws(() => workerReaderPackage({ ...checked, captures: captures.map(c => ({ ...c, partial: true })) }), /PRIMARY_CAPTURE_MISSING_OR_INCOMPLETE/);
  assert.throws(() => workerReaderPackage({ ...checked, captures: captures.map(c => ({ ...c, evidence: { ...c.evidence, canonicalUrl: "https://mirror.example.com/rules" } })) }), /LINKED_SOURCE_UNVERIFIED/);
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

test("a BROKE audit names the published reader members it takes out of the next version (DP-15)", async () => {
  const { input, h, store, results, artifact, ready, prior } = await workerFixture("comment-access", {
    commentPeriod: "YES", commentPeriodDetail: "The board provides a public comment period.", signup: "Sign up before the meeting." });
  const published = await publishWorkerReaderResults(input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  const parser = results.find(row => row.result.role === "PARSER")!;
  if (parser.result.role !== "PARSER") throw new Error("parser missing");
  const captures = await Promise.all([parser.result.artifactId, artifact.id].map(input.readCapture));
  const check = { plan: ready, parser, captures, registry: prior, now: h.now() };
  assert.equal(workerReaderPackageWithPulls({ ...check, results }).pulledMemberIds.size, 0, "no audit, nothing pulled");
  const broke = { id: "wr-audit-broke", workItemId: h.item.id, endedAt: "2099-01-01T00:00:00.000Z",
    result: { role: "ADVERSARIAL_AUDITOR", verdict: "BROKE", producerAttemptId: parser.result.attemptId, brokenRecordIds: [parser.result.records[0].id] } } as unknown as typeof parser;
  const built = workerReaderPackageWithPulls({ ...check, results: [...results, broke] });
  const live = await readCuratedReaderProjection("comment-access", { store, now: h.now(), bypassCache: true });
  if (live.kind !== "PROMOTED") throw new Error("reader missing");
  assert.deepEqual([...built.pulledMemberIds], [live.value.records[0].id as string], "the pull names the exact published member");
  assert.equal((built.package.payload as CuratedReaderProjection).records.length, 0, "the pulled record is not republished");
});

test("CP-09: an amountless filing reaches its reader as a document without manufacturing Money", async () => {
  const f = await workerFixture("official-filings", { committeeName: "Fixture Committee", committeeId: "123", documentUrl: FIXTURE_URL }, "CAMPAIGN_FINANCE_FILING");
  const published = await publishWorkerReaderResults(f.input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  const projection = await readCuratedReaderProjection("official-filings", { store: f.store, now: f.h.now(), bypassCache: true });
  assert.equal(projection.kind, "PROMOTED");
  if (projection.kind !== "PROMOTED") throw Error("fixture reader");
  const rows = filingsForDivisions(projection.value.records as unknown as OfficialFiling[], [f.body.ocdId!]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "CAMPAIGN_FINANCE_DOCUMENT");
  assert.equal(officialFilingIssue(rows[0]), null);
  const html = renderToStaticMarkup(createElement(OfficialFilings, { rows }));
  assert.ok(html.includes(FIXTURE_URL) && html.includes("Fixture Committee"));
  assert.doesNotMatch(html, /Reported receipts|Reported expenditures|Reported cash/);
});

test("CP-03: a saved voter-guide fact keeps its kind through the actual reader package", async () => {
  const fixture = await workerFixture("comment-access", { commentPeriod: "YES", commentPeriodDetail: "Public comment is welcome." });
  const parser = fixture.results.find(row => row.result.role === "PARSER")!;
  if (parser.result.role !== "PARSER") throw Error("parser missing");
  const original = await fixture.input.readCapture(parser.result.artifactId);
  const capture = { ...original, evidence: { ...original.evidence, canonicalUrl: "https://www.vote411.org/local-guide" } };
  const built = workerReaderPackage({ plan: fixture.ready, parser, captures: [capture], registry: fixture.prior, now: fixture.h.now() });
  assert.equal(built.sourceReceipt.sources[0].sourceClass, "VOTER_GUIDE");
  const prepared = await prepareManualProjectionSuccessor(built, fixture.store, fixture.h.now());
  const outcome = await processRegisteredManualCandidate(fixture.store, "comment-access", prepared.candidate, fixture.h.now(), prepared.expectedBaseVersionId);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "guide fact held");
});

test("CP-07: a receipt keeps the superseded value while the winning fact reaches the typed reader", async () => {
  const f = await workerFixture("comment-access", { commentPeriod: "YES", commentPeriodDetail: "Public comment is welcome.", signup: "Sign up with the clerk." });
  assert.equal((await publishWorkerReaderResults(f.input))[0].outcome.status, "PUBLISHED");
  const prior = (await readManualProjectionPrior("comment-access", f.store, f.h.now()))!;
  const original = (prior.payload as CuratedReaderProjection).records[0];
  const sourceUrl = "https://news.example/comment";
  const later = "2026-09-08T12:10:00.000Z";
  const input = { contractId: "comment-access" as const, version: "source-conflict-news", sourceThrough: later,
    sourceReceipt: { ...prior.sourceReceipt, reviewedAt: later, sources: [{ ...prior.sourceReceipt.sources[0], sourceClass: "NEWS" as const,
      requestedUrl: sourceUrl, finalUrl: sourceUrl, retrievedAt: later }] },
    payload: { kind: "comment-access" as const, records: [{ ...original, signup: "No signup needed.", sourceUrl, collectedAt: later,
      fieldSources: { signup: { sourceUrl, sourceOrg: "News", collectedAt: later, verifiedAt: later, quote: "No signup needed." } } }] } };
  const prepared = await prepareManualProjectionSuccessor(input, f.store, later);
  assert.ok(prepared.candidate.excludedFacts?.some(fact => fact.code === "CONFLICT_SUPERSEDED"));
  const published = await processRegisteredManualCandidate(f.store, "comment-access", prepared.candidate, later, prepared.expectedBaseVersionId);
  assert.ok(published.promoted, published.candidate.failureDetail ?? "conflict blocked the whole record");
  const read = await readCuratedReaderProjection("comment-access", { store: f.store, now: later, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal(read.value.records.find(row => row.id === original.id)?.signup, "Sign up with the clerk.");
});
