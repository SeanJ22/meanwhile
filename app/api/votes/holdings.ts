import { keyVotesForMember, type MemberKeyVotes } from "@/lib/votes/key-votes-reader";
import { partyByOfficeholderId } from "@/lib/registry/server";
import {
  getStateVotesSnapshot,
  OFFICIAL_STATE_VOTE_SCOPES,
  readOfficialStateVotesProjection,
  type OfficialStateVoteScope,
} from "@/lib/sources/legiscan/snapshot";
import type { StateVotesSnapshot } from "@/lib/sources/legiscan/types";
import { stateRollAttribution } from "@/lib/sources/legiscan/types";
import { mayUseTestFixture } from "@/lib/civic-data/fixture-policy";

const RETIRED_TEST_STATE_ID = /^plural:[0-9a-f-]{36}$/i;

export interface FederalVoteSupportingReaders {
  readonly parties: () => Promise<ReadonlyMap<string, string | null>>;
  readonly keyVotes: (member: string) => Promise<MemberKeyVotes>;
}

export interface FederalVoteSupportingHoldings {
  readonly parties: ReadonlyMap<string, string | null>;
  readonly partyBreakdownHoldingStatus: "HELD" | "HOLDING_UNAVAILABLE";
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

/**
 * Read the one state authority encoded in the member's source-namespaced identifier. Identity and scope are
 * fixed before the store opens, so one state's request cannot wait on, be erased by, or be satisfied from another's.
 */
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
export function researchFixtureScopeForMember(member: string): OfficialStateVoteScope | null {
  if (!mayUseTestFixture() || !RETIRED_TEST_STATE_ID.test(member)) return null;
  const matches = OFFICIAL_STATE_VOTE_SCOPES.filter((scope) =>
    getStateVotesSnapshot(scope).positions.some((position) => position.officeholderId === member)
  );
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Party labels and the curated key-vote projection are supporting holdings
 * beside the federal roll-call record. Neither is authority for the other,
 * so one unavailable holding must not erase the independently held record.
 */
export async function settleFederalVoteSupportingHoldings(
  member: string,
  readers: FederalVoteSupportingReaders = {
    parties: partyByOfficeholderId,
    keyVotes: keyVotesForMember,
  },
): Promise<FederalVoteSupportingHoldings> {
  const [partyResult, keyVoteResult] = await Promise.allSettled([
    Promise.resolve().then(() => readers.parties()),
    Promise.resolve().then(() => readers.keyVotes(member)),
  ]);

  return {
    parties: partyResult.status === "fulfilled" ? partyResult.value : new Map(),
    partyBreakdownHoldingStatus: partyResult.status === "fulfilled" ? "HELD" : "HOLDING_UNAVAILABLE",
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

export function stateVotes(member: string, holding: HeldStateVoteScope, unavailableScopes: readonly OfficialStateVoteScope[]) {
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
      // A party-by-party count is REFUSED here rather than estimated. We hold
      // positions only for the members whose district our geometry clips, so
      // any tally we computed would be a fraction of the chamber's and could
      // never sum to the recorded result — which is exactly the condition the
      // federal breakdown refuses on.
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
