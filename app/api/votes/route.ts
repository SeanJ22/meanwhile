import type { VotesSnapshot } from "@/lib/votes/types";
import { getVotesSnapshot, readFederalRollCallsProjection } from "@/lib/votes/snapshot";
import { partyBreakdownFor } from "@/lib/votes/party-breakdown";
import { pickedKeyVotesFor } from "@/lib/votes/key-vote-picks";
import { readKeyVotePicks } from "@/lib/votes/key-vote-picks-read";
import { KEY_VOTES_CRITERIA } from "@/lib/votes/key-votes";
import { officialStateVoteScopeForOfficeholderId } from "@/lib/state-rollcalls/authority";
import { summaryForBill, summaryPendingForBill } from "@/lib/votes/bill-summaries";
import { readHistoricalFederalVotesForMember } from "@/lib/votes/history";
import { readNativeMemberVotes } from "@/lib/state-rollcalls/reader-votes";
import { researchFixtureScopeForMember, settleFederalVoteSupportingHoldings, settleStateVoteMemberHolding, stateVotes } from "./holdings";
import { stateVoteStateForMember } from "@/lib/state-rollcalls/reader-vote-visibility";

/**
 * GET /api/votes?member=congress:<bioguide> — a federal member
 * GET /api/votes?member=<official-source>:<person-id> — a state legislator
 *
 * A member's recent recorded votes, newest first, from proof-validated canonical projections, never a
 * runtime fallback or a live fetch. Legacy state rows carry LegiScan's required CC BY attribution.
 */

export const runtime = "nodejs";

const FEDERAL_ID = /^congress:[A-Z]\d{6}$/;

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const member = query.get("member");
  const historical = query.get("history") === "1";
  if (member && stateVoteStateForMember(member, query.get("state") ?? undefined)) {
    try {
      const read = await readNativeMemberVotes(member, undefined, { state: query.get("state") ?? undefined });
      if (read) {
        if (historical) return Response.json({ member, historyStatus: "UNAVAILABLE", historicalVotes: [], historicalCount: 0,
          nextHistoricalVersionId: null, historyIssue: "These acquired state votes already retain their available history." });
        return Response.json({ ...read, holdingStatus: read.status === "HOLDING_UNAVAILABLE" ? "HOLDING_UNAVAILABLE"
          : read.status === "IDENTITY_UNRESOLVED" ? "IDENTITY_UNRESOLVED" : "HELD",
          count: read.votes.length }, { status: read.status === "HOLDING_UNAVAILABLE" ? 503 : 200 });
      }
    } catch { return Response.json({ member, holdingStatus: "HOLDING_UNAVAILABLE", generatedAt: null, votes: [] }, { status: 503 }); }
  }
  const officialStateScope = member ? officialStateVoteScopeForOfficeholderId(member) : null;
  const researchStateScope = member ? researchFixtureScopeForMember(member) : null;
  const stateScope = officialStateScope ?? researchStateScope;
  if (!member || (!FEDERAL_ID.test(member) && stateScope === null)) {
    return Response.json(
      { error: "member must be a congress:<bioguide> or source-namespaced official state person id" },
      { status: 400 },
    );
  }

  if (stateScope !== null) {
    if (historical) return Response.json({ member, historyStatus: "UNAVAILABLE",
      historicalVotes: [], historicalCount: 0, nextHistoricalVersionId: null,
      historyIssue: "Earlier state vote history is not available through this federal history reader." });
    const holding = await settleStateVoteMemberHolding(member, stateScope);
    if (holding.kind === "HOLDING_UNAVAILABLE") {
      return Response.json({ generatedAt: null, member, holdingStatus: "HOLDING_UNAVAILABLE", votes: [] }, { status: 503 });
    }
    if (holding.kind === "HELD_NO_RECORD") {
      return Response.json({
        member,
        holdingStatus: "HELD",
        count: 0,
        generatedAt: holding.generatedAt,
        authorityScopesChecked: holding.scopesChecked,
        attribution: null,
        votes: [],
      });
    }
    return stateVotes(member, holding.holding, holding.unavailableScopes);
  }

  let snap: VotesSnapshot;
  let federalRead: Awaited<ReturnType<typeof readFederalRollCallsProjection>>;
  try {
    federalRead = await readFederalRollCallsProjection();
    if (federalRead.kind !== "PROMOTED" && federalRead.kind !== "BOOTSTRAP") throw new Error(federalRead.detail);
    snap = getVotesSnapshot();
  } catch {
    return Response.json({ generatedAt: null, member, holdingStatus: "HOLDING_UNAVAILABLE", votes: [] }, { status: 503 });
  }

  if (historical) {
    if (federalRead.kind !== "PROMOTED") return Response.json({ member, historyStatus: "UNAVAILABLE",
      historicalVotes: [], historicalCount: 0, nextHistoricalVersionId: null,
      historyIssue: "No durable promoted history is available for this current vote window." });
    const anchor = query.get("anchor");
    if (anchor && anchor !== federalRead.projection.versionId) return Response.json({
      member, historyStatus: "UNAVAILABLE", historicalVotes: [], historicalCount: 0,
      nextHistoricalVersionId: null, historyIssue: "The current vote window changed; reload earlier records.",
      currentVersionId: federalRead.projection.versionId,
    }, { status: 409 });
    const page = await readHistoricalFederalVotesForMember(member, federalRead,
      { cursor: query.get("cursor"), pageSize: 4 });
    return Response.json({ member, historyStatus: page.status,
      historicalVotes: page.votes, historicalCount: page.votes.length,
      historicalVersionIds: page.versionIds, nextHistoricalVersionId: page.nextVersionId,
      historyIssue: page.issue, currentVersionId: federalRead.projection.versionId });
  }

  const positions = new Map(
    snap.positions
      .filter((p) => p.officeholderId === member)
      .map((p) => [p.voteId, p.position]),
  );

  // The party breakdown: pure
  // arithmetic over the snapshot's positions joined to the roster's
  // party labels, refused (null) unless it sums exactly to the
  // chamber's recorded tally. The surface renders the honest
  // unavailable state on null.
  const supporting = await settleFederalVoteSupportingHoldings(member);

  // A member sits in one chamber, so their votes share a chamber and the
  // roll number orders them newest-first.
  const votes = snap.votes
    .filter((v) => positions.has(v.id))
    .sort((a, b) => b.rollNumber - a.rollNumber)
    .map((v) => ({
      ...v,
      position: positions.get(v.id),
      partyBreakdown: partyBreakdownFor(v.id, v.result, snap.positions, supporting.parties),
      billSummary: summaryForBill(v.billUrl),
      billSummaryPending: summaryPendingForBill(v.billUrl),
    }));

  /*
   * The "When it mattered" rows, served beside the recent ones. `keyVoteRowsFor` is handed a chamber and
   * never reads the other array; a member with no chamber gets an empty list.
   */
  const { chamber, rows: keyVotes } = supporting.curated;

  return Response.json({
    member,
    holdingStatus: "HELD",
    count: votes.length,
    generatedAt: snap.generatedAt,
    votes,
    partyBreakdownHoldingStatus: supporting.partyBreakdownHoldingStatus,
    chamber,
    keyVotes,
    keyVotesHoldingStatus: supporting.keyVotesHoldingStatus,
    keyVotesCriteria: keyVotes.length > 0 ? KEY_VOTES_CRITERIA : null,
    pickedKeyVotes: pickedKeyVotesFor(await readKeyVotePicks(), chamber, snap.votes, snap.positions, member),
  });
}
