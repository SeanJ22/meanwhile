/**
 * **THE ADMIN HOST'S AUTHENTICATION, AND EVERY PLACE THE SECRET MAY NOT GO.**
 * (Session C final, ITEM H, 2026-09-01. Sign in with Google and the break-glass
 * law, RULING 245, 2026-09-02.)
 *
 * ## Two ways in, and only one of them is a login
 *
 * RULING 245: administrative access authenticates the OWNER'S IDENTITY through
 * Sign in with Google for exactly the enrolled address, verified server-side
 * (`lib/control-plane/admin-google.ts`). The shared secret this module was
 * first written around is no longer a login path. It survives ONLY as the
 * documented break-glass at the bottom of this file — a path that does not
 * exist unless the owner turns it on by name, that is rate-limited through the
 * durable control plane rather than through a per-instance counter, and that
 * writes an incident record for every attempt it accepts or refuses.
 *
 * The session cookie is the same for both ways in. Which one issued it is
 * carried in the session (`via`) so a decision made under a break-glass session
 * is distinguishable from one made under the owner's Google identity.
 *
 * ## The threat this is actually defending against
 *
 * The admin host (`ADMIN_ORIGIN`) is a domain alias on the SAME Netlify site that
 * serves readers. There is one deploy, one function bundle, one set of
 * environment variables. So the separation between the owner's control centre
 * and the public product is not infrastructural — it is entirely this file and
 * `middleware.ts`. That is worth stating plainly, because it means a mistake
 * here does not degrade a private thing; it publishes it.
 *
 * ## Where the secret may NEVER go, enumerated rather than implied
 *
 * ```
 *   NOT in a URL          — query strings are logged by every hop, and the
 *                           constitution forbids personal or sensitive data in
 *                           query strings outright
 *   NOT in the client bundle — `next.config.ts` `env` INLINES values at build
 *                           time and anything inlined is readable by anyone who
 *                           can read the bundle. Admin secrets are RUNTIME
 *                           `process.env` reads in server code, never `env:`
 *                           entries and never `NEXT_PUBLIC_*`
 *   NOT in localStorage   — readable by any script that reaches the page
 *   NOT in rendered HTML  — including a hidden input, a data attribute, or a
 *                           server-component prop that gets serialised into the
 *                           RSC payload
 *   NOT in telemetry or logs — {@link redactSecrets} exists for the case where
 *                           somebody logs an error object that contains one
 * ```
 *
 * The cookie carries a SESSION, not the secret. The session is a signed
 * assertion that somebody proved knowledge of the secret at a point in time; it
 * is useless for learning the secret and it expires.
 *
 * ## Why Web Crypto rather than `node:crypto`
 *
 * `middleware.ts` runs on the Edge runtime, which has no `node:crypto`. Signing
 * in a route handler with one implementation and verifying in middleware with
 * another is two implementations of one comparison (RULING 103), and the way
 * that fails is the worst kind: it works in development, where both happen to
 * run in Node. `crypto.subtle` exists in both, so there is one implementation.
 */

/** The owner's shared secret. RUNTIME read, server-side only. NEVER inlined. */
export const ADMIN_SECRET_VAR = "WTP_ADMIN_SECRET";

/**
 * The key that SIGNS session cookies — deliberately a second variable.
 *
 * If the session key were derived from the admin secret, rotating the secret
 * would silently invalidate every session, and worse, a signature would be an
 * oracle for testing guesses at the secret. Two independent values means
 * compromising one does not hand over the other.
 */
export const ADMIN_SESSION_KEY_VAR = "WTP_ADMIN_SESSION_KEY";

/** The cookie name. Prefixed `__Host-` so the browser enforces the rest. */
export const ADMIN_SESSION_COOKIE = "__Host-wtp-admin";

/**
 * How long a session lasts.
 *
 * Bounded because an unbounded admin session is a permanent credential sitting
 * in a browser profile. Eight hours is one working day: long enough that the
 * owner is not retyping a secret all afternoon, short enough that a laptop left
 * open overnight is not still authenticated in the morning.
 */
export const SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

/** The minimum secret length that will be accepted at all. */
export const MIN_SECRET_LENGTH = 24;

/* ------------------------------------------------------------------ *
 * ENCODING
 * ------------------------------------------------------------------ */

const encoder = new TextEncoder();

/**
 * Exported because `admin-google.ts` decodes JWT segments with it. One
 * implementation of one encoding (RULING 103); a second copy in the Google
 * module would be the duplicate the sweep exists to catch.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode into a view backed by a REAL `ArrayBuffer`.
 *
 * `new Uint8Array(length)` types as `Uint8Array<ArrayBufferLike>`, and
 * `ArrayBufferLike` includes `SharedArrayBuffer`, which is not a `BufferSource`.
 * `crypto.subtle.verify` therefore refuses it at the type level — a real error
 * rather than a pedantic one, since a shared buffer can be mutated by another
 * thread between the signature check and the read of what was checked.
 * Allocating the buffer explicitly narrows the type and removes the hazard.
 */
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

/* ------------------------------------------------------------------ *
 * CONSTANT-TIME COMPARISON
 * ------------------------------------------------------------------ */

/**
 * Compare two strings without leaking WHERE they differ through timing.
 *
 * `a === b` returns as soon as it finds a differing byte, so the time it takes
 * is a function of how many leading bytes matched — which is enough to
 * reconstruct a secret one character at a time given enough requests. This
 * always walks the whole length.
 *
 * Length is folded into the result rather than short-circuited on, for the same
 * reason: an early return on length difference leaks the length.
 */
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

/* ------------------------------------------------------------------ *
 * THE SESSION ID, AND WHY IT MAY NOT SHARE A MINTER WITH A READER KEY
 * ------------------------------------------------------------------ */

/**
 * **The admin session id lives in a DISJOINT VALUE SPACE from every reader
 * identifier, and that is enforced by shape rather than by intention.**
 *
 * The first version of this was `new Uint8Array(16)` → `getRandomValues` → hex,
 * which is a perfectly good identifier and was ALSO byte-for-byte identical to
 * `mintBrowserKey` in `lib/state/browser-key.ts` — the minter for the reader's
 * own local key. `tests/duplicate-implementations.test.ts` caught it, and the
 * guard was right for a bigger reason than duplication:
 *
 * **The collection stores never join, and RULING 132 proves that over VALUE
 * SPACES rather than over column names.** Two identifier generators producing
 * the same 32-hex-character space put an admin session id and a reader browser
 * key into one space where a value from either could be mistaken for — or
 * matched against — a value from the other. Nothing would have to intend it.
 *
 * So this is deliberately not that:
 *
 * ```
 *   reader browser key   32 chars, [0-9a-f] only
 *   admin session id     "adm_" + 32 chars of base64url
 * ```
 *
 * The `adm_` prefix alone makes the spaces provably disjoint, because `m` and
 * `_` are not hexadecimal digits — no reader key can ever begin `adm_`, and no
 * admin session id can ever fail to. `tests/admin-control-centre.test.ts`
 * asserts that, so the separation is checked rather than remembered.
 */
export const ADMIN_SESSION_ID_PREFIX = "adm_";

export function mintAdminSessionId(): string {
  return `${ADMIN_SESSION_ID_PREFIX}${randomBase64Url(24)}`;
}

/* ------------------------------------------------------------------ *
 * THE HOST CHECK — ONE IMPLEMENTATION, TWO ROUTES
 * ------------------------------------------------------------------ */

/**
 * Is this request on the admin host?
 *
 * Both admin API routes need this and both had their own copy, which is the
 * shape of RULING 103's whole complaint: one comparison, two implementations,
 * and the day they disagree is the day one route is reachable from the public
 * host and the other is not. Nobody would notice until it mattered.
 *
 * `x-forwarded-host` is what Netlify's edge sets and carries the alias the
 * caller actually typed; `host` is the fallback. The FIRST value of a
 * comma-joined list is the one the edge itself wrote — a second value is either
 * a proxy chain or an attempt to smuggle a host past this check.
 */
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

/* ------------------------------------------------------------------ *
 * SESSION SIGNING
 * ------------------------------------------------------------------ */

/**
 * How a session was issued. Carried in the cookie so a durable record that
 * references the session (a decision intent, a break-glass incident) can say
 * whether the owner proved an IDENTITY or knowledge of a SECRET.
 */
export type SessionIssuer = "google" | "break-glass";

export interface AdminSession {
  /** An opaque id for this session. Used to reference decisions in the audit. */
  readonly sid: string;
  /** Issued-at, epoch seconds. */
  readonly iat: number;
  /** Expires-at, epoch seconds. Bounded by {@link SESSION_LIFETIME_SECONDS}. */
  readonly exp: number;
  /** Absent on a session issued before RULING 245; read as unknown, never as Google. */
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

/* ------------------------------------------------------------------ *
 * THE SIGNED ENVELOPE — one primitive under both cookies
 * ------------------------------------------------------------------ */

/**
 * Sign any JSON payload into `<base64url payload>.<base64url HMAC>`.
 *
 * The session cookie and the OAuth state cookie are both this. Two envelope
 * formats would be two verifiers, and the one that drifted would be the one
 * nobody tested in middleware.
 */
export async function signEnvelope(payload: unknown, key: string): Promise<string> {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(key), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export type EnvelopeVerdict =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly rejection: "MALFORMED" | "BAD_SIGNATURE" };

/**
 * Open an envelope.
 *
 * **Signature first, contents second.** Parsing an unverified payload and then
 * checking the signature means the parser runs on attacker-controlled bytes;
 * checking first means a forged value never reaches `JSON.parse` at all.
 */
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

/** Sign a session into a cookie value. The value contains no secret. */
export async function signSession(session: AdminSession, sessionKey: string): Promise<string> {
  return signEnvelope(session, sessionKey);
}

/**
 * Why a cookie was not accepted. Named states, because "invalid" covers a
 * forged signature and an ordinary expiry, and those want different responses.
 */
export type SessionRejection =
  | "NO_COOKIE"
  | "MALFORMED"
  | "BAD_SIGNATURE"
  | "EXPIRED"
  | "NOT_CONFIGURED";

export type SessionVerdict =
  | { readonly ok: true; readonly session: AdminSession }
  | { readonly ok: false; readonly rejection: SessionRejection };

/**
 * **WHAT A REFUSED SIGN-IN SAYS TO THE OWNER, AND WHAT HE CAN DO ABOUT IT.**
 * (ADM-49, the 9.7.26 admin feedback. Critical.)
 *
 * ## The defect this exists to close
 *
 * The owner typed an answer on a decision card, clicked *Record my answer*, and
 * read: *"Not recorded. The server answered 401. Nothing was written, so the row
 * is still waiting on you."* He read the red dot as **"Not approved"** and could
 * not understand how the console had decided that. Three sessions of "nothing
 * happens" (ADM-4, ADM-16, ADM-32) were this.
 *
 * The machine was not confused. `verifySession` had already named the reason —
 * one of five — and both 401 sites already carried it. **The console threw it
 * away and printed the HTTP status instead.** A number between 400 and 499 is
 * not a sentence the owner can act on, and "401" in particular reads to a
 * non-engineer as a verdict about the DECISION rather than about the session.
 *
 * ## Why a `Record` over the union rather than an entry in `PLAIN_WORDS`
 *
 * `plain-words.ts` is the console's one translation layer and this is
 * deliberately not a second one: it maps ARBITRARY machine constants to a label,
 * keyed by a bare string, and `NOT_CONFIGURED` is ALREADY a key there meaning a
 * health contract that was never set up. Two domains, one key, different
 * sentences — a flat dictionary cannot hold both, and the one it would answer
 * with is whichever was written last. So the closed union owns its own
 * exhaustive map, here, beside the type it is total over. `Record<SessionRejection, …>`
 * makes a new rejection class a COMPILE error rather than a missing sentence.
 *
 * ## The distinction that matters most
 *
 * Four of these five are fixed by signing in again. **`NOT_CONFIGURED` is not.**
 * It means this deployment has no signing key, so it cannot check anybody — and
 * telling the owner to sign in again would loop him forever through a door that
 * cannot open. `fixedBySigningIn` carries that difference so a surface can offer
 * the right control instead of guessing, and so the console never sends him to
 * do something that cannot work.
 *
 * Nothing here names a variable, a header or a cookie. The owner gets the fact
 * and the action; the class travels separately for the log.
 */
export interface RejectionWords {
  /** What happened, in the owner's words. One sentence, no jargon. */
  readonly says: string;
  /** What he can do about it. One sentence. */
  readonly whatToDo: string;
  /** False when signing in again cannot fix it — this is a deployment fault. */
  readonly fixedBySigningIn: boolean;
}

export const SESSION_REJECTION_WORDS: Readonly<Record<SessionRejection, RejectionWords>> = {
  /*
   * Also the class an ordinary time-out arrives as. The cookie's `Max-Age` is
   * set from the same `SESSION_LIFETIME_SECONDS` as its `exp`, so the browser
   * drops it at the moment it would have expired and the server never sees an
   * EXPIRED cookie from a session that simply aged out — it sees no cookie at
   * all. The sentence therefore has to cover both without guessing which.
   */
  NO_COOKIE: {
    says: "You are not signed in on this tab — either the sign-in ran out, or this browser is not carrying it.",
    whatToDo: "Sign in again, then use the button once more. Nothing you typed has been lost.",
    fixedBySigningIn: true,
  },
  EXPIRED: {
    says: "Your sign-in has run out. A sign-in lasts eight hours.",
    whatToDo: "Sign in again, then use the button once more. Nothing you typed has been lost.",
    fixedBySigningIn: true,
  },
  MALFORMED: {
    says: "The sign-in this tab is carrying could not be read.",
    whatToDo: "Sign in again. If it happens twice, say so — a sign-in should never arrive unreadable.",
    fixedBySigningIn: true,
  },
  BAD_SIGNATURE: {
    says: "The sign-in this tab is carrying was not issued by this console.",
    whatToDo:
      "Sign in again. If it happens twice, say so — it means the signing key changed underneath a live session.",
    fixedBySigningIn: true,
  },
  /*
   * The one that must never be dressed up as an expiry. Signing in again cannot
   * help, because the console has nothing to check a sign-in against.
   */
  NOT_CONFIGURED: {
    says: "This console has no signing key, so it cannot check anybody's sign-in — including yours.",
    whatToDo:
      "Signing in again will not fix this one; the deployment is missing a setting. Nothing was written, and nothing you typed has been lost.",
    fixedBySigningIn: false,
  },
};

/** The owner-facing sentence for a refused session. Total over the union. */
export function rejectionWords(rejection: SessionRejection): RejectionWords {
  return SESSION_REJECTION_WORDS[rejection];
}

/** Verify a session cookie value. */
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
  // A cookie whose lifetime exceeds the policy was not issued under this
  // policy. Trusting its own `exp` would let a once-issued long session
  // outlive a tightening of the rule.
  if (session.exp - session.iat > SESSION_LIFETIME_SECONDS) {
    return { ok: false, rejection: "MALFORMED" };
  }
  return { ok: true, session };
}

/* ------------------------------------------------------------------ *
 * THE LOGIN COMPARISON
 * ------------------------------------------------------------------ */

export type LoginVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "NOT_CONFIGURED" | "WEAK_SECRET" | "REFUSED" };

/**
 * Compare a submitted secret against the configured one.
 *
 * **`NOT_CONFIGURED` is not a pass.** A missing environment variable is the
 * single most likely way an admin surface ends up open: the check reads
 * `undefined`, the submitted value is also falsy in some comparison, and the
 * door opens. So absence is an explicit refusal with its own name, and the
 * short-secret case is refused too — a two-character `WTP_ADMIN_SECRET` set
 * during a hurried deploy is worse than none, because it looks configured.
 */
export function checkLogin(
  submitted: string | undefined | null,
  configured: string | undefined | null,
): LoginVerdict {
  if (!configured || configured.trim() === "") return { ok: false, reason: "NOT_CONFIGURED" };
  if (configured.length < MIN_SECRET_LENGTH) return { ok: false, reason: "WEAK_SECRET" };
  if (!submitted) return { ok: false, reason: "REFUSED" };
  return timingSafeEqual(submitted, configured) ? { ok: true } : { ok: false, reason: "REFUSED" };
}

/* ------------------------------------------------------------------ *
 * ORIGIN / CSRF FOR STATE-CHANGING REQUESTS
 * ------------------------------------------------------------------ */

/**
 * Is this state-changing request coming from the admin surface itself?
 *
 * `SameSite=Strict` already stops a cross-site form post from carrying the
 * cookie, which is most of the defence. This is the second layer, and it exists
 * because SameSite is enforced by the BROWSER: a client that does not implement
 * it, or a request that never went through one, is not covered. Checking the
 * `Origin` header server-side does not depend on the caller's good behaviour.
 *
 * A MISSING Origin is refused rather than allowed. Some legitimate clients omit
 * it, and that is precisely the point — a state-changing admin request should
 * come from the admin page in a browser, and nothing else needs to work.
 */
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

/* ------------------------------------------------------------------ *
 * REDACTION
 * ------------------------------------------------------------------ */

/**
 * Remove any configured secret from a string before it is logged or rendered.
 *
 * The realistic leak is not somebody printing the secret on purpose. It is an
 * error object, a stack frame, or a serialised config blob that happens to
 * contain it reaching a log aggregator. This is the last line, and it is cheap.
 */
export function redactSecrets(text: string, secrets: readonly (string | undefined | null)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 8) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  return out;
}

/**
 * The `Set-Cookie` attributes, in one place so no caller can forget one.
 *
 * `__Host-` is not decoration: the prefix makes the BROWSER refuse the cookie
 * unless it is Secure, has Path=/, and has NO Domain attribute. That last one
 * is the important one here — a cookie scoped to the PARENT domain would be
 * sent to the PUBLIC host too, which would put an admin session credential on
 * every reader request. The prefix makes that configuration impossible rather
 * than merely discouraged.
 */
export function sessionCookieAttributes(maxAgeSeconds: number): string {
  return [
    `Path=/`,
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

/* ------------------------------------------------------------------ *
 * THE BREAK-GLASS — RULING 245's one permitted use of the shared secret,
 * held under RULING 238 custody
 * ------------------------------------------------------------------ */

/**
 * ## What the break-glass is, and what it is not
 *
 * RULING 245: "Shared secrets are not a login path except as a documented,
 * rate-limited, incident-logged break-glass held by the owner under RULING
 * 238." Each of those four words is a mechanism here, not an adjective:
 *
 * ```
 *   DOCUMENTED       docs/admin-sign-in.md — how it is enabled, and that
 *                    enabling it is itself visible in the incident log
 *   HELD BY THE OWNER  RULING 238: the secret is a value the OWNER holds a copy
 *                    of. The first WTP_ADMIN_SECRET was generated by a session
 *                    and installed masked, with no owner copy — the owner could
 *                    not log in to his own control centre. That is the custody
 *                    violation this section is written after
 *   RATE-LIMITED     through the DURABLE control plane. A per-instance counter
 *                    in a serverless function is not a rate limit: instances
 *                    come and go per request and each one starts at zero. The
 *                    count is read from the append-only incident log itself
 *   INCIDENT-LOGGED  every attempt the path accepts or refuses appends a record
 *                    naming the class, the moment and the outcome. Never the
 *                    value, never its length, never a prefix
 * ```
 *
 * ## The path does not exist unless the owner turns it on
 *
 * `WTP_ADMIN_BREAK_GLASS` must equal `enabled`, exactly. Absent, empty, `true`,
 * `1`, `Enabled` — all mean the route answers 404, which is the same answer the
 * public host gives, so a prober cannot tell a disabled break-glass from a path
 * that was never there. A flag that has to be typed as a specific word is a
 * decision; a flag that any truthy value opens is an accident waiting for a
 * copy-paste.
 *
 * ## Why an unloggable attempt is a refused attempt
 *
 * The incident record is appended BEFORE a session is issued, and a failed
 * append refuses the login even when the secret was right. A break-glass that
 * can be used without leaving a record is not the break-glass the ruling
 * permits; it is the old login path with a new name.
 *
 * ## The rate limit's own denial-of-service surface, stated
 *
 * When the flag is on, every POST reads one indexed log partition and appends
 * at most one row — bounded work, but work, on an unauthenticated path. That
 * is accepted because the flag is OFF by default and is meant to be on for the
 * length of an incident. Beyond the ceiling the path refuses WITHOUT
 * appending: the N records already in the window are the evidence of a flood,
 * and a log that grew by one row per refused request would be the flood's
 * amplifier.
 */
export const BREAK_GLASS_FLAG_VAR = "WTP_ADMIN_BREAK_GLASS";
export const BREAK_GLASS_ENABLED_VALUE = "enabled";

/** The append-only log partition the incident records live under. */
export const BREAK_GLASS_LOG_KEY = "admin-break-glass";

/** Attempts permitted per window, counted from the durable log. */
export const BREAK_GLASS_MAX_ATTEMPTS_PER_WINDOW = 5;
export const BREAK_GLASS_WINDOW_SECONDS = 15 * 60;

export function isBreakGlassEnabled(env: { readonly [name: string]: string | undefined }): boolean {
  return env[BREAK_GLASS_FLAG_VAR] === BREAK_GLASS_ENABLED_VALUE;
}

/** Why a break-glass attempt was refused, beyond the login verdict's own reasons. */
export type BreakGlassRejection =
  | "RATE_LIMITED"
  | "INCIDENT_LOG_UNAVAILABLE"
  | "NOT_CONFIGURED"
  | "WEAK_SECRET"
  | "REFUSED";

export interface BreakGlassWindowVerdict {
  readonly allowed: boolean;
  /** Attempts already recorded inside the window, BEFORE this one. */
  readonly attemptsInWindow: number;
  readonly max: number;
  readonly windowSeconds: number;
}

/**
 * Count the attempts already recorded in the window and decide whether one
 * more may proceed.
 *
 * A record whose `writtenAt` does not parse is counted AGAINST the caller: a
 * log entry we cannot date is not evidence that the window is quiet.
 */
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

/**
 * The incident record, shaped as an owner digest so it lives in the existing
 * append-only owner log under its own key. Nothing here is a value anyone
 * typed: the class, the moment, the outcome, the session it issued (an opaque
 * id) and the window arithmetic.
 */
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
  /** The opaque session id issued, or null when nothing was issued. */
  readonly sessionRef: string | null;
  readonly attemptsInWindowIncludingThis: number;
  readonly max: number;
  readonly windowSeconds: number;
}): BreakGlassIncident {
  const cls = input.outcome === "ACCEPTED" ? "ACCEPTED" : (input.rejection ?? "REFUSED");
  return {
    formatVersion: 1,
    // Random suffix rather than the moment alone: two attempts in one
    // millisecond are two attempts, and an id derived from time alone would
    // make the second an idempotent no-op of the first.
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
      "law: RULING 245 break-glass under RULING 238 custody",
    ],
    cycleOk: null,
    testedSha: null,
  };
}
