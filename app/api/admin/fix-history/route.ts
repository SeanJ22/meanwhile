import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { readFixPreventionHistory } from "@/lib/control-plane/admin-view/fix-prevention-history.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const headers = { "cache-control": "no-store, no-cache, must-revalidate" };
const valid = (value: string | null): value is string => value !== null && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);

/** Exact WorkItem history; subject and instruction coordinates narrow it, never widen it. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const observedAt = new Date().toISOString();
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.parse(observedAt) / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });

  const workItemId = request.nextUrl.searchParams.get("workItemId");
  const subjectId = request.nextUrl.searchParams.get("subjectId");
  const assignmentKey = request.nextUrl.searchParams.get("scopeKey");
  const receiptId = request.nextUrl.searchParams.get("receiptId");
  const rawLimit = request.nextUrl.searchParams.get("limit");
  if (!valid(workItemId) || (subjectId !== null && !valid(subjectId)) ||
    ((assignmentKey !== null || receiptId !== null) && (!valid(assignmentKey) || !valid(receiptId))) ||
    (rawLimit !== null && !/^[1-9]\d{0,2}$/.test(rawLimit))) {
    return NextResponse.json({ code: "INVALID_EXACT_HISTORY_QUERY" }, { status: 400, headers });
  }
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ code: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503, headers });
  const result = await readFixPreventionHistory(opened.repos, { workItemId, observedAt,
    ...(subjectId === null ? {} : { subjectId }),
    ...(assignmentKey !== null && receiptId !== null ? { scope: { assignmentKey, receiptId } } : {}),
    ...(rawLimit === null ? {} : { limit: Number(rawLimit) }),
  });
  return NextResponse.json(result, { status: result.kind === "HELD" ? 200 : result.kind === "NOT_RECORDED" ? 404 : 503, headers });
}
