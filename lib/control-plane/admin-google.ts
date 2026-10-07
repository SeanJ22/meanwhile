/**
 * Verifies server-side that the identity Google asserts is exactly the enrolled address. Pure of Next and the network:
 * routes hand in a clock, a fetch and a key resolver. `hd` is never sufficient for authorization.
 */

import {
  ADMIN_SESSION_KEY_VAR,
  base64UrlDecode,
  base64UrlEncode,
  openEnvelope,
  randomBase64Url,
  signEnvelope,
  timingSafeEqual,
} from "./admin-auth.ts";

/** The enrolled owner. Exactly this, lower-cased, or nothing. */
export const OWNER_ADMIN_EMAIL = "sean@meanwhileusa.com";

/** Google OAuth client credentials. RUNTIME reads, server-side only. */
export const GOOGLE_CLIENT_ID_VAR = "GOOGLE_OAUTH_CLIENT_ID";
export const GOOGLE_CLIENT_SECRET_VAR = "GOOGLE_OAUTH_CLIENT_SECRET";

/** Every variable the Google path needs, so the login page can name what is missing. */
export const GOOGLE_SIGN_IN_VARS = [
  GOOGLE_CLIENT_ID_VAR,
  GOOGLE_CLIENT_SECRET_VAR,
  ADMIN_SESSION_KEY_VAR,
] as const;

export const OAUTH_STATE_COOKIE = "__Host-wtp-oauth";
export const OAUTH_STATE_LIFETIME_SECONDS = 10 * 60;

export const OAUTH_START_PATH = "/admin/auth/google";
export const OAUTH_CALLBACK_PATH = "/admin/auth/callback";

export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"] as const;
export const OAUTH_SCOPE = "openid email";
export const ID_TOKEN_CLOCK_SKEW_SECONDS = 60;

/** The hosted-domain HINT sent to Google's account chooser. Never an authorization input. */
export const OWNER_HOSTED_DOMAIN_HINT = OWNER_ADMIN_EMAIL.slice(OWNER_ADMIN_EMAIL.indexOf("@") + 1);

export const GOOGLE_REJECTIONS = [
  "NOT_CONFIGURED",
  "BAD_STATE",
  "GOOGLE_DENIED",
  "MALFORMED",
  "TOKEN_EXCHANGE_FAILED",
  "BAD_SIGNATURE",
  "BAD_ISSUER",
  "BAD_AUDIENCE",
  "EXPIRED",
  "NOT_YET_VALID",
  "UNVERIFIED_EMAIL",
  "WRONG_EMAIL",
] as const;
export type GoogleRejection = (typeof GOOGLE_REJECTIONS)[number];

const encoder = new TextEncoder();

export interface GoogleSignInReadiness {
  readonly ready: boolean;
  /** Variable NAMES that are absent or blank. Never values. */
  readonly missing: readonly string[];
}

export function googleSignInReadiness(env: {
  readonly [name: string]: string | undefined;
}): GoogleSignInReadiness {
  const missing = GOOGLE_SIGN_IN_VARS.filter((name) => !env[name] || env[name]?.trim() === "");
  return { ready: missing.length === 0, missing };
}

/** 32 random bytes → 43 base64url characters, inside RFC 7636's 43–128. */
export function mintPkceVerifier(): string {
  return randomBase64Url(32);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** `state` and `nonce` are both this: 16 random bytes, opaque, single-use. */
export function mintOauthToken(): string {
  return randomBase64Url(16);
}

export interface OauthState {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  readonly iat: number;
  readonly exp: number;
}

export function signOauthState(state: OauthState, sessionKey: string): Promise<string> {
  return signEnvelope(state, sessionKey);
}

export type OauthStateVerdict =
  | { readonly ok: true; readonly state: OauthState }
  | { readonly ok: false; readonly rejection: "BAD_STATE" };

/** Every failure is BAD_STATE; which kind applied is not shown to a caller who did not start the flow. */
export async function openOauthState(
  cookieValue: string | null | undefined,
  sessionKey: string,
  nowSeconds: number,
): Promise<OauthStateVerdict> {
  if (!cookieValue) return { ok: false, rejection: "BAD_STATE" };
  const opened = await openEnvelope(cookieValue, sessionKey);
  if (!opened.ok) return { ok: false, rejection: "BAD_STATE" };
  const s = opened.payload as Partial<OauthState> | null;
  if (
    !s ||
    typeof s.state !== "string" ||
    typeof s.nonce !== "string" ||
    typeof s.verifier !== "string" ||
    typeof s.iat !== "number" ||
    typeof s.exp !== "number" ||
    s.state === "" ||
    s.verifier === ""
  ) {
    return { ok: false, rejection: "BAD_STATE" };
  }
  if (s.exp <= nowSeconds) return { ok: false, rejection: "BAD_STATE" };
  // A cookie claiming a longer life than policy was not issued under it.
  if (s.exp - s.iat > OAUTH_STATE_LIFETIME_SECONDS) return { ok: false, rejection: "BAD_STATE" };
  return { ok: true, state: s as OauthState };
}

/** `SameSite=Lax`, the one non-Strict cookie: the callback is a cross-site top-level navigation from Google. Carries no secret. */
export function oauthCookieAttributes(maxAgeSeconds: number): string {
  return [`Path=/`, `Max-Age=${maxAgeSeconds}`, "HttpOnly", "Secure", "SameSite=Lax"].join("; ");
}

/** The query `state` against the cookie's, without leaking where they differ. */
export function stateMatches(fromQuery: string | null | undefined, fromCookie: string): boolean {
  if (!fromQuery) return false;
  return timingSafeEqual(fromQuery, fromCookie);
}

export function buildAuthorizationUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
    // A chooser hint only; the enrolled address never goes in a query string.
  url.searchParams.set("hd", OWNER_HOSTED_DOMAIN_HINT);
  return url.toString();
}

export interface GoogleJwk {
  readonly kty: string;
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
  readonly n?: string;
  readonly e?: string;
}

export interface Jwks {
  readonly keys: readonly GoogleJwk[];
}

export type KeyResolver = (kid: string) => Promise<GoogleJwk | null>;

export function parseCacheControlMaxAge(header: string | null | undefined): number | null {
  if (!header) return null;
  const m = /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(header);
  if (!m) return null;
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) ? seconds : null;
}

/** The cache lifetime when Google sends no max-age. Conservative on purpose. */
export const JWKS_DEFAULT_TTL_SECONDS = 5 * 60;
/** A miss re-fetches ONCE; a second miss inside this interval does not. */
export const JWKS_MIN_REFETCH_INTERVAL_MS = 60 * 1000;

export interface JwksCache {
  jwks: Jwks | null;
  expiresAtMs: number;
  lastFetchAtMs: number;
}

export function emptyJwksCache(): JwksCache {
  return { jwks: null, expiresAtMs: 0, lastFetchAtMs: 0 };
}

/** An unknown `kid` re-fetches at most once per {@link JWKS_MIN_REFETCH_INTERVAL_MS}, so made-up kids cannot flood Google. */
export function createJwksResolver(input: {
  readonly fetchImpl: typeof fetch;
  readonly cache?: JwksCache;
  readonly url?: string;
  readonly now?: () => number;
}): KeyResolver {
  const cache = input.cache ?? emptyJwksCache();
  const url = input.url ?? GOOGLE_JWKS_URL;
  const now = input.now ?? (() => Date.now());

  async function refresh(): Promise<void> {
    const at = now();
    cache.lastFetchAtMs = at;
    let response: Response;
    try {
      response = await input.fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
    } catch {
      return;
    }
    if (!response.ok) return;
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return;
    }
    const keys = (body as { keys?: unknown })?.keys;
    if (!Array.isArray(keys)) return;
    const ttl = parseCacheControlMaxAge(response.headers.get("cache-control")) ?? JWKS_DEFAULT_TTL_SECONDS;
    cache.jwks = { keys: keys.filter((k): k is GoogleJwk => typeof k === "object" && k !== null) };
    cache.expiresAtMs = at + ttl * 1000;
  }

  function lookup(kid: string): GoogleJwk | null {
    return cache.jwks?.keys.find((k) => k.kid === kid) ?? null;
  }

  return async (kid: string): Promise<GoogleJwk | null> => {
    const at = now();
    if (cache.jwks === null || at >= cache.expiresAtMs) await refresh();
    const hit = lookup(kid);
    if (hit) return hit;
    if (at - cache.lastFetchAtMs >= JWKS_MIN_REFETCH_INTERVAL_MS) {
      await refresh();
      return lookup(kid);
    }
    return null;
  };
}

export interface IdTokenClaims {
  readonly iss?: unknown;
  readonly aud?: unknown;
  readonly exp?: unknown;
  readonly iat?: unknown;
  readonly sub?: unknown;
  readonly email?: unknown;
  readonly email_verified?: unknown;
  readonly hd?: unknown;
  readonly nonce?: unknown;
}

export type IdTokenVerdict =
  | { readonly ok: true; readonly claims: IdTokenClaims }
  | { readonly ok: false; readonly rejection: GoogleRejection };

function decodeJsonSegment(segment: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(segment)));
}

/** Header, then signature, then payload: a forged token never reaches the claims parser. */
export async function verifyIdToken(
  idToken: string,
  input: {
    readonly clientId: string;
    readonly resolveKey: KeyResolver;
    readonly nowSeconds: number;
    readonly expectedNonce?: string;
    readonly skewSeconds?: number;
  },
): Promise<IdTokenVerdict> {
  const skew = input.skewSeconds ?? ID_TOKEN_CLOCK_SKEW_SECONDS;
  const parts = idToken.split(".");
  if (parts.length !== 3 || parts.some((p) => p === "")) return { ok: false, rejection: "MALFORMED" };
  const [h, p, s] = parts;

  let header: { alg?: unknown; kid?: unknown };
  try {
    header = decodeJsonSegment(h) as { alg?: unknown; kid?: unknown };
  } catch {
    return { ok: false, rejection: "MALFORMED" };
  }
  if (header?.alg !== "RS256" || typeof header?.kid !== "string" || header.kid === "") {
    return { ok: false, rejection: "BAD_SIGNATURE" };
  }

  const jwk = await input.resolveKey(header.kid);
  if (!jwk || jwk.kty !== "RSA" || typeof jwk.n !== "string" || typeof jwk.e !== "string") {
    return { ok: false, rejection: "BAD_SIGNATURE" };
  }

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    valid = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      key,
      base64UrlDecode(s),
      encoder.encode(`${h}.${p}`),
    );
  } catch {
    return { ok: false, rejection: "BAD_SIGNATURE" };
  }
  if (!valid) return { ok: false, rejection: "BAD_SIGNATURE" };

  let claims: IdTokenClaims;
  try {
    claims = decodeJsonSegment(p) as IdTokenClaims;
  } catch {
    return { ok: false, rejection: "MALFORMED" };
  }
  if (typeof claims !== "object" || claims === null) return { ok: false, rejection: "MALFORMED" };

  if (typeof claims.iss !== "string" || !(GOOGLE_ISSUERS as readonly string[]).includes(claims.iss)) {
    return { ok: false, rejection: "BAD_ISSUER" };
  }
  // `aud` may be a string or an array; ours must be present and nothing else may be.
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (aud.length !== 1 || aud[0] !== input.clientId) return { ok: false, rejection: "BAD_AUDIENCE" };

  if (typeof claims.exp !== "number" || typeof claims.iat !== "number") {
    return { ok: false, rejection: "MALFORMED" };
  }
  if (claims.exp + skew <= input.nowSeconds) return { ok: false, rejection: "EXPIRED" };
  if (claims.iat - skew > input.nowSeconds) return { ok: false, rejection: "NOT_YET_VALID" };

  if (input.expectedNonce !== undefined) {
    if (typeof claims.nonce !== "string" || !timingSafeEqual(claims.nonce, input.expectedNonce)) {
      return { ok: false, rejection: "BAD_STATE" };
    }
  }
  return { ok: true, claims };
}

export type OwnerVerdict =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly rejection: "UNVERIFIED_EMAIL" | "WRONG_EMAIL" };

/** `email_verified` must be the boolean `true`; `hd` is deliberately not consulted. */
export function authorizeOwner(claims: IdTokenClaims): OwnerVerdict {
  if (claims.email_verified !== true) return { ok: false, rejection: "UNVERIFIED_EMAIL" };
  if (typeof claims.email !== "string") return { ok: false, rejection: "WRONG_EMAIL" };
  const email = claims.email.trim().toLowerCase();
  if (!timingSafeEqual(email, OWNER_ADMIN_EMAIL)) return { ok: false, rejection: "WRONG_EMAIL" };
  return { ok: true, email: OWNER_ADMIN_EMAIL };
}

export type ExchangeVerdict =
  | { readonly ok: true; readonly idToken: string }
  | { readonly ok: false; readonly rejection: "TOKEN_EXCHANGE_FAILED"; readonly httpStatus: number | null };

/** Only `id_token` is read; on failure the status is kept and the body, which may echo the request, never travels. */
export async function exchangeCodeForIdToken(input: {
  readonly code: string;
  readonly verifier: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly fetchImpl: typeof fetch;
  readonly tokenEndpoint?: string;
}): Promise<ExchangeVerdict> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.verifier,
  });
  let response: Response;
  try {
    response = await input.fetchImpl(input.tokenEndpoint ?? GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    });
  } catch {
    return { ok: false, rejection: "TOKEN_EXCHANGE_FAILED", httpStatus: null };
  }
  if (!response.ok) return { ok: false, rejection: "TOKEN_EXCHANGE_FAILED", httpStatus: response.status };
  let parsed: { id_token?: unknown };
  try {
    parsed = (await response.json()) as { id_token?: unknown };
  } catch {
    return { ok: false, rejection: "TOKEN_EXCHANGE_FAILED", httpStatus: response.status };
  }
  if (typeof parsed?.id_token !== "string" || parsed.id_token === "") {
    return { ok: false, rejection: "TOKEN_EXCHANGE_FAILED", httpStatus: response.status };
  }
  return { ok: true, idToken: parsed.id_token };
}

export interface CallbackInput {
  readonly query: URLSearchParams;
  readonly stateCookie: string | null | undefined;
  readonly sessionKey: string | null | undefined;
  readonly clientId: string | null | undefined;
  readonly clientSecret: string | null | undefined;
  readonly redirectUri: string;
  readonly nowSeconds: number;
  readonly fetchImpl: typeof fetch;
  readonly resolveKey: KeyResolver;
  readonly tokenEndpoint?: string;
}

export type CallbackVerdict =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly rejection: GoogleRejection; readonly httpStatus?: number | null };

/** State is checked before anything else, so an untied callback sends nothing to Google. */
export async function completeGoogleCallback(input: CallbackInput): Promise<CallbackVerdict> {
  if (!input.sessionKey) return { ok: false, rejection: "NOT_CONFIGURED" };

  const opened = await openOauthState(input.stateCookie, input.sessionKey, input.nowSeconds);
  if (!opened.ok) return { ok: false, rejection: "BAD_STATE" };
  if (!stateMatches(input.query.get("state"), opened.state.state)) {
    return { ok: false, rejection: "BAD_STATE" };
  }

  if (input.query.get("error")) return { ok: false, rejection: "GOOGLE_DENIED" };
  const code = input.query.get("code");
  if (!code) return { ok: false, rejection: "MALFORMED" };

  if (!input.clientId || !input.clientSecret) return { ok: false, rejection: "NOT_CONFIGURED" };

  const exchanged = await exchangeCodeForIdToken({
    code,
    verifier: opened.state.verifier,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri: input.redirectUri,
    fetchImpl: input.fetchImpl,
    tokenEndpoint: input.tokenEndpoint,
  });
  if (!exchanged.ok) {
    return { ok: false, rejection: "TOKEN_EXCHANGE_FAILED", httpStatus: exchanged.httpStatus };
  }

  const verified = await verifyIdToken(exchanged.idToken, {
    clientId: input.clientId,
    resolveKey: input.resolveKey,
    nowSeconds: input.nowSeconds,
    expectedNonce: opened.state.nonce,
  });
  if (!verified.ok) return { ok: false, rejection: verified.rejection };

  const owner = authorizeOwner(verified.claims);
  if (!owner.ok) return { ok: false, rejection: owner.rejection };
  return { ok: true, email: owner.email };
}

/** The login page's path for a rejection CLASS. Never an echo of input. */
export function loginPathFor(why: string): string {
  return `/admin/login?why=${encodeURIComponent(why)}`;
}
