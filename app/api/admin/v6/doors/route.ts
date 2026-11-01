import { loadWebsiteSavedKeys } from "../../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { DOOR_CHANGES_SHOWN } from "@/lib/control-plane/admin-view/v6-doors-read.ts";
import { ADMIN_RECEIPT_LOG_KEY, type ActionReceipt } from "@/lib/control-plane/gateway/contract.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { readAdminDoors, readAdminQueueDoors } from "@/lib/control-plane/admin-view/door-queries.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const UNREAD = "The doors could not be read just now, so they are unknown, not shut.";

/** The Door Registry for Admin: counts, the shut doors and the newest door changes. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  await loadWebsiteSavedKeys();
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  try {
    const opened = await openControlPlane();
    if (!opened.ok) return NextResponse.json({ says: UNREAD }, { status: 503, headers: NO_STORE });
    if (request.nextUrl.searchParams.get("reading") === "queue")
      return NextResponse.json(await readAdminQueueDoors(opened.repos, new Date().toISOString()), { headers: NO_STORE });
    const saves = await (
      // The newest door changes only, narrowed in the store: no full log read.
      opened.repos.adminReceipts.readRecentWhere(ADMIN_RECEIPT_LOG_KEY, ["type"], "door.save", DOOR_CHANGES_SHOWN,
        { subject: true, says: true, outcome: true, startedAt: true, completedAt: true })
        .then((rows) => rows as readonly ActionReceipt[]).catch(() => [] as readonly ActionReceipt[])
    );
    return NextResponse.json(await readAdminDoors(opened.repos, saves, new Date().toISOString()), { headers: NO_STORE });
  } catch {
    return NextResponse.json({ says: UNREAD }, { status: 503, headers: NO_STORE });
  }
}

export const GET = adminRead(get);
