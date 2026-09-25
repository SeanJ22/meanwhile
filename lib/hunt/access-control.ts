/**
 * **ACCESS CONTROLS ARE NEVER BYPASSED.** (2026-09-25, beside the owner decision
 * that robots.txt alone must not block acquisition.)
 *
 * Sean's decision of 2026-09-25 authorizes automated reading of publicly
 * accessible pages even when robots.txt asks otherwise, and says in the same
 * breath that it "does not extend to bypassing authentication or other access
 * controls". Robots.txt is now evidence (`lib/control-plane/scheduler/robots.ts`,
 * `ROBOTS_BLOCKS_ACQUISITION = false`). This module is the other half: the
 * answers that DO stop a read, named once so every fetcher judges them alike.
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
 * An access control is a TECHNICAL FAILURE of this route, recorded as a wall
 * and investigated by other public routes (another official host, a feed, an
 * API, an archive). It is never something to defeat: no credential, cookie or
 * token is sent to get past it, no challenge is solved, and the same request is
 * not re-sent to push through a rate limit. `tests/robots-recorded-not-blocking.test.ts`
 * holds the research fetch, the adapter permission gate, the scout tools and the
 * discovery walk to it.
 *
 * PURE: no network, no state.
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
 * The access control this answer puts in front of the page, or null when it is
 * not one. A challenge page is recognised at any status, 200 included.
 */
export function accessControlIn(answer: { readonly status: number | null; readonly text?: string | null }): AccessControl | null {
  const text = answer.text ?? "";
  const challenge = text === "" ? null : challengeIn(text);
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
