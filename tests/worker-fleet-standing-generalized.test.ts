import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, type TestContext } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { defaultGrant } from "../lib/control-plane/capability.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import { AUDIT_CONTEXT_MAX_BYTES, auditReasoningContext, modelAuditReasoner } from "../lib/control-plane/workers/model-audit.ts";
import { advanceHeldWorkerFleet, standingFleetRuntime } from "../lib/control-plane/workers/standing.ts";
import type { GeneralizedCivicExtractionContract, IndependentAuditContext, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import { dispatchWorkerTask, enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import { readCompletedWorkerResult } from "../lib/control-plane/repository/worker-completion.ts";
import { fingerprint } from "../lib/control-plane/ids.ts";
import { encodeVerifiedReplay } from "../lib/sources/verified-replay.ts";
import { playbookRows } from "./helpers/playbooks.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import {
  installOperationalReferenceBundle,
  operationalReferenceBundle,
} from "../lib/civic-data/operational-references.ts";
import { methodFixture } from "./method-store-fixture.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { installPromotedValue } from "./helpers/promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { rosterFactReader } from "./helpers/roster-fact-reader.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import { PUBLISHED_ARRAY_SLICE_SQL } from "../lib/civic-data/published-array-slice.ts";


function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

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

async function installRegistryRuntime(states?: readonly string[]): Promise<{ readonly value: RegistryRuntimeReadModel; readonly versionId: string }> {
  const { projection } = registryTransferImport();
  const selected = states ?? [...new Set(projection.payload.registry.divisions.flatMap(row => registryJurisdictions(row.ocdId)))];
  for (const state of selected) installPromotedValue({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state),
    sourceId: projection.sourceId, versionId: `${projection.versionId}:${state}`, value: registryFixtureForState(state) });
  installFactReader(rosterFactReader(projection.payload.bodyRosters));
  const value = served(await readRegistryRuntimeProjection(selected), "Registry runtime");
  return { value, versionId: selected.map(state => `${projection.versionId}:${state}`).join("|") };
}



const ROOT = fileURLToPath(new URL("../", import.meta.url));
const METHOD = methodFixture();
installOperationalReferenceBundle(operationalReferenceBundle(
  JSON.parse(readFileSync(path.join(ROOT, "tests/fixtures/jurisdiction-registries.json"), "utf8")),
));
const installedRegistry = await installRegistryRuntime(["AZ"]);
const registryDatabase = new PGlite();
await registryDatabase.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
await insertPublishedSliceFixture(registryDatabase, { id: "generalized-registry-az", sourceId: "registry-runtime", recordClass: "REGISTRY_RUNTIME_BINDING",
  scope: stateRegistryRuntimeScope("AZ"), readModel: installedRegistry.value, at: "2026-09-03T03:00:00.000Z" });
installReaderDatabaseQuery(async statements => {
  const results: Record<string, unknown>[][] = [];
  for (const statement of statements) {
    assert.equal(statement.text, PUBLISHED_ARRAY_SLICE_SQL);
    assert.equal(statement.params[0], "REGISTRY_RUNTIME_BINDING");
    assert.equal(statement.params[1], stateRegistryRuntimeScope("AZ"));
    assert.deepEqual(statement.params[2], ["registry", "bodies"]);
    assert.equal(statement.params[4], "^(?:curated:az/corona-de-tucson-fire-district#governing)$");
    results.push((await registryDatabase.query<Record<string, unknown>>(statement.text, [...statement.params])).rows);
  }
  return results;
});
after(async () => { installReaderDatabaseQuery(undefined); await registryDatabase.close(); });
const SUBJECT = "curated:az/corona-de-tucson-fire-district#governing";
const START = "2026-09-03T04:00:00.000Z";
const PRIMARY = "https://www.coronafire.org/sitemap.xml";
const OTHER_HOST = "https://records.example.gov/archive";

function contract(observationArtifactIds: readonly string[]): GeneralizedCivicExtractionContract {
  return { schemaVersion: 2, recordClass: "DOCUMENT_INDEX", subjectId: SUBJECT,
    jurisdiction: { country: "us", state: "az", canonicalId: SUBJECT }, identity: { namespace: "publisher-page", keyFields: ["url"] },
    sourceScope: { sourceId: "www.coronafire.org", routeIds: ["held-source"], publisher: "Corona de Tucson Fire District", canonicalUrls: [PRIMARY], observationArtifactIds },
    methodVersion: METHOD.version, requiredFields: ["url"], completenessScope: "All URL rows in the recorded sitemap, not all civic records.", expectedSourceDate: null,
    extraction: { format: "XML_RECORDS", rowTag: "url", fields: { url: { source: "loc", type: "STRING" } } }, verification: { required: true, authorities: [] } };
}

function plan(value: GeneralizedCivicExtractionContract): AutonomousWorkPlan {
  return { version: 1, contract: value, capability: "meetings", jurisdiction: "AZ", sourceRegistryReferences: ["lib/registry/registry.json"],
    seedUrls: [], sources: [], acquisition: [], auditScope: "CAPTURED_ARTIFACT" };
}

async function harness(t: TestContext, subject = SUBJECT) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "worker-generalized-standing-"));
  assert.equal(path.dirname(path.resolve(vaultRoot)), path.resolve(tmpdir()));
  t.after(() => rm(vaultRoot, { recursive: true, force: true }));
  const store = new DurableEvidenceStore(vaultRoot); const repos = createMemoryRepositories();
  let ordinal = 0; const now = () => new Date(Date.parse(START) + ++ordinal * 1000).toISOString();
  const item = createWorkItem({ project: "freshness", subject, obligation: "Generalized standing source controls", why: "Recorded control; no live source calls.", now: now() });
  await registerWorkItem(repos, item, now());
  async function hold(text: string, canonicalUrl: string, owner = item): Promise<ArtifactRecord> {
    const at = now(); const task = createRouteTask({ workItemId: owner.id, routeId: "held-source", routeLabel: "Recorded control", target: canonicalUrl, inherited: false, now: at });
    await registerRouteTask(repos, task, at);
    const holder = `recorded-control-${ordinal}`;
    const lease = await claimRouteTask(repos, { routeTaskId: task.id, holder, now: at, ttlMs: 60000 });
    const attempt = await beginAttemptFor(repos, { routeTaskId: task.id, workItemId: owner.id,
      worker: { role: "ACQUIRER", provider: "fixture", version: "fixture/1", instance: holder }, lease: lease.lease.value, now: at, methodVersion: METHOD.version, policyVersion: "fixture/1" });
    const { artifact } = recordAcquisition({ canonicalUrl, retrievedAt: at, httpStatus: 200, contentType: canonicalUrl.endsWith(".xml") ? "application/xml" : "text/html",
      sourceId: new URL(canonicalUrl).hostname, methodRouteId: "held-source", workItemId: owner.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, text);
    await putArtifact(store, "freshness", artifact, Buffer.from(text));
    const record: ArtifactRecord = { artifactId: artifact.id, workItemId: owner.id, routeTaskId: task.id, attemptId: attempt.id,
      tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl, partial: false, recordedAt: at };
    await recordArtifactMetadata(repos, record, at);
    await disposeRouteTask(repos, { routeTaskId: task.id, attemptId: attempt.id, expectedTaskRevision: (await repos.routeTasks.mustRead(task.id)).revision,
      artifactIds: [artifact.id], now: at, disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
        permission: "ALLOWED", transport: "REACHABLE", note: "Synthetic recorded control; no live retrieval." } });
    return record;
  }
  async function setPlan(owner: WorkItem, value: GeneralizedCivicExtractionContract) {
    const held = await repos.workItems.mustRead(owner.id);
    return (await repos.workItems.compareAndSet(owner.id, held.revision, { ...held.value, autonomousPlan: plan(value) }, now())).value;
  }
  const runtime = standingFleetRuntime({ root: ROOT, method: METHOD, vaultRoot, repos, now });
  t.after(() => runtime.close());
  return { repos, item, hold, setPlan, runtime, now };
}

async function largeOfficialTitle(t: TestContext) {
  const subject = "ocd-division/country:us/state:az/county:pima", url = "https://www.pima.gov/board-of-supervisors";
  const h = await harness(t, subject);
  const title = "<title>Board of Supervisors | Pima County, AZ</title>";
  const body = (revision: string) => {
    const prefix = title + '<script type="application/json">{"revision":"' + revision + '","padding":"';
    const suffix = '"}</script><p>Full immutable challenger witness outside the title projection.</p>';
    return prefix + "x".repeat(1_527_913 - Buffer.byteLength(prefix + suffix)) + suffix;
  };
  const observationOwner = createWorkItem({ project: "freshness", subject, obligation: "Saved official publisher observation", why: "Recorded distinct source observation", now: h.now() });
  await registerWorkItem(h.repos, observationOwner, h.now());
  const observation = await h.hold(body("old"), url, observationOwner), primary = await h.hold(body("new"), url);
  assert.notEqual(primary.contentHash, observation.contentHash);
  const value: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "OFFICIAL_BOARD_DIRECTORY", subjectId: subject,
    jurisdiction: { country: "US", state: "AZ", canonicalId: subject }, identity: { namespace: `${subject}:official-title`, keyFields: ["bodyName"] },
    sourceScope: { sourceId: "www.pima.gov", routeIds: ["held-source"], publisher: "Pima County government", canonicalUrls: [url], observationArtifactIds: [observation.artifactId] },
    methodVersion: METHOD.version, requiredFields: ["bodyName"], completenessScope: "Only the body name explicitly written in the captured official title; no complete membership claim.",
    expectedSourceDate: null, extraction: { format: "TEXT_BLOCKS", recordStart: "<title>", recordEnd: " | Pima County, AZ</title>", fields: { bodyName: { source: "<title>", type: "STRING" } } },
    verification: { required: false, authorities: [] } };
  await h.setPlan(h.item, value);
  return { ...h, primary, observation, value };
}

test("large distinct official captures retain verified replay references and ground challenges against the full original body", async t => {
  const h = await largeOfficialTitle(t);
  const context = await h.runtime.independentContext({ workItemId: h.item.id, artifactId: h.primary.artifactId, contract: h.value, auditScope: "CAPTURED_ARTIFACT", methodVersion: METHOD.version });
  assert.deepEqual(new Set(context.evidence.map(e => e.artifactId)), new Set([h.primary.artifactId, h.observation.artifactId]));
  assert.ok(context.evidence.every(e => typeof Object.getOwnPropertyDescriptor(e, "text")?.get === "function"));
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /x{1024}/, "raw source bodies are not embedded in the serialized context");
  for (const evidence of context.evidence) {
    const reference = JSON.parse(JSON.stringify(evidence));
    assert.equal(Object.hasOwn(reference, "text"), false);
    assert.equal(reference.__sourceReplay.text.ref.sha256, evidence.contentHash.replace(/^sha256-/, ""));
    assert.equal(reference.__sourceReplay.text.ref.byteLength, 1_527_913);
  }
  t.diagnostic(JSON.stringify({ retainedBytes: Buffer.byteLength(serialized), routeMetadataBytes: Buffer.byteLength(JSON.stringify(context.routes)),
    evidenceReferenceBytes: Buffer.byteLength(JSON.stringify(context.evidence)), rawSourceBytes: 3_055_826 }));
  const reasoning = auditReasoningContext(context);
  assert.ok(Buffer.byteLength(reasoning) <= AUDIT_CONTEXT_MAX_BYTES);
  assert.match(reasoning, /Board of Supervisors/);
  assert.doesNotMatch(reasoning, /Full immutable challenger witness/);
  for (const row of playbookRows) await h.repos.fieldManual.put(row.id, row, h.now());
  const challenge = { code: "EXACT_HELD_WITNESS", detail: "Exercise full-source grounding outside the model field projection", artifactId: h.primary.artifactId,
    quote: "Full immutable challenger witness outside the title projection." };
  const reasoner = modelAuditReasoner(h.repos, async request => ({ model: request.model, stop_reason: "tool_use", usage: {},
    content: [{ type: "tool_use", id: "recorded-response", name: "record_audit", input: { verdict: "BROKE", challenges: [challenge] } }] }), h.now, { ceilingUsd: 10 });
  const review = await reasoner.review(context, "recorded-auditor-no-provider");
  assert.equal(review.review.validationError, null);
  assert.deepEqual(review.review.challenges, [challenge]);
  const wire = encodeVerifiedReplay(context.evidence[0]) as unknown as { __sourceReplay: { text: { ref: { path: string } } } };
  writeFileSync(wire.__sourceReplay.text.ref.path, "changed capture");
  assert.throws(() => context.evidence[0].text, /SOURCE_REPLAY_INTEGRITY_MISMATCH/);
  await assert.rejects(reasoner.review(context, "recorded-tampered-no-provider"), /SOURCE_REPLAY_INTEGRITY_MISMATCH/);
  await h.runtime.close();
  assert.throws(() => context.evidence[1].text, /ENOENT/, "preflight-only contexts are released by the normal runtime close");
});

test("native isolated audit completes over large captures and releases replay files after success and execution failure", async t => {
  const h = await largeOfficialTitle(t);
  const run = async (role: "PARSER" | "VALIDATOR" | "ADVERSARIAL_AUDITOR", producerResultId?: string, validatorResultId?: string) => {
    const task = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: h.primary.artifactId, role, contract: h.value, now: h.now(), producerResultId, validatorResultId });
    const outcome = await dispatchWorkerTask({ ...h.runtime, requireModelAudit: false }, task);
    assert.equal(outcome.outcome, "WORKED", outcome.detail);
    return (await readCompletedWorkerResult(h.repos, `wr-${fingerprint([outcome.attemptId!])}`)).record;
  };
  const parser = await run("PARSER"), validator = await run("VALIDATOR", parser.id);
  assert.equal(parser.result.verdict, "EXTRACTED");
  assert.equal(validator.result.verdict, "PASS");
  let heldContext: IndependentAuditContext | undefined;
  const runtime = { ...h.runtime, requireModelAudit: false, independentContext: async (...args: Parameters<typeof h.runtime.independentContext>) => {
    heldContext = await h.runtime.independentContext(...args); return heldContext;
  } };
  const auditTask = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: h.primary.artifactId, role: "ADVERSARIAL_AUDITOR", contract: h.value,
    producerResultId: parser.id, validatorResultId: validator.id, now: h.now() });
  const audited = await dispatchWorkerTask(runtime, auditTask);
  assert.equal(audited.outcome, "WORKED", audited.detail);
  const result = (await readCompletedWorkerResult(h.repos, `wr-${fingerprint([audited.attemptId!])}`)).record;
  assert.equal(result.result.verdict, "SURVIVED");
  assert.deepEqual(new Set(result.inputArtifactIds), new Set([h.primary.artifactId, h.observation.artifactId]));
  assert.ok(heldContext);
  assert.throws(() => heldContext!.evidence[0].text, /ENOENT/, "successful tasks release their replay files before returning the committed result");
  const badTask = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: h.primary.artifactId, role: "ADVERSARIAL_AUDITOR", contract: h.value,
    now: h.now(), purpose: "DIAGNOSTIC_REPLAY", replayLabel: "recorded-missing-producer" });
  const failed = await dispatchWorkerTask(runtime, badTask);
  assert.equal(failed.outcome, "FAILED");
  assert.match(failed.detail, /WORKER_PRODUCER_REFERENCE_MISSING/);
  assert.throws(() => heldContext!.evidence[0].text, /ENOENT/, "a native failure after independent context creation also releases the files");
  const providerFailure = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, artifactId: h.primary.artifactId, role: "ADVERSARIAL_AUDITOR", contract: h.value,
    producerResultId: parser.id, validatorResultId: validator.id, now: h.now(), purpose: "DIAGNOSTIC_REPLAY", replayLabel: "recorded-provider-failure" });
  for (const row of playbookRows) await h.repos.fieldManual.put(row.id, row, h.now());
  const failedReview = await dispatchWorkerTask({ ...runtime, modelAuditSample: async () => true,
    auditReasoner: modelAuditReasoner(h.repos, async () => { throw new Error("recorded transport failure; no provider invoked"); }, h.now, { ceilingUsd: 10 }) }, providerFailure);
  assert.equal(failedReview.outcome, "FAILED");
  assert.match(failedReview.detail, /AUDIT_PROVIDER_FAILURE/);
  assert.throws(() => heldContext!.evidence[0].text, /ENOENT/, "reasoner failures release the files before reading the producer");
});

test("generalized standing independently retains two subject publisher hosts and explicit authority while excluding other subjects", async t => {
  const h = await harness(t);
  const observation = await h.hold(`<a href="${OTHER_HOST}">District meeting archive</a>`, "https://www.coronafire.org/");
  const primary = await h.hold('<urlset><url><loc>https://www.coronafire.org/2026-09-01-board</loc></url></urlset>', PRIMARY);
  const alternateItem = createWorkItem({ project: "freshness", subject: SUBJECT, obligation: "Other publisher representation", why: "Same canonical subject, independent record shape", now: h.now() });
  await registerWorkItem(h.repos, alternateItem, h.now());
  const alternate = await h.hold("<p>September board meeting archive</p>", OTHER_HOST, alternateItem);
  const external = await h.hold('[{"id":"board","count":1}]', "https://county.example.gov/district-register");
  const value: GeneralizedCivicExtractionContract = { ...contract([observation.artifactId]), verification: { required: true, authorities: [{ id: "county-register", type: "GOVERNMENT_REGISTER",
    publisher: "County government", sourceId: "county.example.gov", canonicalUrls: [external.canonicalUrl], artifactIds: [external.artifactId], authorityEvidenceArtifactIds: [],
    independenceBasis: "DISTINCT_AUTHORITY", independenceExplanation: "Separate recorded county authority control.",
    extraction: { format: "JSON_RECORDS", rowsPointer: "", fields: { count: { source: "/count", type: "NUMBER" } } }, comparison: { kind: "COUNT", keyFields: [], fields: ["count"] } }] } };
  await h.setPlan(h.item, value);
  await h.setPlan(alternateItem, { ...contract([observation.artifactId]), sourceScope: { ...value.sourceScope, sourceId: "records.example.gov", canonicalUrls: [OTHER_HOST] } });
  const foreign = createWorkItem({ project: "freshness", subject: "az:city:city-of-glendale", obligation: "Foreign publisher evidence", why: "Matching host does not bind a different canonical subject", now: h.now() });
  await registerWorkItem(h.repos, foreign, h.now());
  const foreignArtifact = await h.hold("<p>Foreign record</p>", PRIMARY, foreign);
  const unrelated = await h.hold("<p>Park reservation</p>", "https://www.coronafire.org/parks");
  const context = await h.runtime.independentContext({ workItemId: h.item.id, artifactId: primary.artifactId, contract: value, auditScope: "CAPTURED_ARTIFACT", methodVersion: METHOD.version });
  assert.deepEqual(context.evidence.map(e => e.artifactId), [primary.artifactId]);
  // The method only grows (agents add routes), so a plan made under an earlier version is audited against today's floor; one from a later version is not.
  const planned = (methodVersion: number) => ({ ...value, methodVersion });
  const auditUnder = (contract: typeof value) => h.setPlan(h.item, contract).then(() => h.runtime.independentContext({ workItemId: h.item.id, artifactId: primary.artifactId, contract, auditScope: "CAPTURED_ARTIFACT", methodVersion: METHOD.version }));
  assert.deepEqual((await auditUnder(planned(METHOD.version - 1))).evidence.map(e => e.artifactId), [primary.artifactId]);
  await assert.rejects(auditUnder(planned(METHOD.version + 1)), /AUDIT_METHOD_VERSION_MISMATCH/);
  await h.setPlan(h.item, value);
  assert.ok(context.surfaceEvidence?.some(e => e.artifactId === alternate.artifactId));
  assert.deepEqual(context.authorityEvidence?.map(e => e.artifactId), [external.artifactId]);
  assert.ok(!context.routes.some(route => route.artifactIds.includes(foreignArtifact.artifactId) || route.artifactIds.includes(unrelated.artifactId)));
  assert.ok(context.publisherSurfaces.includes(OTHER_HOST));
  assert.ok(context.routes.some(route => route.routeId === "streamline-sitemap-is-a-dated-meeting-inventory"), "Current publisher-specific learned method must remain on the independent route floor.");
  const model = JSON.parse(auditReasoningContext(context));
  assert.equal(model.contract.schemaVersion, 2);
  assert.equal(model.contract.jurisdiction.canonicalId, SUBJECT);
  assert.match(model.evidence[0].sourceExcerpt, /2026-09-01-board/);
  assert.ok(model.authorityEvidence.some((e: { artifactId: string }) => e.artifactId === external.artifactId));
});

test("generalized scope refuses a plan mismatch, a missing publisher link, and a foreign-subject observation", async t => {
  const h = await harness(t);
  const observation = await h.hold(`<p>A remembered URL ${OTHER_HOST} is not a link.</p>`, "https://www.coronafire.org/");
  const foreignHost = await h.hold('<urlset><url><loc>https://records.example.gov/2026-09-01-board</loc></url></urlset>', OTHER_HOST);
  const value: GeneralizedCivicExtractionContract = { ...contract([observation.artifactId]), sourceScope: { ...contract([]).sourceScope, observationArtifactIds: [observation.artifactId], sourceId: "records.example.gov", canonicalUrls: [OTHER_HOST] } };
  await h.setPlan(h.item, value);
  await assert.rejects(h.runtime.independentContext({ workItemId: h.item.id, artifactId: foreignHost.artifactId, contract: value, auditScope: "CAPTURED_ARTIFACT", methodVersion: METHOD.version }), /AUDIT_FIRST_PARTY_PUBLISHER_BINDING_MISSING/);
  await assert.rejects(h.runtime.independentContext({ workItemId: h.item.id, artifactId: foreignHost.artifactId, contract: { ...value, completenessScope: "Invented expanded scope" }, auditScope: "CAPTURED_ARTIFACT", methodVersion: METHOD.version }), /AUDIT_CANONICAL_SCOPE_MISMATCH/);
  const foreign = createWorkItem({ project: "freshness", subject: "az:city:city-of-glendale", obligation: "Foreign observation", why: "Cross-subject control", now: h.now() });
  await registerWorkItem(h.repos, foreign, h.now());
  const foreignObservation = await h.hold(`<a href="${OTHER_HOST}">Linked record</a>`, "https://www.coronafire.org/", foreign);
  const changed = { ...value, sourceScope: { ...value.sourceScope, observationArtifactIds: [foreignObservation.artifactId] } };
  await h.setPlan(h.item, changed);
  await assert.rejects(h.runtime.independentContext({ workItemId: h.item.id, artifactId: foreignHost.artifactId, contract: changed, auditScope: "CAPTURED_ARTIFACT", methodVersion: METHOD.version }), /AUDIT_ARTIFACT_SUBJECT_MISMATCH/);
});

test("standing advancement needs a successful Hunter result, not merely same-host held bytes", async t => {
  const h = await harness(t);
  const observation = await h.hold("<p>District publisher</p>", "https://www.coronafire.org/");
  const primary = await h.hold('<urlset><url><loc>https://www.coronafire.org/2026-09-01-board</loc></url></urlset>', PRIMARY);
  await h.setPlan(h.item, contract([observation.artifactId]));
  await advanceHeldWorkerFleet(ROOT, h.runtime, 1);
  assert.ok(!(await h.repos.routeTasks.list()).some(row => row.value.workerTask));
  const closedAttempt = (await h.repos.attempts.mustRead(primary.attemptId)).value;
  const task = await h.repos.routeTasks.mustRead(primary.routeTaskId!);
  const record = { id: "wr-acquirer-control", schemaVersion: 1, workItemId: h.item.id, routeTaskId: task.id, attemptId: primary.attemptId,
    worker: closedAttempt.worker, grant: defaultGrant({ role: "ACQUIRER", project: "freshness", policyVersion: "fixture/1", grantedAt: START }),
    methodVersion: METHOD.version, policyVersion: "fixture/1", startedAt: START, endedAt: START, executionMode: "DETERMINISTIC", cost: ZERO_COST,
    usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, uncachedInputTokens: null }, inputArtifactIds: [observation.artifactId], inputResultIds: [], semanticHash: primary.contentHash,
    result: { role: "ACQUIRER", attemptId: primary.attemptId, verdict: "ACQUIRED", source: { subjectId: SUBJECT },
      artifacts: [{ artifactId: primary.artifactId, completeness: "COMPLETE", byteCount: primary.byteLength, contentHash: primary.contentHash, canonicalUrl: primary.canonicalUrl, acquisitionAttemptId: primary.attemptId }], artifactIds: [primary.artifactId] },
    completion: { closedAttempt, completedTask: task.value, taskRevision: task.revision, attemptRevision: (await h.repos.attempts.mustRead(primary.attemptId)).revision } } as unknown as WorkerResultRecord;
  await h.repos.workerResults.append(h.item.id, record.id, record, h.now());
  await advanceHeldWorkerFleet(ROOT, h.runtime, 1, true);
  assert.ok(!(await h.repos.routeTasks.list()).some(row => row.value.workerTask), "Legacy-only admission cannot enqueue generalized work.");
  await advanceHeldWorkerFleet(ROOT, h.runtime, 1);
  const queued = (await h.repos.routeTasks.list()).filter(row => row.value.workerTask);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].value.workerTask?.artifactId, primary.artifactId);
  assert.equal(queued[0].value.workerTask?.contract.schemaVersion, 2);
});
