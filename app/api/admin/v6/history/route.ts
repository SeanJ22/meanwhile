import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { readV6History, validV6HistoryStatus } from "@/lib/control-plane/admin-view/admin-v6-history.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const headers = { "cache-control": "no-store, no-cache, must-revalidate" };

/** Durable order history, one bounded page of authoritative receipts. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const asOf = new Date().toISOString();
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.parse(asOf) / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });

  const scope = request.nextUrl.searchParams.get("scope")?.trim() ?? "";
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const status = request.nextUrl.searchParams.get("status") ?? "all";
  const rawLimit = request.nextUrl.searchParams.get("limit") ?? "50";
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (!scope || scope.length > 256 || /[\u0000-\u001f\u007f]/.test(scope) || q.length > 100 ||
    !validV6HistoryStatus(status) || !/^(?:[1-9]|[1-4]\d|50)$/.test(rawLimit) ||
    (cursor !== null && cursor.length > 700)) {
    return NextResponse.json({ code: "INVALID_HISTORY_QUERY" }, { status: 400, headers });
  }
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ code: "CONTROL_PLANE_UNAVAILABLE" }, { status: 503, headers });
  try {
    return NextResponse.json(await readV6History(opened.repos, { scope, asOf, q, status, limit: Number(rawLimit), cursor }),
      { status: 200, headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "INVALID_HISTORY_CURSOR" || code === "STALE_HISTORY_CURSOR")
      return NextResponse.json({ code }, { status: 400, headers });
    return NextResponse.json({ code: "HISTORY_READ_UNAVAILABLE" }, { status: 503, headers });
  }
}
