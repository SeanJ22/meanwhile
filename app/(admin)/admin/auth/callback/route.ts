/**
 * **THE REGISTERED REDIRECT URI.** (RULING 245, 2026-09-02.)
 *
 * `ADMIN_ORIGIN` + `OAUTH_CALLBACK_PATH`, exactly as registered on the OAuth
 * client — the admin host or nothing, never the request's own. Google sends
 * the browser here with `code` and `state`; this route exchanges the code
 * server-side, verifies the ID token against Google's keys, and admits
 * exactly the enrolled owner by issuing the EXISTING session cookie. Every
 * decision is `completeGoogleCallback` in `lib/control-plane/admin-google.ts`;
 * this file is the Next-shaped rim around it.
 *
 * On every outcome the state cookie is cleared. On failure the browser goes
 * to `/admin/login?why=<class>` — the class, never the token, the code, the
 * email Google asserted, or the error text Google sent.
 *
 * Nothing about a token or a code is logged. The one log line names the
 * class and, for an exchange failure, the HTTP status Google returned.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  SESSION_LIFETIME_SECONDS,
  isAdminHostRequest,
  mintAdminSessionId,
  sessionCookieAttributes,
  signSession,
} from "@/lib/control-plane/admin-auth.ts";
import {
  GOOGLE_CLIENT_ID_VAR,
  GOOGLE_CLIENT_SECRET_VAR,
  OAUTH_CALLBACK_PATH,
  OAUTH_STATE_COOKIE,
  completeGoogleCallback,
  createJwksResolver,
  loginPathFor,
  oauthCookieAttributes,
} from "@/lib/control-plane/admin-google.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Per-instance key cache. A miss re-fetches once; see the resolver. */
const resolveKey = createJwksResolver({ fetchImpl: (...args) => fetch(...args) });

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) {
    return new NextResponse(null, { status: 404 });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionKey = process.env[ADMIN_SESSION_KEY_VAR];
  const verdict = await completeGoogleCallback({
    query: request.nextUrl.searchParams,
    stateCookie: request.cookies.get(OAUTH_STATE_COOKIE)?.value,
    sessionKey,
    clientId: process.env[GOOGLE_CLIENT_ID_VAR],
    clientSecret: process.env[GOOGLE_CLIENT_SECRET_VAR],
    redirectUri: `${ADMIN_ORIGIN}${OAUTH_CALLBACK_PATH}`,
    nowSeconds,
    fetchImpl: (...args) => fetch(...args),
    resolveKey,
  });

  const clearState = `${OAUTH_STATE_COOKIE}=; ${oauthCookieAttributes(0)}`;

  if (!verdict.ok || !sessionKey) {
    const why = verdict.ok ? "NOT_CONFIGURED" : verdict.rejection;
    if (!verdict.ok && verdict.rejection === "TOKEN_EXCHANGE_FAILED") {
      console.error(`admin google sign-in: TOKEN_EXCHANGE_FAILED (http ${verdict.httpStatus ?? "unreachable"})`);
    }
    const response = NextResponse.redirect(new URL(loginPathFor(why), ADMIN_ORIGIN), 303);
    response.headers.append("set-cookie", clearState);
    response.headers.set("cache-control", "no-store");
    return response;
  }

  const cookie = await signSession(
    { sid: mintAdminSessionId(), iat: nowSeconds, exp: nowSeconds + SESSION_LIFETIME_SECONDS, via: "google" },
    sessionKey,
  );
  const response = NextResponse.redirect(new URL("/admin", ADMIN_ORIGIN), 303);
  response.headers.append(
    "set-cookie",
    `${ADMIN_SESSION_COOKIE}=${cookie}; ${sessionCookieAttributes(SESSION_LIFETIME_SECONDS)}`,
  );
  response.headers.append("set-cookie", clearState);
  response.headers.set("cache-control", "no-store");
  return response;
}
