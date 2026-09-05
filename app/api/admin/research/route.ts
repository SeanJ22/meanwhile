/**
 * **THE RESEARCH BUTTONS' ONLY EFFECT: AN APPENDED INTENT.**
 * (Level 1 activation, 2026-09-01. RULING 240, RULING 241.)
 *
 * PAUSE, RESUME and RUN_CYCLE_NOW are the owner's intents. This route records
 * one, durably, with who and when; the standing runner honors it on its next
 * cycle and appends its own HONORED record beside it. Nothing here touches the
 * runner, the research state, or any generated artifact.
 *
 * The security sequence is the decision route's, in the same order:
 * host → origin → session → validate → append → 303.
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
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import {
  appendResearchIntent,
  buildResearchIntent,
  parseResearchIntentAction,
  validateIntentNote,
} from "@/lib/control-plane/research-view.ts";
import { RESEARCH_INTENT_ACTIONS } from "@/lib/control-plane/scheduler/research-policy.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) {
    return new NextResponse(null, { status: 404 });
  }

  // State-changing and authenticated. Middleware already refused an
  // unauthenticated request; this re-verifies because the session reference
  // is about to be written into a durable audit record.
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
  const action = parseResearchIntentAction(form.get("action"));
  if (action === null) {
    return NextResponse.json(
      { error: `action must be one of ${RESEARCH_INTENT_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }
  /*
   * ADM-8 / ADM-5 (9.4.26): a DISPATCH carries the owner's target and a
   * PAUSE_RUNNER may carry his reason. Validated here, before the store is
   * opened, so a bad request never costs a connection.
   */
  const note = validateIntentNote(action, form.get("note"));
  if (!note.ok) {
    return NextResponse.json({ error: note.detail }, { status: 400 });
  }
  // Where to land after the record: the page the form came from, from a
  // closed list — never an arbitrary URL out of the form body.
  const returnTo = String(form.get("returnTo") ?? "");
  const destination = RETURN_PATHS.includes(returnTo) ? returnTo : "/admin/research";

  const opened = await openControlPlane();
  if (!opened.ok) {
    // Not recorded, and said plainly. A redirect over a failed write would
    // leave the owner believing the lane was paused when nothing heard him.
    return NextResponse.json({ error: "not recorded", detail: opened.detail }, { status: 503 });
  }

  const requestedAt = new Date().toISOString();
  const intent = buildResearchIntent(action, requestedAt, verdict.session.sid, note.note);
  const wrote = await appendResearchIntent(opened.repos, intent, requestedAt);
  if (!wrote.ok) {
    return NextResponse.json({ error: "not recorded", detail: wrote.detail }, { status: 500 });
  }

  return NextResponse.redirect(new URL(destination, request.url), 303);
}

/** The pages an intent form may return to. A closed list, by design. */
const RETURN_PATHS: readonly string[] = ["/admin", "/admin/research"];
