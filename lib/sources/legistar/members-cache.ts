import { createHash } from "node:crypto";
import { recordAcquisition } from "../../control-plane/evidence/artifact.ts";
import { artifactMeta, objectIncompatibility, objectKey, type EvidenceStore } from "../../control-plane/evidence/store.ts";
import { rawCaptureMetadata, rawCapturePointer } from "../../control-plane/evidence/raw-pointer.ts";
import { holdRawCapture } from "../../civic-data/raw-capture-vault.ts";
import { FRESHNESS_PROJECT } from "../../control-plane/scheduler/durable.ts";
import { memberReading, type MemberReading } from "./members-model.ts";

/** Save a newly fetched source once, by its fingerprint. */
export async function saveLegistarReading(vault: EvidenceStore, slug: string, reading: {
  url: string; text: string; retrievedAt: string; body: unknown;
}) {
  const { artifact } = recordAcquisition({ canonicalUrl: reading.url, retrievedAt: reading.retrievedAt, httpStatus: 200, contentType: "application/json",
    sourceId: `legistar:${slug}`, methodRouteId: "legistar-members", workItemId: `legistar-members:${slug}`, attemptId: reading.retrievedAt,
    permission: "ALLOWED", transport: "REACHABLE" }, reading.text);
  if (artifact.tier !== "RAW") throw new Error("LEGISTAR_MEMBERS_CAPTURE_RESTRICTED");
  const ref = await holdRawCapture(vault, artifact.sourceId, reading.text, artifact.contentType);
  const key = objectKey(FRESHNESS_PROJECT, artifact), meta = artifactMeta(artifact);
  const existing = await vault.head(key);
  if (existing) {
    if (objectIncompatibility(rawCaptureMetadata(existing), meta)) throw new Error("LEGISTAR_MEMBERS_CAPTURE_METADATA_CONFLICT");
  } else {
    const pointer = rawCapturePointer(ref, meta);
    await vault.put(key, pointer.bytes, pointer.meta);
  }
  return memberReading(artifact, reading.body, reading.text);
}

/** Publish from the bytes just fetched, without downloading the saved copy. */
export function legistarMemberCapture(reading: MemberReading) {
  const { artifact, text } = reading;
  const bytes = Buffer.from(text);
  if (`sha256-${createHash("sha256").update(bytes).digest("hex")}` !== artifact.contentHash || bytes.byteLength !== artifact.byteLength)
    throw new Error("LEGISTAR_MEMBERS_CAPTURE_HASH_INVALID");
  return { evidence: { artifactId: artifact.id, contentHash: artifact.contentHash, text, acquiredByAttemptId: artifact.attemptId,
    canonicalUrl: artifact.canonicalUrl, retrievedAt: artifact.retrievedAt, sourceId: artifact.sourceId, methodRouteId: artifact.methodRouteId },
    observedAt: artifact.retrievedAt, httpStatus: 200, transport: "REACHABLE" as const, partial: false };
}
