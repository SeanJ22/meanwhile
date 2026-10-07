/**
 * Candidate questionnaire authentication. A single-use expiring token is sent to the email on the
 * candidate's certified filing; following the link proves control of that mailbox and nothing else.
 * No account, no password, and no new identifier: the token is keyed to a public `candidacyId`.
 *
 * Nothing here reads or writes the search log or reactions store. Only `sha256(token)` is kept.
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

/** Mint a link for one candidacy. `issuedAt` is passed in so the caller owns the stamp. */
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
 * Check a presented token against a stored record. The digest comparison is constant-time. The three
 * failure reasons stay apart because each needs a different sentence for the candidate.
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

/** What a candidate is told when a link does not work. */
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
