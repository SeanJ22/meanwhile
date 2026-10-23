import { createHash } from "node:crypto";
import type { PluralVoteFact } from "../sources/plural/votes.ts";

export interface VoteMemberPage { session: string; personId: string; key: string; sha256: string; count: number }
export interface VotePageProjection { formatVersion: 1 | 2; state: string; rollCalls: PluralVoteFact[]; memberPages?: VoteMemberPage[] }
export const votePageDigest = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export const VOTE_PAGE_PERSON = /^ocd-person\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const VOTE_PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const VOTE_PAGE_ROWS = 1024;
export function votePageRollBody(vote: PluralVoteFact) {
  const { positions: _positions, positionHash: _hash, positionCount: _count, firstPersonId: _first, ...body } = vote;
  return body;
}
export function votePagesIssue(projection: VotePageProjection): string | null {
  if (projection?.formatVersion !== 2 || !/^[A-Z]{2}$/.test(projection.state) || !Array.isArray(projection.rollCalls) || !Array.isArray(projection.memberPages)) return "VOTE_PAGE_INDEX_INVALID";
  const keys = new Set<string>(), totals = new Map<string, number>(), pages = new Map<string, number>();
  for (const vote of projection.rollCalls) {
    if (!vote || !Array.isArray(vote.positions) || vote.positions.length || !Number.isSafeInteger(vote.positionCount) || !vote.positionCount ||
        typeof vote.positionHash !== "string" || !/^[a-f0-9]{64}$/.test(vote.positionHash) || !VOTE_PAGE_PERSON.test(vote.firstPersonId ?? "")) return "VOTE_PAGE_ROLL_INVALID";
    totals.set(vote.session, (totals.get(vote.session) ?? 0) + vote.positionCount);
  }
  for (const page of projection.memberPages) {
    if (!page || !totals.has(page.session) || !VOTE_PAGE_PERSON.test(page.personId) || !/^[a-f0-9]{64}$/.test(page.sha256) ||
        !Number.isSafeInteger(page.count) || page.count <= 0 || page.count > VOTE_PAGE_ROWS || keys.has(page.key)) return "VOTE_PAGE_REFERENCE_INVALID";
    const expected = new RegExp(`^project/state-votes/[a-z0-9-]+/${projection.state}/${votePageDigest(page.session)}/${page.personId.slice(11)}/${page.sha256}\\.json$`);
    if (!expected.test(page.key)) return "VOTE_PAGE_REFERENCE_INVALID";
    keys.add(page.key); pages.set(page.session, (pages.get(page.session) ?? 0) + page.count);
  }
  for (const [session, total] of totals) if (pages.get(session) !== total) return "VOTE_PAGE_POSITION_TOTAL_INVALID";
  return null;
}
