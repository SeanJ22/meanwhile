import { join } from "node:path";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import { canonicalJson, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import { modelAuditReasoner } from "./model-audit.ts";
import { modelParseReasoner } from "./model-parser.ts";
import { createModelAuditSampler } from "./audit-sampling.ts";
import { workerVaultResolver } from "./vault.ts";
import { enqueueWorkerTask, evidenceProjection, type FleetRuntime } from "./runtime.ts";
import type { GeneralizedCivicExtractionContract, IndependentAuditContext, OfficialRouteExpectation } from "./types.ts";
import type { WorkItem } from "../work-item.ts";
import type { MethodKnowledge } from "../../method/knowledge.ts";
import { computeRouteFloor } from "../preflight.ts";
import { fingerprint } from "../ids.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import type { WorkerEvidence } from "./types.ts";
import { requiredOperationalJurisdictionRegistry } from "../../civic-data/operational-references.ts";
import { readRegistryRuntimeProjection } from "../../registry/runtime-read-model.ts";
import { authorizeInheritedHeldArtifact, type ResearchRuntimeTools } from "./research-runtime.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { readAuditHistory } from "./scoped-history.ts";
import { hasOwedHeldDiggers, planHeldDiggers } from "./held-digger-plan.ts";

export const HELD_AUDIT_CONTEXT_MAX_BYTES = 1_800_000;
export const HELD_AUDIT_MAX_ARTIFACTS = 64;

interface RegistrySubject {
  readonly id: string;
  readonly govClass: string;
  readonly ownWebAddress: string | null;
  readonly sourceIds: readonly string[];
}

async function registryScope(contract: GeneralizedCivicExtractionContract) {
  const state = contract.jurisdiction.state.toLowerCase();
  if (!/^[a-z]{2}$/.test(state) || contract.jurisdiction.country.toLowerCase() !== "us") throw new Error("AUDIT_CANONICAL_JURISDICTION_INVALID");
  const registry = requiredOperationalJurisdictionRegistry(state) as {
    readonly jurisdictions: readonly RegistrySubject[];
    readonly sourceCatalog: Readonly<Record<string, { readonly url: string | null; readonly routeId: string | null }>>;
  };
  const subject = registry.jurisdictions.find(row => row.id === contract.subjectId);
  if (subject) {
    if (contract.jurisdiction.canonicalId !== subject.id) throw new Error("AUDIT_CANONICAL_OBLIGATION_MISSING");
    const knownUrls = [subject.ownWebAddress, ...subject.sourceIds.map(id => registry.sourceCatalog[id]?.url)].filter((url): url is string => Boolean(url));
    return { subject, knownUrls };
  }
  const read = await readRegistryRuntimeProjection([state]);
  if (read.kind !== "PROMOTED") throw new Error(`AUDIT_REGISTRY_UNAVAILABLE:${state}:${read.kind}`);
  const bodies = read.value.registry.bodies as {
    id: string; ocdId: string | null; bodyClass: string; homepageUrl: string | null; agendaSourceRef: string | null; provenance?: { sourceUrl?: string };
  }[];
  const body = bodies.find(row => row.id === contract.subjectId);
  if (!body || !new RegExp(`(?:state:|curated:)${state}(?:[/#]|$)`).test(body.id)) throw new Error("AUDIT_CANONICAL_OBLIGATION_MISSING");
  const knownUrls = [body.homepageUrl, body.agendaSourceRef, body.provenance?.sourceUrl].filter((url): url is string => Boolean(url && hostname(url)));
  const jurisdiction = registry.jurisdictions.find(row => row.id === contract.jurisdiction.canonicalId);
  if (![body.id, body.ocdId].includes(contract.jurisdiction.canonicalId) &&
      (!jurisdiction || !knownUrls.some(url => hostname(url) === hostname(jurisdiction.ownWebAddress ?? "")))) throw new Error("AUDIT_CANONICAL_JURISDICTION_MISMATCH");
  return { subject: { id: body.id, govClass: jurisdiction?.govClass ?? body.bodyClass, ownWebAddress: body.homepageUrl, sourceIds: jurisdiction?.sourceIds ?? [] }, knownUrls };
}

async function heldGeneralizedContract(artifact: ArtifactRecord, item: WorkItem): Promise<GeneralizedCivicExtractionContract | null> {
  const contract = item.autonomousPlan?.contract;
  if (!contract || contract.schemaVersion !== 2 || artifact.partial || item.subject !== contract.subjectId || artifact.workItemId !== item.id ||
      !contract.sourceScope.canonicalUrls.includes(artifact.canonicalUrl)) return null;
  await registryScope(contract);
  return contract;
}

function hostname(value: string): string | null {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.hostname.toLowerCase().replace(/^www\./, "") : null; }
  catch { return null; }
}

function linkedHosts(evidence: WorkerEvidence): readonly string[] {
  let text = evidence.text;
  try {
    const raw: unknown = JSON.parse(text);
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(raw); text = strings.join("\n");
  } catch {  }
  const links = [...text.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);

  for (const match of text.matchAll(/^location:\s*(https?:\/\/\S+)\s*$/gmi)) links.push(match[1]);
  return links.flatMap(link => {
    try { const host = hostname(new URL(link.replace(/&amp;/g, "&"), evidence.canonicalUrl).href); return host ? [host] : []; }
    catch { return []; }
  });
}

export function methodFields(capability: string, contract: GeneralizedCivicExtractionContract): readonly string[] {
  const known: Record<string, readonly string[]> = {
    meetings: ["meeting", "agenda", "minutes"], meetings_agendas: ["meeting", "agenda", "minutes"],
    officials: ["officeholder", "roster"], officials_offices: ["officeholder", "roster"],
    districts: ["body", "jurisdiction", "boundary"], districts_geography: ["body", "jurisdiction", "boundary"],
    elections: ["contest", "candidate"], elections_ballot: ["contest", "candidate"],
    ballot_and_candidates: ["contest", "candidate", "filing"],
    campaign_finance: ["filing", "document", "source"],
  };
  const normalized = capability.toLowerCase().replace(/[ /-]+/g, "_");
  return [...new Set([...(known[normalized] ?? [normalized]), contract.recordClass.toLowerCase(), ...contract.requiredFields])];
}

export function heldAuditAttribution(input: { artifacts: readonly ArtifactRecord[]; items: readonly WorkItem[]; artifactId: string;
  contract: GeneralizedCivicExtractionContract; workItemId?: string }) {
  const matches = input.artifacts.filter(artifact => artifact.artifactId === input.artifactId && !artifact.partial &&
    (input.workItemId === undefined || artifact.workItemId === input.workItemId));
  if (!matches.length) throw new Error("AUDIT_ARTIFACT_WORK_ITEM_ATTRIBUTION_MISSING");
  const eligible = matches.flatMap(primary => {
    const owner = input.items.find(item => item.id === primary.workItemId);
    return owner?.subject === input.contract.subjectId && canonicalJson(owner.autonomousPlan?.contract ?? null) === canonicalJson(input.contract)
      ? [{ primary, owner }] : [];
  });
  if (!eligible.length) throw new Error(matches.some(primary => input.items.some(owner => owner.id === primary.workItemId && owner.subject === input.contract.subjectId))
    ? "AUDIT_CANONICAL_SCOPE_MISMATCH" : "AUDIT_ARTIFACT_SUBJECT_MISMATCH");
  if (new Set(eligible.map(row => row.owner.id)).size !== 1) throw new Error("AUDIT_WORK_ITEM_SCOPE_REQUIRED");
  return eligible[0];
}

export async function resolvedHeldAuditAttribution(input: {
  repos: ControlPlaneRepositories; artifacts: readonly ArtifactRecord[]; items: readonly WorkItem[];
  artifactId: string; contract: GeneralizedCivicExtractionContract; workItemId: string;
  siblingHeldRootFor?: ResearchRuntimeTools["siblingHeldRootFor"];
}) {
  const owner = input.items.find(item => item.id === input.workItemId);
  if (!owner || owner.subject !== input.contract.subjectId) throw new Error("AUDIT_ARTIFACT_SUBJECT_MISMATCH");
  if (canonicalJson(owner.autonomousPlan?.contract ?? null) !== canonicalJson(input.contract)) throw new Error("AUDIT_CANONICAL_SCOPE_MISMATCH");
  const local = input.artifacts.find(artifact => artifact.artifactId === input.artifactId &&
    artifact.workItemId === owner.id && !artifact.partial);
  if (local) return heldAuditAttribution(input);
  const captures = input.artifacts.filter(artifact => artifact.artifactId === input.artifactId && !artifact.partial);
  const results = await readCompletedWorkerResults(input.repos, owner.id);
  for (const primary of captures) {
    if (primary.workItemId === owner.id) continue;
    const declared = owner.autonomousPlan?.acquisition.find(acquisition =>
      acquisition.route.url === primary.canonicalUrl && acquisition.held.some(held =>
        held.artifactId === primary.artifactId && held.inheritedFromWorkItemId === primary.workItemId &&
        held.sourceRouteId === acquisition.route.id &&
        held.sourceObservationArtifactId === acquisition.route.observation.artifactId && held.immutable && !held.partial));
    if (!declared) continue;
    const acquired = results.some(record => record.result.role === "ACQUIRER" && record.result.verdict === "ACQUIRED" &&
      record.result.source.id === declared.route.id && record.result.source.subjectId === owner.subject &&
      record.result.artifacts.some(artifact => artifact.artifactId === primary.artifactId && artifact.reused &&
        artifact.completeness === "COMPLETE" && artifact.acquisitionAttemptId === primary.attemptId &&
        artifact.canonicalUrl === primary.canonicalUrl && artifact.contentHash === primary.contentHash &&
        artifact.byteCount === primary.byteLength && artifact.sourceRouteId === declared.route.id &&
        artifact.sourceObservationArtifactId === declared.route.observation.artifactId));
    if (!acquired || !await authorizeInheritedHeldArtifact(input.repos, { artifactId: primary.artifactId,
      originWorkItemId: primary.workItemId, childWorkItemId: owner.id, project: owner.project }, input.siblingHeldRootFor)) continue;
    return { primary, owner };
  }
  throw new Error("AUDIT_ARTIFACT_WORK_ITEM_ATTRIBUTION_MISSING");
}

async function generalizedIndependentContext(input: {
  root: string; repos: ControlPlaneRepositories; method: MethodKnowledge; readEvidence: FleetRuntime["readEvidence"];
  artifactId: string; contract: GeneralizedCivicExtractionContract; auditScope: IndependentAuditContext["scope"]; methodVersion: number; workItemId?: string;
  siblingHeldRootFor?: ResearchRuntimeTools["siblingHeldRootFor"];
}): Promise<IndependentAuditContext> {
  const { contract } = input;

  if (contract.methodVersion > input.methodVersion) throw new Error("AUDIT_METHOD_VERSION_MISMATCH");
  const { artifacts, items } = await readAuditHistory(input.repos, { workItemId: input.workItemId, subjectId: contract.subjectId,
    requiredArtifactIds: [input.artifactId, ...contract.sourceScope.observationArtifactIds,
      ...contract.verification.authorities.flatMap(authority => [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds])] });
  if (!input.workItemId) throw new Error("AUDIT_WORK_ITEM_SCOPE_REQUIRED");
  const { primary, owner } = await resolvedHeldAuditAttribution({ repos: input.repos, artifacts, items,
    artifactId: input.artifactId, contract, workItemId: input.workItemId, siblingHeldRootFor: input.siblingHeldRootFor });
  const canonical = primary.workItemId === owner.id ? await heldGeneralizedContract(primary, owner)
    : owner.autonomousPlan?.contract.schemaVersion === 2 && !primary.partial && owner.subject === contract.subjectId &&
      contract.sourceScope.canonicalUrls.includes(primary.canonicalUrl) ? owner.autonomousPlan.contract : null;
  if (!canonical || canonicalJson(canonical) !== canonicalJson(contract)) throw new Error("AUDIT_CANONICAL_SCOPE_MISMATCH");
  const { subject, knownUrls } = await registryScope(contract);
  const subjectItems = items.filter(item => item.subject === subject.id);
  const subjectIds = new Set(subjectItems.map(item => item.id));
  const sameSubject = artifacts.filter(artifact => subjectIds.has(artifact.workItemId));
  const observationIds = new Set(contract.sourceScope.observationArtifactIds);
  const authorityIds = new Set(contract.verification.authorities.flatMap(authority => [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds]));
  const requiredIds = new Set([input.artifactId, ...observationIds, ...authorityIds]);
  for (const id of requiredIds) {
    const held = artifacts.find(artifact => artifact.artifactId === id);
    if (!held) throw new Error(`AUDIT_DECLARED_EVIDENCE_MISSING:${id}`);
    if (!subjectIds.has(held.workItemId)) throw new Error(`AUDIT_ARTIFACT_SUBJECT_MISMATCH:${id}`);
  }
  const relevantUrls = new Set([...contract.sourceScope.canonicalUrls, ...contract.verification.authorities.flatMap(authority => authority.canonicalUrls)]);
  for (const item of subjectItems) {
    if (item.autonomousPlan?.contract.recordClass !== contract.recordClass) continue;
    for (const source of item.autonomousPlan.sources) if (source.subjectId === subject.id) relevantUrls.add(source.url);
    for (const acquisition of item.autonomousPlan.acquisition) if (acquisition.route.subjectId === subject.id) relevantUrls.add(acquisition.route.url);
    if (item.autonomousPlan.contract.schemaVersion === 2) {
      item.autonomousPlan.contract.sourceScope.canonicalUrls.forEach(url => relevantUrls.add(url));
      item.autonomousPlan.contract.sourceScope.observationArtifactIds.forEach(id => observationIds.add(id));
    }
  }
  const relevant = sameSubject.filter(artifact => requiredIds.has(artifact.artifactId) || observationIds.has(artifact.artifactId) || relevantUrls.has(artifact.canonicalUrl));
  const rawBytes = relevant.reduce((sum, artifact) => sum + artifact.byteLength, 0);
  if (relevant.length > HELD_AUDIT_MAX_ARTIFACTS || rawBytes > HELD_AUDIT_CONTEXT_MAX_BYTES) throw new Error(`AUDIT_EVIDENCE_UNIVERSE_BOUND_EXCEEDED: ${relevant.length} artifacts / ${rawBytes} bytes; no evidence was truncated`);
  const readings: WorkerEvidence[] = [];
  for (const artifact of relevant.filter(artifact => !artifact.partial)) readings.push(evidenceProjection(await input.readEvidence(artifact.artifactId)));
  if ([...observationIds].some(id => !readings.some(evidence => evidence.artifactId === id))) throw new Error("AUDIT_SOURCE_OBSERVATION_MISSING_OR_PARTIAL");
  const rootedHosts = new Set(knownUrls.flatMap(url => { const host = hostname(url); return host ? [host] : []; }));

  let changed = true;
  while (changed) {
    changed = false;
    for (const reading of readings) if (rootedHosts.has(hostname(reading.canonicalUrl) ?? "")) {
      for (const host of linkedHosts(reading)) if (!rootedHosts.has(host)) { rootedHosts.add(host); changed = true; }
    }
  }
  for (const url of contract.sourceScope.canonicalUrls) if (!rootedHosts.has(hostname(url) ?? "")) throw new Error("AUDIT_FIRST_PARTY_PUBLISHER_BINDING_MISSING");
  const evidence = readings.filter(reading => !authorityIds.has(reading.artifactId) && contract.sourceScope.canonicalUrls.includes(reading.canonicalUrl) &&
    reading.sourceId === contract.sourceScope.sourceId && contract.sourceScope.routeIds.includes(reading.methodRouteId));
  if (!evidence.some(reading => reading.artifactId === input.artifactId)) throw new Error("AUDIT_PRIMARY_SOURCE_SCOPE_MISMATCH");
  const evidenceIds = new Set(evidence.map(reading => reading.artifactId));
  const authorityEvidence = readings.filter(reading => authorityIds.has(reading.artifactId));
  const surfaceEvidence = readings.filter(reading => !evidenceIds.has(reading.artifactId) && !authorityIds.has(reading.artifactId));
  const routes: OfficialRouteExpectation[] = [...relevantUrls].sort().map(url => {
    const held = relevant.filter(artifact => artifact.canonicalUrl === url);
    return { routeId: `OBSERVED_SCOPE:${fingerprint([url])}`, canonicalUrl: url, applicable: true,
      status: held.some(artifact => !artifact.partial) ? "HELD" : "OPEN", artifactIds: held.map(artifact => artifact.artifactId),
      reason: held.some(artifact => artifact.partial) ? "A partial capture is retained and cannot establish a complete route reading." : "Exact same-subject source route inventoried from the durable plan and immutable evidence, independently of producer output." };
  });
  for (const routeId of contract.sourceScope.routeIds) for (const url of contract.sourceScope.canonicalUrls) {
    const held = evidence.filter(reading => reading.methodRouteId === routeId && reading.canonicalUrl === url);
    routes.push({ routeId, canonicalUrl: url, applicable: true, status: held.length ? "HELD" : "OPEN", artifactIds: held.map(reading => reading.artifactId), reason: "Exact source route/URL pair declared by the versioned extraction contract; an unobserved pair remains open." });
  }
  const floor = computeRouteFloor({ knowledge: input.method, jurisdiction: { state: contract.jurisdiction.state.toLowerCase(), governmentType: subject.govClass.toLowerCase(), publisher: contract.sourceScope.sourceId },
    fields: [...methodFields(owner.autonomousPlan!.capability, contract)],
    adapterRoutes: routes.map(route => ({ routeId: route.routeId, label: route.reason, target: route.canonicalUrl })) });
  for (const route of floor.routes) if (!routes.some(held => held.routeId === route.routeId && held.canonicalUrl === route.target)) {
    routes.push({ routeId: route.routeId, canonicalUrl: route.target, applicable: route.obligation === "REQUIRED", status: "OPEN", artifactIds: [],
      reason: `Current method projection: ${route.obligation}; ${route.proof}; ${route.label}. The inherited target is not a newly observed endpoint.` });
  }
  const context: IndependentAuditContext = { subjectId: subject.id, contract, methodVersion: input.methodVersion, scope: input.auditScope,
    publisherSurfaces: [...new Set([...knownUrls, ...relevant.map(artifact => artifact.canonicalUrl)])], routes, evidence, surfaceEvidence, authorityEvidence,
    startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"] };
  if (Buffer.byteLength(canonicalJson(context)) > HELD_AUDIT_CONTEXT_MAX_BYTES) throw new Error("AUDIT_EVIDENCE_UNIVERSE_BOUND_EXCEEDED: serialized context; no evidence was truncated");
  return context;
}

export function standingFleetRuntime(input: { root: string;  method: MethodKnowledge; vaultRoot?: string; repos: ControlPlaneRepositories; transport?: ModelTransport; now?: () => string; auditCeilingUsd?: number;
  lifetimeHuntSubject?: (subjectId: string) => boolean;
  siblingHeldRootFor?: ResearchRuntimeTools["siblingHeldRootFor"];

  transportFor?: (jurisdiction: { readonly subjectId: string; readonly state: string | null }) => ModelTransport }): FleetRuntime {
  const now = input.now ?? (() => new Date().toISOString());
  const method = input.method;
  const readEvidence = workerVaultResolver(input.repos, new DurableEvidenceStore(input.vaultRoot ?? join(input.root, ...VAULT_DIR)), "freshness");
  return { repos: input.repos, readEvidence, methodVersion: method.version, now, requireModelAudit: true,
    ...(input.lifetimeHuntSubject === undefined ? {} : { lifetimeHuntSubject: input.lifetimeHuntSubject }),
    ...(input.transport ? (() => {
      const modelOptions = { ...(input.auditCeilingUsd === undefined ? {} : { ceilingUsd: input.auditCeilingUsd }), ...(input.transportFor === undefined ? {} : { transportFor: input.transportFor }),
        ...(input.lifetimeHuntSubject === undefined ? {} : { lifetimeHuntSubject: input.lifetimeHuntSubject }),
      };
      return { auditReasoner: modelAuditReasoner(input.repos, input.transport, now, modelOptions), parseReasoner: modelParseReasoner(input.repos, input.transport, now, modelOptions),
        modelAuditSample: createModelAuditSampler(input.repos) };
    })() : {}),
    independentContext: async ({ artifactId, contract, auditScope, methodVersion, workItemId }): Promise<IndependentAuditContext> => {
      if (methodVersion !== method.version) throw new Error("AUDIT_METHOD_VERSION_MISMATCH");
      if (contract.schemaVersion !== 2) throw new Error("GENERALIZED_EXTRACTION_CONTRACT_REQUIRED");
      return generalizedIndependentContext({ ...input, method, readEvidence, artifactId, contract, auditScope, methodVersion, workItemId });
    },
  };
}

export async function advanceHeldWorkerFleet(_root: string, runtime: FleetRuntime, maximumArtifacts = Infinity, legacyOnly = false): Promise<void> {
  if (maximumArtifacts <= 0) return;
  if (legacyOnly) { await planHeldDiggers(runtime); return; }
  const records = await runtime.repos.workerResults.readAll();
  const attempts = (await runtime.repos.attempts.list()).map(a => a.value);
  let admitted = 0;
  const items = new Map((await runtime.repos.workItems.list()).map(row => [row.id, row.value]));
  const successfulAcquisitions = new Map(records.flatMap(record => record.result.role === "ACQUIRER" && record.result.verdict === "ACQUIRED" &&
    record.completion.closedAttempt.outcome === "COMPLETED" && record.completion.closedAttempt.id === record.attemptId && record.result.source.subjectId === items.get(record.workItemId)?.subject
    ? record.result.artifacts.filter(artifact => artifact.completeness === "COMPLETE" && artifact.byteCount > 0).map(artifact => [`${record.workItemId}\u0000${artifact.artifactId}`, artifact] as const) : []));
  for (const artifact of [...await runtime.repos.artifacts.readAll()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const item = items.get(artifact.workItemId);
    if (!item || item.autonomousPlan?.contract.recordClass === "HELD_MEETING_DETAILS" ||
        item.autonomousPlan?.contract.recordClass === "HELD_SUBJECT_DETAILS") continue;
    const acquired = successfulAcquisitions.get(`${item.id}\u0000${artifact.artifactId}`);
    const acquisitionMatches = acquired && acquired.contentHash === artifact.contentHash && acquired.canonicalUrl === artifact.canonicalUrl &&
      acquired.byteCount === artifact.byteLength && acquired.acquisitionAttemptId === artifact.attemptId;
    const generalized = acquisitionMatches ? await heldGeneralizedContract(artifact, item) : null;
    const contract = generalized;
    if (!contract) continue;
    if (item.subject !== contract.subjectId) continue;
    const now = (runtime.now ?? (() => new Date().toISOString()))();
    const common = { workItemId: item.id, artifactId: artifact.artifactId, contract, now };
    let task = await enqueueWorkerTask(runtime.repos, { ...common, role: "PARSER" });
    const parser = records.find(r => r.routeTaskId === task.id && r.result.role === "PARSER");
    if (parser) {
      if (parser.result.verdict !== "EXTRACTED") continue;
      task = await enqueueWorkerTask(runtime.repos, { ...common, role: "VALIDATOR", producerResultId: parser.id });
      const validator = records.find(r => r.routeTaskId === task.id && r.result.role === "VALIDATOR");
      if (validator) {
        if (validator.result.verdict !== "PASS" && !(contract.schemaVersion === 2 && validator.result.role === "VALIDATOR" && validator.result.extractionVerdict === "PASS")) continue;
        task = await enqueueWorkerTask(runtime.repos, { ...common, role: "ADVERSARIAL_AUDITOR", producerResultId: parser.id, validatorResultId: validator.id });
        if (records.some(r => r.routeTaskId === task.id && r.result.role === "ADVERSARIAL_AUDITOR")) continue;
      }
    }
    const admission = workerTaskAdmission(task, attempts, now);

    if (!admission.due || admission.requiresPolicyRecheck) continue;
    if (++admitted >= maximumArtifacts) break;
  }
}

/** Compatibility for the standing runner's existing signal; held work now uses native per-fact workers. */
export async function legacyHeldWorkOwed(_root: string, runtime: FleetRuntime): Promise<boolean> {
  return hasOwedHeldDiggers(runtime);
}
