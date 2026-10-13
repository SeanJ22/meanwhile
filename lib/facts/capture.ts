import { recordAcquisition } from "../control-plane/evidence/artifact.ts";
import { putArtifact, type EvidenceStore } from "../control-plane/evidence/store.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { WorkerPublicationCapture } from "../civic-data/worker-roster-publication.ts";
import { heldCaptureReader } from "../civic-data/worker-publication-context.ts";
import type { ProbeFetch } from "../doors/probe.ts";
import { hostSourceKind, type SourceKind } from "../control-plane/promotion/source-kinds.ts";
import { hostOf, isOfficialHost, type Provenance } from "./check.ts";

const RECEIPT_WORK_ITEM = "fact-receipts";

const KIND_PROVENANCE: Partial<Record<SourceKind, Provenance>> = { OFFICIAL: "OFFICIAL", FILING: "FILING", CAMPAIGN: "CAMPAIGN", NEWS: "NEWS" };

/** Who stands behind a saved page: the entity's own or a .gov host, a campaign, or the kind Admin gives its host. */
export function captureProvenance(capture: WorkerPublicationCapture, entityHosts: readonly string[]): Provenance {
  const url = capture.evidence.canonicalUrl;
  if (isOfficialHost(hostOf(url), entityHosts)) return "OFFICIAL";
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
  const bytes = await response.bytes();
  const host = new URL(input.url).hostname.toLowerCase();
  const { artifact } = recordAcquisition({ canonicalUrl: input.url, retrievedAt: input.now, httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "text/html", sourceId: host, methodRouteId: "fact-receipt",
    workItemId: RECEIPT_WORK_ITEM, attemptId: `fact-receipt:${input.now}`, permission: "ALLOWED", transport: "REACHABLE" }, new TextDecoder().decode(bytes));
  if (artifact.tier !== "RAW") return { error: "PAGE_HOLDS_CREDENTIALS" };
  const body = new TextEncoder().encode(new TextDecoder().decode(bytes));
  await putArtifact(input.vault, "freshness", artifact, body);
  const record: ArtifactRecord = { artifactId: artifact.id, workItemId: RECEIPT_WORK_ITEM, routeTaskId: null, attemptId: artifact.attemptId,
    tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
    canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: input.now };
  await input.repos.artifacts.append(RECEIPT_WORK_ITEM, `${artifact.id}:${input.now}`, record, input.now);
  const capture = await readHeld(record);
  return capture ? { capture } : { error: "SAVED_COPY_UNREADABLE" };
}
