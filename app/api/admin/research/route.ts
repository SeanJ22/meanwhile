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
import { consoleReturnPath } from "@/lib/control-plane/console-paths.ts";
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
  // ADM-15 (9.4.26 evening): "Deploy fleet here" on a readiness row returns to that state's page.
  const destination = consoleReturnPath(String(form.get("returnTo") ?? ""), "/admin/research");

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

  /*
   * THE JSON ANSWER (Admin redesign, 2026-09-23). The console's controls post
   * with `Accept: application/json` and refresh the page themselves, so they
   * get a body and no redirect: the page is re-read from the store, never drawn
   * from the click. A plain form without script still gets the redirect below,
   * built on the admin origin (#371). Everything above — host, origin, session,
   * validation, append — runs first and unchanged, so a refused request is
   * refused before anything is written.
   */
  if ((request.headers.get("accept") ?? "").includes("application/json")) {
    return NextResponse.json(
      {
        ok: true,
        recorded: { intentId: intent.intentId, action: intent.action, requestedAt: intent.requestedAt },
        says: `Recorded: ${INTENT_WORDS[action]}. The runner reads it at its next cycle and records that it did; until then it is a request.`,
      },
      { status: 200 },
    );
  }
  return NextResponse.redirect(new URL(destination, ADMIN_ORIGIN), 303);
}

const INTENT_WORDS: Readonly<Record<(typeof RESEARCH_INTENT_ACTIONS)[number], string>> = {
  PAUSE: "you paused paid research",
  RESUME: "you resumed paid research",
  RUN_CYCLE_NOW: "you asked for a cycle now",
  DISPATCH: "your instruction to deploy the fleet",
  PAUSE_RUNNER: "you paused the runner",
  RESUME_RUNNER: "you resumed the runner",
};
