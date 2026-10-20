import { canonicalCivicDataHash } from "../civic-data/changes.ts";
import { getStore } from "@netlify/blobs";
import { NetlifyEvidenceStore, netlifyEvidenceStoreFromEnv } from "../control-plane/evidence/netlify-store.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import type { PluralVoteFact } from "../sources/plural/votes.ts";
import { votePageDigest, votePageRollBody, votePagesIssue, VOTE_PAGE_MAX_BYTES, VOTE_PAGE_PERSON,
  type VoteMemberPage, type VotePageProjection } from "./vote-page-model.ts";

const stores = new WeakMap<RoutineDataStore, EvidenceStore>();

/** The ordinary injected store remains usable in source/reader integration tests. */
export function bindVotePageVault(store: RoutineDataStore, vault: EvidenceStore): void { stores.set(store, vault); }
export function votePageVault(store?: unknown): EvidenceStore {
  if (store && typeof store === "object" && stores.has(store as RoutineDataStore)) return stores.get(store as RoutineDataStore)!;
  // Source workers use the explicit shared vault. Hosted reader Functions use
  // the same site store through Netlify's automatically injected credentials.
  return netlifyEvidenceStoreFromEnv() ?? new NetlifyEvidenceStore(getStore({ name: process.env.WTP_VAULT_STORE ?? "meanwhile-evidence", consistency: "strong" }));
}
export async function readVoteMemberPage(vault: EvidenceStore, metadata: ReadonlyMap<string, PluralVoteFact>, page: VoteMemberPage): Promise<PluralVoteFact[]> {
  const object = await vault.get(page.key);
  if (!object || object.bytes.length > VOTE_PAGE_MAX_BYTES || votePageDigest(object.bytes) !== page.sha256) throw new Error("VOTE_PAGE_EVIDENCE_INVALID");
  const votes: PluralVoteFact[] = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(object.bytes));
  if (!Array.isArray(votes) || votes.length !== page.count) throw new Error("VOTE_PAGE_COUNT_INVALID");
  for (const vote of votes) {
    const roll = metadata.get(vote.id), position = vote.positions?.[0];
    if (!roll || vote.session !== page.session || vote.positions?.length !== 1 || position.personId !== page.personId || !position.option ||
        !Number.isFinite(Date.parse(position.retrievedAt)) || position.retrievedAt > vote.retrievedAt) throw new Error("VOTE_PAGE_PERSON_INVALID");
    const { positions: _positions, ...actual } = vote;
    if (canonicalCivicDataHash(actual) !== canonicalCivicDataHash(votePageRollBody(roll))) throw new Error("VOTE_PAGE_ROLL_MISMATCH");
  }
  return votes;
}

/** Only one person's immutable pages cross the object-store connection, four at a time. */
export async function readVotePages(vault: EvidenceStore, projection: VotePageProjection, personId: string): Promise<PluralVoteFact[]> {
  const issue = votePagesIssue(projection); if (issue) throw new Error(issue);
  if (!VOTE_PAGE_PERSON.test(personId)) return [];
  const metadata = new Map(projection.rollCalls.map(vote => [vote.id, vote]));
  const pages = projection.memberPages!.filter(page => page.personId === personId), groups: PluralVoteFact[][] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, pages.length) }, async () => {
    while (next < pages.length) { const at = next++; groups[at] = await readVoteMemberPage(vault, metadata, pages[at]); }
  }));
  const result: PluralVoteFact[] = [], seen = new Set<string>();
  for (const votes of groups) for (const vote of votes) {
    if (seen.has(vote.id)) throw new Error("VOTE_PAGE_PERSON_INVALID");
    seen.add(vote.id); result.push(vote);
  }
  return result;
}
