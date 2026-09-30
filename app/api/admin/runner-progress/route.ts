import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { readAdminRunnerProgress } from "@/lib/control-plane/admin-view/runner-progress-read.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** A bounded on-demand read; /api/admin/live remains the cheap polling pulse. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value, checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status,
      headers: { "cache-control": "no-store, no-cache, must-revalidate" } });
  const opened = await openControlPlane();
  if (!opened.ok) return NextResponse.json({ state: "UNREAD", says: "The control-plane store could not be opened just now. Runner progress is unknown." },
    { status: 503, headers: { "cache-control": "no-store, no-cache, must-revalidate" } });
  const progress = await readAdminRunnerProgress(opened.repos, new Date().toISOString());
  return NextResponse.json(progress, { headers: { "cache-control": "no-store, no-cache, must-revalidate" } });
}
