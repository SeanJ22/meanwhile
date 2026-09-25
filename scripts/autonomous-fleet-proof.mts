import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { performance } from "node:perf_hooks";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { registerWorkItem, registerRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask, type RouteTask } from "../lib/control-plane/route-task.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { defaultGrant, requireCapability } from "../lib/control-plane/capability.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { hostSpacer } from "../lib/control-plane/scheduler/http-executor.ts";
import { buildScoutToolkit, extractLinks } from "../lib/control-plane/scheduler/scout-tools.ts";
import { dispatchOne, proofChargeOf, type DeclaredExecutor, type WorkArtifact } from "../lib/control-plane/scheduler/dispatch.ts";
import { AUTONOMOUS_FLEET_PROOF_PROJECT } from "../lib/control-plane/cost.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import type { ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { dispatchWorkerTask, enqueueWorkerTask, FLEET_POLICY_VERSION, type FleetRuntime } from "../lib/control-plane/workers/runtime.ts";
import { durableResearchTools, researchRoleExecutor } from "../lib/control-plane/workers/research-runtime.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import type { GeneralizedCivicExtractionContract, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { AcquirerTaskSpec, DetectiveTaskSpec, ObservedResearchRoute, ResearchSpan } from "../lib/control-plane/workers/research-types.ts";
import type { ScoutResult, ScoutRung } from "../lib/control-plane/scheduler/scout-result.ts";
import { today } from "./doc-dates.mjs";
import { writeAutonomousFleetProof } from "./autonomous-fleet-proof-output.ts";

/** Real owed registry records only. The script writes observations; it cannot promote or render them. */
const root = resolve(import.meta.dirname, "..");
const vaultRoot = process.argv.find(a => a.startsWith("--vault-root="))?.slice(13);
if (!vaultRoot) throw new Error("AUTONOMOUS_PROOF_EXPLICIT_CANONICAL_VAULT_REQUIRED");
const targetName = process.argv.find(a => a.startsWith("--target="))?.slice(9) ?? "corona";
const registry = JSON.parse(readFileSync(join(root, "lib/registry/registry.json"), "utf8"));
const targets = {
  corona: { subject: "curated:az/corona-de-tucson-fire-district#governing", state: "AZ", seed: "https://www.coronafire.org/" },
  sonoita: { subject: "wtp-body/country:us/state:az/census:220681/sonoita_elgin_fire_district#governing", state: "AZ", seed: "https://www.sefd911.org/" },
  springfield: { subject: "ocd-division/country:us/state:nh/county:sullivan/place:springfield_town#select-board", state: "NH", seed: "https://springfieldnh.org/events/" },
} as const;
const target = targets[targetName as keyof typeof targets];
if (!target) throw new Error("AUTONOMOUS_PROOF_UNKNOWN_REGISTRY_TARGET");
const body = registry.bodies.find((b: { id: string }) => b.id === target.subject);
if (!body || new URL(body.homepageUrl).hostname !== new URL(target.seed).hostname) throw new Error("AUTONOMOUS_PROOF_REGISTRY_BINDING_REFUSED");
const connection = controlPlaneUrlFromEnv();
if (!connection) throw new Error("AUTONOMOUS_PROOF_CONTROL_PLANE_NOT_CONFIGURED");
const now = () => new Date().toISOString();
const beganAt = now();
const repos = await createPgRepositories(connection);
const store = new DurableEvidenceStore(resolve(vaultRoot));
const tools = { repos, store, spaceOut: hostSpacer(), now };
const methodVersion = JSON.parse(readFileSync(join(root, "data/method/knowledge.json"), "utf8")).version;
/* MW-024: a proof run works and charges under its own project, never `freshness`, so its spend stays real and out of production's figures. */
const draft = createWorkItem({ project: AUTONOMOUS_FLEET_PROOF_PROJECT, subject: target.subject, obligation: "Acquire and independently verify the official meeting-document source universe",
  why: `Canonical registry ${body.coverageStatus} source for ${body.name}; official meeting documents remain owed.`,
  contract: { requiresValidation: true, requiresAudit: true, requiresCompleteDenominator: true }, now: now() });
let item: WorkItem = (await repos.workItems.read(draft.id))?.value ?? (await registerWorkItem(repos, draft, now())).value;
const resolveVault = researchVaultResolver(repos, store, item.project);
const readEvidence = workerVaultResolver(repos, store, item.project);
const runtime: FleetRuntime = { repos, readEvidence, methodVersion, now, independentContext: async () => { throw new Error("PROOF_REQUIRES_STANDING_AUDIT_CONTEXT"); },
  roleExecutor: (task, holder) => researchRoleExecutor(runtime, tools, task, holder) };
const proofDir = join(root, "data/health/autonomous-agent-fleet");
const proofPath = join(proofDir, `${today()}-${targetName}.json`);
const scheduled = (task: RouteTask): ScheduledObligation => ({ obligation: { id: task.id, recordClass: "OFFICIAL_MEETING_DOCUMENT_INVENTORY", subjectId: item.subject,
  routeId: task.routeId, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: task.createdAt,
  cadenceHours: 24, cadenceSource: "DEFAULT_NO_SIGNAL", basis: "Canonical registry marks this official source universe owed." });
const observationDraft = createRouteTask({ workItemId: item.id, routeId: "OFFICIAL_PUBLISHER_OBSERVATION", routeLabel: "Observe the registry's official publisher and its published bulk locator",
  target: target.seed, inherited: false, now: now() });
const observationTask = (await repos.routeTasks.read(observationDraft.id))?.value ?? (await registerRouteTask(repos, observationDraft, now())).value;
const dispatches: unknown[] = [];
if (["PENDING", "RECLAIMABLE"].includes(observationTask.state)) {
  const executor: DeclaredExecutor = { lane: "DETERMINISTIC", workerFor: ({ holder }) => ({ role: "SCOUT", provider: "we-the-people", version: "official-source-observation/1", instance: holder }),
    run: async ctx => {
      const started = performance.now();
      const attempt = await repos.attempts.mustRead(ctx.attemptId);
      const grant = defaultGrant({ role: "SCOUT", project: item.project, policyVersion: FLEET_POLICY_VERSION, grantedAt: attempt.value.startedAt });
      await repos.attempts.compareAndSet(attempt.id, attempt.revision, { ...attempt.value, capabilityGrant: grant }, now());
      requireCapability(grant, "NETWORK_PUBLIC_READ"); requireCapability(grant, "VAULT_WRITE");
      const toolkit = buildScoutToolkit({ ...ctx, route: null, providerId: null, holder: ctx.holder, now, bound: RESEARCH_BOUNDS.perDispatch,
        inherited: { artifactIds: [], summary: "Registry first-party seed; observed references only." }, ...durableResearchTools(tools, { project: item.project, ...ctx }) });
      const artifacts: WorkArtifact[] = [];
      const rungs: ScoutRung[] = [];
      for (const tool of ["read_permission", "fetch_public"] as const) {
        const r = await toolkit.call(tool, { url: target.seed, rung: "primary-site-navigation", why: "Observe the official publisher and its actual bulk publication links." }, "primary-site-navigation");
        artifacts.push(...r.artifacts);
        if (r.rung) rungs.push({ ...r.rung, index: rungs.length, note: null, at: now() });
        /* robots.txt is recorded on the rung and never stops the read (owner decision 2026-09-25); fetch_public walls on an access control itself. */
      }
      const useful = artifacts.filter(a => !a.canonicalUrl.endsWith("/robots.txt"));
      const result: ScoutResult = { formatVersion: 1, attemptId: ctx.attemptId, obligationId: ctx.obligation.obligation.id,
        routeTaskId: ctx.routeTaskId, workItemId: ctx.workItemId, subjectId: item.subject, routeId: observationTask.routeId,
        recordClass: "OFFICIAL_MEETING_DOCUMENT_INVENTORY", providerId: new URL(target.seed).hostname,
        reason: "Established deterministic first-party source observation; no model required.", outcome: useful.length ? "EVIDENCE_FOUND" : "NO_PROGRESS", stoppedBy: "BOUND",
        rungs, distinctEvidenceRungs: new Set(rungs.filter(r => r.artifactIds.length).map(r => r.rung)).size, candidates: [],
        findings: useful.map(a => ({ summary: "The official publisher surface is vaulted as a route observation, pending authoritative record acquisition.", artifactIds: [a.artifactId], kind: "POINTER" })),
        nextRungs: ["Walk the bulk publication locator named by the publisher or its robots document."], unverified: ["Source-universe completeness and civic identities remain unverified."],
        narrative: "Deterministic source observation; machine artifacts and rungs record exactly what was opened.",
        worker: { provider: "we-the-people", model: "DETERMINISTIC_NO_MODEL", modelReported: null },
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 0, toolCalls: toolkit.toolCalls },
        usd: 0, elapsedMs: Math.round(performance.now() - started), artifactIds: artifacts.map(a => a.artifactId), methodCandidateIds: [], refusal: null,
        startedAt: attempt.value.startedAt, recordedAt: now(), steps: [{ step: "official-source-observation", kind: "DETERMINISTIC", turn: null, model: null, effort: null,
          tokens: { cacheRead: 0, cacheWrite: 0, uncachedInput: 0, output: 0 }, usd: 0, representationBytes: 0, count: toolkit.toolCalls }] };
      await repos.scoutResults.append(result.obligationId, result.attemptId, result, now());
      return { kind: useful.length ? "DISPOSED" : "ABORTED", ranAs: "DETERMINISTIC", artifacts,
        ...(useful.length ? { disposition: { disposition: "POINTER_ONLY" as const, observation: null, permission: rungs.at(-1)?.permission ?? "CANNOT_TELL",
          transport: "REACHABLE" as const, note: "Official source observation captured; acquisition remains owed." } } : {}),
        cost: { ...ZERO_COST, durationMs: result.elapsedMs, requestCount: toolkit.requestCount, bytesFetched: toolkit.bytesFetched }, detail: "Official publisher observation committed; no promotion authority." };
    } };
  dispatches.push(await dispatchOne(repos, { obligation: scheduled(observationTask), routeTaskId: observationTask.id, holder: `source-proof:${process.pid}`, now: now(),
    leaseTtlMs: 300_000, maturity: () => "GRADUATED", executor, methodVersion, policyVersion: FLEET_POLICY_VERSION, ...proofChargeOf(item.project) }));
}
const sourceRecords = (await repos.artifacts.readAll()).filter(a => a.workItemId === item.id && a.routeTaskId === observationTask.id && !a.partial);
const sources = await Promise.all(sourceRecords.map(a => resolveVault(a.artifactId)));
const publisher = sources.find(a => a.artifact.canonicalUrl === target.seed && a.artifact.transport === "REACHABLE" && a.artifact.retentionPolicy !== "DIAGNOSTIC");
if (!publisher) {
  writeAutonomousFleetProof(root, proofPath, { startedAt: beganAt, observedAt: now(), itemId: item.id, subject: item.subject, dispatches, outcome: "PUBLISHER_OBSERVATION_BLOCKED", promotion: "OFF" });
  console.log(JSON.stringify({ proofPath, itemId: item.id, outcome: "PUBLISHER_OBSERVATION_BLOCKED" })); process.exitCode = 1;
} else {
  const text = new TextDecoder().decode(publisher.bytes);
  const spanFor = (held: typeof publisher, quote: string): ResearchSpan => ({ artifactId: held.artifact.id, contentHash: held.artifact.contentHash,
    start: new TextDecoder().decode(held.bytes).indexOf(quote), end: new TextDecoder().decode(held.bytes).indexOf(quote) + quote.length, quote, offsetUnit: "UTF16_CODE_UNITS" });
  let observed = publisher;
  let locator = target.seed as string;
  let quote = text.slice(0, Math.min(text.length, 400));
  for (const held of sources) {
    const bodyText = new TextDecoder().decode(held.bytes);
    const sitemap = /Sitemap:\s*(https?:\/\/[^\s<>]+)/i.exec(bodyText);
    if (sitemap) { observed = held; locator = sitemap[1]; quote = sitemap[0]; break; }
  }
  if (locator === target.seed) {
    const linked = extractLinks(text, new URL(target.seed), 200).find(l => /sitemap/i.test(l.url));
    if (linked) {
      locator = linked.url;
      const linkedPublisherUrl = new URL(locator);
      const candidate = linkedPublisherUrl.pathname;
      if (text.includes(locator)) quote = locator; else if (text.includes(candidate)) quote = candidate;
    }
  }
  const publisherUrl = new URL(locator);
  if (!["http:", "https:"].includes(publisherUrl.protocol)) throw new Error("AUTONOMOUS_PROOF_PUBLISHER_PROTOCOL_REFUSED");
  const route: ObservedResearchRoute = { id: `OFFICIAL_PUBLISHER_DOCUMENTS:${publisherUrl.pathname}`, subjectId: item.subject, jurisdiction: target.state,
    recordClass: /sitemap/i.test(locator) ? "OFFICIAL_DOCUMENT_SITEMAP" : "OFFICIAL_PUBLISHER_SURFACE", sourceId: publisherUrl.host, publisher: body.name,
    url: locator, observedLocator: quote === publisherUrl.pathname ? quote : locator, observedAt: observed.artifact.retrievedAt,
    firstObservedAt: observed.artifact.retrievedAt, methodVersion, permission: "ALLOWED", observation: spanFor(observed, quote),
    publisherSubjectEvidence: [spanFor(publisher, text.slice(0, Math.min(text.length, 400)))], applicableBecause: "The current canonical registry names this publisher; its actual observation names this bulk/public record locator.",
    nextRouteIds: ["OFFICIAL_MEETING_DOCUMENTS_AND_EXTERNAL_AUTHORITY"], retrieval: "fetch_public" };
  const acquisition: AcquirerTaskSpec = { route, held: [] };
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: route.recordClass, subjectId: item.subject,
    jurisdiction: { country: "US", state: target.state, canonicalId: item.subject }, identity: { namespace: `${publisherUrl.host}:publication`, keyFields: ["loc"] },
    sourceScope: { sourceId: route.sourceId, routeIds: [route.id], publisher: body.name, canonicalUrls: [locator], observationArtifactIds: [...new Set([observed.artifact.id, publisher.artifact.id])] },
    methodVersion, requiredFields: ["loc"], completenessScope: "Only the URL rows in the captured official publisher sitemap; no claim of complete civic-record or meeting coverage.", expectedSourceDate: null,
    extraction: { format: "XML_RECORDS", rowTag: "url", fields: { loc: { source: "loc", type: "STRING" } } }, verification: { required: true, authorities: [] } };
  const row = await repos.workItems.mustRead(item.id);
  item = (await repos.workItems.compareAndSet(item.id, row.revision, { ...row.value, autonomousPlan: { version: 1, contract, capability: "MEETINGS", jurisdiction: target.state,
    sourceRegistryReferences: [`lib/registry/registry.json#${item.subject}`], seedUrls: [target.seed], sources: [route], acquisition: [acquisition], detective: [], engineering: [], auditScope: "CAPTURED_ARTIFACT" } }, now())).value;
  const task = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId: observed.artifact.id, contract, acquisition, now: now() });
  if (["PENDING", "RECLAIMABLE"].includes(task.state)) dispatches.push(await dispatchWorkerTask(runtime, task));
  let records = await repos.workerResults.read(item.id);
  const acquired = records.findLast(r => r.routeTaskId === task.id && r.result.role === "ACQUIRER");
  if (acquired?.result.role === "ACQUIRER" && acquired.result.verdict === "ACQUIRED") {
    const a = acquired.result.artifacts[0];
    const retryAcquisition: AcquirerTaskSpec = { route, held: [{ artifactId: a.artifactId, sourceRouteId: route.id, sourceObservationArtifactId: route.observation.artifactId,
      immutable: true, partial: false, currentUntil: new Date(Date.parse(a.retrievedAt) + 60 * 60_000).toISOString() }] };
    const retry = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId: observed.artifact.id, contract, acquisition: retryAcquisition,
      now: now(), replayLabel: "immutable-recovery-readback", purpose: "DIAGNOSTIC_REPLAY" });
    if (["PENDING", "RECLAIMABLE"].includes(retry.state)) dispatches.push(await dispatchWorkerTask(runtime, retry));
    if (targetName === "corona") {
      const canonicalCandidates = registry.bodies.filter((b: { homepageUrl?: string }) => b.homepageUrl && /coronafire\.org/.test(b.homepageUrl));
      const publisherEvidence = await readEvidence(publisher.artifact.id);
      const foundName = /Corona.{0,20}Tucson/i.exec(publisherEvidence.text)?.[0] ?? text.slice(0, 80);
      const detective: DetectiveTaskSpec = { question: { id: "corona-canonical-identity-join", text: "Which current canonical Corona de Tucson Fire District body ID is the unique identity for this publisher's records?",
        subjectId: item.subject, jurisdiction: "AZ", recordClass: "GOVERNMENT_IDENTITY", kind: "IDENTITY", alternatives: canonicalCandidates.map((b: { id: string }) => ({ id: b.id,
          statement: `The official publisher should join to ${b.id}.`, canonicalIdentity: b.id, tests: [{ artifactId: publisher.artifact.id, predicate: { kind: "EXACT_TEXT", quote: foundName } }] })),
        authorities: [{ artifactId: publisher.artifact.id, organization: body.name, type: "OFFICIAL_RECORD", observedAt: publisher.artifact.retrievedAt }],
        falsificationCondition: "An independent government/Census identifier crosswalk establishes one of the current body IDs as an unrelated or duplicate record.",
        nextAction: "Compare the Census government-unit identifier and curated body's registry lineage; record an independently validated alias join before reader linkage.", populationDefinition: null, denominator: null },
        artifactIds: [publisher.artifact.id], walk: [], walkState: { state: "OPEN", nextRouteIds: ["CENSUS_GOVERNMENT_IDENTITY_CROSSWALK"] } };
      const detectiveTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "DETECTIVE", artifactId: publisher.artifact.id, contract, detective, now: now() });
      if (["PENDING", "RECLAIMABLE"].includes(detectiveTask.state)) dispatches.push(await dispatchWorkerTask(runtime, detectiveTask));
      const current = await repos.workItems.mustRead(item.id);
      await repos.workItems.compareAndSet(item.id, current.revision, { ...current.value, autonomousPlan: { ...current.value.autonomousPlan!, detective: [detective] } }, now());
    }
  }
  records = await repos.workerResults.read(item.id);
  const summarize = (r: WorkerResultRecord) => ({ id: r.id, attemptId: r.attemptId, role: r.result.role, verdict: r.result.verdict,
    artifacts: r.result.role === "ACQUIRER" ? r.result.artifacts : r.inputArtifactIds, cost: r.cost });
  const proof = { formatVersion: 1, startedAt: beganAt, observedAt: now(), subject: item.subject, state: target.state, itemId: item.id,
    observationTaskId: observationTask.id, sourceObservationArtifactIds: sources.map(s => s.artifact.id), contract, dispatches, results: records.map(summarize),
    promotion: "OFF", sourceUniverseComplete: false, verification: "External verification remains owed; acquired observations are not reader-facing truth." };
  writeAutonomousFleetProof(root, proofPath, proof);
  console.log(JSON.stringify({ proofPath, itemId: item.id, state: target.state, records: records.map(summarize) }, null, 2));
}
