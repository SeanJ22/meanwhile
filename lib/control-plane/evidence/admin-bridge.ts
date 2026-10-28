/** Private, immutable copy of an already-held capture for authenticated Admin download. */
import { createHash } from "node:crypto";
import type { Attempt } from "../attempt.ts";
import type { ArtifactRecord } from "../repository/types.ts";
import { artifactId, classifyAcquisition } from "./artifact.ts";
import type { HeldVaultArtifact } from "./read-only-vault.ts";

export const ADMIN_EVIDENCE_STORE_NAME = "admin-evidence-private";
export const ADMIN_EVIDENCE_MAX_BYTES = 32 * 1024 * 1024;

export interface AdminEvidenceCopy {
  readonly artifactId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly tier: "RAW";
  readonly source: "VERIFIED_ORIGINAL_CAPTURE";
}

export interface AdminEvidenceBlob {
  readonly bytes: Uint8Array;
  readonly copy: AdminEvidenceCopy;
}

export interface AdminEvidenceRemote {
  read(key: string): Promise<AdminEvidenceBlob | null>;
  /** Must use an immutable create-if-absent operation. False means another copy already exists. */
  create(key: string, blob: AdminEvidenceBlob): Promise<boolean>;
}

export class AdminEvidenceRefusal extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; this.name = "AdminEvidenceRefusal"; }
}

const sha = (bytes: Uint8Array): string => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
const validId = (value: string): boolean => /^[a-z][a-z0-9-]{1,120}$/.test(value);
const scannableText = (contentType: string): boolean =>
  /^(?:text\/(?:html|plain|csv|xml)|application\/(?:xhtml\+xml|json|xml))(?:\s*;|$)/i.test(contentType);
const allowedBinary = (contentType: string): boolean =>
  /^(?:application\/pdf|image\/(?:png|jpeg|gif|webp|tiff))(?:\s*;|$)/i.test(contentType);
export const adminMirrorableContentType = (contentType: string): boolean => scannableText(contentType) || allowedBinary(contentType);
const remainsRaw = (contentType: string, bytes: Uint8Array): boolean =>
  !scannableText(contentType) || classifyAcquisition(Buffer.from(bytes).toString("utf8")).tier === "RAW";

/** Never use user-provided blob keys. All four immutable identity components come from the CP record. */
export function adminEvidenceKey(record: ArtifactRecord): string {
  if (![record.workItemId, record.attemptId, record.artifactId].every(validId) ||
      !/^sha256-[0-9a-f]{64}$/.test(record.contentHash) ||
      artifactId(record.tier, record.contentHash) !== record.artifactId) throw new AdminEvidenceRefusal("INVALID_RECORD_IDENTITY");
  return `freshness/${record.workItemId}/${record.attemptId}/${record.artifactId}/${record.contentHash}`;
}

export function assertOriginalCapture(record: ArtifactRecord, attempt: Attempt, held: HeldVaultArtifact, bytes: Uint8Array): AdminEvidenceCopy {
  if (record.tier !== "RAW" || held.tier !== "RAW") throw new AdminEvidenceRefusal("RAW_ONLY");
  if (!adminMirrorableContentType(record.contentType) || record.contentType !== held.contentType) throw new AdminEvidenceRefusal("UNSCANNABLE_OR_MISMATCHED_CONTENT_TYPE");
  if (held.retentionPolicy !== "EVIDENCE_PERMANENT") throw new AdminEvidenceRefusal("RETENTION_NOT_MIRRORABLE");
  if (record.partial) throw new AdminEvidenceRefusal("PARTIAL_CAPTURE");
  if (held.httpStatus === 206) throw new AdminEvidenceRefusal("PARTIAL_SOURCE_RESPONSE");
  if (record.artifactId !== held.id || record.contentHash !== held.contentHash ||
      record.workItemId !== held.workItemId || record.attemptId !== held.attemptId ||
      record.canonicalUrl !== held.canonicalUrl || record.recordedAt !== held.retrievedAt ||
      attempt.id !== record.attemptId || attempt.workItemId !== record.workItemId ||
      !attempt.artifactIds.includes(record.artifactId)) throw new AdminEvidenceRefusal("ATTRIBUTION_MISMATCH");
  if (record.byteLength > ADMIN_EVIDENCE_MAX_BYTES || bytes.byteLength > ADMIN_EVIDENCE_MAX_BYTES)
    throw new AdminEvidenceRefusal("EXCEEDS_PRIVATE_COPY_LIMIT_32_MIB");
  const raw = held.rawCapture;
  const heldHash = raw ? `sha256-${raw.rawHash}` : held.bodySha256;
  const validPointer = !raw || raw.vaultKey === `project/freshness/raw/sha256/${raw.rawHash}` &&
    raw.byteLength === bytes.byteLength && sha(new TextEncoder().encode(JSON.stringify(raw))) === held.bodySha256;
  if (!validPointer || bytes.byteLength !== record.byteLength ||
      sha(bytes) !== record.contentHash || sha(bytes) !== heldHash) throw new AdminEvidenceRefusal("BYTES_MISMATCH");
  // The original scanner is also the mirror's final gate. A newly recognized credential
  // must never be exported merely because an older sidecar called the body RAW.
  if (!remainsRaw(record.contentType, bytes)) throw new AdminEvidenceRefusal("RESTRICTED_ON_RESCAN");
  return { artifactId: record.artifactId, workItemId: record.workItemId, attemptId: record.attemptId,
    contentHash: record.contentHash, byteLength: record.byteLength, tier: "RAW", source: "VERIFIED_ORIGINAL_CAPTURE" };
}

export function verifyAdminEvidenceBlob(record: ArtifactRecord, blob: AdminEvidenceBlob): Uint8Array {
  adminEvidenceKey(record);
  if (record.byteLength > ADMIN_EVIDENCE_MAX_BYTES || blob.bytes.byteLength > ADMIN_EVIDENCE_MAX_BYTES)
    throw new AdminEvidenceRefusal("EXCEEDS_PRIVATE_COPY_LIMIT_32_MIB");
  const copy = blob.copy;
  if (record.tier !== "RAW" || record.partial || !adminMirrorableContentType(record.contentType) ||
      copy.tier !== "RAW" || copy.source !== "VERIFIED_ORIGINAL_CAPTURE" ||
      copy.artifactId !== record.artifactId || copy.workItemId !== record.workItemId ||
      copy.attemptId !== record.attemptId || copy.contentHash !== record.contentHash ||
      copy.byteLength !== record.byteLength || blob.bytes.byteLength !== record.byteLength ||
      sha(blob.bytes) !== record.contentHash ||
      !remainsRaw(record.contentType, blob.bytes)) {
    throw new AdminEvidenceRefusal("REMOTE_COPY_MISMATCH");
  }
  return blob.bytes;
}

/** A missing copy remains missing; retries cannot silently replace an occupied key. */
export async function mirrorOriginalCapture(input: {
  readonly record: ArtifactRecord;
  readonly attempt: Attempt;
  readonly held: HeldVaultArtifact;
  readonly bytes: Uint8Array;
  readonly remote: AdminEvidenceRemote;
}): Promise<"COPIED" | "ALREADY_VERIFIED"> {
  const copy = assertOriginalCapture(input.record, input.attempt, input.held, input.bytes);
  const key = adminEvidenceKey(input.record);
  const existing = await input.remote.read(key);
  if (existing) { verifyAdminEvidenceBlob(input.record, existing); return "ALREADY_VERIFIED"; }
  const created = await input.remote.create(key, { bytes: input.bytes, copy });
  const committed = await input.remote.read(key);
  if (!committed) throw new AdminEvidenceRefusal("REMOTE_COPY_NOT_VERIFIED");
  verifyAdminEvidenceBlob(input.record, committed);
  if (!created && committed.copy.source !== copy.source) throw new AdminEvidenceRefusal("REMOTE_COPY_MISMATCH");
  return created ? "COPIED" : "ALREADY_VERIFIED";
}
