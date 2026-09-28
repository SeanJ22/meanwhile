import { NextResponse } from "next/server";
import type { ArtifactRecord } from "../repository/types.ts";
import { verifyAdminEvidenceBlob, type AdminEvidenceBlob } from "./admin-bridge.ts";

export const adminEvidencePrivateHeaders = { "cache-control": "private, no-store, max-age=0",
  "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'",
  "referrer-policy": "no-referrer" };

/** Only an authenticated Admin route calls this after exact CP ownership checks. */
export function originalEvidenceAttachment(record: ArtifactRecord, blob: AdminEvidenceBlob): NextResponse {
  const bytes = verifyAdminEvidenceBlob(record, blob);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new NextResponse(body, { status: 200, headers: { ...adminEvidencePrivateHeaders,
    "content-type": "application/octet-stream", "content-length": String(bytes.byteLength),
    "content-disposition": `attachment; filename="${record.artifactId}.bin"`,
    "x-evidence-source": "verified-original-capture", "x-evidence-sha256": record.contentHash } });
}
