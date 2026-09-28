import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { ADMIN_EVIDENCE_MAX_BYTES, adminEvidenceKey } from "@/lib/control-plane/evidence/admin-bridge.ts";
import { adminEvidencePrivateHeaders, originalEvidenceAttachment } from "@/lib/control-plane/evidence/admin-bridge-http.ts";
import { NetlifyAdminEvidenceRemote } from "@/lib/control-plane/evidence/admin-bridge-netlify.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const safeId = (id: string): boolean => /^[a-z][a-z0-9-]{1,120}$/.test(id);
/** The route serves a checked copy of original bytes; it never fetches the publisher again. */
export async function GET(request: NextRequest, context: { params: Promise<{
  workItemId: string; attemptId: string; artifactId: string;
}> }): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers: adminEvidencePrivateHeaders })
    : NextResponse.json({ error: guard.says }, { status: guard.status, headers: adminEvidencePrivateHeaders });
  const { workItemId, attemptId, artifactId } = await context.params;
  if (![workItemId, attemptId, artifactId].every(safeId))
    return NextResponse.json({ error: "Invalid evidence identity." }, { status: 400, headers: adminEvidencePrivateHeaders });
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ error: "The evidence record could not be read." }, { status: 503, headers: adminEvidencePrivateHeaders });
  try {
    const [records, attempt, workItem] = await Promise.all([
      opened.repos.artifacts.read(workItemId), opened.repos.attempts.read(attemptId), opened.repos.workItems.read(workItemId),
    ]);
    const record = records.find(row => row.artifactId === artifactId && row.attemptId === attemptId);
    if (!record || record.tier !== "RAW" || record.partial || !attempt || !workItem ||
        workItem.value.project !== "freshness" || attempt.value.workItemId !== workItemId ||
        !attempt.value.artifactIds.includes(artifactId))
      return NextResponse.json({ error: "No eligible original capture is recorded for this attempt." }, { status: 404, headers: adminEvidencePrivateHeaders });
    if (record.byteLength > ADMIN_EVIDENCE_MAX_BYTES)
      return NextResponse.json({ error: "The held original exceeds the private Admin copy limit of 32 MiB; it remains in the runner vault." },
        { status: 409, headers: adminEvidencePrivateHeaders });
    const blob = await new NetlifyAdminEvidenceRemote().read(adminEvidenceKey(record));
    if (!blob) return NextResponse.json({ error: "The private copy is unavailable. The control plane records an original runner capture; its current vault bytes were not checked here." },
      { status: 404, headers: adminEvidencePrivateHeaders });
    return originalEvidenceAttachment(record, blob);
  } catch {
    return NextResponse.json({ error: "The private copy could not be verified or read." }, { status: 503, headers: adminEvidencePrivateHeaders });
  }
}
