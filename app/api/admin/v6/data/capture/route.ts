import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { captureWindow, readCaptureHealth } from "@/lib/control-plane/admin-view/v6-capture-health.ts";
import { netlifyHistoryStore, readCaptureFailures } from "@/lib/control-plane/data-business/live.ts";
import { easternSources } from "@/lib/control-plane/data-business/eastern-sources.ts";
import { readSwitchConfig } from "@/lib/control-plane/data-business/switches.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/**
 * Is capture working? Events per day by type, topics vs free-form, new vs returning readers, usage by district, and anything that
 * failed to record: counts and shares only, never an anonymous ID, an exact time or one person's trail. Read-only.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  try {
    const now = new Date();
    const opened = await openControlPlane();
    const config = opened.ok ? await readSwitchConfig(opened.repos) : null;
    const failures = await readCaptureFailures({ ...captureWindow(now), history: netlifyHistoryStore() }).catch(() => null);
    return NextResponse.json(await readCaptureHealth({ sources: easternSources(), switchOn: () => true }, config, failures, now), { headers: NO_STORE });
  } catch {
    return NextResponse.json({ says: "Whether capture is working could not be read just now, so it is unknown, not stopped." }, { status: 503, headers: NO_STORE });
  }
}
