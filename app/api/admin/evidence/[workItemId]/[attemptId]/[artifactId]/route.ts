import { loadWebsiteSavedKeys } from "../../../../../../../lib/core/keys-entry.ts";
import { storedKeyValue } from "../../../../../../../lib/core/keys-values.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { ADMIN_EVIDENCE_MAX_BYTES, adminEvidenceKey } from "@/lib/control-plane/evidence/admin-bridge.ts";
import { ADMIN_EVIDENCE_RESPONSE_BYTES, adminEvidencePrivateHeaders, originalEvidenceAttachment } from "@/lib/control-plane/evidence/admin-bridge-http.ts";
import { NetlifyAdminEvidenceRemote } from "@/lib/control-plane/evidence/admin-bridge-netlify.ts";
import { readAdminEvidenceCopyStatus, requeueUnavailableAdminCopy, requestAdminEvidenceCopy } from "@/lib/control-plane/evidence/admin-copy-request.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const safeId = (id: string): boolean => /^[a-z][a-z0-9-]{1,120}$/.test(id);
/** The route serves a checked copy of original bytes; it never fetches the publisher again. */
async function get(request: NextRequest, context: { params: Promise<{
  workItemId: string; attemptId: string; artifactId: string;
}> }): Promise<NextResponse> {
  await loadWebsiteSavedKeys();
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
    const rawPart = request.nextUrl.searchParams.get("part");
    const parts = Math.max(1, Math.ceil(record.byteLength / ADMIN_EVIDENCE_RESPONSE_BYTES));
    if (rawPart === null && parts > 1)
      return NextResponse.json({ code: "CHUNKED_DOWNLOAD_REQUIRED", byteLength: record.byteLength,
        contentHash: record.contentHash, chunkBytes: ADMIN_EVIDENCE_RESPONSE_BYTES, parts },
      { status: 409, headers: adminEvidencePrivateHeaders });
    if (rawPart !== null && (!/^(0|[1-9][0-9]*)$/.test(rawPart) || Number(rawPart) >= parts))
      return NextResponse.json({ error: "Invalid evidence part." }, { status: 400, headers: adminEvidencePrivateHeaders });
    const blob = await new NetlifyAdminEvidenceRemote().read(adminEvidenceKey(record));
    if (!blob) return NextResponse.json({ error: "The private copy is unavailable. The control plane records an original runner capture; its current vault bytes were not checked here." },
      { status: 404, headers: adminEvidencePrivateHeaders });
    return originalEvidenceAttachment(record, blob, rawPart === null ? undefined : Number(rawPart));
  } catch {
    return NextResponse.json({ error: "The private copy could not be verified or read." }, { status: 503, headers: adminEvidencePrivateHeaders });
  }
}

/** Queue a copy of this exact recorded capture. The permanent runner does the byte work. */
async function post(request: NextRequest, context: { params: Promise<{
  workItemId: string; attemptId: string; artifactId: string;
}> }): Promise<NextResponse> {
  await loadWebsiteSavedKeys();
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: true,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers: adminEvidencePrivateHeaders })
    : NextResponse.json({ error: guard.says }, { status: guard.status, headers: adminEvidencePrivateHeaders });
  const { workItemId, attemptId, artifactId } = await context.params;
  if (![workItemId, attemptId, artifactId].every(safeId))
    return NextResponse.json({ error: "Invalid evidence identity." }, { status: 400, headers: adminEvidencePrivateHeaders });
  if (process.env.WTP_ADMIN_EVIDENCE_REQUESTS_ENABLED !== "1" ||
      !process.env.NETLIFY_SITE_ID || !storedKeyValue("NETLIFY_BLOBS_TOKEN"))
    return NextResponse.json({ state: "REFUSED", code: "PRIVATE_COPY_NOT_ACTIVE",
      detail: "Private evidence requests are not active.", updatedAt: null },
      { status: 409, headers: adminEvidencePrivateHeaders });
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ error: "The evidence record could not be read." }, { status: 503, headers: adminEvidencePrivateHeaders });
  try {
    const [records, attempt, workItem] = await Promise.all([
      opened.repos.artifacts.read(workItemId), opened.repos.attempts.read(attemptId), opened.repos.workItems.read(workItemId),
    ]);
    const record = records.find(row => row.artifactId === artifactId && row.attemptId === attemptId);
    if (!record || !attempt || !workItem)
      return NextResponse.json({ error: "No original capture is recorded for this work and attempt." }, { status: 404, headers: adminEvidencePrivateHeaders });
    const queued = await requestAdminEvidenceCopy({ repos: opened.repos, record, attempt: attempt.value,
      owner: workItem.value, now: new Date().toISOString(), adminSessionRef: guard.sessionRef });
    let current = queued.state === "REFUSED" ? queued : await readAdminEvidenceCopyStatus({ repos: opened.repos,
      record, remote: new NetlifyAdminEvidenceRemote() });
    if (current.state === "PENDING" &&
        (current.code === "PRIVATE_COPY_UNAVAILABLE" || current.code === "PRIVATE_COPY_UNVERIFIED"))
      current = await requeueUnavailableAdminCopy({ repos: opened.repos, record, now: new Date().toISOString() });
    return NextResponse.json(current, { status: current.state === "REFUSED" ? 409 : current.state === "AVAILABLE" ? 200 : 202,
      headers: adminEvidencePrivateHeaders });
  } catch {
    return NextResponse.json({ error: "The copy request could not be recorded or checked." }, { status: 503, headers: adminEvidencePrivateHeaders });
  }
}

export const GET = adminRead(get);

export const POST = adminRead(post);
