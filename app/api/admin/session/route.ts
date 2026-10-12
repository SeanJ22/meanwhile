/**
 * POST is the break-glass:
 *
 * ```
 *   HOST          404 on any host but the admin host
 *   FLAG          404 unless WTP_ADMIN_BREAK_GLASS=enabled, so a prober learns nothing
 *   ORIGIN        the Origin header must be the admin origin
 *   INCIDENT LOG  the control plane must open, or the attempt is refused as INCIDENT_LOG_UNAVAILABLE
 *   RATE LIMIT    read from the log: more than N attempts in the window is RATE_LIMITED, not appended
 *   COMPARE       constant-time against WTP_ADMIN_SECRET
 *   APPEND        one incident record per attempt, before the session is issued; a failed append refuses
 *   ISSUE         the existing session cookie, marked `via: "break-glass"`
 * ```
 *
 * Nothing about the submitted value is logged. DELETE is sign-out and is not behind the flag.
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
  return NextResponse.redirect(new URL(loginPathFor(why), ADMIN_ORIGIN), 303);
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
  const response = NextResponse.redirect(new URL("/admin", ADMIN_ORIGIN), 303);
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
