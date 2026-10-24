import { artifactId, classifyAcquisition, deriveSanitized, recordAcquisition, type Artifact } from "../control-plane/evidence/artifact.ts";
import { putArtifact, readForParser, type EvidenceStore } from "../control-plane/evidence/store.ts";
import { contentHash } from "../control-plane/ids.ts";
import { evidenceProjection } from "../control-plane/workers/evidence-projection.ts";
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
  readonly windowHours?: number;
}): Promise<{ readonly capture: WorkerPublicationCapture } | { readonly error: string }> {
  const readHeld = heldCaptureReader(input.vault);
  for (const record of (await input.repos.artifactsByCanonicalUrl?.(input.url, 3)) ?? []) {
    const capture = await readHeld(record);
    if (capture && (input.windowHours === undefined || (Date.parse(input.now)-Date.parse(capture.observedAt))/3_600_000 <= input.windowHours)) return { capture };
  }
  return fetchCapture(input);
}

/** One fetch of the page by code, saved to the vault and listed with every job's artifacts. */
export async function fetchCapture(input: {
  readonly url: string; readonly repos: Pick<ControlPlaneRepositories, "artifacts">; readonly vault: EvidenceStore; readonly fetch: ProbeFetch; readonly now: string;
}): Promise<{ readonly capture: WorkerPublicationCapture } | { readonly error: string }> {
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
  const acquisition = { canonicalUrl: input.url, retrievedAt: input.retrievedAt, httpStatus: input.httpStatus,
    contentType: input.contentType, sourceId: new URL(input.url).hostname.toLowerCase(), methodRouteId: "fact-receipt",
    workItemId: RECEIPT_WORK_ITEM, attemptId: `fact-receipt:${input.retrievedAt}`, permission: "ALLOWED" as const, transport: "REACHABLE" as const };
  let text: string, artifact: Artifact;
  if (/pdf/i.test(input.contentType) || new TextDecoder().decode(input.bytes.subarray(0, 5)) === "%PDF-") {
    const { extractPdf } = await import("../control-plane/scheduler/scout-tools.ts");
    const extracted = await extractPdf(input.bytes);
    if (extracted.kind !== "TEXT" || !extracted.complete) return { error: "PDF_EXTRACTION_INCOMPLETE" };
    text = extracted.text;
    const captured = recordAcquisition({ ...acquisition, contentType: "text/plain" }, text).artifact;
    if (captured.tier === "RESTRICTED_RAW" || classifyAcquisition(new TextDecoder().decode(input.bytes)).tier === "RESTRICTED_RAW") {
      // A PDF holding a key-like string is never re-saved; its extracted text, blanked, is the copy facts are checked against.
      if (captured.tier === "RESTRICTED_RAW") {
        const sanitized = deriveSanitized(captured, text, input.retrievedAt);
        artifact = sanitized.artifact; text = sanitized.text;
      } else artifact = captured;
    } else {
      const hash = contentHash(input.bytes);
      const parent: Artifact = { ...acquisition, headers: {}, retrievalUrl: input.url, id: artifactId("RAW", hash), tier: "RAW",
        contentHash: hash, byteLength: input.bytes.byteLength, retentionPolicy: "EVIDENCE_PERMANENT" };
      await putArtifact(input.vault, "freshness", parent, input.bytes);
      artifact = { ...captured, id: artifactId("EXTRACTED_DERIVED", captured.contentHash), tier: "EXTRACTED_DERIVED",
        extraction: { kind: "PDF_TEXT", version: "pdf-transcription/1", complete: true, pages: extracted.pages, parent } };
    }
  } else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes); }
    catch { return { error: "SOURCE_TEXT_ENCODING_UNREADABLE" }; }
    const captured = recordAcquisition(acquisition, text).artifact;
    if (captured.tier === "RESTRICTED_RAW") {
      const sanitized = deriveSanitized(captured, text, input.retrievedAt);
      artifact = sanitized.artifact; text = sanitized.text;
    } else artifact = captured;
  }
  await putArtifact(input.vault, "freshness", artifact, new TextEncoder().encode(text));
  const { input: saved } = await readForParser(input.vault, "freshness", artifact);
  const record: ArtifactRecord = { artifactId: artifact.id, workItemId: RECEIPT_WORK_ITEM, routeTaskId: null, attemptId: artifact.attemptId,
    tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
    canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: input.retrievedAt };
    return { record, capture: { evidence: evidenceProjection(saved),
    observedAt: input.retrievedAt, httpStatus: input.httpStatus, transport: "REACHABLE", partial: false } };
}

/** Bytes saved to the vault and listed with the artifacts every job reads. */
async function saveCapture(input: Parameters<typeof vaultCapture>[0] & { readonly repos: Pick<ControlPlaneRepositories, "artifacts"> }):
  Promise<{ readonly capture: WorkerPublicationCapture } | { readonly error: string }> {
  const saved = await vaultCapture(input);
  if ("error" in saved) return saved;
  await input.repos.artifacts.append(RECEIPT_WORK_ITEM, `${saved.record.artifactId}:${input.retrievedAt}:${input.url}`, saved.record, input.retrievedAt);
  return { capture: saved.capture };
}
