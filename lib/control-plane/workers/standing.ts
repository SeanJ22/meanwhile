import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import { canonicalJson, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import { VAULT_DIR } from "../scheduler/vault.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import { modelAuditReasoner } from "./model-audit.ts";
import { workerVaultResolver } from "./vault.ts";
import { drainWorkerQueue, enqueueWorkerTask, evidenceProjection, type FleetRuntime } from "./runtime.ts";
import type { CivicExtractionContract, IndependentAuditContext, OfficialRouteExpectation } from "./types.ts";
import { computeRouteFloor } from "../preflight.ts";
import { fingerprint } from "../ids.ts";
import { workerTaskAdmission } from "./scheduling.ts";
import type { WorkerEvidence } from "./types.ts";

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
export function heldEventContract(root: string, artifact: ArtifactRecord): CivicExtractionContract | null {
  const url = publicUrl(artifact.canonicalUrl);
  if (!url || url.hostname !== API_HOST || url.pathname !== "/v1/Events" || artifact.partial) return null;
  const registry = JSON.parse(readFileSync(join(root, "data/states/az/jurisdictions/az.json"), "utf8"));
  const subject = registry.jurisdictions.find((j: { id: string }) => j.id === SUBJECT);
  if (!subject || !subject.sourceIds.some((id: string) => id.startsWith("MEETINGS:"))) throw new Error("WORKER_CANONICAL_OBLIGATION_MISSING");
  return { recordClass: "CIVICCLERK_EVENTS", schemaVersion: 1, subjectId: subject.id, sourceBodyId: null, sourceBodyName: null,
    publisherSlug: "avondaleaz", requiredFields: ["id", "eventName", "startDateTime", "eventDate", "categoryId", "eventCategoryName", "isPublished"],
    completenessScope: "All scalar Event rows in this immutable OData response, preserving each category. No claim to complete municipality history, subresources, or actual meeting occurrence.",
    expectedSourceDate: null };
}

export function standingFleetRuntime(input: { root: string; vaultRoot?: string; repos: ControlPlaneRepositories; transport?: ModelTransport; now?: () => string }): FleetRuntime {
  const now = input.now ?? (() => new Date().toISOString());
  const method = JSON.parse(readFileSync(join(input.root, "data/method/knowledge.json"), "utf8"));
  const readEvidence = workerVaultResolver(input.repos, new DurableEvidenceStore(input.vaultRoot ?? join(input.root, ...VAULT_DIR)), "freshness");
  return { repos: input.repos, readEvidence, methodVersion: method.version, now, requireModelAudit: true,
    ...(input.transport ? { auditReasoner: modelAuditReasoner(input.repos, input.transport, now) } : {}),
    independentContext: async ({ artifactId, contract, auditScope, methodVersion }): Promise<IndependentAuditContext> => {
      if (methodVersion !== method.version) throw new Error("AUDIT_METHOD_VERSION_MISMATCH");
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
export async function advanceHeldWorkerFleet(root: string, runtime: FleetRuntime, maximumArtifacts = 1): Promise<void> {
  if (maximumArtifacts <= 0) return;
  const records = await runtime.repos.workerResults.readAll();
  const attempts = (await runtime.repos.attempts.list()).map(a => a.value);
  let admitted = 0;
  for (const artifact of (await runtime.repos.artifacts.readAll()).filter(a => a.canonicalUrl.startsWith(`https://${API_HOST}/v1/Events`)).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const contract = heldEventContract(root, artifact);
    if (!contract) continue;
    const item = (await runtime.repos.workItems.mustRead(artifact.workItemId)).value;
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
        if (validator.result.verdict !== "PASS") continue;
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

export async function runHeldWorkerFleetCycle(root: string, runtime: FleetRuntime) {
  const results = [];
  for (let stage = 0; stage < 3; stage++) {
    await advanceHeldWorkerFleet(root, runtime);
    results.push(...await drainWorkerQueue(runtime, 1));
  }
  return results;
}
