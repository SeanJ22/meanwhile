import {
  readPromotedCivicDataPredecessors,
  type CivicDataReadResult,
  type ProvenCivicDataHistoryOptions,
} from "../civic-data/read-model.ts";
import { FEDERAL_ROLLCALL_SCOPE, federalMemberVotesScope } from "./data-plane.ts";
import type { FederalMemberVotesReadModel, FederalRollCallsReadModel } from "./data-plane.ts";
import { readFederalMemberVotes } from "./snapshot.ts";
import type { MemberVote, RollCallVote, VotePosition } from "./types.ts";
import type { BillSummariesFile, BillSummary } from "./bill-summaries.ts";

export interface HistoricalFederalVote extends RollCallVote {
  readonly position: VotePosition;
  readonly partyBreakdown: null;
  readonly billSummary: BillSummary | null;
  readonly billSummaryPending: boolean;
  /** The exact approved former projection, never the current recent window. */
  readonly historicalVersionId: string;
  readonly historicalSourceThrough: string | null;
  readonly historicalRetrievedAt: string | null;
}

export interface HistoricalFederalVotePage {
  readonly status: "COMPLETE" | "MORE" | "UNAVAILABLE";
  readonly votes: readonly HistoricalFederalVote[];
  readonly versionIds: readonly string[];
  readonly nextVersionId: string | null;
  readonly issue: string | null;
}

/** Reviewed summaries join an older roll call only by its exact official bill URL. */
export function reviewedHistoricalBill(
  billUrl: string | null,
  reviewed: BillSummariesFile,
): Pick<HistoricalFederalVote, "billSummary" | "billSummaryPending"> {
  return {
    billSummary: billUrl ? reviewed.summaries[billUrl] ?? null : null,
    billSummaryPending: Boolean(billUrl && reviewed.pending.some((row) => row.billUrl === billUrl)),
  };
}

type Window = Extract<CivicDataReadResult<FederalRollCallsReadModel>, { readonly kind: "PROMOTED" }>;
const WINDOW_CURSOR = "window:";

/** A separate, source-backed history answer: the member's own earlier records, then the national windows from before they had one. */
export async function readHistoricalFederalVotesForMember(
  member: string,
  window: Window,
  options: Pick<ProvenCivicDataHistoryOptions, "cursor" | "pageSize" | "bypassCache" | "voteBill"> = {},
): Promise<HistoricalFederalVotePage> {
  const own = await readFederalMemberVotes(member, { bypassCache: options.bypassCache });
  const recent = new Set(own.kind === "PROMOTED" || own.kind === "BOOTSTRAP" ? own.value.votes.map(vote => vote.id) : []);
  const reviewed = window.value.billSummaries, votes: HistoricalFederalVote[] = [], seen = new Set<string>();
  const add = (vote: RollCallVote, position: VotePosition | undefined, version: { projection: { versionId: string }; metadata: { sourceThrough: string | null; retrievedAt: string | null } }) => {
    if (!position || recent.has(vote.id) || seen.has(vote.id)) return;
    seen.add(vote.id);
    // Bill summaries are keyed by the exact official bill URL, so an older roll call keeps its reviewed explanation.
    votes.push({ ...vote, position, partyBreakdown: null, ...reviewedHistoricalBill(vote.billUrl, reviewed),
      historicalVersionId: version.projection.versionId, historicalSourceThrough: version.metadata.sourceThrough,
      historicalRetrievedAt: version.metadata.retrievedAt });
  };
  const page = (status: HistoricalFederalVotePage["status"], versionIds: string[], nextVersionId: string | null, issue: string | null): HistoricalFederalVotePage => {
    votes.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.rollNumber - a.rollNumber);
    return { status, votes, versionIds, nextVersionId, issue };
  };
  if (!options.cursor?.startsWith(WINDOW_CURSOR) && own.kind === "PROMOTED") {
    const chain = await readPromotedCivicDataPredecessors<FederalMemberVotesReadModel>("FEDERAL_ROLL_CALL", federalMemberVotesScope(member), own, options);
    for (const version of chain.versions) {
      const positions = new Map(version.value.positions.map(row => [row.voteId, row.position] as const));
      for (const vote of version.value.votes) add(vote, positions.get(vote.id), version);
    }
    const ids = chain.versions.map(version => version.projection.versionId);
    if (chain.issue) return page("UNAVAILABLE", ids, null, chain.issue);
    return page("MORE", ids, chain.complete ? WINDOW_CURSOR : chain.nextVersionId, null);
  }
  const cursor = options.cursor?.startsWith(WINDOW_CURSOR) ? options.cursor.slice(WINDOW_CURSOR.length) || null : null;
  const chain = await readPromotedCivicDataPredecessors("FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE, window, { ...options, cursor });
  for (const version of chain.versions) {
    // Windows published before members held their own records carry every member's positions.
    const held = (version.value.snapshot as { positions?: readonly MemberVote[] }).positions ?? [];
    const positions = new Map(held.filter(row => row.officeholderId === member).map(row => [row.voteId, row.position] as const));
    for (const vote of version.value.snapshot.votes) add(vote, positions.get(vote.id), version);
  }
  const ids = chain.versions.map(version => version.projection.versionId);
  return page(chain.issue ? "UNAVAILABLE" : chain.complete ? "COMPLETE" : "MORE", ids,
    chain.nextVersionId ? `${WINDOW_CURSOR}${chain.nextVersionId}` : null, chain.issue);
}
