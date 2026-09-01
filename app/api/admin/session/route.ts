/**
 * **THE LOGIN POST.** (Session C final, ITEM H, 2026-09-01.)
 *
 * The one place the admin secret is compared, and the only place it is read.
 *
 * ## What this route is careful about, and why each one
 *
 * ```
 *   HOST         refuses on any host but ADMIN_ORIGIN's. Middleware already
 *                404s this path on the public host; this is the second lock,
 *                because a route that is only safe because of a matcher is one
 *                regex edit away from not being safe
 *   ORIGIN       state-changing, so the Origin header must be the admin origin.
 *                SameSite=Strict is the browser's half; this is ours
 *   BODY         the secret arrives in the body, never a query string
 *   COMPARE      constant-time, so response latency does not leak a prefix
 *   LOG          nothing about the submitted value is logged, ever — not its
 *                length, not a prefix, not a hash
 *   REDIRECT     303 to /admin on success, and to /admin/login?why=… on
 *                failure. `why` is a rejection CLASS, never an echo of input
 * ```
 *
 * ## Why failures are not rate-limited here, and what that means
 *
 * They are not, and pretending otherwise would be worse than saying so. A
 * per-instance counter in a serverless function is not a rate limit — instances
 * are created and destroyed per request — and a real one needs the durable
 * store, which is a write on an unauthenticated path and therefore its own
 * denial-of-service surface. The defence that is actually load-bearing is the
 * secret's own entropy, which is why {@link MIN_SECRET_LENGTH} is enforced and
 * a short secret is refused as a CONFIGURATION error rather than accepted.
 * This is named in the session report rather than left for someone to discover.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import {
  ADMIN_SECRET_VAR,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  SESSION_LIFETIME_SECONDS,
  checkLogin,
  isAdminHostRequest,
  mintAdminSessionId,
  originAllowed,
  sessionCookieAttributes,
  signSession,
} from "@/lib/control-plane/admin-auth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function backToLogin(request: NextRequest, why: string): NextResponse {
  const url = new URL("/admin/login", request.url);
  url.searchParams.set("why", why);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // The second lock on the host. Not redundant — see the header.
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) {
    return new NextResponse(null, { status: 404 });
  }

  // State-changing: the request must come from the admin surface itself.
  if (!originAllowed(request.headers.get("origin"), ADMIN_ORIGIN)) {
    return backToLogin(request, "ORIGIN");
  }

  const form = await request.formData();
  const submitted = form.get("secret");

  const verdict = checkLogin(
    typeof submitted === "string" ? submitted : null,
    process.env[ADMIN_SECRET_VAR],
  );

  if (!verdict.ok) {
    return backToLogin(request, verdict.reason);
  }

  const sessionKey = process.env[ADMIN_SESSION_KEY_VAR];
  if (!sessionKey) {
    // The secret was right and we still cannot issue a session. Saying
    // NOT_CONFIGURED rather than REFUSED matters: the owner would otherwise
    // spend the afternoon convinced he had the wrong secret.
    return backToLogin(request, "NOT_CONFIGURED");
  }

  const iat = Math.floor(Date.now() / 1000);
  const cookie = await signSession(
    { sid: mintAdminSessionId(), iat, exp: iat + SESSION_LIFETIME_SECONDS },
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
