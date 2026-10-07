/**
 * The admin host is an alias on the same deploy as the reader site, so this file and `middleware.ts` are the whole
 * separation. Web Crypto, not `node:crypto`, so the Edge middleware and the route handlers share one implementation.
 * The shared secret is only a break-glass; the login is Google (`admin-google.ts`).
 */

/** The owner's shared secret. RUNTIME read, server-side only. NEVER inlined. */
export const ADMIN_SECRET_VAR = "WTP_ADMIN_SECRET";

/** Deliberately independent of the admin secret: a signature must never be an oracle for guesses at the secret. */
export const ADMIN_SESSION_KEY_VAR = "WTP_ADMIN_SESSION_KEY";

/** The cookie name. Prefixed `__Host-` so the browser enforces the rest. */
export const ADMIN_SESSION_COOKIE = "__Host-wtp-admin";

/** The login page derives the hours it shows from this constant. */
export const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;

export const MIN_SECRET_LENGTH = 24;

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An explicit `ArrayBuffer`, so `crypto.subtle` never sees a `SharedArrayBuffer` that could change after verification. */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Random bytes as base64url — session ids, PKCE verifiers, OAuth state. */
export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(new ArrayBuffer(byteLength));
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Walks the whole length and folds the length into the result, so timing leaks neither where nor whether lengths differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

/** The `adm_` prefix keeps admin session ids disjoint from reader browser keys (hex only); a test asserts it. */
export const ADMIN_SESSION_ID_PREFIX = "adm_";

export function mintAdminSessionId(): string {
  return `${ADMIN_SESSION_ID_PREFIX}${randomBase64Url(24)}`;
}

/** Only the first `x-forwarded-host` value counts: the edge wrote it, and later values are a proxy chain or a smuggle. */
export function isAdminHostRequest(
  headers: { get(name: string): string | null },
  adminOrigin: string,
): boolean {
  const raw = headers.get("x-forwarded-host")?.split(",")[0] ?? headers.get("host") ?? "";
  const host = raw.trim().toLowerCase().replace(/:\d+$/, "");
  let adminHost: string;
  try {
    adminHost = new URL(adminOrigin).host.toLowerCase();
  } catch {
    return false;
  }
  return host !== "" && host === adminHost;
}

export type SessionIssuer = "google" | "break-glass";

export interface AdminSession {
  readonly sid: string;
  /** Issued-at, epoch seconds. */
  readonly iat: number;
  /** Expires-at, epoch seconds. Bounded by {@link SESSION_LIFETIME_SECONDS}. */
  readonly exp: number;
    /** Absent on older sessions; read as unknown, never as Google. */
  readonly via?: SessionIssuer;
}

async function hmacKey(sessionKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signEnvelope(payload: unknown, key: string): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(key), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export type EnvelopeVerdict =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly rejection: "MALFORMED" | "BAD_SIGNATURE" };

/** Signature first, contents second: a forged value never reaches `JSON.parse`. */
export async function openEnvelope(value: string, key: string): Promise<EnvelopeVerdict> {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return { ok: false, rejection: "MALFORMED" };
  const body = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(key),
      base64UrlDecode(signature),
      encoder.encode(body),
    );
  } catch {
    return { ok: false, rejection: "MALFORMED" };
  }
  if (!valid) return { ok: false, rejection: "BAD_SIGNATURE" };
  try {
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) };
  } catch {
    return { ok: false, rejection: "MALFORMED" };
  }
}

export async function signSession(session: AdminSession, sessionKey: string): Promise<string> {
  return signEnvelope(session, sessionKey);
}

export type SessionRejection =
  | "NO_COOKIE"
  | "MALFORMED"
  | "BAD_SIGNATURE"
  | "EXPIRED"
  | "NOT_CONFIGURED";

export type SessionVerdict =
  | { readonly ok: true; readonly session: AdminSession }
  | { readonly ok: false; readonly rejection: SessionRejection };

export async function verifySession(
  cookieValue: string | undefined | null,
  sessionKey: string | undefined | null,
  nowSeconds: number,
): Promise<SessionVerdict> {
  if (!sessionKey) return { ok: false, rejection: "NOT_CONFIGURED" };
  if (!cookieValue) return { ok: false, rejection: "NO_COOKIE" };
  const opened = await openEnvelope(cookieValue, sessionKey);
  if (!opened.ok) return { ok: false, rejection: opened.rejection };
  const session = opened.payload as AdminSession;
  if (typeof session?.exp !== "number" || typeof session?.iat !== "number") {
    return { ok: false, rejection: "MALFORMED" };
  }
  if (session.exp <= nowSeconds) return { ok: false, rejection: "EXPIRED" };
    // A cookie whose lifetime exceeds the policy was not issued under it.
  if (session.exp - session.iat > SESSION_LIFETIME_SECONDS) {
    return { ok: false, rejection: "MALFORMED" };
  }
  return { ok: true, session };
}

export type LoginVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "NOT_CONFIGURED" | "WEAK_SECRET" | "REFUSED" };

/** `NOT_CONFIGURED` and a too-short secret are refusals, never a pass. */
export function checkLogin(
  submitted: string | undefined | null,
  configured: string | undefined | null,
): LoginVerdict {
  if (!configured || configured.trim() === "") return { ok: false, reason: "NOT_CONFIGURED" };
  if (configured.length < MIN_SECRET_LENGTH) return { ok: false, reason: "WEAK_SECRET" };
  if (!submitted) return { ok: false, reason: "REFUSED" };
  return timingSafeEqual(submitted, configured) ? { ok: true } : { ok: false, reason: "REFUSED" };
}

/** Second layer behind `SameSite=Strict`; a missing Origin is refused. */
export function originAllowed(
  originHeader: string | null | undefined,
  adminOrigin: string,
): boolean {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === new URL(adminOrigin).origin;
  } catch {
    return false;
  }
}

export function redactSecrets(text: string, secrets: readonly (string | undefined | null)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  return out;
}

/** `__Host-` makes the browser refuse the cookie unless Secure, Path=/ and no Domain, so the public host never gets it. */
export function sessionCookieAttributes(maxAgeSeconds: number): string {
  return [
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

/**
 * Exists only while `WTP_ADMIN_BREAK_GLASS` is exactly `enabled`; otherwise the route answers 404. The incident
 * record is appended before a session is issued, and a failed append refuses the login. Beyond the ceiling the path
 * refuses without appending, so a flood cannot grow the log.
 */
export const BREAK_GLASS_FLAG_VAR = "WTP_ADMIN_BREAK_GLASS";
export const BREAK_GLASS_ENABLED_VALUE = "enabled";

export const BREAK_GLASS_LOG_KEY = "admin-break-glass";

export const BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW = 5;
export const BREAK_GLASS_WINDOW_SECONDS = 15 * 60;

export function isBreakGlassEnabled(env: { readonly [name: string]: string | undefined }): boolean {
  return env[BREAK_GLASS_FLAG_VAR] === BREAK_GLASS_ENABLED_VALUE;
}

export type BreakGlassRejection =
  | "RATE_LIMITED"
  | "INCIDENT_LOG_UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "WEAK_SECRET"
  | "REFUSED";

export interface BreakGlassWindowVerdict {
  readonly allowed: boolean;
  readonly attemptsInWindow: number;
  readonly max: number;
  readonly windowSeconds: number;
}

/** A record whose `writtenAt` does not parse counts against the caller. */
export function breakGlassWindowVerdict(
  records: readonly { readonly writtenAt: string }[],
  nowIso: string,
  max: number = BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW,
  windowSeconds: number = BREAK_GLASS_WINDOW_SECONDS,
): BreakGlassWindowVerdict {
  const nowMs = Date.parse(nowIso);
  const floorMs = nowMs - windowSeconds * 1000;
  let attemptsInWindow = 0;
  for (const record of records) {
    const at = Date.parse(record.writtenAt);
    if (Number.isNaN(at) || at >= floorMs) attemptsInWindow += 1;
  }
  return { allowed: attemptsInWindow < max, attemptsInWindow, max, windowSeconds };
}

export interface BreakGlassIncident {
  readonly formatVersion: number;
  readonly digestId: string;
  readonly writtenAt: string;
  readonly headline: string;
  readonly lines: readonly string[];
  readonly cycleOk: boolean | null;
  readonly testedSha: string | null;
}

export function buildBreakGlassIncident(input: {
  readonly at: string;
  readonly outcome: "ACCEPTED" | "REFUSED";
  readonly rejection: BreakGlassRejection | null;
  readonly sessionRef: string | null;
  readonly attemptsInWindowIncludingThis: number;
  readonly max: number;
  readonly windowSeconds: number;
}): BreakGlassIncident {
  const cls = input.outcome === "ACCEPTED" ? "ACCEPTED" : (input.rejection ?? "REFUSED");
  return {
    formatVersion: 1,
        // Random suffix: two attempts in one millisecond are two attempts, not one idempotent write.
    digestId: `break-glass:${input.at}:${randomBase64Url(6)}`,
    writtenAt: input.at,
    headline: `BREAK-GLASS SIGN-IN ${input.outcome}: ${cls}`,
    lines: [
      `class: ${cls}`,
      `outcome: ${input.outcome}`,
      `at: ${input.at}`,
      `route: POST /api/admin/session (${BREAK_GLASS_FLAG_VAR}=${BREAK_GLASS_ENABLED_VALUE})`,
      `session issued: ${input.sessionRef ?? "none"}`,
      `attempts in window: ${input.attemptsInWindowIncludingThis} of ${input.max} per ${input.windowSeconds}s`,
      "law: break-glass sign-in under owner-held secret custody",
    ],
    cycleOk: null,
    testedSha: null,
  };
}
