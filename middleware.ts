/**
 * **HOST ROUTING, AND THE 404 THAT IS THE WHOLE SEPARATION.**
 * (Session C final, ITEM H, 2026-09-01.)
 *
 * The admin host (`ADMIN_ORIGIN`) is a DOMAIN ALIAS on the same Netlify site
 * that serves readers — one deploy, one function bundle, one environment.
 * Measured on the Netlify API on 2026-09-01: the alias is registered on site
 * `sparkwtp`, a managed `NETLIFY` DNS record for it points at the site default
 * subdomain, and the existing apex wildcard certificate already covers it (it
 * did not re-issue when the alias was added — read back from `/ssl`).
 *
 * That means the separation between the owner's control centre and the public
 * product is not infrastructural. It is this file, and it is
 * `lib/control-plane/admin-auth.ts`. Nothing else stands between them.
 *
 * ## The two rules, and they are not the same rule
 *
 * ```
 *   1  EVERY ADMIN ROUTE 404s ON THE PUBLIC HOST
 *      Not 403, not a redirect. A 403 confirms the path exists; a redirect
 *      names where it lives. 404 is the answer that tells a prober nothing,
 *      and it is what the acceptance clause asks for by name.
 *
 *   2  NO ADMIN SURFACE IS REACHABLE UNAUTHENTICATED ON THE ADMIN HOST
 *      Refused BEFORE any admin data is read. The check runs in middleware,
 *      which is upstream of the route handler, so an unauthenticated request
 *      never reaches the code that opens the control plane.
 * ```
 *
 * Rule 1 without rule 2 is an unlocked door on a quiet street. Rule 2 without
 * rule 1 is a locked door with a sign on the public site saying where it is.
 *
 * ## Why the public host also refuses the admin host's paths in reverse
 *
 * The admin host serves ONLY the admin surface. A reader page answering on
 * the admin host would be a second origin serving the product, and
 * `lib/ops/origin-confinement.ts` decides whether a synthetic-run marker may
 * travel by comparing HOSTS — an origin that answers 200 but is not
 * `PUBLIC_SITE_ORIGIN` is an origin where the confinement rule and the deployed
 * reality disagree. That is the exact defect ITEM F's 301 was adopted to close,
 * and re-opening it under a different hostname would be no better.
 *
 * ## What is deliberately NOT protected
 *
 * Framework JS/CSS chunks under `/_next/static` are publicly addressable. They
 * are not admin data — they are the same bundle the reader app ships — and
 * gating them would break the admin page without protecting anything. The
 * requirement is that no admin PAGE, server-rendered admin PAYLOAD, admin API
 * RESPONSE or admin DATA is available from the public host, and none is: the
 * data lives behind `/api/admin` and the RSC payload behind `/admin`, both of
 * which 404 there.
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

/** The command center and its authenticated API. */
const ADMIN_PATH_PREFIXES = ["/admin", "/api/admin"] as const;

/**
 * What may be reached unauthenticated on the admin host, and nothing else:
 * the login page; the Google start and its registered callback (RULING 245 —
 * the callback is a top-level navigation FROM Google carrying no session yet);
 * and the session route, which is sign-out (DELETE) and the flag-gated
 * break-glass (POST). Every other admin path needs a valid session cookie.
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
  // ONE implementation of "is this the admin host" (RULING 103), shared with
  // both admin route handlers. Two copies of this comparison is how one route
  // ends up reachable from the public host while the other is not.
  const onAdminHost = isAdminHostRequest(request.headers, ADMIN_ORIGIN);
  const { pathname } = request.nextUrl;

  /* ---------------------------------------------------------------- *
   * THE PUBLIC HOST — and anything that is not the admin host.
   *
   * The default branch is the SAFE one on purpose. An unrecognised host
   * (a preview URL, the site's default subdomain, a probe with a forged
   * Host header) is treated as public and therefore refused the admin
   * paths. A default that fell through to "admin" would turn every
   * misconfiguration into an open control centre.
   * ---------------------------------------------------------------- */
  if (!onAdminHost) {
    return isAdminPath(pathname) ? notFound() : NextResponse.next();
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
   * AUTHENTICATION — refused BEFORE any admin data is read.
   *
   * This runs upstream of every admin route handler, so a request without
   * a valid session never reaches the code that opens the control-plane
   * connection. "Failed authentication is refused before admin data is
   * read" is a property of WHERE this check lives, not of how carefully
   * each handler remembers to call it.
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
    // The reason travels so the page can say "your session expired" rather
    // than "wrong secret". It is a REJECTION CLASS, never the secret and
    // never anything the owner typed.
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
 * Run on everything except Next's own static output and the favicon.
 *
 * The admin paths must be matched on EVERY host — that is how rule 1 is
 * enforced — so this matcher cannot be narrowed to `/admin/*`. A matcher that
 * only ran on admin paths would still be correct for rule 2 and would silently
 * drop rule 1 the moment somebody "optimised" it, which is why the reasoning is
 * written here next to the pattern.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
