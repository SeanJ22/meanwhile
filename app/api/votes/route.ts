import { readerRoute } from "@/lib/api/reader-route";
import { getVotesSnapshot, readFederalMemberVotes, readFederalRollCallsProjection } from "@/lib/votes/snapshot";
import type { FederalRollCallWindow } from "@/lib/votes/data-plane";
import { pickedKeyVotesFor } from "@/lib/votes/key-vote-picks";
import { readKeyVotePicks } from "@/lib/votes/key-vote-picks-read";
import { keyVotesForMember, type MemberKeyVotes } from "@/lib/votes/key-votes-reader";
import { KEY_VOTES_CRITERIA } from "@/lib/votes/key-votes";
import {
  getStateVotesSnapshot,
  OFFICIAL_STATE_VOTE_SCOPES,
  readOfficialStateVotesProjection,
  type OfficialStateVoteScope,
} from "@/lib/sources/legiscan/snapshot";
import { officialStateVoteScopeForOfficeholderId } from "@/lib/state-rollcalls/authority";
import type { StateVotesSnapshot } from "@/lib/sources/legiscan/types";
import { stateRollAttribution } from "@/lib/sources/legiscan/types";
import { summaryForBill, summaryPendingForBill } from "@/lib/votes/bill-summaries";
import { readHistoricalFederalVotesForMember } from "@/lib/votes/history";
import { mayUseTestFixture } from "@/lib/civic-data/fixture-policy";
import { readNativeMemberVotes } from "@/lib/state-rollcalls/reader-votes";
import { stateVoteStateForMember } from "@/lib/state-rollcalls/reader-vote-visibility";



export const runtime = "nodejs";

const FEDERAL_ID = /^congress:[A-Z]\d{6}$/;
const RETIRED_TEST_STATE_ID = /^plural:[0-9a-f-]{36}$/i;

export interface FederalVoteSupportingReaders {
  readonly keyVotes: (member: string) => Promise<MemberKeyVotes>;
}

export interface FederalVoteSupportingHoldings {
  readonly curated: MemberKeyVotes;
  readonly keyVotesHoldingStatus: "HELD" | "HOLDING_UNAVAILABLE";
}

export interface HeldStateVoteScope {
  readonly scope: OfficialStateVoteScope;
  readonly snapshot: StateVotesSnapshot;
  readonly versionId: string | null;
  readonly authorityKind: "PROMOTED_OFFICIAL" | "RESEARCH_TEST_FIXTURE";
}

export interface StateVoteScopeReaders {
  readonly read: (scope: OfficialStateVoteScope) => Promise<HeldStateVoteScope>;
}

export type StateVoteMemberHolding =
  | {
      readonly kind: "HELD";
      readonly holding: HeldStateVoteScope;
      readonly unavailableScopes: readonly OfficialStateVoteScope[];
    }
  | {
      readonly kind: "HELD_NO_RECORD";
      readonly generatedAt: string;
      readonly scopesChecked: readonly OfficialStateVoteScope[];
    }
  | {
      readonly kind: "HOLDING_UNAVAILABLE";
      readonly reason: "SCOPE_UNAVAILABLE";
      readonly unavailableScopes: readonly OfficialStateVoteScope[];
      readonly matchedScopes: readonly OfficialStateVoteScope[];
    };

async function readCanonicalStateVoteScope(scope: OfficialStateVoteScope): Promise<HeldStateVoteScope> {
  // The retained LegiScan bytes are a deterministic node:test fixture only.
  // Production always opens the exact canonical pointer below.
  if (mayUseTestFixture() && !process.env.DATABASE_URL) {
    return {
      scope,
      snapshot: getStateVotesSnapshot(scope),
      versionId: null,
      authorityKind: "RESEARCH_TEST_FIXTURE",
    };
  }
  const result = await readOfficialStateVotesProjection(scope);
  if (result.kind !== "PROMOTED") {
    throw new Error(result.detail);
  }
  return {
    scope,
    snapshot: result.value,
    versionId: result.metadata.versionId,
    authorityKind: "PROMOTED_OFFICIAL",
  };
}


export async function settleStateVoteMemberHolding(
  member: string,
  scope: OfficialStateVoteScope,
  readers: StateVoteScopeReaders = { read: readCanonicalStateVoteScope },
): Promise<StateVoteMemberHolding> {
  let holding: HeldStateVoteScope;
  try {
    holding = await readers.read(scope);
  } catch {
    return {
      kind: "HOLDING_UNAVAILABLE",
      reason: "SCOPE_UNAVAILABLE",
      unavailableScopes: [scope],
      matchedScopes: [],
    };
  }
  if (holding.snapshot.positions.some((position) => position.officeholderId === member)) {
    return { kind: "HELD", holding, unavailableScopes: [] };
  }
  return {
    kind: "HELD_NO_RECORD",
    generatedAt: holding.snapshot.generatedAt,
    scopesChecked: [scope],
  };
}

/** Retained only so old vendor ids can exercise deterministic fixtures. */
function researchFixtureScopeForMember(member: string): OfficialStateVoteScope | null {
  if (!mayUseTestFixture() || !RETIRED_TEST_STATE_ID.test(member)) return null;
  const matches = OFFICIAL_STATE_VOTE_SCOPES.filter((scope) =>
    getStateVotesSnapshot(scope).positions.some((position) => position.officeholderId === member)
  );
  return matches.length === 1 ? matches[0]! : null;
}


export async function settleFederalVoteSupportingHoldings(
  member: string,
  readers: FederalVoteSupportingReaders = { keyVotes: keyVotesForMember },
): Promise<FederalVoteSupportingHoldings> {
  const [keyVoteResult] = await Promise.allSettled([Promise.resolve().then(() => readers.keyVotes(member))]);

  return {
    curated: keyVoteResult.status === "fulfilled"
      ? keyVoteResult.value
      : { member, chamber: null, rows: [], positionsReadAt: null },
    keyVotesHoldingStatus: keyVoteResult.status === "fulfilled" ? "HELD" : "HOLDING_UNAVAILABLE",
  };
}

/** A state legislator's recent roll calls, in the federal rows' shape. */
export function stateVoteAttributionForHolding(
  holding: Pick<HeldStateVoteScope, "authorityKind">,
  rolls: Parameters<typeof stateRollAttribution>[0],
) {
  return holding.authorityKind === "PROMOTED_OFFICIAL" ? null : stateRollAttribution(rolls);
}

function stateVotes(member: string, holding: HeldStateVoteScope, unavailableScopes: readonly OfficialStateVoteScope[]) {
  const snap = holding.snapshot;
  const positions = new Map(
    snap.positions
      .filter((p) => p.officeholderId === member)
      .map((p) => [p.rollCallId, p.position]),
  );

  const matchedRolls = snap.rollCalls
    .filter((r) => positions.has(r.id))
    .sort((a, b) => b.date.localeCompare(a.date));
  const votes = matchedRolls
    .map((r) => ({
      id: r.id,
      // The bill's official title, as the legislature published it. Never
      // ours — the same rule the federal rows ship under.
      title: r.billTitle,
      titleSource: "BILL_TITLE" as const,
      // The chamber's own description of the motion.
      question: r.motion,
      result: r.result,
      legisNum: r.billNumber || null,
      billUrl: r.billUrl,
      rollCallUrl: r.rollCallUrl,
      date: r.date,
      position: positions.get(r.id),
      partyBreakdown: null,
      billSummary: null,
      billSummaryPending: false,
    }));

  return Response.json({
    member,
    holdingStatus: "HELD",
    authorityScope: holding.scope,
    canonicalVersionId: holding.versionId,
    unavailableSiblingScopes: unavailableScopes,
    count: votes.length,
    generatedAt: snap.generatedAt,
    attribution: stateVoteAttributionForHolding(holding, matchedRolls),
    votes,
  });
}

export const GET = readerRoute("/api/votes", async function GET(request: Request) {
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

  let window: FederalRollCallWindow;
  let federalRead: Awaited<ReturnType<typeof readFederalRollCallsProjection>>;
  let own: Awaited<ReturnType<typeof readFederalMemberVotes>>;
  try {
    federalRead = await readFederalRollCallsProjection();
    if (federalRead.kind !== "PROMOTED" && federalRead.kind !== "BOOTSTRAP") throw new Error(federalRead.detail);
    window = getVotesSnapshot();
    own = await readFederalMemberVotes(member);
    if (own.kind === "STORE_UNREACHABLE") throw new Error(own.detail);
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

  const record = own.kind === "PROMOTED" || own.kind === "BOOTSTRAP" ? own.value : null;
  const positions = new Map((record?.positions ?? []).map((p) => [p.voteId, p.position]));
  const supporting = await settleFederalVoteSupportingHoldings(member);

  // A member sits in one chamber, so their votes share a chamber and the
  // roll number orders them newest-first.
  const votes = (record?.votes ?? [])
    .filter((v) => positions.has(v.id))
    .sort((a, b) => b.rollNumber - a.rollNumber)
    .map((v) => ({
      ...v,
      position: positions.get(v.id),
      partyBreakdown: federalRead.value.partyBreakdowns[v.id] ?? null,
      billSummary: summaryForBill(v.billUrl),
      billSummaryPending: summaryPendingForBill(v.billUrl),
    }));

  const { chamber, rows: keyVoteRows } = supporting.curated;

  return Response.json({
    member,
    holdingStatus: "HELD",
    count: votes.length,
    generatedAt: window.generatedAt,
    votes,
    partyBreakdownHoldingStatus: "HELD",
    chamber,
    keyVotes: keyVoteRows,
    keyVotesHoldingStatus: supporting.keyVotesHoldingStatus,
    keyVotesCriteria: keyVoteRows.length > 0 ? KEY_VOTES_CRITERIA : null,
    pickedKeyVotes: pickedKeyVotesFor(await readKeyVotePicks(), chamber, record?.votes ?? [], record?.positions ?? [], member),
  });
});
