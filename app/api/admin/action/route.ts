/**
 * **THE ONE DOOR, AS AN HTTP ENDPOINT.** (Admin Pass C, ADM-C6; §3.5.)
 *
 * A plain `<form method="post">` with no JavaScript and a `fetch` from a client
 * component and a chat tool call all arrive here, all reach the same
 * `submit()`, and all get the same validation, staleness rule, idempotency,
 * receipt and refusal. §3.5 forbids the alternative in as many words: *"Do not
 * create one action path for buttons, another privileged action path for chat."*
 *
 * ## What comes back depends on what was asked for, never on what happened
 *
 * ```
 *   Accept: application/json   the ActionOutcome as JSON
 *   anything else              303 to a validated console path
 * ```
 *
 * A JSON answer is **200 even for a refusal**, and that is deliberate. §3.7
 * makes a refusal a first-class outcome with a receipt — the gateway looked at
 * the request, decided, and recorded the decision. That is a successful
 * exchange, and the body says `ok: false` with the receipt and the reason. The
 * non-200 statuses are reserved for the cases where the gateway never got to
 * decide at all: the wrong host, the wrong origin, no session, or no store.
 *
 * ## Two things this route works out for the caller
 *
 * **The current state version.** The gateway needs to know what the world is
 * now to tell a control drawn against a moving world from one drawn against
 * this one. The route takes the pulse — the same cheap read `/api/admin/live`
 * takes — rather than trusting the client to say what "current" is, because a
 * staleness check whose current value comes from the same request as the quoted
 * one checks nothing.
 *
 * **The idempotency key, when the caller has none.** A no-JS form cannot mint
 * one. So an absent key is DERIVED from the action, its subject, a digest of
 * its input and the version of the world it was aimed at. Two clicks on one
 * rendered page are then one action — which is what a double-click is — and the
 * same action deliberately repeated after the world has moved is a new one,
 * because the version it is aimed at has changed. A key supplied by the caller
 * always wins.
 *
 * ## What it will not say
 *
 * Never a connection string, and never an environment variable's name. The
 * store-open failure carries both in its own detail sentence, which is right
 * for a server log and wrong for a browser, so this route answers with a plain
 * sentence of its own.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { consoleReturnPath } from "@/lib/control-plane/console-paths.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { readPulse } from "@/lib/control-plane/gateway/pulse-read.ts";
import { inputDigest } from "@/lib/control-plane/gateway/receipts.ts";
import type { ActionRequest, CallerAuthority } from "@/lib/control-plane/gateway/contract.ts";
import { recordReview } from "@/app/(admin)/admin/release-review/write.ts";
import { readManifest } from "@/app/(admin)/admin/release-review/manifest-source.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The envelope fields. Everything else in the body is the action's own input. */
const ENVELOPE = new Set(["type", "subject", "stateVersion", "idempotencyKey", "caller", "returnTo"]);

/**
 * The callers a request body may CLAIM to be.
 *
 * Authority is derived from the authenticated session, so the body can only ever
 * lower it, never raise it. The owner's own session is the ceiling; a chat tool
 * or a delegated agent speaking through this route says so and gets less. A body
 * that claims `OWNER_SESSION`, or claims nothing, or claims something
 * unrecognised, is treated as the session it actually is.
 */
const CLAIMABLE: Readonly<Record<string, CallerAuthority>> = {
  OPERATOR_CHAT: "OPERATOR_CHAT",
  AGENT: "AGENT",
};

function claimedCaller(raw: string | undefined): CallerAuthority {
  const claim = (raw ?? "").trim();
  return Object.prototype.hasOwnProperty.call(CLAIMABLE, claim) ? CLAIMABLE[claim] : "OWNER_SESSION";
}

function wantsJson(request: NextRequest): boolean {
  return (request.headers.get("accept") ?? "").toLowerCase().includes("application/json");
}

/**
 * The body, as a flat map of strings, whatever it arrived as.
 *
 * `formData()` handles both `application/x-www-form-urlencoded` (what a plain
 * form posts) and `multipart/form-data` (what a form with an enctype posts).
 * JSON is read separately and its `input` object, when it has one, is the
 * action's input rather than a sibling of the envelope.
 */
async function readBody(
  request: NextRequest,
): Promise<{ readonly envelope: Record<string, string>; readonly input: Record<string, unknown> } | null> {
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (contentType.includes("application/json")) {
      const parsed: unknown = await request.json();
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      const body = parsed as Record<string, unknown>;
      const envelope: Record<string, string> = {};
      for (const key of ENVELOPE) if (typeof body[key] === "string") envelope[key] = body[key] as string;
      const nested = body.input;
      const input =
        nested !== null && typeof nested === "object" && !Array.isArray(nested)
          ? (nested as Record<string, unknown>)
          : Object.fromEntries(Object.entries(body).filter(([key]) => !ENVELOPE.has(key) && key !== "input"));
      return { envelope, input };
    }
    const form = await request.formData();
    const envelope: Record<string, string> = {};
    const input: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      // A file upload is not an action input. There is no action that takes
      // one, and coercing a File to a string would put "[object File]" into a
      // durable digest.
      if (typeof value !== "string") continue;
      if (ENVELOPE.has(key)) envelope[key] = value;
      else input[key] = value;
    }
    return { envelope, input };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const guard = await guardAdminRequest({
    headers: request.headers,
    cookie: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    checkOrigin: true,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (!guard.ok) {
    return guard.status === 404
      ? new NextResponse(null, { status: 404 })
      : NextResponse.json({ ok: false, says: guard.says }, { status: guard.status });
  }

  const body = await readBody(request);
  if (body === null) {
    return NextResponse.json(
      { ok: false, says: "The console could not read that request, so nothing was done." },
      { status: 400 },
    );
  }

  const opened = await openControlPlane();
  if (!opened.ok) {
    /*
     * `opened.detail` names the environment variable, which belongs in a server
     * log and never in a browser. The owner gets the fact, which is the part he
     * can act on: nothing was recorded.
     */
    return NextResponse.json(
      {
        ok: false,
        says:
          "Nothing was recorded. The console could not reach the place it keeps its records, " +
          "so it did not do the thing either — it will not act without being able to prove it did.",
      },
      { status: 503 },
    );
  }

  const nowIso = new Date().toISOString();
  const pulse = await readPulse(opened.repos, nowIso);
  const quoted = body.envelope.stateVersion?.trim();
  const stateVersion = quoted === undefined || quoted === "" ? null : quoted;
  const type = (body.envelope.type ?? "").trim();
  const subject = (body.envelope.subject ?? "").trim();

  const supplied = (body.envelope.idempotencyKey ?? "").trim();
  const idempotencyKey =
    supplied !== ""
      ? supplied
      : // Derived: this action, on this subject, with this input, aimed at this
        // version of the world. `inputDigest` is already `sha256-<hex>`, so the
        // key is inside the character class the gateway's envelope check allows.
        inputDigest({ type, subject, input: body.input, at: stateVersion ?? pulse.revision });

  const actionRequest: ActionRequest = {
    type,
    subject,
    input: body.input,
    stateVersion,
    idempotencyKey,
    caller: claimedCaller(body.envelope.caller),
    actorRef: guard.sessionRef,
  };

  const outcome = await submit(actionRequest, {
    repos: opened.repos,
    now: () => new Date().toISOString(),
    currentStateVersion: pulse.revision,
    // Inlined by `next.config.ts` at build time from Netlify's COMMIT_REF; a
    // local `next build` has none and the receipt honestly says null rather
    // than carrying a plausible SHA nobody can check.
    codeSha: (process.env.WTP_BUILD_COMMIT ?? "").trim() || null,
    recordReview: (input) =>
      recordReview(
        {
          reviews: opened.repos.softwareReleaseReviews,
          readLiveManifest: readManifest,
          now: () => new Date().toISOString(),
          actor: `session:${guard.sessionRef}`,
        },
        input,
      ),
  });

  if (wantsJson(request)) return NextResponse.json(outcome, { status: 200 });

  const destination = consoleReturnPath(body.envelope.returnTo ?? "", "/admin");
  return NextResponse.redirect(
    new URL(`${destination}#${outcome.ok ? "recorded" : "refused"}`, ADMIN_ORIGIN),
    303,
  );
}
