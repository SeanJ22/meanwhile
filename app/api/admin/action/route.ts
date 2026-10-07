/**
 * Form posts, client fetches and chat tool calls all reach the same `submit()`.
 *
 * ```
 *   Accept: application/json   the ActionOutcome as JSON, 200 even for a refusal (a refusal is a recorded decision)
 *   anything else              303 to a validated console path
 * ```
 *
 * Non-200 statuses mean the gateway never decided: wrong host or origin, no session, or no store.
 * The current state version comes from the pulse, never from the client. An absent idempotency key is derived
 * from the action, subject, input digest and state version; a caller's key always wins.
 * Never returns a connection string or an environment variable's name.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/control-plane/admin-auth.ts";
import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { consoleReturnPath } from "@/lib/control-plane/console-paths.ts";
import { guardAdminRequest } from "@/lib/control-plane/gateway/admin-guard.ts";
import { confirmReceipt } from "@/lib/control-plane/gateway/confirmation.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { readPulse } from "@/lib/control-plane/gateway/pulse-read.ts";
import { wakeHintWriterFromEnv } from "@/lib/control-plane/gateway/wake-hint.ts";
import { inputDigest } from "@/lib/control-plane/gateway/receipts.ts";
import type { ActionRequest, CallerAuthority } from "@/lib/control-plane/gateway/contract.ts";

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
    wake: wakeHintWriterFromEnv(),
  });

  if (wantsJson(request)) {
    /* The answer also says whether the runner has picked the action up, from the runner's own records. */
    const confirmation = outcome.ok ? await confirmReceipt(opened.repos, outcome.receipt) : null;
    return NextResponse.json({ ...outcome, confirmation }, { status: 200 });
  }

  const destination = consoleReturnPath(body.envelope.returnTo ?? "", "/admin");
  return NextResponse.redirect(
    new URL(`${destination}#${outcome.ok ? "recorded" : "refused"}`, ADMIN_ORIGIN),
    303,
  );
}
