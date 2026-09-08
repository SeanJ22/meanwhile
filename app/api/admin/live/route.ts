/**
 * **HAS ANYTHING CHANGED SINCE THE PAGE RENDERED?** (Admin Pass C, ADM-34 / §9A.5.)
 *
 * The owner's question, in his words: *"do I have to manually refresh the site
 * to get more information? Is it going to auto-update if I just simply leave it
 * open?"* The console must answer that visibly — and must not answer it by
 * re-reading the whole control plane every thirty seconds, which §16 names as
 * the scaling concern this pass may not make worse.
 *
 * So this endpoint is the CHEAP half of a two-step loop. Every ~45 seconds the
 * page asks for a pulse: one small JSON body carrying a revision, the runner's
 * beat and the handful of counts the strip shows. Only when that revision
 * differs from the one the page was rendered with does the page ask the router
 * for a fresh render. A quiet console therefore costs one small exchange a
 * minute and re-renders nothing; a console watching a live cycle re-renders
 * exactly when the cycle moves.
 *
 * The reads themselves, and the rule that a read which did not happen is named
 * rather than rendered as `0`, live in
 * `lib/control-plane/gateway/pulse-read.ts`. It is shared with
 * `/api/admin/action`, which needs the same revision to decide whether a click
 * came from a page the world has moved past.
 *
 * ## The guards, and the one that is deliberately absent
 *
 * Host and session, both enforced. **No origin check**, matching the existing
 * read route (`GET /api/admin/release-review`): an origin check on a GET buys
 * nothing, because a cross-site reader cannot see the response. The asymmetry is
 * named at the call site rather than left to be inferred.
 *
 * ## What it will not say
 *
 * `no-store`, because a cached pulse is a pulse that says nothing has changed
 * when something has — the exact failure the endpoint exists to prevent. And
 * never a connection string or an environment variable's name: a store that
 * could not be opened is reported as a pulse with no revision and the reason in
 * plain words, so the strip can say it is not reading rather than show a
 * confident old number.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { adminRefusalBody } from "@/lib/control-plane/admin-refusal.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { readPulse } from "@/lib/control-plane/gateway/pulse-read.ts";
import type { LivePulse } from "@/lib/control-plane/live-pulse.ts";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/**
 * The pulse when the store could not be opened.
 *
 * The revision is deliberately a constant, so a page holding a real revision
 * sees a DIFFERENCE and re-renders — landing on the console's own "we could not
 * ask" surface, which explains it properly — rather than sitting quietly on a
 * number nobody is checking any more. Every count is null and every one of them
 * is named in `unread`: not one renders as zero.
 */
function unreadPulse(at: string): LivePulse {
  return {
    revision: "unread",
    at,
    runner: { beatAt: null, lastCycleFinishedAt: null, nextCycleDueAt: null, state: null },
    counts: {
      decisionsWaiting: null,
      freshnessDebtRows: null,
      incidents: null,
      obligations: null,
      agentJobsRunning: null,
    },
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
    if (guard.status === 404) return new NextResponse(null, { status: 404 });
    // ADM-49: the class only, never the credential (see the action route).
    if (guard.rejection !== undefined) {
      console.warn(`admin live pulse refused: 401 ${guard.rejection}`);
    }
    return NextResponse.json(adminRefusalBody(guard), { status: guard.status });
  }

  const at = new Date().toISOString();
  const opened = await openControlPlane();
  const pulse = opened.ok ? await readPulse(opened.repos, at) : unreadPulse(at);
  return NextResponse.json(pulse, {
    status: 200,
    headers: { "cache-control": "no-store, no-cache, must-revalidate" },
  });
}
