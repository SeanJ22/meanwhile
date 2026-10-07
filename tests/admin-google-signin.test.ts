/**
 * Sign in with Google.
 *
 * Every signature here is real: an RSA key pair is generated with Web Crypto, a fake JWKS
 * publishes its public half under a `kid`, and the ID tokens are signed with the private half.
 *
 * Seeded failures:
 *
 *   i    an ID token for any other email is refused              WRONG_EMAIL
 *   ii   `email_verified: false` is refused                       UNVERIFIED_EMAIL
 *   iii  a tampered state is refused                              BAD_STATE
 *   iv   the callback on the PUBLIC host 404s                     middleware
 *   v    an expired token is refused                              EXPIRED
 *
 * And beside them: NOT_CONFIGURED when the client id is absent; the break-glass
 * route 404s when its flag is absent; the OAuth cookie is HttpOnly, Secure,
 * Path=/ and Lax; a positive control proves the whole callback admits the
 * owner, so every refusal above is the refusal's fault and not the fixture's.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware.ts";
import { GET as startGET } from "@/app/(admin)/admin/auth/google/route.ts";
import { GET as callbackGET } from "@/app/(admin)/admin/auth/callback/route.ts";
import { POST as breakGlassPOST } from "@/app/api/admin/session/route.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins.ts";
import {
  ADMIN_SECRET_VAR,
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_KEY_VAR,
  BREAK_GLASS_FLAG_VAR,
  BREAK_GLASS_LOG_KEY,
  BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW,
  BREAK_GLASS_WINDOW_SECONDS,
  MIN_SECRET_LENGTH,
  SESSION_LIFETIME_SECONDS,
  base64UrlEncode,
  breakGlassWindowVerdict,
  buildBreakGlassIncident,
  isBreakGlassEnabled,
  signSession,
  verifySession,
} from "@/lib/control-plane/admin-auth.ts";
import {
  GOOGLE_CLIENT_ID_VAR,
  GOOGLE_CLIENT_SECRET_VAR,
  GOOGLE_JWKS_URL,
  GOOGLE_REJECTIONS,
  GOOGLE_TOKEN_ENDPOINT,
  JWKS_MIN_REFETCH_INTERVAL_MS,
  OAUTH_CALLBACK_PATH,
  OAUTH_START_PATH,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_LIFETIME_SECONDS,
  OWNER_ADMIN_EMAIL,
  authorizeOwner,
  buildAuthorizationUrl,
  completeGoogleCallback,
  createJwksResolver,
  emptyJwksCache,
  exchangeCodeForIdToken,
  googleSignInReadiness,
  mintPkceVerifier,
  oauthCookieAttributes,
  openOauthState,
  parseCacheControlMaxAge,
  pkceChallenge,
  signOauthState,
  verifyIdToken,
  type GoogleJwk,
  type IdTokenClaims,
  type OauthState,
} from "@/lib/control-plane/admin-google.ts";
import { assertAggregateOnly } from "@/lib/control-plane/owner-surface.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { CONTROL_PLANE_URL_VAR } from "@/lib/control-plane/repository/pg-store.ts";
import { ADMIN_HOST, PUBLIC_HOST, SESSION_KEY } from "./admin-session.ts";

const ROOT = process.cwd();
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret-value-never-logged";
const REDIRECT_URI = `${ADMIN_ORIGIN}${OAUTH_CALLBACK_PATH}`;
const NOW = 1_800_000_000;
const KID = "test-kid-1";
/** The owner's domain, derived: every other account in the fixture lives beside the owner. */
const OWNER_DOMAIN = OWNER_ADMIN_EMAIL.slice(OWNER_ADMIN_EMAIL.indexOf("@") + 1);
const OWNER_LOCAL_PART = OWNER_ADMIN_EMAIL.slice(0, OWNER_ADMIN_EMAIL.indexOf("@"));

const encoder = new TextEncoder();

/* ------------------------------------------------------------------ keys */

interface Signer {
  readonly privateKey: CryptoKey;
  readonly jwk: GoogleJwk;
}

async function generateSigner(kid: string): Promise<Signer> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwk: { kty: "RSA", kid, alg: "RS256", use: "sig", n: exported.n, e: exported.e },
  };
}

let signerPromise: Promise<Signer> | null = null;
function signer(): Promise<Signer> {
  signerPromise ??= generateSigner(KID);
  return signerPromise;
}

async function mintIdToken(
  claims: Record<string, unknown>,
  key: CryptoKey,
  header: Record<string, unknown> = { alg: "RS256", kid: KID, typ: "JWT" },
): Promise<string> {
  const h = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const p = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    encoder.encode(`${h}.${p}`),
  );
  return `${h}.${p}.${base64UrlEncode(new Uint8Array(signature))}`;
}

function ownerClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1234567890",
    email: OWNER_ADMIN_EMAIL,
    email_verified: true,
    hd: OWNER_DOMAIN,
    iat: NOW - 30,
    exp: NOW + 3600,
    ...over,
  };
}

/** A resolver over the fixture key alone — no network, no cache to reason about. */
async function fixtureResolver(): Promise<(kid: string) => Promise<GoogleJwk | null>> {
  const { jwk } = await signer();
  return async (kid: string) => (kid === KID ? jwk : null);
}

/* ------------------------------------------------------------------ env */

async function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const before: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(values)) {
    before[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const CONFIGURED = {
  [GOOGLE_CLIENT_ID_VAR]: CLIENT_ID,
  [GOOGLE_CLIENT_SECRET_VAR]: CLIENT_SECRET,
  [ADMIN_SESSION_KEY_VAR]: SESSION_KEY,
};

/* ------------------------------------------------------------------ requests */

function request(host: string, path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://${host}${path}`, { headers: { host, ...headers } });
}

function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookieValueOf(response: Response, name: string): string | null {
  const line = setCookies(response).find((c) => c.startsWith(`${name}=`));
  if (!line) return null;
  return line.split(";")[0].slice(name.length + 1);
}

/* ================================================================== *
 * PKCE AND THE AUTHORIZATION URL
 * ================================================================== */

test("PKCE: the verifier is inside RFC 7636's length and the challenge is S256 of it", async () => {
  const verifier = mintPkceVerifier();
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `verifier length ${verifier.length}`);
  assert.match(verifier, /^[A-Za-z0-9_-]+$/);
  const challenge = await pkceChallenge(verifier);
  // An INDEPENDENT computation: node:crypto, not the Web Crypto path under test.
  const expected = createHash("sha256").update(verifier).digest("base64url");
  assert.equal(challenge, expected);
  assert.notEqual(mintPkceVerifier(), verifier, "verifiers do not repeat");
});

test("the authorization URL is Google's, with PKCE S256, openid email, state and nonce — and no login_hint or prompt", () => {
  const url = new URL(
    buildAuthorizationUrl({
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      state: "st",
      nonce: "nn",
      codeChallenge: "ch",
    }),
  );
  assert.equal(url.host, "accounts.google.com");
  assert.equal(url.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT_URI);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid email");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "ch");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.get("nonce"), "nn");
  // The enrolled address is not put in a query string; `hd` is a chooser hint only.
  assert.equal(url.searchParams.get("login_hint"), null);
  // Never prompt=none: with no session, Google must show the normal sign-in prompt.
  assert.equal(url.searchParams.get("prompt"), null);
  assert.ok(!url.toString().includes(encodeURIComponent(OWNER_ADMIN_EMAIL)) && !url.toString().includes(OWNER_LOCAL_PART));
});

/* ================================================================== *
 * THE STATE COOKIE — SEEDED FAILURE iii
 * ================================================================== */

async function freshState(over: Partial<OauthState> = {}): Promise<OauthState> {
  return {
    state: "state-token",
    nonce: "nonce-token",
    verifier: mintPkceVerifier(),
    iat: NOW,
    exp: NOW + OAUTH_STATE_LIFETIME_SECONDS,
    ...over,
  };
}

test("the state cookie round-trips under the session key", async () => {
  const state = await freshState();
  const cookie = await signOauthState(state, SESSION_KEY);
  const opened = await openOauthState(cookie, SESSION_KEY, NOW + 60);
  assert.equal(opened.ok, true);
  if (opened.ok) assert.deepEqual(opened.state, state);
});

test("SEEDED iii: a TAMPERED state cookie is refused as BAD_STATE, whichever byte moved", async () => {
  const cookie = await signOauthState(await freshState(), SESSION_KEY);
  const [payload, signature] = cookie.split(".");
  // Payload changed, signature kept.
  const otherPayload = base64UrlEncode(
    encoder.encode(JSON.stringify(await freshState({ state: "someone-elses-state" }))),
  );
  const tamperedPayload = await openOauthState(`${otherPayload}.${signature}`, SESSION_KEY, NOW + 60);
  assert.deepEqual(tamperedPayload, { ok: false, rejection: "BAD_STATE" });
  // Signature changed, payload kept.
  const flipped = signature.slice(0, -2) + (signature.endsWith("AA") ? "BB" : "AA");
  const tamperedSignature = await openOauthState(`${payload}.${flipped}`, SESSION_KEY, NOW + 60);
  assert.deepEqual(tamperedSignature, { ok: false, rejection: "BAD_STATE" });
  // Signed under a different key entirely.
  const otherKey = await signOauthState(await freshState(), "a-different-key-entirely-and-long");
  assert.deepEqual(await openOauthState(otherKey, SESSION_KEY, NOW + 60), { ok: false, rejection: "BAD_STATE" });
  // No cookie, garbage, and an empty string.
  for (const bad of [undefined, null, "", "not.an.envelope", "garbage"]) {
    const verdict = await openOauthState(bad, SESSION_KEY, NOW + 60);
    assert.deepEqual(verdict, { ok: false, rejection: "BAD_STATE" }, `${String(bad)} must be BAD_STATE`);
  }
});

test("an expired or over-long state cookie is BAD_STATE", async () => {
  const cookie = await signOauthState(await freshState(), SESSION_KEY);
  const late = await openOauthState(cookie, SESSION_KEY, NOW + OAUTH_STATE_LIFETIME_SECONDS + 1);
  assert.deepEqual(late, { ok: false, rejection: "BAD_STATE" });
  const long = await signOauthState(
    await freshState({ exp: NOW + OAUTH_STATE_LIFETIME_SECONDS * 10 }),
    SESSION_KEY,
  );
  assert.deepEqual(await openOauthState(long, SESSION_KEY, NOW + 60), { ok: false, rejection: "BAD_STATE" });
});

test("the OAuth cookie is __Host-, HttpOnly, Secure, Path=/, Lax, and has no Domain", () => {
  const attributes = oauthCookieAttributes(OAUTH_STATE_LIFETIME_SECONDS);
  assert.match(attributes, /HttpOnly/);
  assert.match(attributes, /Secure/);
  assert.match(attributes, /Path=\//);
  assert.match(attributes, /SameSite=Lax/, "the callback is a cross-site top-level navigation from Google");
  assert.doesNotMatch(attributes, /SameSite=Strict/);
  assert.doesNotMatch(attributes, /Domain=/);
  assert.match(attributes, new RegExp(`Max-Age=${OAUTH_STATE_LIFETIME_SECONDS}`));
  assert.match(OAUTH_STATE_COOKIE, /^__Host-/);
  assert.equal(OAUTH_STATE_LIFETIME_SECONDS, 600);
});

/* ================================================================== *
 * THE ID TOKEN — SEEDED FAILURES i, ii, v
 * ================================================================== */

test("POSITIVE CONTROL: a real RS256 token for the owner verifies and authorizes", async () => {
  const { privateKey } = await signer();
  const token = await mintIdToken(ownerClaims({ nonce: "n1" }), privateKey);
  const verified = await verifyIdToken(token, {
    clientId: CLIENT_ID,
    resolveKey: await fixtureResolver(),
    nowSeconds: NOW,
    expectedNonce: "n1",
  });
  assert.equal(verified.ok, true, `expected ok, got ${JSON.stringify(verified)}`);
  if (verified.ok) {
    const owner = authorizeOwner(verified.claims);
    assert.deepEqual(owner, { ok: true, email: OWNER_ADMIN_EMAIL });
  }
});

test("SEEDED i: an ID token for ANY other email is refused as WRONG_EMAIL — hd alone is never enough", () => {
  for (const email of [
    `someone@${OWNER_DOMAIN}`,
    `${OWNER_ADMIN_EMAIL}.evil.invalid`,
    `${OWNER_LOCAL_PART}@gmail.com`,
    "",
  ]) {
    const verdict = authorizeOwner(ownerClaims({ email }) as IdTokenClaims);
    assert.deepEqual(verdict, { ok: false, rejection: "WRONG_EMAIL" }, `${email || "(empty)"} must be refused`);
  }
  // No email claim at all, with the hosted domain present: still WRONG_EMAIL.
  const noEmail = ownerClaims() as Record<string, unknown>;
  delete noEmail.email;
  assert.deepEqual(authorizeOwner(noEmail as IdTokenClaims), { ok: false, rejection: "WRONG_EMAIL" });
});

test("the enrolled address is matched case-insensitively and nothing else is", () => {
  assert.equal(authorizeOwner(ownerClaims({ email: OWNER_ADMIN_EMAIL.toUpperCase() }) as IdTokenClaims).ok, true);
  assert.equal(authorizeOwner(ownerClaims({ email: ` ${OWNER_ADMIN_EMAIL} ` }) as IdTokenClaims).ok, true);
});

test("SEEDED ii: email_verified must be the boolean true — false, a string, and absence are UNVERIFIED_EMAIL", () => {
  for (const email_verified of [false, "true", 1, undefined, null]) {
    const verdict = authorizeOwner(ownerClaims({ email_verified }) as IdTokenClaims);
    assert.deepEqual(
      verdict,
      { ok: false, rejection: "UNVERIFIED_EMAIL" },
      `email_verified=${JSON.stringify(email_verified)} must be refused`,
    );
  }
});

test("SEEDED v: an EXPIRED token is refused, and the skew is 60 seconds and no more", async () => {
  const { privateKey } = await signer();
  const resolveKey = await fixtureResolver();
  const expired = await mintIdToken(ownerClaims({ exp: NOW - 61 }), privateKey);
  const verdict = await verifyIdToken(expired, { clientId: CLIENT_ID, resolveKey, nowSeconds: NOW });
  assert.deepEqual(verdict, { ok: false, rejection: "EXPIRED" });
  // Inside the skew is still accepted; this is what proves the boundary is 60.
  const skewed = await mintIdToken(ownerClaims({ exp: NOW - 59 }), privateKey);
  assert.equal((await verifyIdToken(skewed, { clientId: CLIENT_ID, resolveKey, nowSeconds: NOW })).ok, true);
  // A token issued in the future beyond the skew is not yet valid.
  const future = await mintIdToken(ownerClaims({ iat: NOW + 61 }), privateKey);
  assert.deepEqual(
    await verifyIdToken(future, { clientId: CLIENT_ID, resolveKey, nowSeconds: NOW }),
    { ok: false, rejection: "NOT_YET_VALID" },
  );
});

test("issuer and audience are checked exactly", async () => {
  const { privateKey } = await signer();
  const resolveKey = await fixtureResolver();
  const check = async (over: Record<string, unknown>) =>
    verifyIdToken(await mintIdToken(ownerClaims(over), privateKey), { clientId: CLIENT_ID, resolveKey, nowSeconds: NOW });

  assert.deepEqual(await check({ iss: "https://accounts.google.com.evil.invalid" }), { ok: false, rejection: "BAD_ISSUER" });
  assert.deepEqual(await check({ iss: "" }), { ok: false, rejection: "BAD_ISSUER" });
  assert.equal((await check({ iss: "accounts.google.com" })).ok, true, "the bare issuer form is Google's too");
  assert.deepEqual(await check({ aud: "another-client" }), { ok: false, rejection: "BAD_AUDIENCE" });
  assert.deepEqual(await check({ aud: [CLIENT_ID, "another-client"] }), { ok: false, rejection: "BAD_AUDIENCE" });
  assert.equal((await check({ aud: [CLIENT_ID] })).ok, true, "a single-element aud array is ours");
});

test("BAD_SIGNATURE: another key under the same kid, a tampered payload, alg=none, and an unknown kid", async () => {
  const { privateKey } = await signer();
  const resolveKey = await fixtureResolver();
  const verify = (token: string) => verifyIdToken(token, { clientId: CLIENT_ID, resolveKey, nowSeconds: NOW });

  const other = await generateSigner(KID);
  const forged = await mintIdToken(ownerClaims(), other.privateKey);
  assert.deepEqual(await verify(forged), { ok: false, rejection: "BAD_SIGNATURE" });

  const good = await mintIdToken(ownerClaims(), privateKey);
  const [h, , s] = good.split(".");
  const swappedPayload = base64UrlEncode(encoder.encode(JSON.stringify(ownerClaims({ email: `x@${OWNER_DOMAIN}` }))));
  assert.deepEqual(await verify(`${h}.${swappedPayload}.${s}`), { ok: false, rejection: "BAD_SIGNATURE" });

  const none = await mintIdToken(ownerClaims(), privateKey, { alg: "none", kid: KID });
  assert.deepEqual(await verify(none), { ok: false, rejection: "BAD_SIGNATURE" });
  const hs256 = await mintIdToken(ownerClaims(), privateKey, { alg: "HS256", kid: KID });
  assert.deepEqual(await verify(hs256), { ok: false, rejection: "BAD_SIGNATURE" });

  const unknownKid = await mintIdToken(ownerClaims(), privateKey, { alg: "RS256", kid: "nobody" });
  assert.deepEqual(await verify(unknownKid), { ok: false, rejection: "BAD_SIGNATURE" });
});

test("MALFORMED: fewer than three segments, or segments that are not JSON", async () => {
  const resolveKey = await fixtureResolver();
  for (const token of ["", "a.b", "a.b.c.d", "...", "!!!.@@@.###"]) {
    const verdict = await verifyIdToken(token, { clientId: CLIENT_ID, resolveKey, nowSeconds: NOW });
    assert.equal(verdict.ok, false);
    if (!verdict.ok) assert.ok(["MALFORMED", "BAD_SIGNATURE"].includes(verdict.rejection), `${token}: ${verdict.rejection}`);
  }
});

test("a nonce that does not match the state cookie's is BAD_STATE", async () => {
  const { privateKey } = await signer();
  const token = await mintIdToken(ownerClaims({ nonce: "issued-for-someone-else" }), privateKey);
  const verdict = await verifyIdToken(token, {
    clientId: CLIENT_ID,
    resolveKey: await fixtureResolver(),
    nowSeconds: NOW,
    expectedNonce: "ours",
  });
  assert.deepEqual(verdict, { ok: false, rejection: "BAD_STATE" });
});

test("every rejection class is named, and none of them is an echo of input", () => {
  for (const cls of GOOGLE_REJECTIONS) assert.match(cls, /^[A-Z_]+$/);
  assert.ok(GOOGLE_REJECTIONS.includes("WRONG_EMAIL"));
  assert.ok(GOOGLE_REJECTIONS.includes("UNVERIFIED_EMAIL"));
  assert.ok(GOOGLE_REJECTIONS.includes("BAD_STATE"));
  assert.ok(GOOGLE_REJECTIONS.includes("EXPIRED"));
  assert.ok(GOOGLE_REJECTIONS.includes("BAD_SIGNATURE"));
  assert.ok(GOOGLE_REJECTIONS.includes("BAD_ISSUER"));
  assert.ok(GOOGLE_REJECTIONS.includes("BAD_AUDIENCE"));
  assert.ok(GOOGLE_REJECTIONS.includes("NOT_CONFIGURED"));
  assert.ok(GOOGLE_REJECTIONS.includes("TOKEN_EXCHANGE_FAILED"));
});

/* ================================================================== *
 * GOOGLE'S KEYS — the cache honours max-age and a miss refetches once
 * ================================================================== */

test("the JWKS resolver honours Cache-Control max-age and refetches ONCE on an unknown kid", async () => {
  const { jwk } = await signer();
  let fetches = 0;
  let served: GoogleJwk[] = [jwk];
  const fetchImpl: typeof fetch = async () => {
    fetches += 1;
    return new Response(JSON.stringify({ keys: served }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
    });
  };
  let clock = 1_000_000;
  const resolve = createJwksResolver({ fetchImpl, cache: emptyJwksCache(), now: () => clock });

  assert.equal((await resolve(KID))?.kid, KID);
  assert.equal(fetches, 1);
  clock += 30 * 60 * 1000;
  assert.equal((await resolve(KID))?.kid, KID);
  assert.equal(fetches, 1, "inside max-age nothing is refetched");

  // An unknown kid: one refetch, which now serves a rotated key.
  clock += JWKS_MIN_REFETCH_INTERVAL_MS;
  const rotated = await generateSigner("rotated-kid");
  served = [jwk, rotated.jwk];
  assert.equal((await resolve("rotated-kid"))?.kid, "rotated-kid");
  assert.equal(fetches, 2);

  // A second unknown kid inside the refetch interval does NOT fetch again.
  assert.equal(await resolve("made-up"), null);
  assert.equal(fetches, 2, "a flood of made-up kids must not turn this host into a request generator");

  // Past max-age, the next lookup refreshes.
  clock += 3600 * 1000 + 1;
  assert.equal((await resolve(KID))?.kid, KID);
  assert.equal(fetches, 3);
});

test("a JWKS fetch that fails leaves the cache alone and resolves nothing", async () => {
  const failing: typeof fetch = async () => new Response("nope", { status: 503 });
  const resolve = createJwksResolver({ fetchImpl: failing, cache: emptyJwksCache(), now: () => 1 });
  assert.equal(await resolve(KID), null);
  const throwing: typeof fetch = async () => {
    throw new Error("network");
  };
  assert.equal(await createJwksResolver({ fetchImpl: throwing, cache: emptyJwksCache(), now: () => 1 })(KID), null);
});

test("parseCacheControlMaxAge reads the directive and nothing else", () => {
  assert.equal(parseCacheControlMaxAge("public, max-age=22157, must-revalidate, no-transform"), 22157);
  assert.equal(parseCacheControlMaxAge("max-age=0"), 0);
  assert.equal(parseCacheControlMaxAge("no-store"), null);
  assert.equal(parseCacheControlMaxAge(null), null);
  assert.equal(parseCacheControlMaxAge("s-maxage=100"), null, "s-maxage is not max-age");
});

/* ================================================================== *
 * THE TOKEN EXCHANGE
 * ================================================================== */

test("the exchange posts the code, the verifier and the client secret to Google's token endpoint", async () => {
  let seen: { url: string; body: URLSearchParams; contentType: string | null } | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen = { url: String(input), body: new URLSearchParams(String(init?.body)), contentType: headers.get("content-type") };
    return new Response(JSON.stringify({ id_token: "h.p.s", access_token: "ignored" }), { status: 200 });
  };
  const verdict = await exchangeCodeForIdToken({
    code: "the-code",
    verifier: "the-verifier",
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    fetchImpl,
  });
  assert.deepEqual(verdict, { ok: true, idToken: "h.p.s" });
  assert.ok(seen !== null);
  const s = seen as unknown as { url: string; body: URLSearchParams; contentType: string | null };
  assert.equal(s.url, GOOGLE_TOKEN_ENDPOINT);
  assert.equal(s.body.get("grant_type"), "authorization_code");
  assert.equal(s.body.get("code"), "the-code");
  assert.equal(s.body.get("code_verifier"), "the-verifier");
  assert.equal(s.body.get("client_secret"), CLIENT_SECRET);
  assert.equal(s.body.get("redirect_uri"), REDIRECT_URI);
  assert.match(s.contentType ?? "", /application\/x-www-form-urlencoded/);
});

test("TOKEN_EXCHANGE_FAILED keeps the status and never the body", async () => {
  const bad: typeof fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_grant", error_description: `echo ${CLIENT_SECRET}` }), { status: 400 });
  const verdict = await exchangeCodeForIdToken({
    code: "c", verifier: "v", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, fetchImpl: bad,
  });
  assert.deepEqual(verdict, { ok: false, rejection: "TOKEN_EXCHANGE_FAILED", httpStatus: 400 });
  assert.doesNotMatch(JSON.stringify(verdict), /invalid_grant|echo/);

  const noToken: typeof fetch = async () => new Response(JSON.stringify({ access_token: "only" }), { status: 200 });
  const missing = await exchangeCodeForIdToken({
    code: "c", verifier: "v", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, fetchImpl: noToken,
  });
  assert.equal(missing.ok, false);

  const down: typeof fetch = async () => {
    throw new Error("ECONNRESET");
  };
  const unreachable = await exchangeCodeForIdToken({
    code: "c", verifier: "v", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUri: REDIRECT_URI, fetchImpl: down,
  });
  assert.deepEqual(unreachable, { ok: false, rejection: "TOKEN_EXCHANGE_FAILED", httpStatus: null });
});

/* ================================================================== *
 * THE WHOLE CALLBACK, PURE — a positive control and each seeded refusal
 * ================================================================== */

/** A Google that issues whatever token the test hands it, at the token endpoint only. */
function googleServing(idToken: string): typeof fetch {
  return async (input) => {
    if (String(input) === GOOGLE_TOKEN_ENDPOINT) {
      return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
}

async function callback(over: {
  claims?: Record<string, unknown>;
  query?: Record<string, string>;
  cookie?: string | null;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  sessionKey?: string | undefined;
  state?: OauthState;
}) {
  const { privateKey } = await signer();
  const state = over.state ?? (await freshState());
  const cookie = over.cookie === undefined ? await signOauthState(state, SESSION_KEY) : over.cookie;
  const token = await mintIdToken(ownerClaims({ nonce: state.nonce, ...(over.claims ?? {}) }), privateKey);
  return completeGoogleCallback({
    query: new URLSearchParams({ code: "the-code", state: state.state, ...(over.query ?? {}) }),
    stateCookie: cookie,
    sessionKey: "sessionKey" in over ? over.sessionKey : SESSION_KEY,
    clientId: "clientId" in over ? over.clientId : CLIENT_ID,
    clientSecret: "clientSecret" in over ? over.clientSecret : CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    nowSeconds: NOW,
    fetchImpl: googleServing(token),
    resolveKey: await fixtureResolver(),
  });
}

test("POSITIVE CONTROL: the whole callback admits the owner", async () => {
  assert.deepEqual(await callback({}), { ok: true, email: OWNER_ADMIN_EMAIL });
});

test("SEEDED i, through the callback: another verified email is WRONG_EMAIL", async () => {
  assert.deepEqual(await callback({ claims: { email: `intern@${OWNER_DOMAIN}` } }), { ok: false, rejection: "WRONG_EMAIL" });
});

test("SEEDED ii, through the callback: email_verified false is UNVERIFIED_EMAIL", async () => {
  assert.deepEqual(await callback({ claims: { email_verified: false } }), { ok: false, rejection: "UNVERIFIED_EMAIL" });
});

test("SEEDED iii, through the callback: no cookie, a tampered cookie, and a mismatched state are BAD_STATE — before any byte goes to Google", async () => {
  let googleCalled = 0;
  const counting: typeof fetch = async () => {
    googleCalled += 1;
    return new Response(null, { status: 500 });
  };
  const state = await freshState();
  const base = {
    query: new URLSearchParams({ code: "c", state: state.state }),
    sessionKey: SESSION_KEY,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    nowSeconds: NOW,
    fetchImpl: counting,
    resolveKey: await fixtureResolver(),
  };
  assert.deepEqual(await completeGoogleCallback({ ...base, stateCookie: null }), { ok: false, rejection: "BAD_STATE" });
  const cookie = await signOauthState(state, SESSION_KEY);
  assert.deepEqual(
    await completeGoogleCallback({ ...base, stateCookie: `${cookie.slice(0, -3)}xyz` }),
    { ok: false, rejection: "BAD_STATE" },
  );
  assert.deepEqual(
    await completeGoogleCallback({ ...base, stateCookie: cookie, query: new URLSearchParams({ code: "c", state: "other" }) }),
    { ok: false, rejection: "BAD_STATE" },
  );
  assert.equal(googleCalled, 0, "a callback that cannot be tied to a start must never reach Google");
});

test("SEEDED v, through the callback: an expired token is EXPIRED", async () => {
  assert.deepEqual(await callback({ claims: { exp: NOW - 3600 } }), { ok: false, rejection: "EXPIRED" });
});

test("NOT_CONFIGURED when the client id, the client secret or the session key is absent — and never a pass", async () => {
  assert.deepEqual(await callback({ clientId: undefined }), { ok: false, rejection: "NOT_CONFIGURED" });
  assert.deepEqual(await callback({ clientSecret: "" }), { ok: false, rejection: "NOT_CONFIGURED" });
  assert.deepEqual(await callback({ sessionKey: undefined }), { ok: false, rejection: "NOT_CONFIGURED" });
});

test("Google's own error is GOOGLE_DENIED, and a callback without a code is MALFORMED", async () => {
  assert.deepEqual(await callback({ query: { error: "access_denied" } }), { ok: false, rejection: "GOOGLE_DENIED" });
  const state = await freshState();
  const verdict = await completeGoogleCallback({
    query: new URLSearchParams({ state: state.state }),
    stateCookie: await signOauthState(state, SESSION_KEY),
    sessionKey: SESSION_KEY,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
    nowSeconds: NOW,
    fetchImpl: googleServing("unused"),
    resolveKey: await fixtureResolver(),
  });
  assert.deepEqual(verdict, { ok: false, rejection: "MALFORMED" });
});

test("googleSignInReadiness names the missing variables and never their values", () => {
  const ready = googleSignInReadiness(CONFIGURED);
  assert.deepEqual(ready, { ready: true, missing: [] });
  const none = googleSignInReadiness({});
  assert.equal(none.ready, false);
  assert.deepEqual([...none.missing], [GOOGLE_CLIENT_ID_VAR, GOOGLE_CLIENT_SECRET_VAR, ADMIN_SESSION_KEY_VAR]);
  const blank = googleSignInReadiness({ ...CONFIGURED, [GOOGLE_CLIENT_SECRET_VAR]: "   " });
  assert.deepEqual([...blank.missing], [GOOGLE_CLIENT_SECRET_VAR]);
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(CLIENT_SECRET));
});

/* ================================================================== *
 * THE ROUTES AND THE MIDDLEWARE — SEEDED FAILURE iv
 * ================================================================== */

test("SEEDED iv: the callback and the start route are 404 on the PUBLIC host, through middleware AND the handlers", async () => {
  for (const path of [OAUTH_CALLBACK_PATH, `${OAUTH_CALLBACK_PATH}?code=x&state=y`, OAUTH_START_PATH]) {
    const response = await middleware(request(PUBLIC_HOST, path));
    assert.equal(response.status, 404, `${path} on the public host must be 404, not ${response.status}`);
  }
  await withEnv(CONFIGURED, async () => {
    assert.equal((await startGET(request(PUBLIC_HOST, OAUTH_START_PATH))).status, 404);
    assert.equal((await callbackGET(request(PUBLIC_HOST, `${OAUTH_CALLBACK_PATH}?code=x&state=y`))).status, 404);
  });
});

test("the start and the callback are reachable unauthenticated on the ADMIN host, and nothing else new is", async () => {
  for (const path of [OAUTH_START_PATH, OAUTH_CALLBACK_PATH]) {
    const response = await middleware(request(ADMIN_HOST, path));
    assert.equal(response.status, 200, `${path} must pass middleware without a session`);
  }
  const other = await middleware(request(ADMIN_HOST, "/admin/auth"));
  assert.equal(other.status, 307, "/admin/auth itself is not a surface and needs a session like any admin path");
});

test("the start route reports NOT_CONFIGURED by class when a variable is absent — no cookie, no 500, no Google", async () => {
  await withEnv({ ...CONFIGURED, [GOOGLE_CLIENT_ID_VAR]: undefined }, async () => {
    const response = await startGET(request(ADMIN_HOST, OAUTH_START_PATH));
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location") ?? "", ADMIN_ORIGIN);
    assert.equal(location.host, ADMIN_HOST);
    assert.equal(location.pathname, "/admin/login");
    assert.equal(location.searchParams.get("why"), "NOT_CONFIGURED");
    assert.equal(setCookies(response).length, 0, "no state cookie is issued for a flow that cannot start");
  });
});

test("the start route 302s to Google with PKCE and sets the Lax state cookie", async () => {
  await withEnv(CONFIGURED, async () => {
    const response = await startGET(request(ADMIN_HOST, OAUTH_START_PATH));
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(location.host, "accounts.google.com");
    assert.equal(location.searchParams.get("client_id"), CLIENT_ID);
    assert.equal(location.searchParams.get("redirect_uri"), REDIRECT_URI);
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    const state = location.searchParams.get("state") ?? "";
    assert.ok(state.length > 10);

    const line = setCookies(response).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
    assert.ok(line, "the state cookie must be set");
    assert.match(line, /HttpOnly/);
    assert.match(line, /Secure/);
    assert.match(line, /Path=\//);
    assert.match(line, /SameSite=Lax/);
    assert.doesNotMatch(line, /Domain=/);

    // The cookie's state IS the URL's state, and the challenge IS S256 of the cookie's verifier.
    const opened = await openOauthState(cookieValueOf(response, OAUTH_STATE_COOKIE), SESSION_KEY, Math.floor(Date.now() / 1000));
    assert.equal(opened.ok, true);
    if (opened.ok) {
      assert.equal(opened.state.state, state);
      assert.equal(opened.state.nonce, location.searchParams.get("nonce"));
      assert.equal(await pkceChallenge(opened.state.verifier), location.searchParams.get("code_challenge"));
    }
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("SEEDED iii, through the route: the callback with no state cookie 303s to why=BAD_STATE and clears the cookie", async () => {
  await withEnv(CONFIGURED, async () => {
    const response = await callbackGET(request(ADMIN_HOST, `${OAUTH_CALLBACK_PATH}?code=x&state=y`));
    assert.equal(response.status, 303);
    const location = new URL(response.headers.get("location") ?? "", ADMIN_ORIGIN);
    assert.equal(location.pathname, "/admin/login");
    assert.equal(location.searchParams.get("why"), "BAD_STATE");
    assert.equal(cookieValueOf(response, ADMIN_SESSION_COOKIE), null, "no session may be issued");
    const cleared = setCookies(response).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
    assert.ok(cleared && /Max-Age=0/.test(cleared), "the state cookie is cleared whatever the outcome");
  });
});

async function withGoogle<T>(claimsOver: Record<string, unknown>, fn: (issue: (nonce: string) => Promise<void>) => Promise<T>): Promise<T> {
  const { privateKey, jwk } = await signer();
  let idToken = "";
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === GOOGLE_TOKEN_ENDPOINT) return new Response(JSON.stringify({ id_token: idToken }), { status: 200 });
    if (url === GOOGLE_JWKS_URL) {
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "cache-control": "max-age=3600" },
      });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    return await fn(async (nonce) => {
      const now = Math.floor(Date.now() / 1000);
      idToken = await mintIdToken(ownerClaims({ nonce, iat: now - 5, exp: now + 3600, ...claimsOver }), privateKey);
    });
  } finally {
    globalThis.fetch = original;
  }
}

/** Run the start route and hand back what the browser would carry to the callback. */
async function startFlow(): Promise<{ state: string; nonce: string; cookie: string }> {
  const response = await startGET(request(ADMIN_HOST, OAUTH_START_PATH));
  const cookie = cookieValueOf(response, OAUTH_STATE_COOKIE) ?? "";
  const opened = await openOauthState(cookie, SESSION_KEY, Math.floor(Date.now() / 1000));
  assert.equal(opened.ok, true);
  if (!opened.ok) throw new Error("unreachable");
  return { state: opened.state.state, nonce: opened.state.nonce, cookie };
}

test("POSITIVE CONTROL, through the routes: start → Google → callback issues the existing Strict session and clears the state", async () => {
  await withEnv(CONFIGURED, () =>
    withGoogle({}, async (issue) => {
      const flow = await startFlow();
      await issue(flow.nonce);
      const response = await callbackGET(
        request(ADMIN_HOST, `${OAUTH_CALLBACK_PATH}?code=the-code&state=${encodeURIComponent(flow.state)}`, {
          cookie: `${OAUTH_STATE_COOKIE}=${flow.cookie}`,
        }),
      );
      assert.equal(response.status, 303, `expected 303, got ${response.status} → ${response.headers.get("location")}`);
      const location = new URL(response.headers.get("location") ?? "", ADMIN_ORIGIN);
      assert.equal(location.pathname, "/admin");
      assert.equal(location.searchParams.get("why"), null);

      const session = setCookies(response).find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE}=`));
      assert.ok(session, "the existing session cookie is what a Google sign-in issues");
      assert.match(session, /SameSite=Strict/);
      assert.match(session, /HttpOnly/);
      assert.match(session, new RegExp(`Max-Age=${SESSION_LIFETIME_SECONDS}`));
      const verdict = await verifySession(cookieValueOf(response, ADMIN_SESSION_COOKIE), SESSION_KEY, Math.floor(Date.now() / 1000));
      assert.equal(verdict.ok, true);
      if (verdict.ok) {
        assert.equal(verdict.session.via, "google");
        assert.match(verdict.session.sid, /^adm_/);
      }
      const cleared = setCookies(response).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`));
      assert.ok(cleared && /Max-Age=0/.test(cleared));
      // The session cookie never carries the email, the token or the code.
      assert.ok(!JSON.stringify(verdict).includes(OWNER_DOMAIN) && !JSON.stringify(verdict).includes("the-code"));
    }),
  );
});

test("SEEDED i, through the routes: a verified token for another account is refused with why=WRONG_EMAIL and NO session", async () => {
  await withEnv(CONFIGURED, () =>
    withGoogle({ email: `board-member@${OWNER_DOMAIN}` }, async (issue) => {
      const flow = await startFlow();
      await issue(flow.nonce);
      const response = await callbackGET(
        request(ADMIN_HOST, `${OAUTH_CALLBACK_PATH}?code=the-code&state=${encodeURIComponent(flow.state)}`, {
          cookie: `${OAUTH_STATE_COOKIE}=${flow.cookie}`,
        }),
      );
      assert.equal(response.status, 303);
      const location = new URL(response.headers.get("location") ?? "", ADMIN_ORIGIN);
      assert.equal(location.searchParams.get("why"), "WRONG_EMAIL");
      assert.equal(cookieValueOf(response, ADMIN_SESSION_COOKIE), null);
      assert.doesNotMatch(location.toString(), /board-member/, "the refused identity never reaches a URL");
    }),
  );
});

/* ================================================================== *
 * THE BREAK-GLASS
 * ================================================================== */

const SECRET = "x".repeat(MIN_SECRET_LENGTH + 8);

/** A form POST to any admin path. Path-parameterised, so it is one helper and not a per-route copy. */
function formPost(host: string, path: string, body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://${host}${path}`, {
    method: "POST",
    headers: { host, "content-type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

const breakGlassPost = (host: string, body: string, headers: Record<string, string> = {}): NextRequest =>
  formPost(host, "/api/admin/session", body, headers);

test("SEEDED: the break-glass route is 404 when its flag is absent — even with the right secret and origin", async () => {
  await withEnv(
    { [BREAK_GLASS_FLAG_VAR]: undefined, [ADMIN_SECRET_VAR]: SECRET, [ADMIN_SESSION_KEY_VAR]: SESSION_KEY },
    async () => {
      const response = await breakGlassPOST(
        breakGlassPost(ADMIN_HOST, `secret=${encodeURIComponent(SECRET)}`, { origin: ADMIN_ORIGIN }),
      );
      assert.equal(response.status, 404);
      assert.equal(setCookies(response).length, 0);
    },
  );
});

test("the flag is the exact word `enabled`: `true`, `1`, `Enabled` and blank all keep the path closed", async () => {
  for (const value of ["true", "1", "Enabled", "", "yes", " enabled"]) {
    assert.equal(isBreakGlassEnabled({ [BREAK_GLASS_FLAG_VAR]: value }), false, JSON.stringify(value));
    await withEnv(
      { [BREAK_GLASS_FLAG_VAR]: value, [ADMIN_SECRET_VAR]: SECRET, [ADMIN_SESSION_KEY_VAR]: SESSION_KEY },
      async () => {
        const response = await breakGlassPOST(
          breakGlassPost(ADMIN_HOST, `secret=${encodeURIComponent(SECRET)}`, { origin: ADMIN_ORIGIN }),
        );
        assert.equal(response.status, 404, `flag=${JSON.stringify(value)} must be 404`);
      },
    );
  }
  assert.equal(isBreakGlassEnabled({ [BREAK_GLASS_FLAG_VAR]: "enabled" }), true);
});

test("with the flag on, an unreachable incident log REFUSES the break-glass — a correct secret issues nothing", async () => {
  await withEnv(
    {
      [BREAK_GLASS_FLAG_VAR]: "enabled",
      [ADMIN_SECRET_VAR]: SECRET,
      [ADMIN_SESSION_KEY_VAR]: SESSION_KEY,
      [CONTROL_PLANE_URL_VAR]: undefined,
    },
    async () => {
      const response = await breakGlassPOST(
        breakGlassPost(ADMIN_HOST, `secret=${encodeURIComponent(SECRET)}`, { origin: ADMIN_ORIGIN }),
      );
      assert.equal(response.status, 303);
      const location = new URL(response.headers.get("location") ?? "", ADMIN_ORIGIN);
      assert.equal(location.searchParams.get("why"), "INCIDENT_LOG_UNAVAILABLE");
      assert.equal(cookieValueOf(response, ADMIN_SESSION_COOKIE), null);
      // Origin is still checked first, and the public host is still 404.
      const noOrigin = await breakGlassPOST(breakGlassPost(ADMIN_HOST, `secret=${encodeURIComponent(SECRET)}`));
      assert.equal(new URL(noOrigin.headers.get("location") ?? "", ADMIN_ORIGIN).searchParams.get("why"), "ORIGIN");
      const pub = await breakGlassPOST(breakGlassPost(PUBLIC_HOST, `secret=x`, { origin: ADMIN_ORIGIN }));
      assert.equal(pub.status, 404);
    },
  );
});

test("the rate limit is read from the durable log: the ceiling refuses, old records do not count, undated ones do", () => {
  const now = "2026-09-02T12:00:00.000Z";
  const inWindow = (minutesAgo: number) => ({ writtenAt: new Date(Date.parse(now) - minutesAgo * 60_000).toISOString() });
  const under = breakGlassWindowVerdict(
    Array.from({ length: BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW - 1 }, (_, i) => inWindow(i)),
    now,
  );
  assert.equal(under.allowed, true);
  assert.equal(under.attemptsInWindow, BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW - 1);

  const at = breakGlassWindowVerdict(
    Array.from({ length: BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW }, (_, i) => inWindow(i)),
    now,
  );
  assert.equal(at.allowed, false, "the Nth attempt in the window fills it; the next is refused");

  const stale = breakGlassWindowVerdict(
    Array.from({ length: 50 }, () => inWindow(BREAK_GLASS_WINDOW_SECONDS / 60 + 1)),
    now,
  );
  assert.equal(stale.allowed, true, "records outside the window are not counted");
  assert.equal(stale.attemptsInWindow, 0);

  const undated = breakGlassWindowVerdict(
    Array.from({ length: BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW }, () => ({ writtenAt: "not a date" })),
    now,
  );
  assert.equal(undated.allowed, false, "a record we cannot date is counted against the caller");
  assert.equal(under.windowSeconds, BREAK_GLASS_WINDOW_SECONDS);
});

test("the incident record names class, moment and outcome, passes aggregate-only, and carries no value", async () => {
  const accepted = buildBreakGlassIncident({
    at: "2026-09-02T12:00:00.000Z",
    outcome: "ACCEPTED",
    rejection: null,
    sessionRef: "adm_example",
    attemptsInWindowIncludingThis: 1,
    max: BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW,
    windowSeconds: BREAK_GLASS_WINDOW_SECONDS,
  });
  assert.doesNotThrow(() => assertAggregateOnly(accepted, "break-glass incident"));
  assert.match(accepted.headline, /BREAK-GLASS SIGN-IN ACCEPTED/);
  assert.ok(accepted.lines.some((l) => l === "class: ACCEPTED"));
  assert.ok(accepted.lines.some((l) => l === "outcome: ACCEPTED"));
  assert.ok(accepted.lines.some((l) => l === "at: 2026-09-02T12:00:00.000Z"));
  assert.ok(accepted.lines.some((l) => l === "session issued: adm_example"));
  assert.ok(accepted.lines.some((l) => /break-glass/.test(l) && /custody/.test(l)));

  const refused = buildBreakGlassIncident({
    at: "2026-09-02T12:00:01.000Z",
    outcome: "REFUSED",
    rejection: "REFUSED",
    sessionRef: null,
    attemptsInWindowIncludingThis: 3,
    max: BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW,
    windowSeconds: BREAK_GLASS_WINDOW_SECONDS,
  });
  assert.match(refused.headline, /REFUSED: REFUSED/);
  assert.ok(refused.lines.some((l) => l === "session issued: none"));
  assert.notEqual(accepted.digestId, refused.digestId);

  // Two attempts in the same millisecond are two records, not one idempotent no-op.
  const twin = buildBreakGlassIncident({ ...refused, at: refused.writtenAt, outcome: "REFUSED", rejection: "REFUSED", sessionRef: null, attemptsInWindowIncludingThis: 3, max: 5, windowSeconds: 900 });
  assert.notEqual(twin.digestId, refused.digestId);

  // And under the memory store the ceiling is reached by appending, exactly as the route reads it.
  const repos = createMemoryRepositories();
  for (let i = 0; i < BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW; i += 1) {
    const incident = buildBreakGlassIncident({
      at: new Date(Date.parse("2026-09-02T12:00:00.000Z") + i * 1000).toISOString(),
      outcome: "REFUSED",
      rejection: "REFUSED",
      sessionRef: null,
      attemptsInWindowIncludingThis: i + 1,
      max: BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW,
      windowSeconds: BREAK_GLASS_WINDOW_SECONDS,
    });
    await repos.ownerDigests.append(BREAK_GLASS_LOG_KEY, incident.digestId, incident, incident.writtenAt);
  }
  const records = await repos.ownerDigests.read(BREAK_GLASS_LOG_KEY);
  assert.equal(records.length, BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW);
  assert.equal(breakGlassWindowVerdict(records, "2026-09-02T12:01:00.000Z").allowed, false);
  assert.equal(breakGlassWindowVerdict(records, "2026-09-02T12:16:00.000Z").allowed, true, "the window passes");
  // The owner-digest history the dashboard reads is a different partition.
  assert.deepEqual(await repos.ownerDigests.read("owner-digest"), []);
});

test("the break-glass route's security sequence, in order, from its source", () => {
  const whole = readFileSync(join(ROOT, "app", "api", "admin", "session", "route.ts"), "utf8");
  // The POST body only: DELETE (sign-out) has its own host check after it.
  const postAt = whole.indexOf("export async function POST");
  const deleteAt = whole.indexOf("export async function DELETE");
  assert.ok(postAt >= 0 && deleteAt > postAt, "POST precedes DELETE in the route");
  const source = whole.slice(postAt, deleteAt);
  const order = [
    "isAdminHostRequest(",
    "isBreakGlassEnabled(",
    "originAllowed(",
    "openControlPlane(",
    "breakGlassWindowVerdict(",
    "checkLogin(",
    "buildBreakGlassIncident(",
    "ownerDigests.append(",
    "signSession(",
  ].map((needle) => {
    const at = source.lastIndexOf(needle);
    assert.ok(at >= 0, `${needle} is not called in the route`);
    return at;
  });
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] < order[i], `step ${i} (${["host", "flag", "origin", "open", "window", "compare", "incident", "append", "issue"][i]}) runs out of sequence`);
  }
  assert.match(whole, /export const runtime = "nodejs"/);
  assert.doesNotMatch(whole, /console\.(log|error|warn)\([^)]*secret/i, "nothing about the submitted value may be logged");
});

test("the login page renders Continue with Google and shows the secret form ONLY under the break-glass flag", () => {
  const source = readFileSync(join(ROOT, "app", "(admin)", "admin", "login", "page.tsx"), "utf8");
  assert.match(source, /Continue with Google/);
  assert.match(source, /href=\{OAUTH_START_PATH\}/);
  const form = source.indexOf("<form");
  const gate = source.indexOf("{breakGlass && (");
  assert.ok(gate >= 0 && form > gate, "the form must sit inside the break-glass gate");
  assert.match(source, /googleSignInReadiness\(process\.env\)/, "missing variables are named at render");
  assert.doesNotMatch(source, /OWNER_ADMIN_EMAIL/, "the enrolled address is not rendered on an unauthenticated surface");
});

test("the middleware's unauthenticated set is exactly the four surfaces", () => {
  const source = readFileSync(join(ROOT, "middleware.ts"), "utf8");
  const block = source.slice(source.indexOf("UNAUTHENTICATED_ADMIN_PATHS = ["), source.indexOf("] as const;", source.indexOf("UNAUTHENTICATED_ADMIN_PATHS = [")));
  const listed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(listed, ["/admin/login", "/admin/auth/google", "/admin/auth/callback", "/api/admin/session"]);
});

test("a session issued before Google sign-in still verifies, and `via` round-trips", async () => {
  const iat = NOW;
  const legacy = await signSession({ sid: "adm_legacy", iat, exp: iat + SESSION_LIFETIME_SECONDS }, SESSION_KEY);
  const verdict = await verifySession(legacy, SESSION_KEY, iat + 1);
  assert.equal(verdict.ok, true);
  if (verdict.ok) assert.equal(verdict.session.via, undefined);
  const marked = await signSession({ sid: "adm_bg", iat, exp: iat + SESSION_LIFETIME_SECONDS, via: "break-glass" }, SESSION_KEY);
  const v2 = await verifySession(marked, SESSION_KEY, iat + 1);
  if (v2.ok) assert.equal(v2.session.via, "break-glass");
});
