/**
 * **THE BREAK-GLASS, AND SIGN-OUT.** (Session C final, ITEM H, 2026-09-01.
 * Retired as a login path and retained as the RULING 245 break-glass under
 * RULING 238 custody, 2026-09-02.)
 *
 * ## POST — the break-glass
 *
 * This was the login. It is not any more: the owner signs in with Google
 * (`app/(admin)/admin/auth/`). The shared secret survives here for exactly the
 * case RULING 245 permits — a documented, rate-limited, incident-logged path
 * held by the owner — and it is RETAINED rather than removed because the Google
 * path could not be proven live in the session that built it: the OAuth client
 * variables were not on the Netlify site, so a removed secret would have left
 * the owner with no way into his own control centre while that stays true.
 *
 * ```
 *   HOST          404 on any host but the admin host
 *   FLAG          404 unless WTP_ADMIN_BREAK_GLASS=enabled — the path does not
 *                 exist until the owner turns it on, and a 404 is what the
 *                 public host says too, so a prober learns nothing
 *   ORIGIN        the Origin header must be the admin origin
 *   INCIDENT LOG  the durable control plane must open, or the attempt is refused
 *                 as INCIDENT_LOG_UNAVAILABLE — an unloggable break-glass is
 *                 the old login with a new name
 *   RATE LIMIT    read from the log itself: more than N attempts in the window
 *                 is RATE_LIMITED, refused WITHOUT appending
 *   COMPARE       constant-time against WTP_ADMIN_SECRET, by name
 *   APPEND        one incident record per attempt — class, moment, outcome,
 *                 the opaque session id issued. Appended BEFORE the session is
 *                 issued; a failed append refuses even a correct secret
 *   ISSUE         the existing session cookie, marked `via: "break-glass"`
 * ```
 *
 * Nothing about the submitted value is logged, ever — not its length, not a
 * prefix, not a hash. The incident record names the CLASS of the outcome.
 *
 * ## DELETE — sign-out
 *
 * Unchanged, and NOT behind the flag: a Google-issued session needs a way out
 * regardless of whether the break-glass is on.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import {
  ADMIN_SECRET_VAR,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  BREAK_GLASS_LOG_KEY,
  SESSION_LIFETIME_SECONDS,
  breakGlassWindowVerdict,
  buildBreakGlassIncident,
  checkLogin,
  isAdminHostRequest,
  isBreakGlassEnabled,
  mintAdminSessionId,
  originAllowed,
  sessionCookieAttributes,
  signSession,
  type BreakGlassRejection,
} from "@/lib/control-plane/admin-auth.ts";
import { openControlPlane } from "@/lib/control-plane/admin-data.ts";
import { loginPathFor } from "@/lib/control-plane/admin-google.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function backToLogin(request: NextRequest, why: string): NextResponse {
  return NextResponse.redirect(new URL(loginPathFor(why), request.url), 303);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) {
    return new NextResponse(null, { status: 404 });
  }
  // The path does not exist unless the owner turned it on, by the exact word.
  if (!isBreakGlassEnabled(process.env)) {
    return new NextResponse(null, { status: 404 });
  }
  if (!originAllowed(request.headers.get("origin"), ADMIN_ORIGIN)) {
    return backToLogin(request, "ORIGIN");
  }

  // A body that is not a form is an attempt with no secret, not a 500: it is
  // refused and logged like any other, and a prober learns nothing from it.
  let submitted: FormDataEntryValue | null = null;
  try {
    submitted = (await request.formData()).get("secret");
  } catch {
    submitted = null;
  }

  const opened = await openControlPlane();
  if (!opened.ok) return backToLogin(request, "INCIDENT_LOG_UNAVAILABLE");

  const nowIso = new Date().toISOString();
  let priorRecords: readonly { readonly writtenAt: string }[];
  try {
    priorRecords = await opened.repos.ownerDigests.read(BREAK_GLASS_LOG_KEY);
  } catch {
    return backToLogin(request, "INCIDENT_LOG_UNAVAILABLE");
  }
  const window = breakGlassWindowVerdict(priorRecords, nowIso);
  if (!window.allowed) return backToLogin(request, "RATE_LIMITED");

  const verdict = checkLogin(typeof submitted === "string" ? submitted : null, process.env[ADMIN_SECRET_VAR]);
  const sessionKey = process.env[ADMIN_SESSION_KEY_VAR];
  const rejection: BreakGlassRejection | null = !verdict.ok
    ? verdict.reason
    : sessionKey
      ? null
      : "NOT_CONFIGURED";
  const sid = rejection === null ? mintAdminSessionId() : null;

  const incident = buildBreakGlassIncident({
    at: nowIso,
    outcome: rejection === null ? "ACCEPTED" : "REFUSED",
    rejection,
    sessionRef: sid,
    attemptsInWindowIncludingThis: window.attemptsInWindow + 1,
    max: window.max,
    windowSeconds: window.windowSeconds,
  });
  try {
    await opened.repos.ownerDigests.append(BREAK_GLASS_LOG_KEY, incident.digestId, incident, nowIso);
  } catch {
    // A correct secret that cannot be recorded is still refused. See the header.
    return backToLogin(request, "INCIDENT_LOG_UNAVAILABLE");
  }

  if (rejection !== null || sid === null || !sessionKey) {
    return backToLogin(request, rejection ?? "NOT_CONFIGURED");
  }

  const iat = Math.floor(Date.now() / 1000);
  const cookie = await signSession(
    { sid, iat, exp: iat + SESSION_LIFETIME_SECONDS, via: "break-glass" },
    sessionKey,
  );
  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.headers.append(
    "set-cookie",
    `${ADMIN_SESSION_COOKIE}=${cookie}; ${sessionCookieAttributes(SESSION_LIFETIME_SECONDS)}`,
  );
  return response;
}

/** Sign out. Clears the cookie by expiring it; there is no server-side state. */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) return new NextResponse(null, { status: 404 });
  if (!originAllowed(request.headers.get("origin"), ADMIN_ORIGIN)) {
    return new NextResponse(null, { status: 403 });
  }
  const response = new NextResponse(null, { status: 204 });
  response.headers.append(
    "set-cookie",
    `${ADMIN_SESSION_COOKIE}=; ${sessionCookieAttributes(0)}`,
  );
  return response;
}
