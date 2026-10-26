import { adminRead } from "@/lib/control-plane/admin-read.ts";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { readTopicCounts, topicCountsView } from "@/lib/control-plane/admin-view/topic-counts.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const NO_STORE = { "cache-control": "no-store, no-cache, must-revalidate" };

/** What residents ask about, as a share of users by week, ZIP or district and topic. Aggregate only. Read-only. */
async function get(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({ headers: request.headers, cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false, nowSeconds: Math.floor(Date.now() / 1000) });
  if (!guard.ok) return guard.status === 404 ? new NextResponse(null, { status: 404 })
    : NextResponse.json({ says: guard.says }, { status: guard.status, headers: NO_STORE });
  try {
    return NextResponse.json(topicCountsView(await readTopicCounts()), { headers: NO_STORE });
  } catch {
    return NextResponse.json({ says: "The topic counts could not be read just now, so they are unknown, not zero." }, { status: 503, headers: NO_STORE });
  }
}

export const GET = adminRead(get);
