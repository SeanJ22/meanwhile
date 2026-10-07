import {
  readPromotedCivicDataPredecessors,
  type CivicDataReadResult,
  type ProvenCivicDataHistory,
  type ProvenCivicDataHistoryOptions,
} from "../civic-data/read-model.ts";
import { FEDERAL_ROLLCALL_SCOPE } from "./data-plane.ts";
import type { FederalRollCallsReadModel } from "./data-plane.ts";
import type { RollCallVote, VotePosition } from "./types.ts";
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

/** Exhaust the same anchored pages for the reader proof census, never for a live member request. */
export async function readAllProvenFederalVoteHistoryForProof(
  current: Extract<CivicDataReadResult<FederalRollCallsReadModel>, { readonly kind: "PROMOTED" }>,
): Promise<readonly Extract<CivicDataReadResult<FederalRollCallsReadModel>, { readonly kind: "PROMOTED" }>[]> {
  const versions: Extract<CivicDataReadResult<FederalRollCallsReadModel>, { readonly kind: "PROMOTED" }>[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (;;) {
    const page: ProvenCivicDataHistory<FederalRollCallsReadModel> = await readPromotedCivicDataPredecessors("FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE,
      current, { cursor, pageSize: 16 });
    if (page.issue) throw new Error(`Federal vote history proof is unavailable: ${page.issue}`);
    versions.push(...page.versions);
    if (page.complete) return versions;
    if (!page.nextVersionId || cursors.has(page.nextVersionId)) {
      throw new Error("Federal vote history proof did not advance its anchored continuation.");
    }
    cursor = page.nextVersionId;
    cursors.add(cursor);
  }
}

/** A separate, source-backed history answer. It cannot alter the recent result. */
export async function readHistoricalFederalVotesForMember(
  member: string,
  current: Extract<CivicDataReadResult<FederalRollCallsReadModel>, { readonly kind: "PROMOTED" }>,
  options: Pick<ProvenCivicDataHistoryOptions, "cursor" | "pageSize" | "store" | "bypassCache"> = {},
): Promise<HistoricalFederalVotePage> {
  const chain = await readPromotedCivicDataPredecessors("FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE,
    current, options);
  const currentIds = new Set(current.value.snapshot.votes.map((vote) => vote.id));
  const reviewedSummaries = current.value.billSummaries;
  const votes: HistoricalFederalVote[] = [];
  const seen = new Set<string>();
  for (const version of chain.versions) {
    const model = version.value;
    if (model.formatVersion !== 1 || !Array.isArray(model.snapshot?.votes) ||
      !Array.isArray(model.snapshot?.positions)) {
      return { status: "UNAVAILABLE", votes, versionIds: chain.versions.map((row) => row.projection.versionId),
        nextVersionId: null, issue: `Historical projection ${version.projection.versionId} has an invalid vote shape.` };
    }
    const positions = new Map(model.snapshot.positions
      .filter((position) => position.officeholderId === member)
      .map((position) => [position.voteId, position.position] as const));
    for (const vote of model.snapshot.votes) {
      if (currentIds.has(vote.id) || seen.has(vote.id)) continue;
      const position = positions.get(vote.id);
      if (!position) continue;
      seen.add(vote.id);
      // Bill summaries are keyed by the exact official bill URL, so an older
      // roll call keeps its reviewed explanation after it leaves Recent.
      votes.push({ ...vote, position, partyBreakdown: null,
        ...reviewedHistoricalBill(vote.billUrl, reviewedSummaries),
        historicalVersionId: version.projection.versionId,
        historicalSourceThrough: version.metadata.sourceThrough,
        historicalRetrievedAt: version.metadata.retrievedAt });
    }
  }
  votes.sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.rollNumber - a.rollNumber);
  return { status: chain.issue ? "UNAVAILABLE" : chain.complete ? "COMPLETE" : "MORE",
    votes, versionIds: chain.versions.map((version) => version.projection.versionId),
    nextVersionId: chain.nextVersionId, issue: chain.issue };
}
