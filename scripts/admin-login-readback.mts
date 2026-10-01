/**
 * `pnpm admin:login-readback` — **THE OWNER SIGN-IN, READ BACK FROM THE
 * DEPLOYED ADMIN HOST.** (Autonomy-recovery session, 2026-09-01. Sign in with
 * Google, RULING 245, 2026-09-02.)
 *
 * The seeded checks in `tests/admin-google-signin.test.ts` prove the routes'
 * decisions against fake requests. They cannot prove the thing the owner
 * actually does: open the admin host (`ADMIN_ORIGIN`), click Sign in with
 * Google, and come back with a cookie the browser will keep. That walk crosses
 * Netlify's edge, its function runtime, its env-var scoping and the browser's
 * `__Host-` cookie rules, and any one of them can turn a correct handler into
 * a redirect loop. So this script walks the LIVE host's OBSERVABLE hops.
 *
 * ## What it can and cannot observe
 *
 * It cannot sign in as the owner — that needs a Google account, a browser and
 * the owner. It CAN observe every hop on our side of Google: the dashboard
 * refusing an anonymous request, the login page offering Google, the start
 * route 302ing to `accounts.google.com` with PKCE and the Lax state cookie,
 * the callback refusing a state it did not issue, and both new routes 404ing
 * on the public host. The one live proof this cannot take — the owner reaching
 * `/admin` after a real sign-in — is the owner's own
 * step in `docs/admin-sign-in.md`.
 *
 * ## What it never does
 *
 * No secret is needed for the Google walk. The client id in the 302's Location
 * is checked for PRESENCE and never printed or recorded. Cookie NAMES and
 * ATTRIBUTES are recorded; no cookie value is. With `--break-glass` the old
 * secret walk runs too: the secret is read from `WTP_ADMIN_SECRET` by name,
 * sent in ONE request body, and the session it earns is signed out at the end.
 *
 * ## Verdicts
 *
 *   exit 0   every hop answered as the flow promises
 *   exit 1   a hop answered wrongly — the hop, its status and its redirect
 *            class are printed and recorded
 *   exit 2   COULD NOT TELL — the deploy reports NOT_CONFIGURED (the missing
 *            variable NAMES are printed), the Google routes are not deployed
 *            at this head, or the host could not be reached. Never printed
 *            like a pass (RULING 24)
 *
 * ## Flags
 *
 *   --origin=<origin>   the host to walk; default ADMIN_ORIGIN
 *   --as-admin-host     send `x-forwarded-host` so a LOCAL `next start` answers
 *                       as the admin host (the middleware reads that header
 *                       first). For a local proof of a built head
 *   --break-glass       also walk the shared-secret path; meaningful only when
 *                       the deploy has WTP_ADMIN_BREAK_GLASS=enabled
 *   --no-record         print, do not write data/ops/admin-login-readback.json
 *
 * The durable record is `data/ops/admin-login-readback.json`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN, hostOf } from "../lib/ops/origins.ts";
import {
  ADMIN_SECRET_VAR,
  ADMIN_SESSION_COOKIE,
  BREAK_GLASS_FLAG_VAR,
} from "../lib/control-plane/admin-auth.ts";
import {
  GOOGLE_CLIENT_ID_VAR,
  GOOGLE_CLIENT_SECRET_VAR,
  OAUTH_CALLBACK_PATH,
  OAUTH_START_PATH,
  OAUTH_STATE_COOKIE,
} from "../lib/control-plane/admin-google.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const OUT = join(ROOT, "data", "ops", "admin-login-readback.json");
const args = process.argv.slice(2);
const origin = args.find((a) => a.startsWith("--origin="))?.slice("--origin=".length) ?? ADMIN_ORIGIN;
const asAdminHost = args.includes("--as-admin-host");
const walkBreakGlass = args.includes("--break-glass");
const record = !args.includes("--no-record");
const adminHost = hostOf(ADMIN_ORIGIN);
const publicHost = hostOf(PUBLIC_SITE_ORIGIN);
/** Where a redirect is expected to land: the origin we are walking. */
const expectedRedirectHost = asAdminHost ? adminHost : new URL(origin).host;

interface Hop {
  readonly name: string;
  readonly method: string;
  readonly host: "admin" | "public";
  readonly path: string;
  readonly status: number | null;
  /** The redirect target as the server sent it — rejection CLASSES only, never a secret. */
  readonly location: string | null;
  readonly requestId: string | null;
  readonly expected: string;
  readonly ok: boolean;
  readonly note: string;
}

const hops: Hop[] = [];
let sessionCookieAttributes: string[] = [];
let oauthCookieAttributes: string[] = [];
let oauthCookieSameSite: string | null = null;
let googleConfigured: boolean | null = null;
let googleRoutesDeployed: boolean | null = null;
let missingVariables: string[] = [];
let breakGlassOpen: boolean | null = null;

function log(line: string): void {
  console.log(`admin:login-readback · ${line}`);
}

function recordHop(h: Hop): void {
  hops.push(h);
  log(
    `${h.ok ? "OK   " : "FAIL "} ${h.name}: ${h.method} ${h.path} [${h.host}] -> ${h.status ?? "no response"}` +
      (h.location ? ` -> ${redactLocation(h.location)}` : "") +
      (h.note ? ` (${h.note})` : ""),
  );
}

/** A Google authorization URL carries the client id; print its host only. */
function redactLocation(location: string): string {
  try {
    const u = new URL(location, origin);
    if (u.host === "accounts.google.com") return `https://accounts.google.com/… (query withheld)`;
    return `${u.pathname}${u.search}`;
  } catch {
    return "(unparseable Location)";
  }
}

/** Headers that make a LOCAL server answer as the named host. Netlify sets this itself. */
function hostHeaders(host: "admin" | "public"): Record<string, string> {
  if (!asAdminHost) return {};
  return { "x-forwarded-host": host === "admin" ? adminHost : publicHost };
}

function urlFor(host: "admin" | "public", path: string): string {
  if (asAdminHost) return `${origin}${path}`;
  return `${host === "admin" ? origin : PUBLIC_SITE_ORIGIN}${path}`;
}

async function hop(input: {
  name: string;
  method: string;
  host: "admin" | "public";
  path: string;
  headers?: Record<string, string>;
  body?: string;
  expected: string;
  judge: (res: Response, text: string) => { ok: boolean; note: string };
}): Promise<Response | null> {
  let res: Response;
  try {
    res = await fetch(urlFor(input.host, input.path), {
      method: input.method,
      headers: { ...hostHeaders(input.host), ...(input.headers ?? {}) },
      body: input.body,
      redirect: "manual",
    });
  } catch (error) {
    recordHop({
      name: input.name, method: input.method, host: input.host, path: input.path, status: null,
      location: null, requestId: null, expected: input.expected, ok: false,
      note: `COULD NOT REACH: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
  const text = input.method === "GET" && res.status === 200 ? await res.text() : "";
  const verdict = input.judge(res, text);
  recordHop({
    name: input.name,
    method: input.method,
    host: input.host,
    path: input.path,
    status: res.status,
    location: res.headers.get("location"),
    requestId: res.headers.get("x-nf-request-id"),
    expected: input.expected,
    ok: verdict.ok,
    note: verdict.note,
  });
  return res;
}

/** The redirect target, resolved against the origin, as host + pathname + search. */
function target(res: Response): { host: string; path: string; url: URL } | null {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const u = new URL(loc, origin);
  return { host: u.host, path: `${u.pathname}${u.search}`, url: u };
}

function isRedirect(res: Response): boolean {
  return res.status === 302 || res.status === 303 || res.status === 307 || res.status === 308;
}

/** Attribute NAMES (and the SameSite value) of one Set-Cookie line. Never the value. */
function cookieLine(res: Response, name: string): { attrs: string[]; sameSite: string | null; maxAge: string | null } | null {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  if (!line) return null;
  const parts = line.split(";").map((s) => s.trim()).slice(1);
  const attrs = parts.map((a) => a.split("=")[0]);
  const sameSite = parts.find((a) => /^samesite=/i.test(a))?.split("=")[1] ?? null;
  const maxAge = parts.find((a) => /^max-age=/i.test(a))?.split("=")[1] ?? null;
  return { attrs, sameSite, maxAge };
}

log(`walking ${origin}${asAdminHost ? " as the admin host (x-forwarded-host)" : ""}`);

/* 1 · the dashboard refuses an anonymous request by redirecting to login */
await hop({
  name: "anonymous dashboard",
  method: "GET",
  host: "admin",
  path: "/admin",
  expected: "redirect to /admin/login?why=NO_COOKIE on the admin host",
  judge: (res) => {
    const t = target(res);
    const ok = isRedirect(res) && t !== null && t.host === expectedRedirectHost && t.path === "/admin/login?why=NO_COOKIE";
    return { ok, note: t ? `host ${t.host}` : "no Location" };
  },
});

/* 2 · the login page offers Google and names what is missing, if anything */
await hop({
  name: "login page",
  method: "GET",
  host: "admin",
  path: "/admin/login",
  expected: "200 with Sign in with Google; a missing variable is NAMED on the page",
  judge: (res, text) => {
    const offersGoogle = /Sign in with Google/.test(text);
    const notConfigured = /Sign in with Google is not configured/.test(text);
    const named = /Not set: <code>([^<]+)<\/code>/.exec(text);
    if (named) missingVariables = named[1].split(",").map((s) => s.trim()).filter(Boolean);
    if (offersGoogle) googleConfigured = !notConfigured;
    const hasSecretForm = /name="secret"/.test(text);
    return {
      ok: res.status === 200 && offersGoogle && !hasSecretForm,
      note: offersGoogle
        ? notConfigured
          ? `NOT_CONFIGURED on the page: ${missingVariables.join(", ") || "(names not parsed)"}`
          : "Sign in with Google offered" + (hasSecretForm ? "; the secret form is rendered (break-glass flag on?)" : "")
        : `status ${res.status}, Sign in with Google absent — this head does not carry RULING 245`,
    };
  },
});

/* 3 · the start route hands the browser to Google, or says NOT_CONFIGURED by class */
await hop({
  name: "google start",
  method: "GET",
  host: "admin",
  path: OAUTH_START_PATH,
  expected: `302 to accounts.google.com with PKCE S256 and the ${OAUTH_STATE_COOKIE} cookie (Lax), or 303 to /admin/login?why=NOT_CONFIGURED`,
  judge: (res) => {
    const t = target(res);
    if (res.status === 302 && t && t.host === "accounts.google.com") {
      googleRoutesDeployed = true;
      googleConfigured = true;
      const q = t.url.searchParams;
      const cookie = cookieLine(res, OAUTH_STATE_COOKIE);
      if (cookie) {
        oauthCookieAttributes = cookie.attrs;
        oauthCookieSameSite = cookie.sameSite;
      }
      const checks = {
        client_id: (q.get("client_id") ?? "").length > 0,
        redirect_uri: q.get("redirect_uri") === `${ADMIN_ORIGIN}${OAUTH_CALLBACK_PATH}`,
        s256: q.get("code_challenge_method") === "S256" && (q.get("code_challenge") ?? "").length > 0,
        state: (q.get("state") ?? "").length > 0,
        scope: q.get("scope") === "openid email",
        cookie: cookie !== null,
        lax: cookie?.sameSite?.toLowerCase() === "lax",
        httpOnly: cookie?.attrs.some((a) => a.toLowerCase() === "httponly") ?? false,
        secure: cookie?.attrs.some((a) => a.toLowerCase() === "secure") ?? false,
      };
      const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      return {
        ok: failed.length === 0,
        note: failed.length === 0
          ? `client id present (withheld); redirect_uri registered; S256; cookie ${OAUTH_STATE_COOKIE} ${cookie?.attrs.join(", ")}`
          : `failed: ${failed.join(", ")}`,
      };
    }
    if (res.status === 303 && t && t.path === "/admin/login?why=NOT_CONFIGURED") {
      googleRoutesDeployed = true;
      googleConfigured = false;
      return { ok: false, note: `NOT_CONFIGURED: ${missingVariables.join(", ") || `${GOOGLE_CLIENT_ID_VAR} and/or ${GOOGLE_CLIENT_SECRET_VAR}`}` };
    }
    if (isRedirect(res) && t && /why=NO_COOKIE/.test(t.path)) {
      googleRoutesDeployed = false;
      return { ok: false, note: "ROUTE_NOT_DEPLOYED: the middleware at this head does not know the Google start route" };
    }
    return { ok: false, note: t ? `unexpected ${res.status} -> ${redactLocation(res.headers.get("location") ?? "")}` : `status ${res.status}` };
  },
});

/* 4 · the callback refuses a state it did not issue, and clears the cookie */
await hop({
  name: "callback with bad state",
  method: "GET",
  host: "admin",
  path: `${OAUTH_CALLBACK_PATH}?state=not-issued-by-this-host&code=not-a-code`,
  expected: "303 to /admin/login?why=BAD_STATE, no session cookie, state cookie cleared",
  judge: (res) => {
    const t = target(res);
    const session = cookieLine(res, ADMIN_SESSION_COOKIE);
    const cleared = cookieLine(res, OAUTH_STATE_COOKIE);
    if (googleRoutesDeployed === false && isRedirect(res) && t && /why=NO_COOKIE/.test(t.path)) {
      return { ok: false, note: "ROUTE_NOT_DEPLOYED" };
    }
    const ok = res.status === 303 && t !== null && t.path === "/admin/login?why=BAD_STATE" && session === null &&
      cleared !== null && cleared.maxAge === "0";
    return {
      ok,
      note: ok ? "refused by class; nothing issued" : `${t ? t.path : `status ${res.status}`}; session cookie ${session ? "PRESENT" : "absent"}`,
    };
  },
});

/* 5 · both new routes 404 on the public host */
await hop({
  name: "callback on public host",
  method: "GET",
  host: "public",
  path: `${OAUTH_CALLBACK_PATH}?state=x&code=y`,
  expected: "404",
  judge: (res) => ({ ok: res.status === 404, note: `status ${res.status}` }),
});
await hop({
  name: "google start on public host",
  method: "GET",
  host: "public",
  path: OAUTH_START_PATH,
  expected: "404",
  judge: (res) => ({ ok: res.status === 404, note: `status ${res.status}` }),
});

/* 6 · the break-glass path is closed unless the owner opened it */
await hop({
  name: "break-glass probe",
  method: "POST",
  host: "admin",
  path: "/api/admin/session",
  headers: { origin: ADMIN_ORIGIN, "content-type": "application/x-www-form-urlencoded" },
  body: "",
  expected: walkBreakGlass
    ? `not 404 — ${BREAK_GLASS_FLAG_VAR}=enabled is expected for this walk`
    : `404 — ${BREAK_GLASS_FLAG_VAR} absent, so the path does not exist`,
  judge: (res) => {
    breakGlassOpen = res.status !== 404;
    if (walkBreakGlass) return { ok: breakGlassOpen, note: breakGlassOpen ? "open, as expected for --break-glass" : "CLOSED: enable the flag first" };
    return { ok: !breakGlassOpen, note: breakGlassOpen ? `OPEN: ${BREAK_GLASS_FLAG_VAR} appears enabled — turn it off when the incident is over` : "closed" };
  },
});

/* 7 · optionally, the shared-secret walk — the RULING 245 break-glass */
let sessionCookie: string | null = null;
if (walkBreakGlass) {
  const secret = process.env[ADMIN_SECRET_VAR];
  if (!secret) {
    log(`COULD NOT TELL — --break-glass needs ${ADMIN_SECRET_VAR} in this environment (run with --env-file=.env.local)`);
  } else {
    const login = await hop({
      name: "break-glass POST",
      method: "POST",
      host: "admin",
      path: "/api/admin/session",
      headers: { origin: ADMIN_ORIGIN, "content-type": "application/x-www-form-urlencoded" },
      body: `secret=${encodeURIComponent(secret)}`,
      expected: "303 to /admin on the admin host, with a __Host- session cookie",
      judge: (res) => {
        const t = target(res);
        const line = res.headers.getSetCookie().find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`));
        if (line) {
          sessionCookie = line.split(";")[0].slice(ADMIN_SESSION_COOKIE.length + 1);
          sessionCookieAttributes = cookieLine(res, ADMIN_SESSION_COOKIE)?.attrs ?? [];
        }
        const attrsOk = ["Path", "Max-Age", "HttpOnly", "Secure", "SameSite"].every((a) =>
          sessionCookieAttributes.some((have) => have.toLowerCase() === a.toLowerCase()),
        );
        const ok = res.status === 303 && t !== null && t.path === "/admin" && line !== undefined && attrsOk;
        return {
          ok,
          note: line
            ? `cookie ${ADMIN_SESSION_COOKIE} set with ${sessionCookieAttributes.join(", ")}`
            : `no ${ADMIN_SESSION_COOKIE} cookie` + (t ? `; redirect ${t.path}` : ""),
        };
      },
    });
    if (login !== null && sessionCookie !== null) {
      await hop({
        name: "dashboard with session",
        method: "GET",
        host: "admin",
        path: "/admin",
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sessionCookie}` },
        expected: "200, the Pilot health page, no redirect",
        judge: (res, text) => {
          const t = target(res);
          const ok = res.status === 200 && /Pilot health/.test(text);
          return { ok, note: ok ? `${text.length} bytes, "Pilot health" rendered` : t ? `redirected to ${t.path}` : `status ${res.status}` };
        },
      });
      await hop({
        name: "public host with session",
        method: "GET",
        host: "public",
        path: "/admin",
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${sessionCookie}` },
        expected: "404 on the public host regardless of the cookie",
        judge: (res) => ({ ok: res.status === 404, note: `status ${res.status}` }),
      });
      await hop({
        name: "sign out",
        method: "DELETE",
        host: "admin",
        path: "/api/admin/session",
        headers: { origin: ADMIN_ORIGIN, cookie: `${ADMIN_SESSION_COOKIE}=${sessionCookie}` },
        expected: "204",
        judge: (res) => ({ ok: res.status === 204, note: "" }),
      });
    }
  }
}
sessionCookie = null;

const failed = hops.filter((h) => !h.ok);
const unreachable = hops.filter((h) => h.status === null);
const couldNotTell = unreachable.length > 0 || googleConfigured === false || googleRoutesDeployed === false;
const verdict = couldNotTell ? "COULD_NOT_TELL" : failed.length === 0 ? "PASS" : "FAIL";

if (record) {
  mkdirSync(join(ROOT, "data", "ops"), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        origin,
        asAdminHost,
        mode: walkBreakGlass ? "google+break-glass" : "google",
        ...(walkBreakGlass ? { secretVar: ADMIN_SECRET_VAR } : {}),
        cookieName: ADMIN_SESSION_COOKIE,
        cookieAttributes: sessionCookieAttributes,
        oauthCookieName: OAUTH_STATE_COOKIE,
        oauthCookieAttributes,
        oauthCookieSameSite,
        googleRoutesDeployed,
        googleConfigured,
        missingVariables,
        breakGlassFlagVar: BREAK_GLASS_FLAG_VAR,
        breakGlassOpen,
        hops,
        verdict,
        _note:
          "No secret, no client id and no cookie value is recorded here. `location` values carry rejection " +
          "classes (NO_COOKIE, BAD_STATE, NOT_CONFIGURED, ...) and never anything the owner typed; a Google " +
          "authorization URL is recorded as the server sent it, which carries the PUBLIC OAuth client id and " +
          "never the secret.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

log("");
/* RULING 159: the count carries its denominator, and a walk that ran no hop at
   all is COULD NOT ASSERT rather than a zero that reads like a pass. */
const answered = floored(
  "hops answered as promised",
  "the owner sign-in walk",
  hops.length,
  hops.length - failed.length,
  hops.length === 0 ? "no hop ran, so there is no walk to grade" : undefined,
);
log(`${verdict} — ${floorLine(answered)}${record ? ` · record ${OUT}` : " · not recorded (--no-record)"}`);
if (googleRoutesDeployed === false) {
  log("COULD NOT TELL — the Google sign-in routes are not deployed at this head; the walk proves the OLD flow's host only");
}
if (googleConfigured === false) {
  log(`COULD NOT TELL — the deploy reports NOT_CONFIGURED: ${missingVariables.join(", ") || `${GOOGLE_CLIENT_ID_VAR}, ${GOOGLE_CLIENT_SECRET_VAR}`} (add them in Netlify: production context, functions scope)`);
}
process.exit(verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2);
