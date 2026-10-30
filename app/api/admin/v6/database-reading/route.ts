import { loadWebsiteSavedKeys } from "../../../../../lib/core/keys-entry.ts";
import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { databaseReadingView } from "@/lib/control-plane/admin-view/database-reading.ts";
import { readRecentHourTotals } from "@/lib/db/transfer.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };
const UNREAD = "Database reading could not be read just now.";

/** Yesterday's and today's database reading against the daily target, from the hours' small totals. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  await loadWebsiteSavedKeys();
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  try {
    return NextResponse.json(databaseReadingView(await readRecentHourTotals(), new Date().toISOString()), { headers: NO_STORE });
  } catch {
    return NextResponse.json({ says: UNREAD }, { status: 503, headers: NO_STORE });
  }
}

export const GET = adminRead(get);
