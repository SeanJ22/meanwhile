/**
 * The cheap half of a two-step loop: the page polls this pulse and asks for a fresh render only when the
 * revision differs. Host and session are enforced; there is no origin check because a cross-site reader
 * cannot see a GET response. `no-store`: a cached pulse would say nothing changed when something has.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { readPulse } from "@/lib/control-plane/gateway/pulse-read.ts";
import type { LivePulse } from "@/lib/control-plane/live-pulse.ts";
import { ADMIN_CAPABILITIES } from "@/lib/control-plane/admin-view/capabilities.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/** The revision is a constant so a page holding a real one sees a difference and re-renders. Every count is null and named in `unread`. */
function unreadPulse(at: string): LivePulse {
  return {
    revision: "unread",
    at,
    capabilities: ADMIN_CAPABILITIES,
    runner: { beatAt: null, lastCycleFinishedAt: null, nextCycleDueAt: null, state: null },
    counts: {
      decisionsWaiting: null,
      freshnessDebtRows: null,
      incidents: null,
      obligations: null,
      agentJobsRunning: null,
    },
    lanes: null,
    unread: ["everything on this strip (the console could not reach its records just now)"],
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({
    headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    // A read. See the header: the origin check belongs on the writes.
    checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!guard.ok) {
    return guard.status === 404
      ? new NextResponse(null, { status: 404 })
      : NextResponse.json({ says: guard.says }, { status: guard.status });
  }

  const at = new Date().toISOString();
  const opened = await openControlPlane();
  const pulse = opened.ok ? await readPulse(opened.repos, at) : unreadPulse(at);
  return NextResponse.json(pulse, {
    status: 200,
    headers: { "cache-control": "no-store, no-cache, must-revalidate" },
  });
}
