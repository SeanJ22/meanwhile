/**
 * **WHAT WOULD HAPPEN IF I PRESSED THIS.** (§9A.16.)
 *
 * A READ. It computes the preview for a `Deploy fleet here` instruction and
 * writes nothing — no intent, no receipt, no state. The owner asked for this
 * because he would not press a button that did not explain itself, and a
 * preview that itself changed something would be the same defect wearing a
 * different hat.
 *
 * Guarded exactly as every other admin route is, through the one shared
 * sequence in `lib/control-plane/gateway/admin-guard.ts`: 404 off the admin
 * host, then the session. The origin check is the one difference and it is
 * deliberate — this is a GET that changes nothing, and a cross-site read of a
 * page the reader already has to be signed in for is not a threat the origin
 * header defends against.
 */
import { NextResponse, type NextRequest } from "next/server";

import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { deployPreview } from "@/lib/control-plane/deploy-preview.ts";
import { FLEET_SAFETY_BOUNDS } from "@/lib/control-plane/fleet-safety.ts";
import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NOTE_MAX = 400;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({
    headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: false,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!guard.ok) return new NextResponse(guard.status === 404 ? null : JSON.stringify({ error: guard.says }), { status: guard.status });

  const note = (request.nextUrl.searchParams.get("note") ?? "").slice(0, NOTE_MAX).trim();
  if (note === "") {
    return NextResponse.json({ error: "say what the fleet should go do, and this will say what that would mean" }, { status: 400 });
  }

  /*
   * The standing obligations are what a dispatch reorders, so they are what the
   * preview counts. A store that could not be read reports `obligationsRead:
   * false` and the preview says the count is a gap in itself — never zero,
   * which would read as "nothing matches".
   */
  let obligations: { id: string; subjectId: string }[] = [];
  let obligationsRead = false;
  const opened = await openControlPlane();
  if (opened.ok) {
    try {
      const rows = await opened.repos.obligations.list();
      obligations = rows.map((r) => {
        const value = r.value as { id?: unknown; subjectId?: unknown };
        return { id: String(value.id ?? r.id), subjectId: String(value.subjectId ?? "") };
      });
      obligationsRead = true;
    } catch {
      obligationsRead = false;
    }
  }

  return NextResponse.json(
    deployPreview({
      note,
      obligations,
      obligationsRead,
      ceilings: {
        cycleModelUsd: FLEET_SAFETY_BOUNDS.cycleModelUsd,
        rolling24HourModelUsd: FLEET_SAFETY_BOUNDS.rolling24HourModelUsd,
        maxDispatchesPerCycle: FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle,
      },
    }),
    { headers: { "cache-control": "no-store" } },
  );
}
