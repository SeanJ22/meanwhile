/**
 * Access controls are never bypassed. Robots.txt is evidence, not a block
 * (`lib/control-plane/scheduler/robots.ts`); these answers do stop a read,
 * named once so every fetcher judges them alike:
 *
 * ```
 *   401 / 407   authentication required   — no credential is ever sent
 *   402         payment required (paywall)
 *   403         forbidden, often a WAF or a bot challenge
 *   429         rate limited              — honoured: the host is backed off
 *   451         unavailable for legal reasons
 *   any status  a bot challenge page (Cloudflare, Imperva, PerimeterX …)
 * ```
 *
 * An access control is a technical failure of this route, recorded as a wall
 * and pursued by other public routes. No credential, cookie or token is sent
 * to get past it, no challenge is solved, and a rate limit is not pushed
 * through. Pure.
 */

import { challengeIn } from "../sources/challenge-signatures.ts";

export type AccessControlKind = "AUTHENTICATION" | "PAYMENT" | "FORBIDDEN" | "RATE_LIMIT" | "LEGAL" | "CHALLENGE";

export interface AccessControl {
  readonly kind: AccessControlKind;
  readonly status: number | null;
  readonly detail: string;
}

/** Statuses that are an access control on the page, never a fact about the record. */
export const ACCESS_CONTROL_STATUSES: Readonly<Record<number, AccessControlKind>> = {
  401: "AUTHENTICATION",
  402: "PAYMENT",
  403: "FORBIDDEN",
  407: "AUTHENTICATION",
  429: "RATE_LIMIT",
  451: "LEGAL",
};

/** How long a host that answered 429 is left alone before anything else is asked of it. */
export const RATE_LIMIT_BACKOFF_MS = 60_000;

/** Request headers no fetcher may send: a credential or a session is how an access control is bypassed. */
export const FORBIDDEN_REQUEST_HEADERS: readonly string[] = ["authorization", "cookie", "proxy-authorization"];

/**
 * A script-only page that sends the browser back with a signed token: a tiny
 * 200 page whose only content is `window.location.replace(...)` carrying a
 * session token. Following it means returning the session cookie and token,
 * which is a bypass, so it is a wall. Only pages that are nothing but the
 * redirect match.
 */
export const TOKEN_REDIRECT_CHALLENGE = {
  name: "JavaScript token redirect",
  test: /location\.(?:replace\(|assign\(|href\s*=)\s*['"][^'"]*[?&]js=[\w-]+\.[\w-]+\.[\w-]+/i,
  maxBytes: 4_000,
} as const;

function tokenRedirectIn(text: string): string | null {
  return text.length <= TOKEN_REDIRECT_CHALLENGE.maxBytes && TOKEN_REDIRECT_CHALLENGE.test.test(text) ? TOKEN_REDIRECT_CHALLENGE.name : null;
}

/**
 * The access control this answer puts in front of the page, or null when it is
 * not one. A challenge page is recognised at any status, 200 included.
 */
export function accessControlIn(answer: { readonly status: number | null; readonly text?: string | null }): AccessControl | null {
  const text = answer.text ?? "";
  const challenge = text === "" ? null : (challengeIn(text) ?? tokenRedirectIn(text));
  if (challenge !== null) {
    return {
      kind: "CHALLENGE",
      status: answer.status,
      detail: `a bot challenge (${challenge}) answered in place of the page${answer.status === null ? "" : ` with HTTP ${answer.status}`}; a challenge is an access control and is never solved or evaded`,
    };
  }
  if (answer.status === null) return null;
  const kind = ACCESS_CONTROL_STATUSES[answer.status];
  if (kind === undefined) return null;
  const why: Record<AccessControlKind, string> = {
    AUTHENTICATION: "authentication is required; no credential is ever sent",
    PAYMENT: "payment is required; a paywall is never bypassed",
    FORBIDDEN: "the host forbids this client; a wall to investigate by another public route, never to defeat",
    RATE_LIMIT: "the host is rate limiting; it is backed off, never pushed through",
    LEGAL: "unavailable for legal reasons",
    CHALLENGE: "a bot challenge",
  };
  return { kind, status: answer.status, detail: `HTTP ${answer.status}: ${why[kind]}` };
}

/** True when a request's headers carry a credential or a session. Every fetcher's requests must answer false. */
export function carriesCredential(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some((name) => FORBIDDEN_REQUEST_HEADERS.includes(name.toLowerCase()));
}
