/**
 * The redirect URI is built from `ADMIN_ORIGIN`, never from the request: it must equal the registered URI
 * byte for byte, and a request's own host is what a prober controls. NOT_CONFIGURED is a 303 back to the
 * login page, never a 500.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import { ADMIN_SESSION_KEY_VAR, isAdminHostRequest } from "@/lib/control-plane/admin-auth.ts";
import {
  GOOGLE_CLIENT_ID_VAR,
  OAUTH_CALLBACK_PATH,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_LIFETIME_SECONDS,
  buildAuthorizationUrl,
  googleSignInReadiness,
  loginPathFor,
  mintOauthToken,
  mintPkceVerifier,
  oauthCookieAttributes,
  pkceChallenge,
  signOauthState,
} from "@/lib/control-plane/admin-google.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAdminHostRequest(request.headers, ADMIN_ORIGIN)) {
    return new NextResponse(null, { status: 404 });
  }

  const readiness = googleSignInReadiness(process.env);
  const clientId = process.env[GOOGLE_CLIENT_ID_VAR];
  const sessionKey = process.env[ADMIN_SESSION_KEY_VAR];
  if (!readiness.ready || !clientId || !sessionKey) {
    return NextResponse.redirect(new URL(loginPathFor("NOT_CONFIGURED"), ADMIN_ORIGIN), 303);
  }

  const verifier = mintPkceVerifier();
  const state = mintOauthToken();
  const nonce = mintOauthToken();
  const iat = Math.floor(Date.now() / 1000);
  const cookie = await signOauthState(
    { state, nonce, verifier, iat, exp: iat + OAUTH_STATE_LIFETIME_SECONDS },
    sessionKey,
  );

  const location = buildAuthorizationUrl({
    clientId,
    redirectUri: `${ADMIN_ORIGIN}${OAUTH_CALLBACK_PATH}`,
    state,
    nonce,
    codeChallenge: await pkceChallenge(verifier),
  });

  const response = NextResponse.redirect(location, 302);
  response.headers.append(
    "set-cookie",
    `${OAUTH_STATE_COOKIE}=${cookie}; ${oauthCookieAttributes(OAUTH_STATE_LIFETIME_SECONDS)}`,
  );
  response.headers.set("cache-control", "no-store");
  return response;
}
