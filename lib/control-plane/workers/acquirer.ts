import { sourceReliabilityKey, type SourceReliability } from "../scheduler/scout-reliability.ts";
import { ACCESS_CONTROL_STATUSES, type AccessControlKind } from "../../hunt/access-control.ts";
import type { WorkerRef } from "../attempt.ts";
import { requireCapability, type CapabilityGrant } from "../capability.ts";
import { artifactId, type Artifact } from "../evidence/artifact.ts";
import { objectKey } from "../evidence/store.ts";
import { contentHash } from "../ids.ts";
import type { ScoutToolkit, ScoutToolCallResult } from "../scheduler/scout-contract.ts";
import type { PermissionState, TransportState } from "../../workstate/types.ts";
import { assertResearchResult, type AcquiredResearchArtifact, type AcquirerResult, type AcquirerTaskSpec,
  type EvidenceWalkStep, type ResearchBlocker, type ResearchSpan } from "./research-types.ts";

export interface VaultedResearchEvidence {
  readonly artifact: Artifact;
  readonly key: string;
  readonly bytes: Uint8Array;
}
export interface AcquirerRuntime {
  readonly sourceReliability?: readonly SourceReliability[];
  /** Build through buildScoutToolkit: permission, public URL, rate limits, browser and vault stay shared. */
  readonly toolkit: ScoutToolkit;
  readonly readVault: (artifactId: string) => Promise<VaultedResearchEvidence>;
  /** A broker check of the immutable linked repair chain, required only when
   * cached bytes belong to an ancestor WorkItem rather than this one. */
  readonly authorizeInheritedHeld?: (input: { readonly artifactId: string; readonly originWorkItemId: string;
    readonly childWorkItemId: string; readonly project: string }) => Promise<boolean>;
}
export interface AcquirerWorkerInput extends AcquirerTaskSpec {
  readonly attemptId: string;
  readonly worker: WorkerRef;
  readonly project: string;
  readonly workItemId: string;
  readonly grant: CapabilityGrant;
  readonly now: () => string;
}

/** Checks bytes again at the worker boundary, including cache hits and route observations. */
export function assertVaultedResearchEvidence(held: VaultedResearchEvidence, expectedId: string, project: string): void {
  const a = held.artifact;
  if (!project || /[\\/]/.test(project) || held.key !== objectKey(project, a) || a.id !== expectedId ||
    contentHash(held.bytes) !== a.contentHash || artifactId(a.tier, a.contentHash) !== a.id || a.byteLength !== held.bytes.byteLength ||
    !Number.isFinite(Date.parse(a.retrievedAt))) throw new Error("ACQUIRER_EVIDENCE_IDENTITY_MISMATCH");
}
function exactSpan(held: VaultedResearchEvidence, span: ResearchSpan): string {
  const text = new TextDecoder().decode(held.bytes);
  if (held.artifact.tier === "RESTRICTED_RAW" || span.contentHash !== held.artifact.contentHash ||
    span.offsetUnit !== "UTF16_CODE_UNITS" || !Number.isSafeInteger(span.start) || span.start < 0 ||
    span.end <= span.start || text.slice(span.start, span.end) !== span.quote) throw new Error("ACQUIRER_UNGROUNDED_ROUTE");
  return text;
}
function responseStatus(call: ScoutToolCallResult): number | null {
  if (call.step?.httpStatus !== undefined) return call.step.httpStatus;
  return Number(/\bHTTP (\d{3})\b/.exec(call.step?.observed ?? "")?.[1]) || null;
}
/**
 * The access control the retrieval met, from the machine-written step: a 401/402/403/407/429/451 answer, or the kind
 * the toolkit names when a bot challenge answered in place of the page (`HTTP 200 (CHALLENGE)`). Null when none.
 */
function accessControlOf(call: ScoutToolCallResult, status: number | null): AccessControlKind | null {
  const named = /\((AUTHENTICATION|PAYMENT|FORBIDDEN|RATE_LIMIT|LEGAL|CHALLENGE)\)/.exec(call.step?.observed ?? "")?.[1];
  if (named !== undefined) return named as AccessControlKind;
  return status === null ? null : ACCESS_CONTROL_STATUSES[status] ?? null;
}
function responseTransport(call: ScoutToolCallResult): TransportState | "NOT_ATTEMPTED" {
  if (call.step?.transport !== undefined) return call.step.transport;
  const s = responseStatus(call);
  if (s !== null) return s >= 200 && s < 300 ? "REACHABLE" : [401, 403, 429].includes(s) ? "CHALLENGED" : "FAILED_AT_RUNG";
  if (/timeout|timed out|abort/i.test(call.step?.observed ?? "")) return "TIMEOUT";
  return /transport failure/i.test(call.step?.observed ?? "") ? "OTHER_NAMED_FAILURE" : "NOT_ATTEMPTED";
}

/** HUNTER is the ACQUIRER role, with no promotion capability or new persistence path. */
export async function runAcquirer(input: AcquirerWorkerInput, runtime: AcquirerRuntime): Promise<AcquirerResult> {
  const { route } = input;
  const artifacts: AcquiredResearchArtifact[] = [];
  const artifactIds = new Set<string>();
  const walk: EvidenceWalkStep[] = [];
  const blockers: ResearchBlocker[] = [];
  const recoveredCacheFindings: AcquirerResult["findings"][number][] = [];
  let requests = 0;
  let bytesFetched = 0;
  let permission: PermissionState = route.permission;
  let sourceGrounding: NonNullable<AcquirerResult["sourceGrounding"]> = { verdict: "UNPROVEN", checkedArtifactIds: [] };
  const stamp = () => input.now();
  const block = (code: ResearchBlocker["code"], description: string, retryable: boolean) => {
    // This dates the detected blocker. Source freshness remains the vaulted retrieval time.
    const detectedAt = input.now();
    blockers.push({ code, description, worker: input.worker, attemptId: input.attemptId, observedAt: detectedAt,
      artifactIds: [...artifactIds], retryable, anotherRouteRemains: route.nextRouteIds.length > 0, operatorDecisionRequired: false });
  };
  const result = (verdict: AcquirerResult["verdict"]): AcquirerResult => {
    const r: AcquirerResult = { role: "ACQUIRER", attemptId: input.attemptId, verdict, source: route, sourceGrounding, artifacts,
      artifactIds: [...artifactIds], findings: [...recoveredCacheFindings, ...blockers.map(b => ({ code: b.code, detail: b.description, severity: "BLOCKING" as const }))],
      blockers, walk, walkState: { state: "OPEN", nextRouteIds: [...new Set([...(verdict === "ACQUIRED" ? [] : [route.id]), ...route.nextRouteIds])] },
      requestCount: requests, bytesFetched };
    assertResearchResult(r, "ACQUIRER", input.attemptId);
    return r;
  };
  const addStep = (rung: string, observed: string, outcome: EvidenceWalkStep["outcome"], ids: readonly string[],
    transport: EvidenceWalkStep["transport"], returnedCount: number | null = null) => {
    walk.push({ sequence: walk.length, at: stamp(), worker: input.worker, attemptId: input.attemptId, routeId: route.id,
      rung, target: route.url, applicableBecause: route.applicableBecause, permission, transport, observed, returnedCount,
      artifactIds: ids, nextRouteIds: route.nextRouteIds, outcome, pass: "INITIAL" });
  };
  try {
    if (input.worker.role !== "ACQUIRER" || input.grant.role !== "ACQUIRER" || input.grant.project !== input.project) throw new Error("ACQUIRER_CAPABILITY_DENIED");
    requireCapability(input.grant, "VAULT_READ_SANITIZED");
  } catch {
    block("CAPABILITY_DENIED", "The Attempt does not hold the scoped ACQUIRER vault-read grant.", false);
    addStep("source-observation", "Capability refused before reading or requesting source bytes.", "NOT_WALKED", [], "NOT_ATTEMPTED");
    return result("BLOCKED");
  }
  try {
    if (![route.id, route.subjectId, route.jurisdiction, route.recordClass, route.sourceId, route.publisher, route.applicableBecause].every(s => s.trim()) ||
      !route.publisherSubjectEvidence.length || !Number.isFinite(Date.parse(route.observedAt)) || !Number.isFinite(Date.parse(route.firstObservedAt)) ||
      Date.parse(route.firstObservedAt) > Date.parse(route.observedAt) || Date.parse(route.observedAt) > Date.parse(stamp())) throw new Error("ACQUIRER_UNGROUNDED_ROUTE");
    const source = await runtime.readVault(route.observation.artifactId);
    assertVaultedResearchEvidence(source, route.observation.artifactId, input.project);
    exactSpan(source, route.observation);
    let quotedLocator: string | null = null;
    try { const decoded: unknown = JSON.parse(route.observation.quote); if (typeof decoded === "string") quotedLocator = decoded; } catch { /* HTML/text observations are literal. */ }
    if ((!route.observation.quote.includes(route.observedLocator) && quotedLocator !== route.observedLocator && source.artifact.canonicalUrl !== route.observedLocator) ||
      new URL(route.observedLocator, source.artifact.canonicalUrl).href !== new URL(route.url).href ||
      Date.parse(source.artifact.retrievedAt) > Date.parse(route.observedAt)) throw new Error("ACQUIRER_UNGROUNDED_ROUTE");
    artifactIds.add(source.artifact.id);
    for (const span of route.publisherSubjectEvidence) {
      const held = await runtime.readVault(span.artifactId);
      assertVaultedResearchEvidence(held, span.artifactId, input.project);
      exactSpan(held, span);
      artifactIds.add(held.artifact.id);
    }
    sourceGrounding = { verdict: "OBSERVED", checkedArtifactIds: [...artifactIds] };
  } catch {
    block("UNGROUNDED_ROUTE", "The exact observed locator or publisher/subject evidence cannot be reproduced from the scoped vault.", false);
    addStep("source-observation", "Source observation failed exact evidence binding; no network request was sent.", "NOT_WALKED", [...artifactIds], "NOT_ATTEMPTED");
    return result("BLOCKED");
  }
  const accept = (held: VaultedResearchEvidence, reused: boolean, partial: boolean, fromWorkItemId = input.workItemId): AcquiredResearchArtifact => {
    const a = held.artifact;
    assertVaultedResearchEvidence(held, a.id, input.project);
    if (a.canonicalUrl !== route.url || a.sourceId !== route.sourceId || a.workItemId !== fromWorkItemId ||
      a.transport !== "REACHABLE" || a.httpStatus < 200 || a.httpStatus >= 300 || a.retentionPolicy === "DIAGNOSTIC" || a.tier === "RESTRICTED_RAW" ||
      (route.representation && (a.extraction?.kind !== route.representation || !a.extraction.complete))) {
      throw new Error("ACQUIRER_EVIDENCE_IDENTITY_MISMATCH");
    }
    // A literal [] is an empty captured response, never proof of civic absence.
    const empty = a.byteLength === 0 || (/json/i.test(a.contentType) && new TextDecoder().decode(held.bytes).trim() === "[]");
    return { artifactId: a.id, sourceRouteId: route.id, sourceObservationArtifactId: route.observation.artifactId,
      canonicalUrl: a.canonicalUrl, sourceId: a.sourceId, acquisitionAttemptId: a.attemptId, retrievedAt: a.retrievedAt,
      contentHash: a.contentHash, byteCount: a.byteLength, contentType: a.contentType, tier: a.tier,
      completeness: partial || a.httpStatus === 206 || Boolean(a.headers["content-range"]) ? "PARTIAL" : empty ? "EMPTY" : "COMPLETE",
      vaultKey: held.key, transport: a.transport, httpStatus: a.httpStatus, reused };
  };
  for (const cached of input.held) {
    if (!cached.immutable || cached.partial || cached.sourceRouteId !== route.id || cached.sourceObservationArtifactId !== route.observation.artifactId ||
      Date.parse(cached.currentUntil) <= Date.parse(stamp()) || !Number.isFinite(Date.parse(cached.currentUntil))) continue;
    try {
      if (cached.inheritedFromWorkItemId && cached.inheritedFromWorkItemId !== input.workItemId &&
        (!runtime.authorizeInheritedHeld || !await runtime.authorizeInheritedHeld({ artifactId: cached.artifactId,
          originWorkItemId: cached.inheritedFromWorkItemId, childWorkItemId: input.workItemId, project: input.project }))) {
        throw new Error("ACQUIRER_HELD_LINEAGE_NOT_AUTHORIZED");
      }
      const acquired = accept(await runtime.readVault(cached.artifactId), true, false, cached.inheritedFromWorkItemId ?? input.workItemId);
      if (acquired.completeness !== "COMPLETE") continue;
      artifacts.push(acquired); artifactIds.add(acquired.artifactId);
      // One invalid cache candidate does not disqualify a separately verified
      // held capture. Keep its diagnosis, but it no longer blocks acquisition.
      for (const failure of blockers.splice(0)) recoveredCacheFindings.push({ code: failure.code,
        detail: `${failure.description} Another supplied immutable capture passed the full identity check.`, severity: "WARNING" });
      addStep("immutable-vault-reuse", "Current immutable evidence was rehashed from the vault; no request was needed.", "WALKED_AND_FOUND", [acquired.artifactId], "NOT_ATTEMPTED", 1);
      return result("ACQUIRED");
    } catch {
      block("EVIDENCE_IDENTITY_MISMATCH", `Declared current immutable artifact ${cached.artifactId} failed its vault identity/provenance check.`, false);
      addStep("immutable-vault-reuse", "Cache integrity check failed; evidence was not used.", "BLOCKED", [...artifactIds], "NOT_ATTEMPTED");
    }
  }
  // Exhausting the supplied alternatives preserves the existing fail-closed
  // boundary: an integrity failure does not authorize another network fetch.
  if (blockers.length) return result("BLOCKED");
  /* The route's recorded robots.txt verdict never blocks it; an access control judged from the retrieval's own answer does. PERMISSION_DENIED and PERMISSION_UNKNOWN remain only for older results. */
  try {
    requireCapability(input.grant, "NETWORK_PUBLIC_READ"); requireCapability(input.grant, "VAULT_WRITE");
    if (route.retrieval === "browse") requireCapability(input.grant, "BROWSER_DRIVE");
  } catch {
    block("CAPABILITY_DENIED", "The Attempt lacks the network, vault-write, or browser capability needed for this route.", false);
    addStep("permission", "Capability denied before permission/network tools were called.", "NOT_WALKED", [...artifactIds], "NOT_ATTEMPTED");
    return result("BLOCKED");
  }
  const reliability = runtime.sourceReliability?.find(row => row.source === sourceReliabilityKey(route.url));
  if (reliability?.retryAt && Date.parse(reliability.retryAt) > Date.parse(stamp())) {
    block("RATE_LIMITED", "Source backoff until " + reliability.retryAt + "; Detective must try a different route. " + reliability.detail, true);
    addStep("source-backoff", "Known source outage; no repeated request sent.", "NOT_WALKED", [...artifactIds], "NOT_ATTEMPTED");
    return result("BLOCKED");
  }
  {
    const call = await runtime.toolkit.call(route.retrieval, { url: route.url });
    requests += call.requestCount; bytesFetched += call.bytesFetched;
    permission = call.step?.permission ?? permission;
    for (const a of call.artifacts) artifactIds.add(a.artifactId);
    const transport = responseTransport(call);
    const status = responseStatus(call);
    /* Recorded, never a gate: robots.txt is read with the retrieval and its own answer decides. */
    addStep("permission", call.step?.permission ? `robots.txt verdict ${call.step.permission}` : "robots.txt verdict not recorded",
      call.step?.permission ? "WALKED_AND_FOUND" : "NOT_WALKED", [], call.step?.permission ? "REACHABLE" : "NOT_ATTEMPTED");
    for (const offered of call.artifacts.filter(a => a.canonicalUrl === route.url)) {
      try {
        const held = await runtime.readVault(offered.artifactId);
        if (route.representation && held.artifact.extraction?.kind !== route.representation) continue;
        if (held.artifact.transport === "REACHABLE" && held.artifact.retentionPolicy !== "DIAGNOSTIC") artifacts.push(accept(held, false, offered.partial));
      } catch {
        block("EVIDENCE_IDENTITY_MISMATCH", "The toolkit's artifact cannot be reproduced with its exact route, source, bytes and vault identity.", false);
      }
    }
    const verdict: AcquirerResult["verdict"] = artifacts.some(a => a.completeness === "PARTIAL") ? "PARTIAL" :
      artifacts.some(a => a.completeness === "COMPLETE") ? "ACQUIRED" : artifacts.some(a => a.completeness === "EMPTY") ? "EMPTY" : "BLOCKED";
    const emptyRead = transport === "REACHABLE" && /\(0 bytes\)/.test(call.step?.observed ?? "");
    addStep(route.retrieval, call.step?.observed ?? "The shared retrieval tool could not run.",
      verdict === "EMPTY" || emptyRead ? "WALKED_AND_EMPTY" : verdict === "BLOCKED" ? "BLOCKED" : "WALKED_AND_FOUND",
      call.artifacts.map(a => a.artifactId), transport, verdict === "EMPTY" || emptyRead ? 0 : artifacts.length || null);
    if (verdict === "BLOCKED" && !blockers.length) {
      /* An access control is a wall: recorded, never bypassed, and another public route is still owed. */
      const control = accessControlOf(call, status);
      block(control === "RATE_LIMIT" ? "RATE_LIMITED" : control !== null ? "PUBLISHER_AUTHENTICATION" :
        transport === "REACHABLE" ? "DOCUMENT_INACCESSIBLE" : "TRANSPORT_FAILED",
      "The exact public record was not acquired; the machine-recorded step preserves the robots.txt verdict and the transport outcome.", true);
    }
    return result(blockers.length ? "BLOCKED" : verdict);
  }
}
