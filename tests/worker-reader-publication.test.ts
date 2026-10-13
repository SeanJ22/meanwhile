import { runWorkerPublicationJob } from "../lib/civic-data/worker-publication-job.ts";
import { factDb } from "./helpers/fact-db.ts";
import {readGenericBallotProjection} from "../lib/ballot/generic-projection.ts";
import {readerBallotSourcesForDivisions} from "../lib/ballot/reader-sources.ts";
import {candidateEnrichmentUniversesFromHoldings} from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { promotedEdgeEntryOf } from "../lib/civic-data/read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { scopedManualContractScope } from "../lib/civic-data/scoped-manual-contracts.ts";
import { readPublicKindOwed } from "../lib/coverage/public-kind-owed.ts";
import { governmentMoneyView } from "../lib/funding/government-money.ts";
import { governmentFinanceEvidence, composeGovernmentFinanceAnswer } from "../lib/ask/government-finance.ts";
import { checkDoorDraft, applyManualEdit } from "../lib/doors/registry.ts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import { createHash } from "node:crypto";
import { CENSUS_PLACEHOLDER_LABELS } from "../lib/registry/census-placeholders.ts";
import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";
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
import { publishWorkerReaderResults, workerReaderPackageWithPulls } from "../lib/civic-data/worker-reader-publication.ts";
import type { CuratedReaderProjection } from "../lib/civic-data/manual-projections.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { workerPublicationTasks } from "../lib/civic-data/worker-publication-tasks.ts";
import { verifiedWorkerRecords } from "../lib/civic-data/worker-publication-evidence.ts";
import { readCuratedReaderProjection } from "../lib/civic-data/curated-reader-read-model.ts";
import { readPublicRecords } from "../lib/civic-data/public-records.ts";
import { takeUnshownUpdates } from "../lib/control-plane/updates.ts";
import { readGovernmentBudgets, currentBudgetFacts, budgetChecklistEvidence } from "../lib/civic-data/government-budgets.ts";
import type { CandidateVersionRecord, PromotedProjection } from "../lib/civic-data/types.ts";
import { readEverydayRoutingProjection } from "../lib/routing/everyday-data-plane.ts";
import { publishWorkerDirectoryResults } from "../lib/civic-data/worker-roster-publication.ts";
import { directoryMeetingHints, workerBodyDirectoryPackage } from "../lib/civic-data/worker-body-directory.ts";
import { filingsForDivisions, officialFilingIssue, type OfficialFiling } from "../lib/civic-data/official-filings.ts";
import { renderCardWithSources } from "./helpers/render-card.ts";
import { collectWorkerRosterReadback } from "../lib/control-plane/worker-reader-readback.ts";

/** The job's repositories with the whole worker-result log made unreadable: a publisher reads only its own job's results. */
function withoutWholeResultLog<R extends { workerResults: object }>(repos: R): R {
  const whole = async (): Promise<never> => { throw new Error("the whole worker-result log was read"); };
  return { ...repos, workerResults: { ...repos.workerResults, readAll: whole, readSince: whole } };
}

async function workerFixture(contractId: WorkerReaderContract | "registry-runtime-bindings", facts: Record<string, string | number> | Record<string, string | number>[] | ((prior: RegistryRuntimePrior, bodyId: string) => Record<string, string | number>[]), classOverride?: "CAMPAIGN_FINANCE_FILING" | "BUDGET_RESPONSIBILITY" | "BUDGET_AMENDMENT" | "PUBLIC_RECORD") {
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
    payload: { ...imported.payload, registry: { ...imported.payload.registry, divisions, bodies: [] }, statewideExecutives: [], officialCandidacies: { ...imported.payload.officialCandidacies, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} } }, { prior: imported });
  const correction = await processRegisteredManualCandidate(store, "registry-runtime-bindings", corrected, "2026-09-08T12:00:02.000Z", imported.versionId);
  assert.ok(correction.promoted, correction.candidate.failureDetail ?? "fixture correction held");
  }
  const prior = (await readRegistryRuntimePrior(store, "2026-09-08T12:01:00.000Z"))!;
  const directory = contractId === "registry-runtime-bindings";
  const body = prior.payload.registry.bodies.find(row => row.name && (!(directory || contractId === "official-filings" || contractId === "public-records" || contractId === "government-budgets" || contractId === "ballot-contests" || contractId === "voting-sites") || prior.payload.registry.divisions.some(d => d.ocdId === row.ocdId &&
    (!["official-filings", "ballot-contests"].includes(contractId) || prior.payload.registry.divisions.filter(other => other.state === d.state && other.label.toLowerCase() === d.label.toLowerCase()).length === 1))))!;
  const publisherDivisionId = body.ocdId;
  const division = prior.payload.registry.divisions.find(row => row.ocdId === publisherDivisionId)!;
  const recordClass = classOverride ?? (directory ? "OFFICIAL_BOARD_DIRECTORY" : WORKER_READER_CLASSES[contractId]);
  const supplied = typeof facts === "function" ? facts(prior, body.id) : facts;
  const rows: Record<string, string | number>[] = (Array.isArray(supplied) ? supplied : [supplied]).map(fact => ({ bodyName: body.name!, ...(["official-filings","ballot-contests"].includes(contractId) ? { jurisdictionName: division.label } : {}), ...(directory ? {
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
    contract: { ...plan.contract, ...(["official-filings","ballot-contests"].includes(contractId) ? { jurisdiction: { country: "US", state: division.state, canonicalId: contractId === "ballot-contests" ? body.ocdId : plan.contract.subjectId } } : {}), schemaVersion: 2, recordClass, identity: { namespace: contractId, keyFields: contractId === "ballot-contests" ? ["candidateName"] : ["bodyName"] },
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
    extraction: { ...extraction, rowsPointer: "/records" }, comparison: { kind: "RECORD_VALUES" as const, keyFields: contractId === "ballot-contests" ? ["candidateName"] : ["bodyName"], fields: Object.keys(fields) } }] } } };
  await h.repos.workItems.compareAndSet(item.id, item.revision, { ...item.value, autonomousPlan: ready }, h.now());
  const authorityEvidence = evidenceProjection(await h.runtime.readEvidence(artifact.id));
  const runtime = { ...h.runtime, independentContext: async (scope: Parameters<typeof h.runtime.independentContext>[0]) => ({
    ...await h.runtime.independentContext(scope), authorityEvidence: [authorityEvidence] }) };
  // The Validator is the last stage for facts that are not judgment calls.
  for (const role of ["ACQUIRER", "PARSER", "VALIDATOR"]) {
    const next = await nextAutonomousOperation(runtime, h.item.id);
    assert.equal(next.task?.workerTask?.role, role, JSON.stringify(next));
    const dispatched = await dispatchWorkerTask(runtime, next.task!);
    assert.equal(dispatched.outcome, "WORKED", JSON.stringify(dispatched));
  }
  const results = await h.repos.workerResults.read(h.item.id);
  assert.deepEqual(results.map(row => row.result.verdict), ["ACQUIRED", "EXTRACTED", "PASS"]);
  assert.equal((await nextAutonomousOperation(runtime, h.item.id)).action, "STAGED", "no auditor is dispatched");
  const queued = workerPublicationTasks([(await h.repos.workItems.mustRead(h.item.id)).value], results, h.now());
  assert.equal(queued.length, 1);
  if (contractId === "voting-sites") assert.deepEqual(queued[0].command.slice(0, 2), ["scripts/fetch-voting-sites.mts", "--promote"], "the existing voting command handles worker results before legacy acquisition");
  else if (!directory) assert.ok(queued[0].command.includes(`--contract=${contractId}`));
  assert.ok(queued[0].command.some(arg => arg === `--${directory ? "worker-directories" : "worker-results"}=${h.item.id}`));
  const input = { repos: h.repos, store, facts: await factDb(), contractId: contractId as WorkerReaderContract, workItemIds: [h.item.id], now: h.now(),
    readCapture: async (id: string) => { const evidence = evidenceProjection(await runtime.readEvidence(id));
      return { evidence, observedAt: evidence.retrievedAt, httpStatus: 200, transport: "REACHABLE", partial: false }; } };
  return { input, h, store, body, rows, results, artifact, ready, prior, runtime };
}

test("verified directory bodies publish through the normal registry door and create durable scope-bound work without manual admission", async () => {
  const f = await workerFixture("registry-runtime-bindings", [
    { bodyName: "Fixture Advisory Commission", bodyClass: "ADVISORY", homepageUrl: "https://directory.example.gov/commission" },
    { bodyName: "Fixture Partial District Board", bodyClass: "GOVERNING", homepageUrl: "https://directory.example.gov/partial", coverage: "part of this jurisdiction" },
  ]);
  const published = await publishWorkerDirectoryResults(f.input);
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
  assert.deepEqual(await publishWorkerDirectoryResults(f.input), published, "durable publication prevents duplicate bodies or child work");
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
  const published = await publishWorkerDirectoryResults(f.input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  const read = (await readRegistryRuntimePrior(f.store, f.h.now()))!;
  const bodies = read.payload.registry.bodies.filter(row => row.name === "Fixture Joint Services Commission");
  assert.equal(bodies.length, 1);
  assert.deepEqual([bodies[0].ocdId, ...(bodies[0].alsoServesOcdIds ?? [])].sort(), expected);
  assert.ok(!expected.includes(f.body.ocdId!), "finding a body under a government does not assign that government's whole territory");
  assert.equal((await f.h.repos.workItems.list()).length, 4, "one body has one set of downstream work, not one copy per division");
  assert.deepEqual(await publishWorkerDirectoryResults(f.input), published);
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
    const html = await renderCardWithSources({ modulePath: "./components/ballot/official-filings.tsx", exportName: "OfficialFilings", props: { rows }, sourceUrls: rows.flatMap(row => [row.documentUrl, row.sourceUrl]) });
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

test("a reader publication reads its own work items' results and its pages' owners', never the whole result log", async () => {
  const f = await workerFixture("public-records", { title: "2026 watershed notice", kindLabel: "watershed notice",
    sourceSentence: "The 2026 watershed notice is a watershed notice." });
  const keysRead: string[] = [];
  const handed: string[][] = [];
  const whole = async (): Promise<never> => { throw new Error("the whole worker-result log was read"); };
  const repos = { ...f.h.repos, workerResults: { ...f.h.repos.workerResults, readAll: whole, readSince: whole,
    readKeys: async (keys: readonly string[]) => { keysRead.push(...keys); return f.h.repos.workerResults.readKeys!(keys); } } };
  const published = await publishWorkerReaderResults({ ...f.input, repos,
    readCapture: async (id, results) => { handed.push(results.map(row => `${row.workItemId}:${row.result.role}`)); return f.input.readCapture(id); } });
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  assert.deepEqual([...new Set(keysRead)], [f.h.item.id], "only this item's results, read once");
  assert.ok(handed.length > 0 && handed.every(rows => rows.includes(`${f.h.item.id}:ACQUIRER`)),
    "each saved page is read with the results of the item that captured it");
});

test("an unfamiliar source-worded kind publishes automatically to its exact place and adds one durable Admin update", async () => {
  const f = await workerFixture("public-records", { title: "2026 watershed notice", kindLabel: "watershed notice",
    sourceSentence: "The 2026 watershed notice is a watershed notice." });
  const published = await publishWorkerReaderResults(f.input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  const read = await readPublicRecords(f.body.ocdId!, { store: f.store, now: f.h.now(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("Public record missing");
  assert.equal(read.value.records[0].kindLabel, "watershed notice");
  assert.equal((await readPublicRecords("ocd-division/country:us/state:oh/county:alder", { store: f.store, now: f.h.now() })).kind, "NOT_RECORDED");
  assert.equal((await takeUnshownUpdates(f.h.repos, f.h.now())).filter(row => row.what === "New kind found: watershed notice").length, 1);
  const owed = await readPublicKindOwed(f.h.repos, [f.body.ocdId!]);
  assert.equal(owed.length, 1);
  assert.equal(owed[0].kindLabel, "watershed notice");
  assert.equal(owed[0].owedSince, f.input.now);
  assert.equal(owed[0].sourceUrl, read.value.records[0].sourceUrl);
  assert.deepEqual(await readPublicKindOwed(f.h.repos, ["ocd-division/country:us/state:oh/county:alder"]), []);
  await publishWorkerReaderResults({ ...f.input, now: "2026-10-06T00:00:00Z" });
  assert.deepEqual(await readPublicKindOwed(f.h.repos, [f.body.ocdId!]), owed);
  assert.equal((await takeUnshownUpdates(f.h.repos, f.h.now())).length, 0);
});

test("an adopted budget publishes from saved official document bytes; a proposal cannot replace it", async () => {
  const facts = { title: "Operating budget", fiscalYear: "FY2027", version: "adopted-v1", fiscalStart: "2026-07-01", fiscalEnd: "2027-06-30",
    documentUrl: FIXTURE_URL, sourceSentence: "The adopted Operating budget for FY2027 is version adopted-v1." };
  const f = await workerFixture("government-budgets", facts);
  const published = await publishWorkerReaderResults(f.input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  const read = await readGovernmentBudgets(f.body.ocdId!, { store: f.store, now: f.h.now(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("Budget missing");
  const money = governmentMoneyView(read.value.records, f.body.id, f.body.ocdId!);
  assert.equal(money.rows[0].period, "FY2027");
  assert.equal(money.rows[0].text, facts.sourceSentence);
  assert.equal(money.sources[0].provenance.sourceUrl, FIXTURE_URL);
  assert.equal(governmentMoneyView(read.value.records, "other-body", f.body.ocdId!).rows.length, 0);
  const evidence = await governmentFinanceEvidence(f.body.id, f.body.ocdId!, { store: f.store, now: f.h.now(), bypassCache: true });
  const answer = composeGovernmentFinanceAnswer({subject:{kind:"BODY",id:f.body.id,name:f.body.name!},question:"What is this government's budget?",records:evidence});
  assert.equal(answer?.answer, facts.sourceSentence);
  const scope = scopedManualContractScope("government-budgets", f.body.ocdId!);
  const edge = promotedEdgeEntryOf(await readGovernmentBudgets(f.body.ocdId!, {store:f.store,now:f.h.now()}), "CURATED_READER_RECORD", scope, f.store);
  assert.ok(edge);
  await withReaderAuthorityEdge({registryRuntime:{value:{...f.prior.payload,bodyRosters:[],rosterReaderDispositions:[]},versionId:f.prior.versionId},promoted:new Map([[`CURATED_READER_RECORD:${scope}`,edge]]),edgeOnly:true},async () => {
    assert.deepEqual(await governmentFinanceEvidence(f.body.id, f.body.ocdId!), evidence);
    const { GET } = await import("@/app/api/government-finance/route");
    const api = await GET(new Request(`https://wtp.test/api/government-finance?division=${encodeURIComponent(f.body.ocdId!)}&body=${encodeURIComponent(f.body.id)}`));
    assert.equal(api.status, 200);
    assert.equal((await api.json()).records[0].sourceSentence, facts.sourceSentence);
    const { POST } = await import("@/app/api/ask/grounded/route");
    const response = await POST(new Request("https://wtp.test/api/ask/grounded", {method:"POST", headers:{"content-type":"application/json",origin:"https://wtp.test",host:"wtp.test","x-wtp-synthetic-run":"ballot-government-budget"},
      body:JSON.stringify({question:"What is this government's budget?",today:"2026-10-05",ocdIds:[f.body.ocdId!],activeSubjects:[{id:f.body.id,kind:"BODY",name:f.body.name,focused:true}]})}));
    const result = await response.json();
    assert.equal(response.status,200,JSON.stringify(result));
    assert.equal(result.subject?.id,f.body.id,JSON.stringify(result));
    assert.ok(result.records.some((row:{kind:string;text:string})=>row.kind==="GOVERNMENT_FINANCE" && row.text===facts.sourceSentence),JSON.stringify(result));
    assert.equal(result.answer,facts.sourceSentence,JSON.stringify(result));
  });
  await withReaderAuthorityEdge({promoted:new Map(),edgeOnly:true},async () => {
    assert.deepEqual(await governmentFinanceEvidence(f.body.id, f.body.ocdId!), []);
  });
  assert.deepEqual(answer?.citedUrls, [FIXTURE_URL]);
  assert.equal(composeGovernmentFinanceAnswer({subject:{kind:"BODY",id:"other-body",name:"Other"},question:"What is this government's budget?",records:evidence}), null);
  assert.equal(composeGovernmentFinanceAnswer({subject:{kind:"BODY",id:f.body.id,name:f.body.name!},question:"What is its debt?",records:evidence}), null);
  assert.equal(currentBudgetFacts(read.value.records, f.body.id, "2026-10-05").length, 1);
  assert.equal(currentBudgetFacts(read.value.records, f.body.id, "2028-10-05").length, 0);
  const proposal = await workerFixture("government-budgets", { ...facts, version: "proposal-v2", sourceSentence: "The proposed Operating budget for FY2027 is version proposal-v2." });
  const refused = await publishWorkerReaderResults({ ...proposal.input, store: f.store });
  assert.equal(refused[0].outcome.status, "HELD");
  const retained = await readGovernmentBudgets(f.body.ocdId!, { store: f.store, now: f.h.now(), bypassCache: true });
  assert.equal(retained.metadata.versionId, read.metadata.versionId);
});

test("source-worded legal budget roles and exact-version amendments fill the existing checklist", async () => {
  const f = await workerFixture("government-budgets", { title: "Operating budget", fiscalYear: "FY2027", version: "adopted-v1",
    fiscalStart: "2026-07-01", fiscalEnd: "2027-06-30", documentUrl: FIXTURE_URL,
    sourceSentence: "The adopted Operating budget for FY2027 is version adopted-v1." });
  assert.equal((await publishWorkerReaderResults(f.input))[0].outcome.status, "PUBLISHED");
  for (const role of ["prepares", "adopts", "administers", "oversees"]) {
    const legal = await workerFixture("government-budgets", { role, responsible: "The governing officer", authorityKind: "Municipal code",
      sourceSentence: `The governing officer ${role} the budget under the municipal code.` }, "BUDGET_RESPONSIBILITY");
    const result = await publishWorkerReaderResults({ ...legal.input, store: f.store });
    assert.equal(result[0].outcome.status, "PUBLISHED", JSON.stringify(result));
  }
  for (const budgetVersion of ["adopted-v1", "older-v0"]) {
    const amendment = await workerFixture("government-budgets", { title: "Library amendment", fiscalYear: "FY2027", budgetVersion,
      documentUrl: FIXTURE_URL, sourceSentence: `The Library amendment for FY2027 amends budget version ${budgetVersion}.` }, "BUDGET_AMENDMENT");
    const result = await publishWorkerReaderResults({ ...amendment.input, store: f.store });
    assert.equal(result[0].outcome.status, "PUBLISHED", JSON.stringify(result));
  }
  const read = await readGovernmentBudgets(f.body.ocdId!, { store: f.store, now: f.h.now(), bypassCache: true });
  if (read.kind !== "PROMOTED") throw new Error("Budget missing");
  const facts = budgetChecklistEvidence(read.value.records, f.body.id, "2026-10-05");
  assert.equal(facts["FIN-04"].length, 4);
  assert.equal(facts["FIN-05"].length, 1);
  assert.equal(facts["FIN-05"][0].budgetVersion, "adopted-v1");
  assert.equal(budgetChecklistEvidence(read.value.records, f.body.id, "2028-10-05")["FIN-03"].length, 0);
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
  const { input, h, store, results, artifact, ready, prior } = await workerFixture("ballot-navigation", { state: "NH", kind: "REGISTRATION_LINK", url: FIXTURE_URL,
    coverage: "STATEWIDE", coverageEvidence: "The election authority identifies this lookup as serving the entire state." });
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
  const live = await readCuratedReaderProjection("ballot-navigation", { store, now: h.now(), bypassCache: true });
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
  const html = await renderCardWithSources({ modulePath: "./components/ballot/official-filings.tsx", exportName: "OfficialFilings", props: { rows }, sourceUrls: rows.flatMap(row => [row.documentUrl, row.sourceUrl]) });
  assert.ok(html.includes(FIXTURE_URL) && html.includes("Fixture Committee"));
  assert.doesNotMatch(html, /Reported receipts|Reported expenditures|Reported cash/);
});

test("local government finance runs through the existing worker publisher and scoped budget reader", async () => {
  const f = await workerFixture("government-budgets", { title: "General revenue", kindLabel: "Revenue",
    sourceSentence: "General revenue is reported for the General fund.", amount: 1234.56,
    units: "dollars", fiscalPeriod: "FY2027", fundScope: "General fund" }, "PUBLIC_RECORD");
  const published = await publishWorkerReaderResults(f.input);
  assert.equal(published[0].outcome.status, "PUBLISHED", JSON.stringify(published));
  const read = await readGovernmentBudgets(f.body.ocdId!, { store: f.store, now: f.h.now(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("Finance missing");
  const fact = read.value.records.find(row => row.kind === "GOVERNMENT_FINANCE");
  assert.equal(fact?.kind, "GOVERNMENT_FINANCE");
  if (fact?.kind !== "GOVERNMENT_FINANCE") throw new Error("Finance missing");
  assert.deepEqual([fact.category, fact.details.amount, fact.details.units], ["REVENUE", 1234.56, "dollars"]);
  assert.equal(fact.sourceUrl, FIXTURE_URL);
  assert.equal(budgetChecklistEvidence(read.value.records, f.body.id, "2026-10-05")["FIN-03"].length, 0,
    "a revenue record cannot claim an adopted budget");
});


test("completed polling workers publish every registered site through the existing task dispatch and retain their exact work outcome", async () => {
  const f = await workerFixture("voting-sites", (prior, bodyId) => {
    const body = prior.payload.registry.bodies.find(row => row.id === bodyId)!;
    const publishingDivisionId = body.ocdId;
    const division = prior.payload.registry.divisions.find(row => row.ocdId === publishingDivisionId)!;
    return [{ jurisdictionName: division.label, model: "Vote centers", name: "Public Library", address: "1 Public Road", kind: "Election day" }];
  });
  const doorId = "fixture:registered-polling", item = await f.h.repos.workItems.mustRead(f.h.item.id);
  const contract = item.value.autonomousPlan!.contract;
  if (contract.schemaVersion !== 2) throw new Error("fixture contract");
  const draft = checkDoorDraft({ doorId, kind: "polling-places-json", ocdId: f.body.ocdId,
    hosts: [new URL(FIXTURE_URL).hostname], config: { extraction: JSON.stringify(contract.extraction) } });
  assert.ok(draft.ok);
  const door = applyManualEdit(null, draft.value, f.h.now());
  await f.h.repos.doors.put(doorId, door, f.h.now());
  await f.h.repos.workItems.compareAndSet(item.id, item.revision, { ...item.value,
    autonomousPlan: { ...item.value.autonomousPlan!, sourceRegistryReferences: [...item.value.autonomousPlan!.sourceRegistryReferences, doorId] } }, f.h.now());
  const report = await publishWorkerReaderResults({ ...f.input, repos: withoutWholeResultLog(f.h.repos) });
  assert.equal(report.length, 1); assert.equal(report[0].outcome.status, "PUBLISHED", report[0].outcome.detail);
  const read = await readVotingSitesProjection({ store: f.store, now: f.h.now(), bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    const sites = read.value.jurisdictions.find(j => j.ocdId === f.body.ocdId)!.sites;
    assert.equal(sites.length, 1); assert.equal(sites[0].name, "Public Library");
    assert.equal(sites[0].lat, null); assert.equal(sites[0].serves, null);
  }
  assert.deepEqual((await f.h.repos.workItems.mustRead(item.id)).value.publicationOutcome, report[0].outcome);
});


test("normal complete candidate workers publish their whole contest into general readers and the candidate work inventory",async()=>{
  const facts=["Avery Example","Jordan Sample"].map(candidateName=>({election:"2026 General election",electionDate:"2026-11-03",office:"County Council",candidateName,givenName:candidateName.split(" ")[0],familyName:candidateName.split(" ")[1]}));
  const f=await workerFixture("ballot-contests",facts);
  const published=await publishWorkerReaderResults({...f.input,repos:withoutWholeResultLog(f.h.repos)});
  assert.equal(published[0].outcome.status,"PUBLISHED",JSON.stringify(published));
  const read=await readGenericBallotProjection({store:f.store,now:f.h.now(),bypassCache:true});
  assert.equal(read.kind,"PROMOTED");if(read.kind!=="PROMOTED")throw new Error("General ballot missing");
  const ballot=Object.values(read.value.ballots)[0];
  assert.equal(ballot.candidacies.length,2);
  assert.equal(ballot.contests.length,1);
  const sources=await readerBallotSourcesForDivisions([f.body.ocdId!],{store:f.store,now:f.h.now()});
  const general=sources.find(row=>row.source.name.startsWith("ballot-contests:"));
  assert.ok(general);
  assert.equal(general.source.normalize(await general.source.fetch()).candidacies.length,2);
  const curatedAt=f.h.now();
  const inventory=candidateEnrichmentUniversesFromHoldings({az:null,nh:null,nj:null,general:read.value,profiles:{cards:{curatedAt,note:"Offline empty enrichment",cards:{},hunts:[]},links:{curatedAt,note:"Offline empty enrichment",links:{},hunts:[]}},corpus:{formatVersion:1,fetchedAt:curatedAt,attempted:0,documents:[],failures:[]},failures:[]},f.h.now());
  const universe=inventory.universes[ballot.election.state.toLowerCase()];
  assert.equal(universe?.candidacies.length,2);
  assert.deepEqual(new Set(universe!.candidacies.flatMap(row=>row.pilotIds)),new Set(ballot.candidacies.map(row=>row.id)));
});


test("publication jobs reuse supplied repositories and return independent receipts without changing the parent's exit status", async () => {
  const f = await workerFixture("ballot-navigation", { state: "NH", kind: "REGISTRATION_LINK", url: FIXTURE_URL,
    coverage: "STATEWIDE", coverageEvidence: "The election authority identifies this lookup as serving the entire state." });
  const exitCode = process.exitCode;
  const context = { repos: f.input.repos, readCapture: f.input.readCapture };
  const job = { ...f.input, context };
  const published = await runWorkerPublicationJob(job);
  assert.equal(published.exitCode, 0, JSON.stringify(published.report));
  assert.ok(published.receipt?.promotedVersion);
  assert.ok(published.receipt.delivered.records > 0);
  assert.equal(published.report[0].outcome.status, "PUBLISHED");
  assert.equal(process.exitCode, exitCode);
  // An empty concurrent job cannot poison another job's process exit code.
  const empty = await runWorkerPublicationJob({ ...job, workItemIds: [] });
  assert.deepEqual([empty.exitCode, empty.receipt], [2, null]);
  assert.equal(process.exitCode, exitCode);
  const reused = await runWorkerPublicationJob({ ...job, now: "2026-09-08T12:05:00.000Z" });
  assert.equal(reused.exitCode, 0);
  assert.equal(reused.receipt?.delivered.records, 0);
  await assert.rejects(runWorkerPublicationJob({ ...job, repos: { ...job.repos } }), /REPOSITORY_MISMATCH/);
});

test("registry publication job uses the same saved directory evidence and typed receipt", async () => {
  const f = await workerFixture("registry-runtime-bindings", { bodyName: "Fixture Shared Job Commission", bodyClass: "ADVISORY", homepageUrl: "https://directory.example.gov/shared" });
  const result = await runWorkerPublicationJob({ ...f.input, contractId: "registry-runtime-bindings",
    context: { repos: f.input.repos, readCapture: f.input.readCapture } });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report));
  assert.equal(result.receipt?.source, "registry-runtime-bindings");
  assert.ok(result.receipt?.delivered.records);
  const read = await readRegistryRuntimePrior(f.store, f.h.now());
  assert.ok(read?.payload.registry.bodies.some(body => body.name === "Fixture Shared Job Commission"));
});
