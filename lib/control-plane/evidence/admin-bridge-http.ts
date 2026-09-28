import { NextResponse } from "next/server";
import type { ArtifactRecord } from "../repository/types.ts";
import { verifyAdminEvidenceBlob, type AdminEvidenceBlob } from "./admin-bridge.ts";

// Netlify's buffered function response is capped at 6 MB, with binary overhead.
// Keep every response below the effective 4.5 MB binary ceiling.
export const ADMIN_EVIDENCE_RESPONSE_BYTES = 4 * 1024 * 1024;

export const adminEvidencePrivateHeaders = { "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
  "referrer-policy": "no-referrer" };

/** Only an authenticated Admin route calls this after exact CP ownership checks. */
export function originalEvidenceAttachment(record: ArtifactRecord, blob: AdminEvidenceBlob, part?: number): NextResponse {
  const bytes = verifyAdminEvidenceBlob(record, blob);
  const parts = Math.max(1, Math.ceil(bytes.byteLength / ADMIN_EVIDENCE_RESPONSE_BYTES));
  if (part === undefined && parts > 1) throw new Error("CHUNKED_DOWNLOAD_REQUIRED");
  if (part !== undefined && (!Number.isSafeInteger(part) || part < 0 || part >= parts))
    throw new Error("INVALID_EVIDENCE_PART");
  const offset = part === undefined ? 0 : part * ADMIN_EVIDENCE_RESPONSE_BYTES;
  const selected = bytes.subarray(offset, Math.min(bytes.byteLength, offset + ADMIN_EVIDENCE_RESPONSE_BYTES));
  const body = new ArrayBuffer(selected.byteLength);
  new Uint8Array(body).set(selected);
  return new NextResponse(body, { status: 200, headers: { ...adminEvidencePrivateHeaders,
    "content-type": "application/octet-stream", "content-length": String(selected.byteLength),
    "content-disposition": `attachment; filename="${record.artifactId}.bin"`,
    "x-evidence-source": "verified-original-capture", "x-evidence-sha256": record.contentHash,
    "x-evidence-full-length": String(bytes.byteLength), "x-evidence-parts": String(parts),
    "x-evidence-part": String(part ?? 0), "x-evidence-byte-offset": String(offset) } });
}
