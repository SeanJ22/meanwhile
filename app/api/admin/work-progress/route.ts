import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { readWorkerProgress, WORKER_PROGRESS_DEFAULT_LIMIT } from "@/lib/control-plane/admin-view/worker-progress.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const headers = { "cache-control": "no-store, no-cache, must-revalidate" };

/** One selected WorkItem's durable worker milestones, for a live Admin detail panel. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const observedAt = new Date().toISOString();
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.parse(observedAt) / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });

  const workItemId = request.nextUrl.searchParams.get("workItemId")?.trim() ?? "";
  if (!workItemId || workItemId.length > 256 || /[\u0000-\u001f\u007f]/.test(workItemId)) {
    return NextResponse.json({ code: "WORK_ITEM_ID_REQUIRED" }, { status: 400, headers });
  }
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (rawLimit !== null && !/^[1-9]\d{0,2}$/.test(rawLimit)) {
    return NextResponse.json({ code: "INVALID_LIMIT" }, { status: 400, headers });
  }
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ code: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503, headers });
  const result = await readWorkerProgress(opened.repos, workItemId, observedAt,
    rawLimit === null ? WORKER_PROGRESS_DEFAULT_LIMIT : Number(rawLimit));
  return NextResponse.json(result, { status: result.kind === "HELD" ? 200 : result.kind === "NOT_RECORDED" ? 404 : 503, headers });
}
