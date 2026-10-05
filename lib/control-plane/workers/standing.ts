import { join } from "node:path";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import { canonicalJson, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import { modelAuditReasoner } from "./model-audit.ts";
import { modelParseReasoner } from "./model-parser.ts";
import { createModelAuditSampler } from "./audit-sampling.ts";
import { workerVaultResolver } from "./vault.ts";
import { drainWorkerQueue, enqueueWorkerTask, evidenceProjection, reauthorizeWorkerTask, type FleetRuntime } from "./runtime.ts";
import type { RouteTask } from "../route-task.ts";
import type { GeneralizedCivicExtractionContract, LegacyCivicExtractionContract, IndependentAuditContext, OfficialRouteExpectation } from "./types.ts";
import type { WorkItem } from "../work-item.ts";
import type { MethodKnowledge } from "../../method/knowledge.ts";
import { computeRouteFloor } from "../preflight.ts";
import { fingerprint } from "../ids.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import type { WorkerEvidence } from "./types.ts";
import { requiredOperationalJurisdictionRegistry } from "../../civic-data/operational-references.ts";
import { getRegistryRuntimeReadModel } from "../../registry/runtime-read-model.ts";
import { registeredHeldMeetingContract } from "./held-meeting-contract.ts";
import { authorizeInheritedHeldArtifact, type ResearchRuntimeTools } from "./research-runtime.ts";
import { readCompletedWorkerResults } from "../repository/worker-completion.ts";
import { readAuditHistory } from "./scoped-history.ts";

const SUBJECT = "az:city:city-of-avondale";
const API_HOST = "avondaleaz.api.civicclerk.com";
const PORTAL_HOST = "avondaleaz.portal.civicclerk.com";
/** Full serialized context bytes, leaving room inside the broker's 2 MB input limit for the candidate. */
export const HELD_AUDIT_CONTEXT_MAX_BYTES = 1_800_000;
export const HELD_AUDIT_MAX_ARTIFACTS = 64;

function publicUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") ? url : null;
  } catch { return null; }
}

function relevantPublisherSurface(artifact: ArtifactRecord): boolean {
  const url = publicUrl(artifact.canonicalUrl);
  if (!url) return false;
  if (url.hostname === PORTAL_HOST) return url.pathname !== "/robots.txt";
  if (url.hostname === API_HOST) return /^\/v1\/(?:Event|Categor|Agenda|Minutes|File)/i.test(url.pathname) && url.pathname !== "/v1/Events";
  if (url.hostname !== "avondaleaz.gov") return false;
  return url.pathname.startsWith("/government/public-meetings/") ||
    url.pathname.startsWith("/government/mayor-council/council-meeting-agendas/") ||
    (url.pathname === "/wp-json/wp/v2/pages" && /meeting|agenda|minutes/i.test(url.searchParams.get("search") ?? "")) ||
    (url.pathname === "/" && /meeting|agenda|minutes/i.test(url.searchParams.get("s") ?? ""));
}

function linksOfficialPortal(evidence: WorkerEvidence): boolean {
  if (publicUrl(evidence.canonicalUrl)?.hostname !== "avondaleaz.gov") return false;
  let text = evidence.text;
  if (publicUrl(evidence.canonicalUrl)?.pathname === "/wp-json/wp/v2/pages") {
    try {
      const pages: unknown = JSON.parse(text);
      if (!Array.isArray(pages)) return false;
      text = pages.map(p => typeof p?.content?.rendered === "string" ? p.content.rendered : "").join("\n");
    } catch { return false; }
  }
  return /(?:href|src)\s*=\s*["']https:\/\/avondaleaz\.portal\.civicclerk\.com(?::443)?(?:\/|["'])/i.test(text);
}

/** The implemented learned procedure is deliberately scoped to this existing owed/held artifact class. */
export function heldEventContract(root: string, artifact: ArtifactRecord): LegacyCivicExtractionContract | null {
  if (!artifact.partial) {
    const registered = registeredHeldMeetingContract(artifact.canonicalUrl);
    if (registered) return registered;
  }
  const url = publicUrl(artifact.canonicalUrl);
  if (!url || url.hostname !== API_HOST || url.pathname !== "/v1/Events" || artifact.partial) return null;
  const registry = requiredOperationalJurisdictionRegistry("az");
  const subject = registry.jurisdictions.find((j: { id: string }) => j.id === SUBJECT);
  if (!subject || !subject.sourceIds.some((id: string) => id.startsWith("MEETINGS:"))) throw new Error("WORKER_CANONICAL_OBLIGATION_MISSING");
  return { recordClass: "CIVICCLERK_EVENTS", schemaVersion: 1, subjectId: subject.id, sourceBodyId: null, sourceBodyName: null,
    publisherSlug: "avondaleaz", requiredFields: ["id", "eventName", "startDateTime", "eventDate", "categoryId", "eventCategoryName", "isPublished"],
    completenessScope: "All scalar Event rows in this immutable OData response, preserving each category. No claim to complete municipality history, subresources, or actual meeting occurrence.",
    expectedSourceDate: null };
}

interface RegistrySubject {
  readonly id: string;
  readonly govClass: string;
  readonly ownWebAddress: string | null;
  readonly sourceIds: readonly string[];
}

function registryScope(root: string, contract: GeneralizedCivicExtractionContract) {
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
  const bodies = getRegistryRuntimeReadModel().registry.bodies as {
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

/** The plan is durable work scope, not permission to sweep every artifact on its host. */
export function heldGeneralizedContract(root: string, artifact: ArtifactRecord, item: WorkItem): GeneralizedCivicExtractionContract | null {
  const contract = item.autonomousPlan?.contract;
  if (!contract || contract.schemaVersion !== 2 || artifact.partial || item.subject !== contract.subjectId || artifact.workItemId !== item.id ||
      !contract.sourceScope.canonicalUrls.includes(artifact.canonicalUrl)) return null;
  registryScope(root, contract);
  return contract;
}

function hostname(value: string): string | null {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.hostname.toLowerCase().replace(/^www\./, "") : null; }
  catch { return null; }
}

/** A mentioned vendor name is not a binding; only an explicit publisher link is walked. */
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
  } catch { /* HTML and recorded response-header text remain literal evidence. */ }
  const links = [...text.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  // Recorded redirect headers, where the acquisition's canonical URL is the known publisher.
  for (const match of text.matchAll(/^location:\s*(https?:\/\/\S+)\s*$/gmi)) links.push(match[1]);
  return links.flatMap(link => {
    try { const host = hostname(new URL(link.replace(/&amp;/g, "&"), evidence.canonicalUrl).href); return host ? [host] : []; }
    catch { return []; }
  });
}

/** Capability vocabulary maps to the method registry's existing singular field vocabulary. */
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

/** A shared content hash does not transfer the old owner's work instructions. */
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

/** A repair child can audit its completed Acquirer reuse without rewriting the
 * immutable capture's original WorkItem attribution. */
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
  siblingHeldRootFor?: ResearchRuntimeTools["siblingHeldRootFor"]; scopedReads?: boolean;
}): Promise<IndependentAuditContext> {
  const { contract } = input;
  // The method only grows, so a contract planned under an earlier version is still audited, against today's floor; one from a later version is not.
  if (contract.methodVersion > input.methodVersion) throw new Error("AUDIT_METHOD_VERSION_MISMATCH");
  // CH-26: when scoped, only the rows this audit reads (`readAuditHistory`); otherwise every row as before.
  const scoped = input.scopedReads === true ? await readAuditHistory(input.repos, { workItemId: input.workItemId, subjectId: contract.subjectId,
    requiredArtifactIds: [input.artifactId, ...contract.sourceScope.observationArtifactIds,
      ...contract.verification.authorities.flatMap(authority => [...authority.artifactIds, ...authority.authorityEvidenceArtifactIds])] }) : null;
  const artifacts = scoped?.artifacts ?? await input.repos.artifacts.readAll();
  const items = scoped?.items ?? (await input.repos.workItems.list()).map(row => row.value);
  if (!input.workItemId) throw new Error("AUDIT_WORK_ITEM_SCOPE_REQUIRED");
  const { primary, owner } = await resolvedHeldAuditAttribution({ repos: input.repos, artifacts, items,
    artifactId: input.artifactId, contract, workItemId: input.workItemId, siblingHeldRootFor: input.siblingHeldRootFor });
  const canonical = primary.workItemId === owner.id ? heldGeneralizedContract(input.root, primary, owner)
    : owner.autonomousPlan?.contract.schemaVersion === 2 && !primary.partial && owner.subject === contract.subjectId &&
      contract.sourceScope.canonicalUrls.includes(primary.canonicalUrl) ? owner.autonomousPlan.contract : null;
  if (!canonical || canonicalJson(canonical) !== canonicalJson(contract)) throw new Error("AUDIT_CANONICAL_SCOPE_MISMATCH");
  const { subject, knownUrls } = registryScope(input.root, contract);
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
  // Each expansion needs an already-rooted publisher's captured explicit link.
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

/** `auditCeilingUsd`: the rolling ceiling in force, which the auditor admits against (model-audit.ts). */
export function standingFleetRuntime(input: { root: string; /** The method knowledge, read from the field manual (`readMethodKnowledge`). */ method: MethodKnowledge; vaultRoot?: string; repos: ControlPlaneRepositories; transport?: ModelTransport; now?: () => string; auditCeilingUsd?: number;
  lifetimeHuntSubject?: (subjectId: string) => boolean;
  /** CH-26: scope each task's history reads (`scoped-history.ts`). */
  scopedReads?: boolean;
  siblingHeldRootFor?: ResearchRuntimeTools["siblingHeldRootFor"];
  /** MW-021 (2026-09-25): the auditor's transport for the jurisdiction a record is about, held on the area budget covering it. */
  transportFor?: (jurisdiction: { readonly subjectId: string; readonly state: string | null }) => ModelTransport }): FleetRuntime {
  const now = input.now ?? (() => new Date().toISOString());
  const method = input.method;
  const readEvidence = workerVaultResolver(input.repos, new DurableEvidenceStore(input.vaultRoot ?? join(input.root, ...VAULT_DIR)), "freshness");
  return { repos: input.repos, readEvidence, methodVersion: method.version, now, requireModelAudit: true,
    ...(input.scopedReads ? { scopedReads: true } : {}),
    ...(input.lifetimeHuntSubject === undefined ? {} : { lifetimeHuntSubject: input.lifetimeHuntSubject }),
    ...(input.transport ? (() => {
      const modelOptions = { ...(input.auditCeilingUsd === undefined ? {} : { ceilingUsd: input.auditCeilingUsd }), ...(input.transportFor === undefined ? {} : { transportFor: input.transportFor }),
        ...(input.lifetimeHuntSubject === undefined ? {} : { lifetimeHuntSubject: input.lifetimeHuntSubject }),
        ...(input.scopedReads ? { scopedReads: true } : {}) };
      return { auditReasoner: modelAuditReasoner(input.repos, input.transport, now, modelOptions), parseReasoner: modelParseReasoner(input.repos, input.transport, now, modelOptions),
        modelAuditSample: createModelAuditSampler(input.repos) };
    })() : {}),
    independentContext: async ({ artifactId, contract, auditScope, methodVersion, workItemId }): Promise<IndependentAuditContext> => {
      if (methodVersion !== method.version) throw new Error("AUDIT_METHOD_VERSION_MISMATCH");
      if (contract.schemaVersion === 2) return generalizedIndependentContext({ ...input, method, readEvidence, artifactId, contract, auditScope, methodVersion, workItemId });
      const primaryRow = (await input.repos.artifacts.readAll()).find(artifact => artifact.artifactId === artifactId);
      const permanentContract = primaryRow && registeredHeldMeetingContract(primaryRow.canonicalUrl, contract.subjectId);
      if (permanentContract) {
        if (auditScope !== "CAPTURED_ARTIFACT") throw new Error("AUDIT_SOURCE_UNIVERSE_NOT_ESTABLISHED");
        if (canonicalJson(permanentContract) !== canonicalJson(contract)) throw new Error("AUDIT_CANONICAL_SCOPE_MISMATCH");
        const owner = (await input.repos.workItems.mustRead(primaryRow!.workItemId)).value;
        if (owner.subject !== contract.subjectId) throw new Error("AUDIT_ARTIFACT_SUBJECT_MISMATCH");
        const captures = (await input.repos.artifacts.readAll()).filter(artifact => artifact.artifactId === artifactId && artifact.workItemId === owner.id &&
          !artifact.partial && registeredHeldMeetingContract(artifact.canonicalUrl, owner.subject));
        if (captures.length > HELD_AUDIT_MAX_ARTIFACTS || captures.reduce((sum, artifact) => sum + artifact.byteLength, 0) > HELD_AUDIT_CONTEXT_MAX_BYTES) throw new Error("AUDIT_EVIDENCE_UNIVERSE_BOUND_EXCEEDED");
        const evidence = await Promise.all(captures.map(async artifact => evidenceProjection(await readEvidence(artifact.artifactId))));
        const routes: OfficialRouteExpectation[] = evidence.map(held => ({ routeId: held.methodRouteId, canonicalUrl: held.canonicalUrl,
          applicable: true, status: "HELD", artifactIds: [held.artifactId],
          reason: "Exact registered permanent meeting source/body capture, independently read from the evidence vault." }));
        const floor = computeRouteFloor({ knowledge: method, jurisdiction: { state: "az", governmentType: "county", platform: "legistar", publisher: "webapi.legistar.com" },
          fields: ["meeting", "agenda"], adapterRoutes: routes.map(route => ({ routeId: route.routeId, label: route.reason, target: route.canonicalUrl })) });
        for (const route of floor.routes) if (!routes.some(held => held.routeId === route.routeId && held.canonicalUrl === route.target)) {
          routes.push({ routeId: route.routeId, canonicalUrl: route.target, applicable: route.obligation === "REQUIRED", status: "OPEN", artifactIds: [],
            reason: `Inherited method route remains open outside this captured-artifact audit: ${route.label}` });
        }
        return { subjectId: owner.subject, contract, methodVersion, scope: auditScope,
          publisherSurfaces: [...new Set(captures.map(artifact => artifact.canonicalUrl))],
          routes,
          evidence, startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"] };
      }
      const artifacts = await input.repos.artifacts.readAll();
      const primary = artifacts.find(a => a.artifactId === artifactId);
      if (!primary) throw new Error("AUDIT_ARTIFACT_MISSING");
      const canonical = heldEventContract(input.root, primary);
      if (!canonical || canonicalJson(canonical) !== canonicalJson(contract)) throw new Error("AUDIT_CANONICAL_SCOPE_MISMATCH");
      const items = await input.repos.workItems.list();
      const subjectItems = new Set(items.filter(i => i.value.subject === canonical.subjectId).map(i => i.id));
      if (!subjectItems.has(primary.workItemId)) throw new Error("AUDIT_ARTIFACT_SUBJECT_MISMATCH");
      const sameSubject = artifacts.filter(a => subjectItems.has(a.workItemId));
      const heldFeeds = sameSubject.filter(a => heldEventContract(input.root, a));
      const heldSurfaces = sameSubject.filter(relevantPublisherSurface);
      const relevant = new Map([...heldFeeds, ...heldSurfaces].map(a => [a.artifactId, a]));
      if (relevant.size > HELD_AUDIT_MAX_ARTIFACTS) {
        throw new Error(`AUDIT_EVIDENCE_UNIVERSE_BOUND_EXCEEDED: ${relevant.size} relevant held artifacts; maximum ${HELD_AUDIT_MAX_ARTIFACTS}; no inventory was truncated`);
      }
      const rawBytes = [...relevant.values()].reduce((sum, a) => sum + a.byteLength, 0);
      if (rawBytes > HELD_AUDIT_CONTEXT_MAX_BYTES) {
        throw new Error(`AUDIT_EVIDENCE_UNIVERSE_BOUND_EXCEEDED: ${rawBytes} relevant held bytes; maximum context ${HELD_AUDIT_CONTEXT_MAX_BYTES}; no evidence was truncated`);
      }
      const feed = evidenceProjection(await readEvidence(artifactId));
      const feeds = [feed];
      for (const other of [...new Map(heldFeeds.map(a => [a.artifactId, a])).values()]) {
        if (other.artifactId !== feed.artifactId) feeds.push(evidenceProjection(await readEvidence(other.artifactId)));
      }
      // Read every relevant complete held representation independently; no Scout or candidate prose enters.
      const surfaceEvidence: WorkerEvidence[] = [];
      for (const page of [...new Map(heldSurfaces.filter(a => !a.partial).map(a => [a.artifactId, a])).values()]) {
        surfaceEvidence.push(evidenceProjection(await readEvidence(page.artifactId)));
      }
      const publisherPage = surfaceEvidence.find(e => linksOfficialPortal(e) && publicUrl(e.canonicalUrl)?.pathname === "/wp-json/wp/v2/pages") ??
        surfaceEvidence.find(linksOfficialPortal);
      if (!publisherPage) throw new Error("AUDIT_FIRST_PARTY_PUBLISHER_BINDING_MISSING");
      const routes: OfficialRouteExpectation[] = [
        { routeId: "CIVICCLERK_EVENTS_CAPTURE", canonicalUrl: feed.canonicalUrl, applicable: true, status: "HELD", artifactIds: [feed.artifactId],
          reason: "Machine-held OData response, inventoried independently by artifact identity; captures only its stated query scope." },
        { routeId: "OFFICIAL_PUBLIC_MEETINGS_PAGE", canonicalUrl: publisherPage.canonicalUrl, applicable: true, status: "HELD", artifactIds: [publisherPage.artifactId],
          reason: "The city's held first-party WordPress page links its CivicClerk portal. This route is publisher evidence, not a producer summary." },
        { routeId: "CIVICCLERK_PORTAL_DOCUMENTS", canonicalUrl: `https://${PORTAL_HOST}/`, applicable: true, status: "OPEN", artifactIds: [],
          reason: "The official publisher's portal and per-event documents remain applicable; a captured Events page cannot discharge them." },
      ];
      for (const artifact of [...relevant.values()]) {
        const existing = routes.find(r => r.canonicalUrl === artifact.canonicalUrl);
        if (existing) {
          if (!existing.artifactIds.includes(artifact.artifactId)) {
            routes[routes.indexOf(existing)] = { ...existing, status: artifact.partial ? existing.status : "HELD",
              artifactIds: [...existing.artifactIds, artifact.artifactId] };
          }
          continue;
        }
        routes.push({ routeId: `HELD_PUBLISHER_SURFACE:${fingerprint([artifact.canonicalUrl])}`, canonicalUrl: artifact.canonicalUrl,
          applicable: true, status: artifact.partial ? "OPEN" : "HELD", artifactIds: [artifact.artifactId],
          reason: artifact.partial ? "An incomplete capture remains open; it cannot supply a complete evidence reading."
            : "A same-subject first-party representation is held and independently read. Holding bytes does not prove a successful route, an event, or a civic absence." });
      }
      const floor = computeRouteFloor({ knowledge: method,
        jurisdiction: { state: "az", governmentType: "city", platform: "civicclerk", publisher: API_HOST },
        fields: ["meeting", "agenda"], adapterRoutes: routes.filter(r => r.applicable).map(r => ({ routeId: r.routeId, label: r.reason, target: r.canonicalUrl })) });
      for (const route of floor.routes) {
        if (routes.some(r => r.routeId === route.routeId)) continue;
        // A method's publisher/tenant target is not an invented concrete endpoint.
        routes.push({ routeId: route.routeId, canonicalUrl: route.target,
          applicable: route.obligation === "REQUIRED", status: "OPEN", artifactIds: [],
          reason: `Current method projection: ${route.obligation}; ${route.proof}; ${route.label}. Applicability grade ${route.grade}; matched fields ${route.matchedFields.join(",")}; matched dimensions ${route.matchedDimensions.join(",") || "none"}. Target is the inherited publisher/tenant target, not a discovered endpoint. No inherited outcome is inferred from an unwalked route.` });
      }
      const context: IndependentAuditContext = { subjectId: canonical.subjectId, contract: canonical, publisherSurfaces: ["https://avondaleaz.gov/", `https://${API_HOST}/`, `https://${PORTAL_HOST}/`],
        methodVersion, routes, evidence: feeds, surfaceEvidence, scope: auditScope,
        startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"] };
      const contextBytes = Buffer.byteLength(canonicalJson(context));
      if (contextBytes > HELD_AUDIT_CONTEXT_MAX_BYTES) {
        throw new Error(`AUDIT_EVIDENCE_UNIVERSE_BOUND_EXCEEDED: ${contextBytes} serialized context bytes; maximum ${HELD_AUDIT_CONTEXT_MAX_BYTES}; no evidence was truncated`);
      }
      return context;
    },
  };
}

/** Enqueues existing held evidence only. It performs no civic acquisition and expands no obligation corpus. */
export async function advanceHeldWorkerFleet(root: string, runtime: FleetRuntime, maximumArtifacts = Infinity, legacyOnly = false): Promise<void> {
  if (maximumArtifacts <= 0) return;
  const records = await runtime.repos.workerResults.readAll();
  const attempts = (await runtime.repos.attempts.list()).map(a => a.value);
  let admitted = 0;
  const items = new Map((await runtime.repos.workItems.list()).map(row => [row.id, row.value]));
  const successfulAcquisitions = new Map(records.flatMap(record => record.result.role === "ACQUIRER" && record.result.verdict === "ACQUIRED" &&
    record.completion.closedAttempt.outcome === "COMPLETED" && record.completion.closedAttempt.id === record.attemptId && record.result.source.subjectId === items.get(record.workItemId)?.subject
    ? record.result.artifacts.filter(artifact => artifact.completeness === "COMPLETE" && artifact.byteCount > 0).map(artifact => [`${record.workItemId}\u0000${artifact.artifactId}`, artifact] as const) : []));
  for (const artifact of [...await runtime.repos.artifacts.readAll()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const item = items.get(artifact.workItemId);
    if (!item) continue;
    if (item.autonomousPlan?.contract.schemaVersion === 2 && legacyOnly) continue;
    const acquired = successfulAcquisitions.get(`${item.id}\u0000${artifact.artifactId}`);
    const acquisitionMatches = acquired && acquired.contentHash === artifact.contentHash && acquired.canonicalUrl === artifact.canonicalUrl &&
      acquired.byteCount === artifact.byteLength && acquired.acquisitionAttemptId === artifact.attemptId;
    const generalized = acquisitionMatches ? heldGeneralizedContract(root, artifact, item) : null;
    const contract = generalized ?? heldEventContract(root, artifact);
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
    // The drain owns current-policy reauthorization of already queued denials.
    // Such a task must not consume the slot for discovering later held work.
    if (!admission.due || admission.requiresPolicyRecheck) continue;
    if (++admitted >= maximumArtifacts) break;
  }
}

/** Held work joins the same lease queue as acquisition. Planning invokes no worker or model. */
export async function planHeldWorkerFleet(root: string, runtime: FleetRuntime, legacyOnly = false): Promise<readonly RouteTask[]> {
  await advanceHeldWorkerFleet(root, runtime, Infinity, legacyOnly);
  const attempts = (await runtime.repos.attempts.list()).map(row => row.value);
  const tasks: RouteTask[] = [];
  for (const { value: task } of await runtime.repos.routeTasks.list()) {
    if (!task.workerTask || (legacyOnly && task.workerTask.contract.schemaVersion !== 1)) continue;
    const now = (runtime.now ?? (() => new Date().toISOString()))();
    const admission = workerTaskAdmission(task, attempts, now);
    if (!admission.due) continue;
    const selected = admission.requiresPolicyRecheck ? await reauthorizeWorkerTask(runtime, task, now) : task;
    if (selected) tasks.push(selected);
  }
  return tasks;
}

export async function runHeldWorkerFleetCycle(
  root: string,
  runtime: FleetRuntime,
  legacyOnly = false,
  options: {
    readonly maximumDispatches?: number;
    readonly admitDispatch?: (work: string) => { readonly admit: true } | { readonly admit: false; readonly code: string; readonly why: string };
    readonly onDeferred?: (reason: string) => void;
  } = {},
) {
  const results = [];
  const maximum = options.maximumDispatches ?? Infinity;
  while (results.length < maximum) {
    await advanceHeldWorkerFleet(root, runtime, Infinity, legacyOnly);
    const dispatched = await drainWorkerQueue(
      runtime,
      maximum - results.length,
      task => !legacyOnly || task.workerTask?.contract.schemaVersion === 1,
      task => options.admitDispatch?.(task.id) ?? { admit: true as const },
    );
    results.push(...dispatched);
    if (!dispatched.length) break;
  }
  return results;
}
