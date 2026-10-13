import { recordAcquisition } from "../control-plane/evidence/artifact.ts";
import { putArtifact, type EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { heldCaptureReader } from "../civic-data/worker-publication-context.ts";
import type { ProbeFetch } from "../doors/probe.ts";
import { hostSourceKind, type SourceKind } from "../control-plane/promotion/source-kinds.ts";
import { isOfficialUrl, type Provenance } from "./check.ts";

const RECEIPT_WORK_ITEM = "fact-receipts";

const KIND_PROVENANCE: Partial<Record<SourceKind, Provenance>> = { OFFICIAL: "OFFICIAL", FILING: "FILING", CAMPAIGN: "CAMPAIGN", NEWS: "NEWS" };

/** Who stands behind a saved page: the entity's own or a .gov host, a campaign, or the kind Admin gives its host. */
export function captureProvenance(capture: WorkerPublicationCapture, entityHosts: readonly string[]): Provenance {
  const url = capture.evidence.canonicalUrl;
  if (isOfficialUrl(url, entityHosts)) return "OFFICIAL";
  if (capture.campaign) return "CAMPAIGN";
  return KIND_PROVENANCE[hostSourceKind(url, capture.sourcePolicy)] ?? "REFERENCE";
}

/** The newest saved copy of a page any job already holds, or a fresh one saved now; null when neither can be had. */
export async function receiptCapture(input: {
  readonly url: string; readonly repos: Pick<ControlPlaneRepositories, "artifacts" | "artifactsByCanonicalUrl">;
  readonly vault: EvidenceStore; readonly fetch: ProbeFetch; readonly now: string;
}): Promise<{ readonly capture: WorkerPublicationCapture } | { readonly error: string }> {
  const readHeld = heldCaptureReader(input.vault);
  for (const record of (await input.repos.artifactsByCanonicalUrl?.(input.url, 3)) ?? []) {
    const capture = await readHeld(record);
    if (capture) return { capture };
  }
  let response;
  try { response = await input.fetch(input.url, {}); } catch (error) { return { error: `FETCH_FAILED:${error instanceof Error ? error.message : String(error)}` }; }
  if (response.status < 200 || response.status >= 300) return { error: `HTTP_${response.status}` };
  return saveCapture({ repos: input.repos, vault: input.vault, url: input.url, bytes: await response.bytes(), httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "text/html", retrievedAt: input.now });
}

/** Bytes a job already read, saved to the vault as the copy facts cite; the vault key alone finds them again. */
export async function vaultCapture(input: {
  readonly vault: EvidenceStore; readonly url: string; readonly bytes: Uint8Array; readonly httpStatus: number; readonly contentType: string; readonly retrievedAt: string;
}): Promise<{ readonly capture: WorkerPublicationCapture; readonly record: ArtifactRecord } | { readonly error: string }> {
  const text = new TextDecoder().decode(input.bytes);
  const { artifact } = recordAcquisition({ canonicalUrl: input.url, retrievedAt: input.retrievedAt, httpStatus: input.httpStatus,
    contentType: input.contentType, sourceId: new URL(input.url).hostname.toLowerCase(), methodRouteId: "fact-receipt",
    workItemId: RECEIPT_WORK_ITEM, attemptId: `fact-receipt:${input.retrievedAt}`, permission: "ALLOWED", transport: "REACHABLE" }, text);
  if (artifact.tier !== "RAW") return { error: "PAGE_HOLDS_CREDENTIALS" };
  await putArtifact(input.vault, "freshness", artifact, new TextEncoder().encode(text));
  const record: ArtifactRecord = { artifactId: artifact.id, workItemId: RECEIPT_WORK_ITEM, routeTaskId: null, attemptId: artifact.attemptId,
    tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
    canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: input.retrievedAt };
  return { record, capture: { evidence: { artifactId: artifact.id, contentHash: artifact.contentHash, text, acquiredByAttemptId: artifact.attemptId,
    canonicalUrl: artifact.canonicalUrl, retrievedAt: input.retrievedAt, sourceId: artifact.sourceId, methodRouteId: artifact.methodRouteId },
    observedAt: input.retrievedAt, httpStatus: input.httpStatus, transport: "REACHABLE", partial: false } };
}

/** Bytes saved to the vault and listed with the artifacts every job reads. */
async function saveCapture(input: Parameters<typeof vaultCapture>[0] & { readonly repos: Pick<ControlPlaneRepositories, "artifacts"> }):
  Promise<{ readonly capture: WorkerPublicationCapture } | { readonly error: string }> {
  const saved = await vaultCapture(input);
  if ("error" in saved) return saved;
  await input.repos.artifacts.append(RECEIPT_WORK_ITEM, `${saved.record.artifactId}:${input.retrievedAt}`, saved.record, input.retrievedAt);
  return { capture: saved.capture };
}
