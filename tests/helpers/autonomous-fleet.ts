import { createWorkItem } from "../../lib/control-plane/work-item.ts";
import { createRouteTask } from "../../lib/control-plane/route-task.ts";
import { createMemoryRepositories } from "../../lib/control-plane/repository/memory.ts";
import { registerWorkItem, registerRouteTask, claimRouteTask, beginAttemptFor, recordArtifactMetadata, disposeRouteTask } from "../../lib/control-plane/repository/coordinator.ts";
import type { ControlPlaneRepositories } from "../../lib/control-plane/repository/types.ts";
import { recordAcquisition } from "../../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, putArtifact, readForParser, type EvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import { researchVaultResolver } from "../../lib/control-plane/workers/vault-object.ts";
import { researchRoleExecutor } from "../../lib/control-plane/workers/research-runtime.ts";
import { evidenceProjection, FLEET_POLICY_VERSION, type FleetRuntime } from "../../lib/control-plane/workers/runtime.ts";
import { registerAutonomousPlan } from "../../lib/control-plane/workers/coordinator.ts";
import type { AutonomousWorkPlan } from "../../lib/control-plane/workers/autonomous-plan.ts";
import type { GeneralizedCivicExtractionContract } from "../../lib/control-plane/workers/types.ts";

export const FIXTURE_NOW = "2026-09-03T18:00:00.000Z";
export const FIXTURE_PROJECT = "autonomous-fleet-controls";
export const FIXTURE_URL = "https://fixture-clerk.example.gov/records.json";
export const FIXTURE_BODY = '[{"id":"office:1","name":"Clerk"},{"id":"office:2","name":"Treasurer"}]';

export async function autonomousHarness(options: {
  repos?: ControlPlaneRepositories; store?: EvidenceStore; plan?: (plan: AutonomousWorkPlan) => AutonomousWorkPlan;
  response?: { text?: string; transportError?: string | null }; clock?: string;
} = {}) {
  const repos = options.repos ?? createMemoryRepositories(); const store = options.store ?? new MemoryEvidenceStore();
  let clock = Date.parse(options.clock ?? FIXTURE_NOW); const now = () => new Date(clock += 1000).toISOString();
  const registered = await repos.workItems.list();
  const item = registered[0]?.value ?? createWorkItem({ project: FIXTURE_PROJECT, subject: "fixture:nh:county", obligation: "Retain and independently check the official roster fixture", why: "Representative repeatable worker control, no live records or reader promotion.", contract: { requiresValidation: true, requiresAudit: true }, now: now() });
  if (!registered.length) {
    await registerWorkItem(repos, item, now());
    const seed = createRouteTask({ workItemId: item.id, routeId: "source-observation", routeLabel: "Recorded first-party fixture observation", target: "https://fixture-clerk.example.gov/", inherited: false, now: now() });
    await registerRouteTask(repos, seed, now()); const holder = "fixture-observer";
    const claim = await claimRouteTask(repos, { routeTaskId: seed.id, holder, now: now(), ttlMs: 60000 });
    const attempt = await beginAttemptFor(repos, { routeTaskId: seed.id, workItemId: item.id, lease: claim.lease.value, worker: { role: "SCOUT", provider: "recorded-fixture", version: "1", instance: holder }, methodVersion: 56, policyVersion: FLEET_POLICY_VERSION, now: now() });
    const text = `<p>Fixture county official roster</p><a href="${FIXTURE_URL}">Download the roster</a>`;
    const { artifact } = recordAcquisition({ canonicalUrl: seed.target, retrievedAt: now(), httpStatus: 200, contentType: "text/html", sourceId: "fixture-clerk.example.gov", methodRouteId: seed.routeId, workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, text);
    await putArtifact(store, FIXTURE_PROJECT, artifact, Buffer.from(text));
    await recordArtifactMetadata(repos, { artifactId: artifact.id, workItemId: item.id, routeTaskId: seed.id, attemptId: attempt.id, tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: artifact.retrievedAt }, now());
    const at = now(); await disposeRouteTask(repos, { routeTaskId: seed.id, attemptId: attempt.id, expectedTaskRevision: (await repos.routeTasks.mustRead(seed.id)).revision, artifactIds: [artifact.id], now: at,
      disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null, permission: "ALLOWED", transport: "REACHABLE", note: "Only fixture publisher observation was acquired; roster obligation remains owed." } });
    const span = { artifactId: artifact.id, contentHash: artifact.contentHash, start: 0, end: text.length, quote: text, offsetUnit: "UTF16_CODE_UNITS" as const };
    const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, subjectId: item.subject, recordClass: "OFFICIAL_ROSTER", jurisdiction: { country: "us", state: "nh", canonicalId: item.subject }, identity: { namespace: item.subject, keyFields: ["id"] },
      sourceScope: { sourceId: "fixture-clerk.example.gov", publisher: "Fixture county clerk", routeIds: ["official-roster", "scout:fetch_public"], canonicalUrls: [FIXTURE_URL], observationArtifactIds: [artifact.id] }, methodVersion: 56, requiredFields: ["id", "name"], completenessScope: "All mapped rows of the captured fixture; other official routes remain owed.", expectedSourceDate: null,
      extraction: { format: "JSON_RECORDS", rowsPointer: "", fields: { id: { source: "/id", type: "STRING" }, name: { source: "/name", type: "STRING" } } }, verification: { required: false, authorities: [] } };
    const plan: AutonomousWorkPlan = { version: 1, contract, capability: "officials/offices", jurisdiction: "NH", sourceRegistryReferences: ["fixture-only:shared-toolkit-control"], seedUrls: [artifact.canonicalUrl],
      sources: [{ id: "official-roster", subjectId: item.subject, jurisdiction: "NH", recordClass: "OFFICIAL_ROSTER", sourceId: "fixture-clerk.example.gov", publisher: "Fixture county clerk", url: FIXTURE_URL, observedLocator: FIXTURE_URL,
        observedAt: artifact.retrievedAt, firstObservedAt: artifact.retrievedAt, methodVersion: 56, permission: "ALLOWED", observation: span, publisherSubjectEvidence: [span], applicableBecause: "The held publisher fixture names this exact roster download.", nextRouteIds: [], retrieval: "fetch_public" }], acquisition: [], engineering: [], auditScope: "CAPTURED_ARTIFACT" };
    await registerAutonomousPlan(repos, item.id, options.plan ? options.plan(plan) : plan, now());
  }
  const calls: string[] = []; const readVault = researchVaultResolver(repos, store, FIXTURE_PROJECT);
  const runtime: FleetRuntime = { repos, methodVersion: 56, now,
    readEvidence: async id => { const held = await readVault(id); return (await readForParser(store, FIXTURE_PROJECT, held.artifact)).input; },
    independentContext: async scope => { const evidence = evidenceProjection(await runtime.readEvidence(scope.artifactId)); const contract = scope.contract as GeneralizedCivicExtractionContract;
      return { subjectId: contract.subjectId, contract, methodVersion: scope.methodVersion, publisherSurfaces: [FIXTURE_URL], routes: [{ routeId: evidence.methodRouteId, canonicalUrl: evidence.canonicalUrl, applicable: true, status: "HELD", artifactIds: [evidence.artifactId], reason: "Independent fixture source inventory" }], evidence: [evidence],
        surfaceEvidence: await Promise.all(contract.sourceScope.observationArtifactIds.map(async id => evidenceProjection(await runtime.readEvidence(id)))), startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"], scope: scope.auditScope }; },
    roleExecutor: (task, holder) => researchRoleExecutor(runtime, { repos, store, now, spaceOut: async () => {}, openBytes: async ({ url }) => {
      calls.push(url); const robots = url.endsWith("/robots.txt"); const body = robots ? "User-agent: *\nDisallow:\n" : options.response?.text ?? FIXTURE_BODY;
      return { status: !robots && options.response?.transportError ? null : 200, bytes: Buffer.from(body), contentType: robots ? "text/plain" : "application/json", finalUrl: url, durationMs: 1, transportError: robots ? null : options.response?.transportError ?? null };
    } }, task, holder),
  };
  return { repos, store, item: (await repos.workItems.mustRead(item.id)).value, runtime, calls, now, advanceTo: (at: string) => { clock = Date.parse(at); } };
}
