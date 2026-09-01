/**
 * **THE DECISION BUTTON'S ONLY EFFECT: AN APPENDED INTENT.**
 * (Session C final, ITEM H, 2026-09-01.)
 *
 * ## What this route deliberately does NOT do
 *
 * It does not edit `docs/governance/ledger.jsonl`. It does not edit
 * `docs/tracker-working.csv`. It does not write a ruling, retire a claim, or
 * touch any generated view. **A browser request cannot make a governance change
 * because a governance change is atomic** — CLAUDE.md is explicit that the
 * canonical event, the operative policy, the regenerated views, the regenerated
 * context and a passing `pnpm governance:check` land together or the change has
 * not happened. A web request can do exactly one of those six things, which
 * would leave the repository in the state RULING 92 and RULING 102 exist to
 * prevent: a generated artifact hand-edited, and a generator whose output no
 * longer matches it.
 *
 * So the button records WHAT THE OWNER DECIDED, durably, with who and when. The
 * authorized local governance path materialises it under the normal gates. The
 * card says `PENDING_CANONICALIZATION` until that has merged — which is the
 * truth, and is what stops the owner believing a decision has landed when the
 * only thing that has happened is that he clicked a button.
 *
 * ## Auditability
 *
 * Every intent carries the admin session reference, the option chosen, and the
 * consequence text that was ON SCREEN when the choice was made. That last one
 * matters: a decision is only informed if we know what the owner was told, and
 * card text changes between generations.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  isAdminHostRequest,
  originAllowed,
  verifySession,
} from "@/lib/control-plane/admin-auth.ts";
import { appendDecisionIntent, openControlPlane } from "@/lib/control-plane/admin-data.ts";
import {
  OWNER_SURFACE_FORMAT_VERSION,
  type OwnerDecisionIntent,
} from "@/lib/control-plane/owner-surface.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) {
    return new NextResponse(null, { status: 404 });
  }

  // State-changing and authenticated. Middleware has already refused an
  // unauthenticated request; this re-verifies rather than assuming, because
  // the session reference is about to be written into a durable audit record
  // and a record that says "the owner decided this" must be one we checked.
  if (!originAllowed(request.headers.get("origin"), ADMIN_ORIGIN)) {
    return NextResponse.json({ error: "origin refused" }, { status: 403 });
  }
  const verdict = await verifySession(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    process.env[ADMIN_SESSION_KEY_VAR],
    Math.floor(Date.now() / 1000),
  );
  if (!verdict.ok) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  const form = await request.formData();
  const subjectId = String(form.get("subjectId") ?? "").trim();
  const chosenOption = String(form.get("chosenOption") ?? "").trim();
  const consequenceShown = String(form.get("consequenceShown") ?? "").trim();

  if (subjectId === "" || chosenOption === "") {
    return NextResponse.json({ error: "subjectId and chosenOption are required" }, { status: 400 });
  }

  const opened = await openControlPlane();
  if (!opened.ok) {
    // The decision is NOT recorded and the owner is told so plainly. A
    // success page over a failed write would be the worst outcome here: he
    // would believe the queue had moved and stop thinking about it.
    return NextResponse.json({ error: "not recorded", detail: opened.detail }, { status: 503 });
  }

  const decidedAt = new Date().toISOString();
  const intent: OwnerDecisionIntent = {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    // Derived from the subject and the moment, so a double-click is one
    // intent rather than two: the append is idempotent on record id, and the
    // repositories treat a byte-identical retry as a no-op success.
    intentId: `${subjectId}:${decidedAt}`,
    subjectId,
    chosenOption,
    consequenceShown,
    decidedAt,
    state: "PENDING_CANONICALIZATION",
    canonicalRef: null,
    refusedReason: null,
    adminSessionRef: verdict.session.sid,
  };

  const wrote = await appendDecisionIntent(opened.repos, intent, decidedAt);
  if (!wrote.ok) {
    return NextResponse.json({ error: "not recorded", detail: wrote.detail }, { status: 500 });
  }

  return NextResponse.redirect(new URL("/admin", request.url), 303);
}
