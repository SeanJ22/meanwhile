/**
 * `pnpm admin:login-readback` — **ONE FULL OWNER LOGIN, READ BACK FROM THE
 * DEPLOYED ADMIN HOST.** (Autonomy-recovery session, 2026-09-01.)
 *
 * The seeded checks in `tests/admin-control-centre.test.ts` prove the
 * middleware's decisions against a fake request. They cannot prove the thing
 * the owner actually does: type the secret on the admin host (`ADMIN_ORIGIN`),
 * submit the form, and land on the dashboard over HTTPS with a cookie the browser will
 * keep. That walk crosses Netlify's edge, its function runtime, its env-var
 * scoping and the browser's `__Host-` cookie rules, and any one of them can
 * turn a correct handler into a redirect loop. So this script performs the
 * walk against the LIVE host and records every hop.
 *
 * ## What it never does
 *
 * The secret is read from `WTP_ADMIN_SECRET` by name and sent in ONE request
 * body. It is never printed, never written to the artifact, never placed in a
 * URL. The session cookie value is held in memory for the walk and discarded;
 * the artifact records the cookie's NAME and ATTRIBUTES only. The session is
 * signed out at the end so nothing is left issued.
 *
 * ## Verdicts
 *
 *   exit 0   every hop answered as the login flow promises
 *   exit 1   a hop answered wrongly — the hop, its status and its redirect
 *            class are printed and recorded
 *   exit 2   COULD NOT TELL — the secret is not in this environment, or the
 *            host could not be reached. Never printed like a pass (RULING 24)
 *
 * The durable record is `data/ops/admin-login-readback.json`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { ADMIN_SECRET_VAR, ADMIN_SESSION_COOKIE } from "../lib/control-plane/admin-auth.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const OUT = join(ROOT, "data", "ops", "admin-login-readback.json");
const origin = process.argv.find((a) => a.startsWith("--origin="))?.slice("--origin=".length) ?? ADMIN_ORIGIN;
const adminHost = new URL(origin).host;

interface Hop {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly status: number | null;
  /** The redirect target as the server sent it. Rejection CLASSES only — never a secret. */
  readonly location: string | null;
  readonly requestId: string | null;
  readonly expected: string;
  readonly ok: boolean;
  readonly note: string;
}

const hops: Hop[] = [];
let cookie: string | null = null;
let cookieAttributes: string[] = [];

function log(line: string): void {
  console.log(`admin:login-readback · ${line}`);
}

function record(h: Hop): void {
  hops.push(h);
  log(`${h.ok ? "OK   " : "FAIL "} ${h.name}: ${h.method} ${h.path} -> ${h.status ?? "no response"}` +
    (h.location ? ` -> ${h.location}` : "") + (h.note ? ` (${h.note})` : ""));
}

async function hop(input: {
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  expected: string;
  judge: (res: Response, text: string) => { ok: boolean; note: string };
}): Promise<Response | null> {
  const u = new URL(input.url);
  let res: Response;
  try {
    res = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      redirect: "manual",
    });
  } catch (error) {
    record({
      name: input.name, method: input.method, path: u.pathname, status: null, location: null,
      requestId: null, expected: input.expected, ok: false,
      note: `COULD NOT REACH: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
  const text = input.method === "GET" && res.status === 200 ? await res.text() : "";
  const verdict = input.judge(res, text);
  record({
    name: input.name,
    method: input.method,
    path: u.pathname,
    status: res.status,
    location: res.headers.get("location"),
    requestId: res.headers.get("x-nf-request-id"),
    expected: input.expected,
    ok: verdict.ok,
    note: verdict.note,
  });
  return res;
}

/** The redirect target, resolved against the origin, as pathname + search. */
function target(res: Response): { host: string; path: string } | null {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const u = new URL(loc, origin);
  return { host: u.host, path: `${u.pathname}${u.search}` };
}

const secret = process.env[ADMIN_SECRET_VAR];
if (!secret) {
  log(`COULD NOT TELL — ${ADMIN_SECRET_VAR} is not in this environment (run with --env-file=.env.local)`);
  process.exit(2);
}

log(`walking ${origin} · secret read from ${ADMIN_SECRET_VAR} by name`);

/* 1 · the dashboard refuses an anonymous request by redirecting to login */
await hop({
  name: "anonymous dashboard",
  method: "GET",
  url: `${origin}/admin`,
  expected: "redirect to /admin/login?why=NO_COOKIE on the admin host",
  judge: (res) => {
    const t = target(res);
    const ok = (res.status === 307 || res.status === 308 || res.status === 302) &&
      t !== null && t.host === adminHost && t.path === "/admin/login?why=NO_COOKIE";
    return { ok, note: t ? `host ${t.host}` : "no Location" };
  },
});

/* 2 · the login POST */
const login = await hop({
  name: "login POST",
  method: "POST",
  url: `${origin}/api/admin/session`,
  headers: { origin, "content-type": "application/x-www-form-urlencoded" },
  body: `secret=${encodeURIComponent(secret)}`,
  expected: "303 to /admin on the admin host, with a __Host- session cookie",
  judge: (res) => {
    const t = target(res);
    const setCookies = res.headers.getSetCookie();
    const ours = setCookies.find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`));
    if (ours) {
      const [pair, ...attrs] = ours.split(";").map((s) => s.trim());
      cookie = pair.slice(ADMIN_SESSION_COOKIE.length + 1);
      cookieAttributes = attrs.map((a) => a.split("=")[0]);
    }
    const attrsOk = ["Path", "Max-Age", "HttpOnly", "Secure", "SameSite"].every((a) =>
      cookieAttributes.some((have) => have.toLowerCase() === a.toLowerCase()),
    );
    const ok = res.status === 303 && t !== null && t.host === adminHost && t.path === "/admin" &&
      ours !== undefined && attrsOk;
    return {
      ok,
      note: ours
        ? `cookie ${ADMIN_SESSION_COOKIE} set with ${cookieAttributes.join(", ")}`
        : `no ${ADMIN_SESSION_COOKIE} cookie in ${setCookies.length} set-cookie header(s)` +
          (t ? `; redirect ${t.path}` : ""),
    };
  },
});

/* 3 · follow the redirect WITH the cookie: this is the hop the owner sees fail */
let dashboard: Response | null = null;
if (login !== null && cookie !== null) {
  dashboard = await hop({
    name: "dashboard with session",
    method: "GET",
    url: `${origin}/admin`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
    expected: "200, the Pilot health page, no redirect",
    judge: (res, text) => {
      const t = target(res);
      const ok = res.status === 200 && /Pilot health/.test(text);
      return {
        ok,
        note: ok
          ? `${text.length} bytes, "Pilot health" rendered`
          : t
            ? `redirected to ${t.path} on ${t.host}`
            : `status ${res.status}, "Pilot health" ${/Pilot health/.test(text) ? "present" : "absent"}`,
      };
    },
  });

  /* 4 · an admin API call with the session is accepted (the middleware lets it through) */
  await hop({
    name: "admin API with session",
    method: "GET",
    url: `${origin}/api/admin/session`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
    expected: "not a 401 — the session is honoured upstream of the handler (405 is the handler's own answer to GET)",
    judge: (res) => ({ ok: res.status !== 401 && res.status !== 404, note: `status ${res.status}` }),
  });

  /* 5 · the public host still 404s the dashboard, even carrying the session */
  await hop({
    name: "public host with session",
    method: "GET",
    url: `${PUBLIC_SITE_ORIGIN}/admin`,
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
    expected: "404 on the public host regardless of the cookie",
    judge: (res) => ({ ok: res.status === 404, note: `status ${res.status}` }),
  });

  /* 6 · sign out, so the walk leaves nothing issued */
  await hop({
    name: "sign out",
    method: "DELETE",
    url: `${origin}/api/admin/session`,
    headers: { origin, cookie: `${ADMIN_SESSION_COOKIE}=${cookie}` },
    expected: "204",
    judge: (res) => ({ ok: res.status === 204, note: "" }),
  });
}
cookie = null;

const failed = hops.filter((h) => !h.ok);
const unreachable = hops.filter((h) => h.status === null);
const verdict = unreachable.length > 0 ? "COULD_NOT_TELL" : failed.length === 0 ? "PASS" : "FAIL";

mkdirSync(join(ROOT, "data", "ops"), { recursive: true });
writeFileSync(
  OUT,
  `${JSON.stringify(
    {
      at: new Date().toISOString(),
      origin,
      secretVar: ADMIN_SECRET_VAR,
      cookieName: ADMIN_SESSION_COOKIE,
      cookieAttributes,
      hops,
      verdict,
      _note:
        "No secret and no cookie value is recorded here. `location` values carry rejection classes " +
        "(NO_COOKIE, EXPIRED, NOT_CONFIGURED, ...) and never anything the owner typed.",
    },
    null,
    2,
  )}\n`,
  "utf8",
);

log("");
/* RULING 159: the count carries its denominator, and a walk that ran no hop at
   all is COULD NOT ASSERT rather than a zero that reads like a pass. */
const answered = floored(
  "hops answered as promised",
  "the owner login walk",
  hops.length,
  hops.length - failed.length,
  hops.length === 0 ? "no hop ran, so there is no walk to grade" : undefined,
);
log(`${verdict} — ${floorLine(answered)} · record ${OUT}`);
if (dashboard === null && login !== null) log("the dashboard hop did not run because the login hop issued no session cookie");
process.exit(verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2);
