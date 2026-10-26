import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { adminEvidencePrivateHeaders } from "@/lib/control-plane/evidence/admin-bridge-http.ts";
import { NetlifyAdminEvidenceRemote } from "@/lib/control-plane/evidence/admin-bridge-netlify.ts";
import { readAdminEvidenceCopyStatus } from "@/lib/control-plane/evidence/admin-copy-request.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const safeId = (id: string): boolean => /^[a-z][a-z0-9-]{1,120}$/.test(id);

/** Read request truth; never fetch the publisher or copy bytes as a GET side effect. */
async function get(request: NextRequest, context: { params: Promise<{
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
    if (!record || !attempt || !workItem || workItem.value.project !== "freshness" ||
        attempt.value.workItemId !== workItemId || !attempt.value.artifactIds.includes(artifactId))
      return NextResponse.json({ error: "No original capture is recorded for this work and attempt." }, { status: 404, headers: adminEvidencePrivateHeaders });
    const result = await readAdminEvidenceCopyStatus({ repos: opened.repos, record, remote: new NetlifyAdminEvidenceRemote() });
    return NextResponse.json(result, { headers: adminEvidencePrivateHeaders });
  } catch {
    return NextResponse.json({ error: "The copy request could not be checked." }, { status: 503, headers: adminEvidencePrivateHeaders });
  }
}

export const GET = adminRead(get);
