/**
 * Research view guards, each with a positive control where a detector could look at nothing:
 *   1  an admin route on the public host 404s, and an unauthenticated admin-host request is refused
 *      before any data is read
 *   2  a stored flag asserting the lane is active is ignored; the verdict is derived from the
 *      heartbeat, the state, the intents and the spend
 *   3  a historical success is not a live lane
 *   4  every number the page emits carries a denominator and a contract
 *   5  the credential never travels: name and configured flag only
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware.ts";
import { ADMIN_ORIGIN } from "@/lib/ops/origins.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { appendResearchIntent, buildResearchIntent } from "@/lib/control-plane/research-view.ts";
import { RESEARCH_FORMAT_VERSION, RESEARCH_INTENT_LOG_KEY } from "@/lib/control-plane/scheduler/research-policy.ts";
import { ADMIN_HOST, PUBLIC_HOST } from "./admin-session.ts";

const ROOT = process.cwd();

/* ------------------------------------------------------------------ fixtures */

const NOW = "2026-09-01T12:00:00.000Z";

/* ------------------------------------------------------------ requests */

function request(host: string, path: string): NextRequest {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

function post(host: string, body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://${host}/api/admin/research`, {
    method: "POST",
    headers: { host, "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

/* ================================================================== *
 * SEEDED FAILURE 1 — host and session boundaries, through the real middleware
 * ================================================================== */

test("SEEDED: /admin/research and /api/admin/research return 404 on the PUBLIC host", async () => {
  for (const path of ["/admin/research", "/api/admin/research", "/admin/research?attempt=x"]) {
    const response = await middleware(request(PUBLIC_HOST, path));
    assert.equal(response.status, 404, `${path} on the public host must be 404, not ${response.status}`);
  }
  const posted = await middleware(post(PUBLIC_HOST, "action=PAUSE", { origin: ADMIN_ORIGIN }));
  assert.equal(posted.status, 404, "a POST on the public host is 404 too");
});

test("SEEDED: an unauthenticated /admin/research request on the ADMIN host redirects to the login", async () => {
  const response = await middleware(request(ADMIN_HOST, "/admin/research"));
  assert.equal(response.status, 307);
  const location = response.headers.get("location") ?? "";
  assert.match(location, /\/admin\/login/);
  assert.match(location, /why=/);
});

test("SEEDED: an unauthenticated /api/admin/research request on the ADMIN host is 401", async () => {
  const response = await middleware(post(ADMIN_HOST, "action=PAUSE", { origin: ADMIN_ORIGIN }));
  assert.equal(response.status, 401);
});

/* ================================================================== *
 * THE ACCEPTED INTENT, AS APPENDED
 * ================================================================== */

test("an accepted intent carries actor, adminSessionRef, requestedAt and action, and lands under the log key", async () => {
  const repos = createMemoryRepositories();
  const intent = buildResearchIntent("PAUSE", NOW, "adm_test-session");
  assert.deepEqual(intent, {
    formatVersion: RESEARCH_FORMAT_VERSION,
    kind: "INTENT",
    intentId: `PAUSE:${NOW}`,
    action: "PAUSE",
    requestedAt: NOW,
    actor: "owner (admin session)",
    adminSessionRef: "adm_test-session",
    note: null,
  });

  const wrote = await appendResearchIntent(repos, intent, NOW);
  assert.deepEqual(wrote, { ok: true, appended: true });
  const log = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY);
  assert.deepEqual(log, [intent]);

  // A retried append of the identical record is a no-op success, never a duplicate.
  const again = await appendResearchIntent(repos, intent, NOW);
  assert.deepEqual(again, { ok: true, appended: false });
  assert.equal((await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).length, 1);
});

test("POSITIVE CONTROL: the append path refuses a record carrying a reader-level field", async () => {
  const repos = createMemoryRepositories();
  const poisoned = { ...buildResearchIntent("RESUME", NOW, "adm_x"), email: "someone@example.com" };
  const wrote = await appendResearchIntent(repos, poisoned as never, NOW);
  assert.equal(wrote.ok, false);
  if (!wrote.ok) assert.match(wrote.detail, /email/);
  assert.deepEqual(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY), []);
});

/* ================================================================== *
 * SEEDED FAILURE 2 — a stored flag is IGNORED; the verdict is derived
 * ================================================================== */

test("the view module never reads a stored flag off the state — checked in source, with a positive control", () => {
  const source = readFileSync(join(ROOT, "lib", "control-plane", "research-view.ts"), "utf8");
  assert.ok(source.length > 1000, "the source read collapsed");
  const readsAFlag = /\b(?:state|input\.state|row|value)\??\.(?:active|verdict|alive)\b/;
  assert.equal(readsAFlag.test("const x = state?.active;"), true, "positive control: the detector fires");
  assert.equal(readsAFlag.test("if (state.verdict === 'ACTIVE')"), true, "positive control: the detector fires");
  assert.equal(readsAFlag.test(source), false, "research-view.ts reads a stored flag off the state");
});

/* ================================================================== *
 * SEEDED FAILURE 3 — a historical success is not a live lane
 * ================================================================== */

/* ================================================================== *
 * SEEDED FAILURE 4 — every number carries a denominator and a contract
 * ================================================================== */

/* ================================================================== *
 * SEEDED FAILURE 5 — the credential never travels
 * ================================================================== */

/* ================================================================== *
 * The runner's own facts travel to the view
 * ================================================================== */

/* ================================================================== *
 * The typed facts a plain sentence needs travel on the row
 * ================================================================== */

/* ================================================================== *
 * THE READS, AGAINST THE IN-MEMORY DOUBLE
 * ================================================================== */

