/**
 * Admin control centre: admin routes 404 on the public host, unauthenticated admin requests are
 * refused before any data is read, a number without a denominator fails its own check, and the
 * credential boundary holds.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware.ts";
import {
  ADMIN_ORIGIN,
  LEGACY_NETLIFY_ORIGIN,
  PUBLIC_SITE_ORIGIN,
  hostOf,
} from "@/lib/ops/origins.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_ID_PREFIX,
  MIN_SECRET_LENGTH,
  SESSION_LIFETIME_SECONDS,
  checkLogin,
  isAdminHostRequest,
  mintAdminSessionId,
  originAllowed,
  redactSecrets,
  sessionCookieAttributes,
  signSession,
  timingSafeEqual,
  verifySession,
} from "@/lib/control-plane/admin-auth.ts";
import {
  ORGANIC_PROD_ASK_NOT_YET,
  assertAggregateOnly,
  auditRenderedNumbers,
  checkStatedEqualsRendered,
  gap,
  held,
  livenessOf,
  measured,
  renderCacheObservation,
} from "@/lib/control-plane/owner-surface.ts";
import { ADMIN_HOST, PUBLIC_HOST, SESSION_KEY } from "./admin-session.ts";


function request(host: string, path: string, cookie?: string): NextRequest {
  const headers = new Headers({ host });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(`https://${host}${path}`, { headers });
}

/* ================================================================== *
 * SEEDED FAILURE 1 — every admin route 404s on the public host
 * ================================================================== */

test("SEEDED: every admin route returns 404 on the PUBLIC host", async () => {
  const paths = [
    "/admin",
    "/admin/",
    "/admin/login",
    "/admin/auth/google",
    "/admin/auth/callback",
    "/admin/auth/callback?code=x&state=y",
    "/api/admin/session",
    "/api/admin/decision",
    "/admin/fleet",
    "/admin/anything/deeper",
  ];
  for (const path of paths) {
    const response = await middleware(request(PUBLIC_HOST, path));
    assert.equal(
      response.status,
      404,
      `${path} on the public host must be 404, not ${response.status}. A 403 confirms the path ` +
        "exists and a redirect names where it lives; 404 tells a prober nothing.",
    );
  }
});

test("SEEDED: an UNRECOGNISED host is treated as public, not as admin", async () => {
  // The default branch must be the safe one. A preview URL, the site's default
  // subdomain, or a forged Host header must never fall through to "admin".
  for (const host of [hostOf(LEGACY_NETLIFY_ORIGIN), "example.invalid", "", "localhost"]) {
    const response = await middleware(request(host || "unknown.invalid", "/admin"));
    assert.equal(response.status, 404, `${host || "(empty)"} must not reach the admin surface`);
  }
});

test("a reader path on the public host is untouched", async () => {
  const response = await middleware(request(PUBLIC_HOST, "/ballot"));
  assert.notEqual(response.status, 404);
});

/* ================================================================== *
 * SEEDED FAILURE 2 — unauthenticated requests on the admin host
 * ================================================================== */

test("SEEDED: an unauthenticated admin page request on the ADMIN host is refused", async () => {
  const response = await middleware(request(ADMIN_HOST, "/admin"));
  assert.equal(response.status, 307, "an unauthenticated page request redirects to the login");
  const location = response.headers.get("location") ?? "";
  assert.match(location, /\/admin\/login/);
  assert.match(location, /why=/, "the rejection CLASS travels so the page can explain itself");
  assert.doesNotMatch(location, /secret/i, "no credential material may ever reach a URL");
});

test("SEEDED: an unauthenticated admin API request on the ADMIN host is refused with 401", async () => {
  const response = await middleware(request(ADMIN_HOST, "/api/admin/decision"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});

test("a path under /admin that has no page of its own is guarded like any other admin page", async () => {
  // /admin/fleet is a retired page (its old links redirect once signed in), so
  // both rules must reach it through the generic prefix logic:
  // a bare 404 on the public host, and a redirect to the login (never a 401 —
  // that is only for /api/admin/*) on the admin host without a session.
  assert.equal((await middleware(request(PUBLIC_HOST, "/admin/fleet"))).status, 404);
  const onAdmin = await middleware(request(ADMIN_HOST, "/admin/fleet"));
  assert.equal(onAdmin.status, 307, "an unauthenticated fleet page request redirects to the login");
  assert.match(onAdmin.headers.get("location") ?? "", /\/admin\/login/);
});

test("the login page, the Google start and callback, and the session route are reachable unauthenticated on the admin host", async () => {
  for (const path of ["/admin/login", "/admin/auth/google", "/admin/auth/callback", "/api/admin/session"]) {
    const response = await middleware(request(ADMIN_HOST, path));
    assert.equal(response.status, 200, `${path} must be reachable so the owner can sign in`);
  }
});

test("a FORGED session cookie is refused on the admin host", async () => {
  const forged = "eyJzaWQiOiJ4IiwiaWF0IjoxLCJleHAiOjk5OTk5OTk5OTl9.not-a-real-signature";
  const response = await middleware(
    request(ADMIN_HOST, "/admin", `${ADMIN_SESSION_COOKIE}=${forged}`),
  );
  assert.equal(response.status, 307);
  assert.match(response.headers.get("location") ?? "", /why=(BAD_SIGNATURE|NOT_CONFIGURED)/);
});

test("the admin host serves ONLY the admin surface", async () => {
  // A reader page answering on the admin host would be a second origin serving the product.
  const response = await middleware(request(ADMIN_HOST, "/ballot"));
  assert.equal(response.status, 404);
});

/* ================================================================== *
 * SEEDED FAILURE 3 — a number without a denominator does not render
 * ================================================================== */

test("SEEDED: a number rendered without a denominator fails the page's own check", () => {
  const verdict = auditRenderedNumbers([
    { label: "obligations overdue", value: 14, denominator: null, contract: "overdue count" },
  ]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.detail, /refusing to render/);
  assert.match(verdict.offenders.join(" "), /no denominator/);
});

test("SEEDED: a number rendered without an interpretation contract also fails", () => {
  const verdict = auditRenderedNumbers([
    { label: "debt rows", value: 3, denominator: 40, contract: "  " },
  ]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.offenders.join(" "), /no interpretation contract/);
});

test("a fully-specified number passes the check", () => {
  const verdict = auditRenderedNumbers([
    {
      label: "obligations overdue",
      value: 14,
      denominator: 18,
      contract: "obligations past their stored nextDueAt",
    },
  ]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.checked, 1);
});

test("measured() refuses the shapes that would mislead", () => {
  assert.throws(() => measured(5, 3, "c", "s"), /larger/, "numerator over denominator is refused");
  assert.throws(() => measured(1, 2, "", "s"), /interpretation contract/);
  assert.throws(() => measured(Number.NaN, 2, "c", "s"), /finite/);
  assert.equal(measured(1, 2, "c", "s").denominator, 2);
});

/* ================================================================== *
 * STATED N EQUALS RENDERED ROWS
 * ================================================================== */

test("stated N must equal rendered rows", () => {
  const bad = checkStatedEqualsRendered([
    { label: "decision cards", stated: 7, rendered: 5 },
  ]);
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /stated 7, rendered 5/);

  const good = checkStatedEqualsRendered([{ label: "decision cards", stated: 5, rendered: 5 }]);
  assert.equal(good.ok, true);
});

/* ================================================================== *
 * AGGREGATE-ONLY
 * ================================================================== */

test("an owner-surface record carrying a reader-level field is REFUSED", () => {
  assert.throws(
    () => assertAggregateOnly({ counts: { total: 4, email: "someone@example.com" } }, "test"),
    /email/,
  );
  assert.throws(
    () => assertAggregateOnly({ rows: [{ zip: "85701", questionText: "who is my mayor" }] }, "test"),
    /questionText/,
  );
  // Nested three deep is where this actually gets broken in practice.
  assert.throws(
    () => assertAggregateOnly({ a: { b: { c: { reactionId: "r1" } } } }, "test"),
    /reactionId/,
  );
});

test("a genuinely aggregate record passes", () => {
  assert.doesNotThrow(() =>
    assertAggregateOnly(
      { zipRows: [{ zip: "85701", green: 3, red: 1, notEvaluable: 0 }], total: 4 },
      "test",
    ),
  );
});

/* ================================================================== *
 * THE GAP IS NAMED, AND THE NAME SAYS WHOSE
 * ================================================================== */

test("a gap must name whose it is and say something", () => {
  const ours = gap("OURS", "We have not recorded this yet.");
  assert.equal(ours.held, false);
  if (!ours.held) assert.equal(ours.gap.whose, "OURS");
  assert.throws(() => gap("THEIRS", "   "), /sentence the owner will actually read/);
  assert.equal(held(3).held, true);
});

/* ================================================================== *
 * THE H1 WAIVER'S STANDING CHECK — three states, never two
 * ================================================================== */

test("H1 WAIVER: 'not yet observed' uses the owner's exact wording", () => {
  const rendered = renderCacheObservation({
    formatVersion: 1,
    state: "NOT_YET_OBSERVED",
    firstObservedAt: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    recorderLastSeenAt: "2026-09-01T00:00:00.000Z",
  });
  assert.equal(rendered.says, ORGANIC_PROD_ASK_NOT_YET);
  assert.equal(rendered.says, "organic prod-ask cache read: not yet observed");
});

test("H1 WAIVER: an unwired recorder does NOT read as 'not yet observed'", () => {
  // If nothing is recording, nothing was observed; absence is never asserted.
  const noRecord = renderCacheObservation(null);
  assert.equal(noRecord.state, "RECORDING_NOT_WIRED");
  assert.notEqual(noRecord.says, ORGANIC_PROD_ASK_NOT_YET);
  assert.match(noRecord.says, /cannot tell/);

  const unwired = renderCacheObservation({
    formatVersion: 1,
    state: "RECORDING_NOT_WIRED",
    firstObservedAt: null,
    cacheReadInputTokens: null,
    cacheCreationInputTokens: null,
    recorderLastSeenAt: null,
  });
  assert.equal(unwired.state, "RECORDING_NOT_WIRED");
  assert.notEqual(unwired.says, ORGANIC_PROD_ASK_NOT_YET);
});

test("H1 WAIVER: an observation renders its token counts", () => {
  const rendered = renderCacheObservation({
    formatVersion: 1,
    state: "OBSERVED",
    firstObservedAt: "2026-09-02T10:00:00.000Z",
    cacheReadInputTokens: 4211,
    cacheCreationInputTokens: 1900,
    recorderLastSeenAt: "2026-09-02T10:00:00.000Z",
  });
  assert.equal(rendered.state, "OBSERVED");
  assert.match(rendered.says, /4211 cache-read input tokens/);
});

/* ================================================================== *
 * LIVENESS IS DERIVED, NEVER STORED
 * ================================================================== */

test("runner liveness is derived from the beat and the clock", () => {
  const beat = (iso: string) => ({
    formatVersion: 1,
    beatAt: iso,
    lastCycleStartedAt: null,
    lastCycleFinishedAt: null,
    nextCycleDueAt: null,
    lastCycleOk: true,
    testedSha: null,
    host: "test",
  });
  const now = "2026-09-01T12:00:00.000Z";
  assert.equal(livenessOf(beat("2026-09-01T11:50:00.000Z"), now).state, "ALIVE");
  assert.equal(livenessOf(beat("2026-09-01T10:00:00.000Z"), now).state, "LATE");
  assert.equal(livenessOf(beat("2026-09-01T02:00:00.000Z"), now).state, "SILENT");

  // No record is NOT "dead" — it is a fact about our store.
  const none = livenessOf(null, now);
  assert.equal(none.state, "NEVER_BEAT");
  assert.match(none.detail, /fact about our control plane, not about the runner/);
});

/* ================================================================== *
 * THE CREDENTIAL BOUNDARY
 * ================================================================== */

test("checkLogin refuses an absent secret rather than passing", () => {
  assert.deepEqual(checkLogin("anything", undefined), { ok: false, reason: "NOT_CONFIGURED" });
  assert.deepEqual(checkLogin("anything", ""), { ok: false, reason: "NOT_CONFIGURED" });
  // Both sides empty must NOT be a match — this is the classic open door.
  assert.deepEqual(checkLogin("", ""), { ok: false, reason: "NOT_CONFIGURED" });
  assert.deepEqual(checkLogin(undefined, undefined), { ok: false, reason: "NOT_CONFIGURED" });
});

test("checkLogin refuses a secret that is too short to be one", () => {
  assert.deepEqual(checkLogin("short", "short"), { ok: false, reason: "WEAK_SECRET" });
});

test("checkLogin accepts only the exact secret", () => {
  const secret = "x".repeat(MIN_SECRET_LENGTH + 4);
  assert.deepEqual(checkLogin(secret, secret), { ok: true });
  assert.deepEqual(checkLogin(`${secret}y`, secret), { ok: false, reason: "REFUSED" });
  assert.deepEqual(checkLogin(secret.slice(0, -1), secret), { ok: false, reason: "REFUSED" });
});

test("timingSafeEqual folds length in rather than short-circuiting on it", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

test("a session round-trips, and an expired one is refused", async () => {
  const iat = 1_800_000_000;
  const cookie = await signSession(
    { sid: "s1", iat, exp: iat + SESSION_LIFETIME_SECONDS },
    SESSION_KEY,
  );
  const ok = await verifySession(cookie, SESSION_KEY, iat + 60);
  assert.equal(ok.ok, true);

  const expired = await verifySession(cookie, SESSION_KEY, iat + SESSION_LIFETIME_SECONDS + 1);
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.rejection, "EXPIRED");

  const wrongKey = await verifySession(cookie, "a-different-key-entirely-and-long", iat + 60);
  assert.equal(wrongKey.ok, false);
  if (!wrongKey.ok) assert.equal(wrongKey.rejection, "BAD_SIGNATURE");
});

test("a session claiming a lifetime longer than policy is refused", async () => {
  // A cookie's own `exp` is not trusted, so tightening the rule shortens live sessions.
  const iat = 1_800_000_000;
  const cookie = await signSession(
    { sid: "s1", iat, exp: iat + SESSION_LIFETIME_SECONDS * 10 },
    SESSION_KEY,
  );
  const verdict = await verifySession(cookie, SESSION_KEY, iat + 60);
  assert.equal(verdict.ok, false);
});

test("a missing session key is NOT_CONFIGURED, never a pass", async () => {
  const verdict = await verifySession("anything.at-all", undefined, 1);
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.equal(verdict.rejection, "NOT_CONFIGURED");
});

test("the session cookie carries every attribute that makes it safe", () => {
  const attributes = sessionCookieAttributes(SESSION_LIFETIME_SECONDS);
  assert.match(attributes, /HttpOnly/);
  assert.match(attributes, /Secure/);
  assert.match(attributes, /SameSite=Strict/);
  assert.match(attributes, /Path=\//);
  // __Host- requires NO Domain attribute; a Domain would send the admin
  // session to the public host on every reader request.
  assert.doesNotMatch(attributes, /Domain=/);
  assert.match(ADMIN_SESSION_COOKIE, /^__Host-/);
});

test("a state-changing request must come from the admin origin", () => {
  assert.equal(originAllowed(ADMIN_ORIGIN, ADMIN_ORIGIN), true);
  assert.equal(originAllowed(PUBLIC_SITE_ORIGIN, ADMIN_ORIGIN), false);
  assert.equal(originAllowed("https://evil.invalid", ADMIN_ORIGIN), false);
  // A MISSING Origin is refused, not allowed.
  assert.equal(originAllowed(null, ADMIN_ORIGIN), false);
  assert.equal(originAllowed("", ADMIN_ORIGIN), false);
});

test("redactSecrets removes a configured secret from anything about to be logged", () => {
  const secret = "super-secret-value-not-for-logs";
  const message = `connection failed using ${secret} at host`;
  const safe = redactSecrets(message, [secret]);
  assert.doesNotMatch(safe, /super-secret-value/);
  assert.match(safe, /\[REDACTED\]/);
  // A short string is left alone: redacting "a" would destroy the message.
  assert.equal(redactSecrets("abc", ["a"]), "abc");
});

/* ================================================================== *
 * THE COLLECTION BOUNDARY, PROVED OVER VALUE SPACES
 * ================================================================== */

test("an admin session id can never collide with a reader browser key", () => {
  // Admin session ids and reader browser keys must live in disjoint value spaces.
  const READER_KEY_SHAPE = /^[0-9a-f]{32}$/;
  for (let i = 0; i < 200; i += 1) {
    const sid = mintAdminSessionId();
    assert.ok(sid.startsWith(ADMIN_SESSION_ID_PREFIX), `${sid} must carry the admin prefix`);
    assert.doesNotMatch(
      sid,
      READER_KEY_SHAPE,
      "an admin session id must never be shaped like a reader browser key",
    );
  }
  // And the reverse: the prefix is unreachable from hex, so no reader key can
  // ever be mistaken for a session id.
  assert.doesNotMatch(ADMIN_SESSION_ID_PREFIX, /^[0-9a-f]+$/);
});

test("session ids do not repeat", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) seen.add(mintAdminSessionId());
  assert.equal(seen.size, 500, "a repeated session id would let one owner session become another");
});

test("the admin host check is ONE implementation and reads the forwarded host", () => {
  const headers = (values: Record<string, string>) => new Headers(values);
  assert.equal(isAdminHostRequest(headers({ host: ADMIN_HOST }), ADMIN_ORIGIN), true);
  assert.equal(isAdminHostRequest(headers({ host: PUBLIC_HOST }), ADMIN_ORIGIN), false);
  // Netlify's edge sets x-forwarded-host, and it wins over `host`.
  assert.equal(
    isAdminHostRequest(
      headers({ host: PUBLIC_HOST, "x-forwarded-host": ADMIN_HOST }),
      ADMIN_ORIGIN,
    ),
    true,
  );
  // A smuggled second value must not win: the leftmost is what the edge wrote.
  assert.equal(
    isAdminHostRequest(
      headers({ "x-forwarded-host": `${PUBLIC_HOST},${ADMIN_HOST}` }),
      ADMIN_ORIGIN,
    ),
    false,
  );
  // Port stripped, case folded, and an empty host is never the admin host.
  assert.equal(isAdminHostRequest(headers({ host: `${ADMIN_HOST}:443` }), ADMIN_ORIGIN), true);
  assert.equal(isAdminHostRequest(headers({ host: ADMIN_HOST.toUpperCase() }), ADMIN_ORIGIN), true);
  assert.equal(isAdminHostRequest(headers({}), ADMIN_ORIGIN), false);
});
