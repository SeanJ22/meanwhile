import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
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
import { auditReasoningContext } from "../lib/control-plane/workers/model-audit.ts";
import { advanceHeldWorkerFleet, standingFleetRuntime } from "../lib/control-plane/workers/standing.ts";
import type { GeneralizedCivicExtractionContract, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
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
await installRegistryRuntime(["AZ"]);
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

async function harness(t: TestContext) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "worker-generalized-standing-"));
  assert.equal(path.dirname(path.resolve(vaultRoot)), path.resolve(tmpdir()));
  t.after(() => rm(vaultRoot, { recursive: true, force: true }));
  const store = new DurableEvidenceStore(vaultRoot); const repos = createMemoryRepositories();
  let ordinal = 0; const now = () => new Date(Date.parse(START) + ++ordinal * 1000).toISOString();
  const item = createWorkItem({ project: "freshness", subject: SUBJECT, obligation: "Generalized standing source controls", why: "Recorded control; no live source calls.", now: now() });
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
  const runtime = Object.assign(standingFleetRuntime({ root: ROOT, method: METHOD, vaultRoot, repos, now }), { diggerReads: {
    sourceChanges: async () => ({ through: now() }), pendingTaskIds: async () => [],
  } });
  return { repos, item, hold, setPlan, runtime, now };
}

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
