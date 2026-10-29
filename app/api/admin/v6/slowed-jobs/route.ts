import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { slowedJobsView } from "@/lib/control-plane/admin-view/slowed-jobs.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const UNREAD = "The slowed jobs could not be read just now.";

/** Jobs slowed this week for reading far more than their normal, from the breaker's last check. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  try {
    const opened = await openControlPlane();
    const slowdowns = opened.ok ? opened.repos.jobSlowdowns : undefined;
    if (!slowdowns) return NextResponse.json({ says: UNREAD }, { status: 503, headers: NO_STORE });
    return NextResponse.json(slowedJobsView(await slowdowns.latest(), new Date().toISOString()), { headers: NO_STORE });
  } catch {
    return NextResponse.json({ says: UNREAD }, { status: 503, headers: NO_STORE });
  }
}

export const GET = adminRead(get);
