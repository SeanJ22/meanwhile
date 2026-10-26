import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { readSwitchConfig, switchTable } from "@/lib/control-plane/data-business/switches.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/** Who may read each number: every recipe by Admin, the dashboard and each customer the owner has set a switch for. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  try {
    const opened = await openControlPlane();
    if (!opened.ok) return NextResponse.json({ says: "The switches could not be read just now, so they are unknown, not off." }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ observedAt: new Date().toISOString(), rows: switchTable(await readSwitchConfig(opened.repos)) }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ says: "The switches could not be read just now, so they are unknown, not off." }, { status: 503, headers: NO_STORE });
  }
}

export const GET = adminRead(get);
