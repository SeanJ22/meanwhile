import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { adminEvidenceKey, verifyAdminEvidenceBlob } from "@/lib/control-plane/evidence/admin-bridge.ts";
import type { AdminEvidenceBlob } from "@/lib/control-plane/evidence/admin-bridge.ts";
import { NetlifyAdminEvidenceRemote } from "@/lib/control-plane/evidence/admin-bridge-netlify.ts";
import type { ArtifactRecord } from "@/lib/control-plane/repository/types.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const safeId = (id: string): boolean => /^[a-z][a-z0-9-]{1,120}$/.test(id);
const privateHeaders = { "cache-control": "private, no-store, max-age=0", "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox; default-src 'none'", "referrer-policy": "no-referrer" };

/** Only the authenticated GET calls this; exported for response-contract tests. */
export function originalEvidenceAttachment(record: ArtifactRecord, blob: AdminEvidenceBlob): NextResponse {
  const bytes = verifyAdminEvidenceBlob(record, blob);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  return new NextResponse(body, { status: 200, headers: { ...privateHeaders,
    "content-type": "application/octet-stream", "content-length": String(bytes.byteLength),
    "content-disposition": `attachment; filename="${record.artifactId}.bin"`,
    "x-evidence-source": "verified-original-capture", "x-evidence-sha256": record.contentHash } });
}

/** The route serves a checked copy of original bytes; it never fetches the publisher again. */
export async function GET(request: NextRequest, context: { params: Promise<{
  workItemId: string; attemptId: string; artifactId: string;
}> }): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers: privateHeaders })
    : NextResponse.json({ error: guard.says }, { status: guard.status, headers: privateHeaders });
  const { workItemId, attemptId, artifactId } = await context.params;
  if (![workItemId, attemptId, artifactId].every(safeId))
    return NextResponse.json({ error: "Invalid evidence identity." }, { status: 400, headers: privateHeaders });
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ error: "The evidence record could not be read." }, { status: 503, headers: privateHeaders });
  try {
    const [records, attempt, workItem] = await Promise.all([
      opened.repos.artifacts.read(workItemId), opened.repos.attempts.read(attemptId), opened.repos.workItems.read(workItemId),
    ]);
    const record = records.find(row => row.artifactId === artifactId && row.attemptId === attemptId);
    if (!record || record.tier !== "RAW" || record.partial || !attempt || !workItem ||
        workItem.value.project !== "freshness" || attempt.value.workItemId !== workItemId ||
        !attempt.value.artifactIds.includes(artifactId))
      return NextResponse.json({ error: "No eligible original capture is recorded for this attempt." }, { status: 404, headers: privateHeaders });
    const blob = await new NetlifyAdminEvidenceRemote().read(adminEvidenceKey(record));
    if (!blob) return NextResponse.json({ error: "The verified private copy has not been made yet; the runner still holds the original." },
      { status: 404, headers: privateHeaders });
    return originalEvidenceAttachment(record, blob);
  } catch {
    return NextResponse.json({ error: "The private copy could not be verified or read." }, { status: 503, headers: privateHeaders });
  }
}
