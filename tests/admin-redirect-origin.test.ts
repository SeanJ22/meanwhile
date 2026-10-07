/**
 * Every admin redirect lands on the admin host. On Netlify an `/api/*` function sees the site's
 * primary host in `request.url`, so every Location is built from `ADMIN_ORIGIN` (already required
 * by `isAdminHostRequest`). Each destination is validated as a path before it is joined, so the
 * fixed base can never become an open redirect.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { NextRequest } from "next/server";

import { GET as startGET } from "@/app/(admin)/admin/auth/google/route.ts";
import { GOOGLE_CLIENT_ID_VAR, GOOGLE_CLIENT_SECRET_VAR, OAUTH_START_PATH } from "@/lib/control-plane/admin-google.ts";
import { ADMIN_SESSION_KEY_VAR } from "@/lib/control-plane/admin-auth.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins.ts";

const ROOT = process.cwd();
const ADMIN_HOST = new URL(ADMIN_ORIGIN).host;
const PUBLIC_HOST = new URL(PUBLIC_SITE_ORIGIN).host;

/** The routes that answer a form submit with a 303, and how many redirects each builds. */
const REDIRECTING_ROUTES: Readonly<Record<string, number>> = {
  "app/api/admin/session/route.ts": 2,
  "app/api/admin/action/route.ts": 1,
  "app/(admin)/admin/auth/google/route.ts": 1,
  "app/(admin)/admin/auth/callback/route.ts": 2,
};

/**
 * A `new URL(…, request.url)` that is NOT a redirect, and why. The chat route
 * forwards the owner's message in process to the action handler; that URL is
 * never a Location a browser follows.
 */
const IN_PROCESS_FORWARDS: Readonly<Record<string, string>> = {
  "app/api/admin/chat/route.ts": "an in-process NextRequest to /api/admin/action, never a Location",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

/** Code only: block and line comments removed, so a comment that DESCRIBES the defect is not the defect. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const repoPath = (path: string) => relative(ROOT, path).split(sep).join("/");

test("no admin route builds a URL on request.url, except a named in-process forward", () => {
  const files = [...sourceFiles(join(ROOT, "app", "api", "admin")), ...sourceFiles(join(ROOT, "app", "(admin)"))];
  const read = new Set(files.map(repoPath));
  for (const route of Object.keys(REDIRECTING_ROUTES)) {
    assert.ok(read.has(route), `the scan must actually read ${route}`);
  }
  const offenders: string[] = [];
  for (const file of files) {
    const path = repoPath(file);
    const body = code(readFileSync(file, "utf8"));
    const bases = body.match(/new URL\([^;]*?,\s*request\.url\s*\)/g) ?? [];
    const direct = body.match(/NextResponse\.redirect\(\s*request\.url/g) ?? [];
    if (direct.length > 0) offenders.push(`${path}: redirects to request.url itself`);
    if (bases.length > 0 && IN_PROCESS_FORWARDS[path] === undefined) {
      offenders.push(`${path}: ${bases.length} URL(s) built on request.url`);
    }
  }
  assert.deepEqual(offenders, [], "an admin Location built from request.url lands on the public host on Netlify");
});

test("each redirecting route builds exactly its redirects on ADMIN_ORIGIN", () => {
  for (const [route, expected] of Object.entries(REDIRECTING_ROUTES)) {
    const body = code(readFileSync(join(ROOT, route), "utf8"));
    const onAdmin = body.match(/new URL\([^;]*?,\s*ADMIN_ORIGIN\s*\)/g) ?? [];
    assert.equal(onAdmin.length, expected, `${route} builds ${onAdmin.length} URL(s) on ADMIN_ORIGIN, expected ${expected}`);
    assert.match(body, /import \{[^}]*\bADMIN_ORIGIN\b[^}]*\} from "@\/lib\/ops\/origins\.ts"/, `${route} imports ADMIN_ORIGIN by name`);
  }
});

test("SEEDED: a request whose URL names the public host, arriving on the admin host, is sent back to the admin host", async () => {
  // Netlify's shape: the Host header is the admin host (so the handler's own
  // host check passes) while request.url carries the primary domain.
  const names = [GOOGLE_CLIENT_ID_VAR, GOOGLE_CLIENT_SECRET_VAR, ADMIN_SESSION_KEY_VAR];
  const before = names.map((name) => process.env[name]);
  for (const name of names) delete process.env[name];
  try {
    const request = new NextRequest(`https://${PUBLIC_HOST}${OAUTH_START_PATH}`, { headers: { host: ADMIN_HOST } });
    const response = await startGET(request);
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.host, ADMIN_HOST, `the Location must be the admin host, not ${location.host}`);
    assert.equal(location.pathname, "/admin/login");
    assert.equal(location.searchParams.get("why"), "NOT_CONFIGURED");
  } finally {
    names.forEach((name, i) => {
      if (before[i] === undefined) delete process.env[name];
      else process.env[name] = before[i];
    });
  }
});
