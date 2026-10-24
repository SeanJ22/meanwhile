/**
 * Host routing. The admin host (`ADMIN_ORIGIN`) is a domain alias on the same
 * Netlify site that serves readers, so this file and
 * `lib/control-plane/admin-auth.ts` are the whole separation.
 *
 * ```
 *   1  EVERY ADMIN ROUTE 404s ON THE PUBLIC HOST
 *      Not 403, not a redirect: a 403 confirms the path exists and a redirect
 *      names where it lives.
 *
 *   2  NO ADMIN SURFACE IS REACHABLE UNAUTHENTICATED ON THE ADMIN HOST
 *      Refused in middleware, upstream of every route handler, so an
 *      unauthenticated request never reaches code that opens the control plane.
 * ```
 *
 * The admin host serves ONLY the admin surface: a reader page answering there
 * would be a second product origin, which `lib/ops/origin-confinement.ts`
 * (comparing hosts against `PUBLIC_SITE_ORIGIN`) must not see.
 *
 * Framework chunks under `/_next/static` are deliberately public: they are the
 * same bundle the reader app ships. Admin data lives behind `/api/admin` and the
 * RSC payload behind `/admin`, both of which 404 on the public host.
 */

import { NextResponse, type NextRequest } from "next/server";

import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  isAdminHostRequest,
  verifySession,
} from "@/lib/control-plane/admin-auth.ts";
import { movedAdminPage } from "@/lib/control-plane/moved-pages.ts";
import { BALLOT_CACHE_HEADER } from "@/lib/reader/ballot-cache.ts";
import { ballotCacheValue } from "@/lib/reader/ballot-cache-value.ts";

/** The command center and its authenticated API. */
const ADMIN_PATH_PREFIXES = ["/admin", "/api/admin"] as const;

/**
 * What may be reached unauthenticated on the admin host: the login page; the
 * Google start and its registered callback (a top-level navigation from Google
 * carrying no session yet); and the session route (sign-out DELETE and the
 * flag-gated break-glass POST). Every other admin path needs a valid session.
 */
const UNAUTHENTICATED_ADMIN_PATHS = [
  "/admin/login",
  "/admin/auth/google",
  "/admin/auth/callback",
  "/api/admin/session",
] as const;

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isUnauthenticatedAdminPath(pathname: string): boolean {
  return UNAUTHENTICATED_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 404, with no body that names what was not found. */
function notFound(): NextResponse {
  return new NextResponse(null, {
    status: 404,
    headers: { "x-robots-tag": "noindex, nofollow, noarchive" },
  });
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // One implementation of "is this the admin host", shared with both admin
  // route handlers.
  const onAdminHost = isAdminHostRequest(request.headers, ADMIN_ORIGIN);
  const { pathname } = request.nextUrl;

  /* ---------------------------------------------------------------- *
   * THE PUBLIC HOST — and anything that is not the admin host. An
   * unrecognised host (a preview URL, a forged Host header) is treated as
   * public, so a misconfiguration never opens the control centre.
   * ---------------------------------------------------------------- */
  if (!onAdminHost) {
    if (isAdminPath(pathname)) return notFound();
    if (pathname !== "/ballot") return NextResponse.next();
    // Only middleware may decide a ballot copy is storable; a reader-sent verdict is dropped.
    const headers = new Headers(request.headers), verdict = await ballotCacheValue(request);
    headers.delete(BALLOT_CACHE_HEADER);
    if (verdict) headers.set(BALLOT_CACHE_HEADER, verdict);
    return NextResponse.next({ request: { headers } });
  }

  /* ---------------------------------------------------------------- *
   * THE ADMIN HOST.
   * ---------------------------------------------------------------- */

  // The admin host serves the admin surface and nothing else. `/` is the
  // control centre; every other non-admin path is not here.
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  if (!isAdminPath(pathname)) {
    return notFound();
  }

  // The login page and the login POST are the only unauthenticated surfaces.
  if (isUnauthenticatedAdminPath(pathname)) {
    return NextResponse.next();
  }

  /* ---------------------------------------------------------------- *
   * AUTHENTICATION — refused BEFORE any admin data is read, by virtue of
   * running upstream of every admin route handler.
   * ---------------------------------------------------------------- */
  const verdict = await verifySession(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    process.env[ADMIN_SESSION_KEY_VAR],
    Math.floor(Date.now() / 1000),
  );

  if (!verdict.ok) {
    // An API path gets a JSON 401 rather than a redirect: a fetch that
    // followed a redirect to an HTML login page would parse the page as
    // data and report a confusing error far from its cause.
    if (pathname.startsWith("/api/")) {
      return new NextResponse(
        JSON.stringify({ error: "authentication required", rejection: verdict.rejection }),
        { status: 401, headers: { "content-type": "application/json", "cache-control": "private, no-store" } },
      );
    }
    const login = new URL("/admin/login", request.url);
    // The reason travels so the page can say "your session expired"; it is a
    // rejection class, never the secret.
    login.searchParams.set("why", verdict.rejection);
    return NextResponse.redirect(login);
  }

  // A retired page goes to the command-center view that took over its job.
  const moved = movedAdminPage(pathname, request.nextUrl.searchParams.get("scope"));
  if (moved !== null) {
    return NextResponse.redirect(new URL(moved, request.url));
  }

  return NextResponse.next();
}

/**
 * Run on everything except Next's own static output and the favicon. Admin
 * paths must be matched on EVERY host for rule 1, so this matcher cannot be
 * narrowed to `/admin/*`.
 */
export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
