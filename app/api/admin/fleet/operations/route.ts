import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { FLEET_OPERATIONS_VERSION, readFleetOperations } from "@/lib/control-plane/fleet-operations.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const headers = { "cache-control": "no-store, no-cache, must-revalidate" };

/** On-demand detail read. The existing /api/admin/live remains the polling path. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404
    ? new NextResponse(null, { status: 404, headers })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });

  const observedAt = new Date().toISOString();
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ formatVersion: FLEET_OPERATIONS_VERSION,
    observedAt, error: { code: "CONTROL_PLANE_UNAVAILABLE", detail: opened.detail } }, { status: 503, headers });
  const report = await readFleetOperations(opened.repos, { observedAt });
  return NextResponse.json(report, { status: report.operations.kind === "STORE_UNREACHABLE" ? 503 : 200, headers });
}
