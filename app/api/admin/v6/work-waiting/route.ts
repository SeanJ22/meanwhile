import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { controlPlaneQuery } from "@/lib/core/work.ts";
import { workWaiting } from "@/lib/core/work-counts.ts";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store" };

/** How much is waiting in the one work list, by kind and tier. Counters only; no job is read. */
async function get(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers });
  try {
    return NextResponse.json({ ...await workWaiting(controlPlaneQuery()), at: new Date().toISOString() }, { headers });
  } catch {
    return NextResponse.json({ says: "What is waiting could not be read just now, so it is unknown, not zero." }, { status: 503, headers });
  }
}

export const GET = adminRead(get);
