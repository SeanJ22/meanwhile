/**
 * **THE AUTHENTICATION, AND IT ADDS NO IDENTIFIER TO THIS PRODUCT.**
 * (Built 2026-08-23, the questionnaire-and-corpora brief, item 1.)
 *
 * ## What it proves, and what it deliberately does not
 *
 * A single-use expiring token is sent to the email **already on the candidate's
 * certified filing** — a public record we hold for 272 of 272 Morris County
 * candidates. Following the link proves control of that mailbox on that day.
 * **It proves nothing else and is designed to prove nothing else.**
 *
 * - **No account.** Nothing is created that persists past the deadline.
 * - **No password.** There is nothing to store, leak, reset or reuse.
 * - **No new identifier.** The token is keyed to a `candidacyId`, which is
 *   already public ballot data — a row in the county clerk's filing, not
 *   anything about a reader or a device.
 *
 * ## Why this cannot touch the collection stores, stated rather than assumed
 *
 * `CLAUDE.md`'s n-stores rule governs the SEARCH LOG, the REACTIONS store and
 * the future subscription store — the three things that are sold or that
 * describe readers. **A candidate's answers are none of those.** They are
 * published civic content that a public candidate wrote for publication, in the
 * same class as a roll-call vote or a filing, and they live in the CONTENT
 * store beside the ballot itself.
 *
 * So: nothing here writes a column onto `search_log` or `reactions`, nothing
 * here reads one, and no key defined in this module appears in either. That is
 * asserted by name in `tests/questionnaire.test.ts` rather than left to be
 * noticed.
 *
 * ## The token is never stored
 *
 * Only `sha256(token)` is kept, in the same shape the reaction continuity key
 * uses. A leaked database therefore does not hand anybody a working link, and
 * we cannot ourselves impersonate a candidate with what we hold.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** How long a link works. Generous — a candidate is not on our schedule. */
export const TOKEN_TTL_DAYS = 21;

/** Bytes of entropy in a token. 32 is 256 bits; guessing is not a route. */
const TOKEN_BYTES = 32;

export interface MintedToken {
  /** **Sent by email and never stored.** The only copy is in the candidate's inbox. */
  token: string;
  /** What we keep. */
  record: TokenRecord;
}

export interface TokenRecord {
  /** `sha256(token)`, hex. The stored form. */
  tokenDigest: string;
  /** The public ballot candidacy this link is for. */
  candidacyId: string;
  issuedAt: string;
  expiresAt: string;
  /** Set the first time the link is followed. Single-use. */
  usedAt: string | null;
}

/** The stored form of a token. Exported so the guard test can assert on it. */
export function digestToken(token: string): string {
  return createHash("sha256").update(`questionnaire-token:${token}`).digest("hex");
}

/**
 * Mint a link for one candidacy.
 *
 * `issuedAt` is passed in rather than read from a clock so the caller owns the
 * stamp — a date this product writes comes from `pnpm stamp` or from the code
 * path that performed the act, never from an incidental `Date.now()` inside a
 * helper (RULING 107).
 */
export function mintToken(input: { candidacyId: string; issuedAt: Date }): MintedToken {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expires = new Date(input.issuedAt.getTime() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return {
    token,
    record: {
      tokenDigest: digestToken(token),
      candidacyId: input.candidacyId,
      issuedAt: input.issuedAt.toISOString(),
      expiresAt: expires.toISOString(),
      usedAt: null,
    },
  };
}

export type TokenVerdict =
  | { ok: true; candidacyId: string }
  | { ok: false; reason: "UNKNOWN" | "EXPIRED" | "ALREADY_USED" };

/**
 * Check a presented token against a stored record.
 *
 * The digest comparison is constant-time. That matters less here than for a
 * password — the tokens are single-use and high-entropy — but a variable-time
 * compare on a secret is the kind of thing that is correct to do once and
 * never think about again.
 *
 * **The three failure reasons are kept apart** rather than collapsed into one
 * "invalid link", because they need different sentences in front of a
 * candidate: an expired link can be reissued, an already-used one means their
 * answers are already in, and an unknown one means they should tell us.
 */
export function verifyToken(input: {
  token: string;
  record: TokenRecord | null | undefined;
  now: Date;
}): TokenVerdict {
  if (!input.record) return { ok: false, reason: "UNKNOWN" };

  const presented = Buffer.from(digestToken(input.token), "hex");
  const stored = Buffer.from(input.record.tokenDigest, "hex");
  if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
    return { ok: false, reason: "UNKNOWN" };
  }

  if (input.record.usedAt !== null) return { ok: false, reason: "ALREADY_USED" };
  if (input.now.getTime() > Date.parse(input.record.expiresAt)) {
    return { ok: false, reason: "EXPIRED" };
  }
  return { ok: true, candidacyId: input.record.candidacyId };
}

/** Burn a token. Pure; the caller persists the result. */
export function markUsed(record: TokenRecord, usedAt: Date): TokenRecord {
  return { ...record, usedAt: usedAt.toISOString() };
}

/**
 * What a candidate is told when a link does not work. Plain language, level
 * register — this is a claim surface, not an interaction flourish.
 */
export function tokenRefusalLine(reason: Exclude<TokenVerdict, { ok: true }>["reason"]): string {
  switch (reason) {
    case "EXPIRED":
      return "This link has expired. Reply to the email we sent and we'll send you a new one.";
    case "ALREADY_USED":
      return "This link has already been used. If you want to change your answers, reply to the email we sent and we'll send you a new one.";
    case "UNKNOWN":
      return "We don't recognise this link. Reply to the email we sent and we'll send you a new one.";
  }
}
