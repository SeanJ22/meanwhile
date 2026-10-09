import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  settleFederalVoteSupportingHoldings,
  settleStateVoteMemberHolding,
  stateVoteAttributionForHolding,
  type HeldStateVoteScope,
} from "../app/api/votes/route.ts";
import {
  clearStateVotesProjectionCacheForTest,
  getStateVotesSnapshot,
  OFFICIAL_STATE_VOTE_SCOPES,
  RETIRED_STATE_ROLL_CALL_SCOPES,
  isRetiredStateRollCallScope,
  officialStateVoteProjectionIssue,
  readAvailableOfficialStateVotes,
  readOfficialStateVotesProjection,
  type OfficialStateVoteScope,
} from "../lib/sources/legiscan/snapshot.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import type { StateVotesSnapshot } from "../lib/sources/legiscan/types.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { MemberKeyVotes } from "../lib/votes/key-votes-reader.ts";
import { OFFICIAL_STATE_ROLL_CALL_TARGETS, officialStateLegislatorTargetByScope } from "../lib/state-rollcalls/authority.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";

const MEMBER = "congress:C001133";
const CURATED: MemberKeyVotes = {
  member: MEMBER,
  chamber: "house",
  rows: [],
  positionsReadAt: "2026-09-09T00:00:00.000Z",
};

test("party-label failure cannot erase an independently held key-vote projection", async () => {
  const result = await settleFederalVoteSupportingHoldings(MEMBER, {
    parties: async () => { throw new Error("planted registry holding failure"); },
    keyVotes: async () => CURATED,
  });

  assert.equal(result.partyBreakdownHoldingStatus, "HOLDING_UNAVAILABLE");
  assert.equal(result.parties.size, 0);
  assert.equal(result.keyVotesHoldingStatus, "HELD");
  assert.equal(result.curated, CURATED);
});

test("key-vote failure cannot erase independently held roll-call supporting facts", async () => {
  const parties = new Map([[MEMBER, "Democrat"]]);
  const result = await settleFederalVoteSupportingHoldings(MEMBER, {
    parties: async () => parties,
    keyVotes: () => { throw new Error("planted key-vote holding failure"); },
  });

  assert.equal(result.partyBreakdownHoldingStatus, "HELD");
  assert.equal(result.parties, parties);
  assert.equal(result.keyVotesHoldingStatus, "HOLDING_UNAVAILABLE");
  assert.deepEqual(result.curated, {
    member: MEMBER,
    chamber: null,
    rows: [],
    positionsReadAt: null,
  });
});

const STATE_SOURCE: Readonly<Record<OfficialStateVoteScope, "az-legislature" | "nh-general-court" | "nj-legislature">> = {
  "US-AZ": "az-legislature",
  "US-NH": "nh-general-court",
  "US-NJ": "nj-legislature",
};

function stateSnapshot(scope: OfficialStateVoteScope, member: string | null): StateVotesSnapshot {
  const state = scope.slice(-2);
  const sourceId = STATE_SOURCE[scope];
  const rosterTarget = officialStateLegislatorTargetByScope(scope)!;
  const rollId = `${sourceId}:roll-1`;
  return {
    generatedAt: `2026-09-09T0${OFFICIAL_STATE_ROLL_CALL_TARGETS.findIndex(target => target.jurisdiction === scope)}:00:00.000Z`,
    officialIdentityAuthority: {
      contractId: rosterTarget.contractId,
      sourceId,
      scope,
      versionId: `${scope}:roster-good`,
      currentOfficeholderIdsSha256: normalizedHash(member ? [member] : []),
      sessionParticipantSet: {
        term: "2026",
        session: "regular",
        sourceVersion: `${scope}:participants-good`,
        count: 1,
        officeholderIdsSha256: normalizedHash(member ? [member] : [`${sourceId}:empty-fixture-participant`]),
      },
    },
    datasets: [],
    identifierMatch: {
      peopleSeen: member ? 1 : 0,
      peopleMatched: member ? 1 : 0,
      distinctOfficeholders: member ? 1 : 0,
      byState: { [state]: { peopleSeen: member ? 1 : 0, peopleMatched: member ? 1 : 0, rollCalls: 1 } },
    },
    rollCalls: [{
      id: rollId,
      sourceId,
      officialRollCallId: "roll-1",
      state,
      sessionId: 1,
      billNumber: "HB 1",
      billTitle: "Official planted isolation measure",
      motion: "Third reading",
      date: "2026-09-09",
      yea: 1,
      nay: 0,
      absent: 0,
      nv: 0,
      result: "Passed 1-0",
      billUrl: `https://example.gov/${state}/hb1`,
      rollCallUrl: `https://example.gov/${state}/roll-1`,
      retrievedAt: "2026-09-09T00:00:00.000Z",
    }],
    positions: member ? [{
      officeholderId: member,
      legiscanPeopleId: 0,
      officialPersonId: `${state}-member-1`,
      rollCallId: rollId,
      position: "YES",
      publisherPosition: "Yes",
    }] : [],
  };
}

function stateReaders(input: {
  readonly failed?: readonly OfficialStateVoteScope[];
  readonly members?: Partial<Record<OfficialStateVoteScope, string>>;
  readonly calls: OfficialStateVoteScope[];
}) {
  return {
    read: async (scope: OfficialStateVoteScope): Promise<HeldStateVoteScope> => {
      input.calls.push(scope);
      if (input.failed?.includes(scope)) throw new Error(`planted ${scope} holding failure`);
      return {
        scope,
        snapshot: stateSnapshot(scope, input.members?.[scope] ?? null),
        versionId: `${scope}:good`,
        authorityKind: "PROMOTED_OFFICIAL",
      };
    },
  };
}

function stateReadResult(
  scope: OfficialStateVoteScope,
  kind: "PROMOTED" | "NOT_RECORDED" | "STORE_UNREACHABLE",
): CivicDataReadResult<StateVotesSnapshot> {
  const metadata = {
    recordClass: "STATE_ROLL_CALL" as const,
    scope,
    sourceId: kind === "PROMOTED" ? STATE_SOURCE[scope] : null,
    version: kind === "PROMOTED" ? `${scope}:version` : null,
    versionId: kind === "PROMOTED" ? `${scope}:good` : null,
    lastKnownGoodVersionId: null,
    sourceThrough: null,
    retrievedAt: null,
    promotedAt: null,
    stale: "UNKNOWN" as const,
    staleAt: null,
  };
  if (kind === "PROMOTED") return {
    kind,
    value: stateSnapshot(scope, `${STATE_SOURCE[scope]}:${scope.slice(-2)}-member-1`),
    metadata,
    projection: {} as never,
  };
  if (kind === "NOT_RECORDED") return { kind, value: null, metadata, detail: `${scope} has no pointer` };
  return { kind, value: null, metadata, code: "STORE_READ_FAILED", detail: `${scope} store failed` };
}

test("official state proof enumeration keeps NOT_RECORDED explicit without borrowing the retired aggregate", async () => {
  const calls: OfficialStateVoteScope[] = [];
  const result = await readAvailableOfficialStateVotes({}, async (scope) => {
    calls.push(scope);
    return stateReadResult(scope, "NOT_RECORDED");
  });
  assert.deepEqual(calls, OFFICIAL_STATE_VOTE_SCOPES);
  assert.deepEqual(calls, ["US-NJ"], "neither retired Arizona nor retired New Hampshire pointer is opened");
  assert.deepEqual(result.promoted, []);
  assert.deepEqual(result.readbacks, [
    { scope: "US-NJ", kind: "NOT_RECORDED", versionId: null },
  ]);
  const held = await readAvailableOfficialStateVotes({}, async scope => stateReadResult(scope, "PROMOTED"));
  assert.deepEqual(held.promoted.map(({ scope }) => scope), ["US-NJ"]);
});

test("official state proof enumeration fails closed on an unreadable canonical store", async () => {
  await assert.rejects(
    readAvailableOfficialStateVotes({}, async (scope) => stateReadResult(
      scope,
      scope === "US-NJ" ? "STORE_UNREACHABLE" : "NOT_RECORDED",
    )),
    /Official state-roll read for US-NJ is STORE_UNREACHABLE/,
  );
});

test("R9: only scopes whose contract still promotes STATE_ROLL_CALL are read; the retired one is named", () => {
  const derived = OFFICIAL_STATE_ROLL_CALL_TARGETS
    .filter((target) => {
      const contract = ROUTINE_SOURCE_CONTRACTS.find((entry) => entry.id === target.contractId);
      return contract?.recordClass === "STATE_ROLL_CALL";
    })
    .map((target) => target.jurisdiction);
  assert.deepEqual([...OFFICIAL_STATE_VOTE_SCOPES], derived);
  assert.deepEqual(
    RETIRED_STATE_ROLL_CALL_SCOPES.map(({ scope }) => scope),
    OFFICIAL_STATE_ROLL_CALL_TARGETS.map(({ jurisdiction }) => jurisdiction).filter((scope) => !derived.includes(scope)),
    "every official target the contracts no longer promote per jurisdiction is retired by name, and only those",
  );
  assert.deepEqual(RETIRED_STATE_ROLL_CALL_SCOPES.map(({ scope }) => scope), ["US-AZ", "US-NH"]);
  assert.equal(ROUTINE_SOURCE_CONTRACTS.some(entry => entry.id === "az-state-rollcalls"), false);
  assert.equal(ROUTINE_SOURCE_CONTRACTS.find(entry => entry.id === "az-openstates-votes")?.scope, "US-AZ:openstates-votes:v1");
  assert.equal(
    ROUTINE_SOURCE_CONTRACTS.find((entry) => entry.id === "nh-state-rollcalls")?.recordClass,
    "STATE_LEGISLATOR_VOTES",
  );
  assert.equal(isRetiredStateRollCallScope("US-NH"), true);
  assert.equal(isRetiredStateRollCallScope("US-AZ"), true);
  assert.equal(isRetiredStateRollCallScope("US-NJ"), false);
});

test("R9: retired jurisdiction pointers are refused before any store opens", async () => {
  const store = new Proxy({}, {
    get() { throw new Error("the store was opened for a retired scope"); },
  });
  for (const scope of ["US-AZ", "US-NH"] as const) {
    await assert.rejects(readOfficialStateVotesProjection(scope, { store: store as never, bypassCache: true }),
      new RegExp(`STATE_ROLL_CALL_SCOPE_RETIRED:${scope}`));
  }
});

test("a New Hampshire member opens only the exact New Hampshire authority", async () => {
  const member = "nh-general-court:NH-member-1";
  const calls: OfficialStateVoteScope[] = [];
  const result = await settleStateVoteMemberHolding(member, "US-NH", stateReaders({
    calls,
    failed: ["US-AZ", "US-NJ"],
    members: { "US-NH": member },
  }));

  assert.equal(result.kind, "HELD");
  if (result.kind !== "HELD") return;
  assert.equal(result.holding.scope, "US-NH");
  assert.deepEqual(result.unavailableScopes, []);
  assert.deepEqual(calls, ["US-NH"]);
});

test("a requested New Jersey failure remains explicitly unavailable without opening AZ or NH", async () => {
  const calls: OfficialStateVoteScope[] = [];
  const result = await settleStateVoteMemberHolding(
    "nj-legislature:NJ-member-1",
    "US-NJ",
    stateReaders({ calls, failed: ["US-NJ"] }),
  );

  assert.deepEqual(result, {
    kind: "HOLDING_UNAVAILABLE",
    reason: "SCOPE_UNAVAILABLE",
    unavailableScopes: ["US-NJ"],
    matchedScopes: [],
  });
  assert.deepEqual(calls, ["US-NJ"]);
});

test("an exact Arizona id absent from its held projection is a scoped no-record result", async () => {
  const calls: OfficialStateVoteScope[] = [];
  const result = await settleStateVoteMemberHolding(
    "az-legislature:AZ-member-missing",
    "US-AZ",
    stateReaders({ calls }),
  );

  assert.deepEqual(result, {
    kind: "HELD_NO_RECORD",
    generatedAt: "2026-09-09T00:00:00.000Z",
    scopesChecked: ["US-AZ"],
  });
  assert.deepEqual(calls, ["US-AZ"]);
});

test("the permanent state-vote Reader has no retired aggregate-scope probe", () => {
  const reader = readFileSync(new URL("../lib/sources/legiscan/snapshot.ts", import.meta.url), "utf8");
  assert.doesNotMatch(reader, /supported-states/);
  assert.deepEqual(OFFICIAL_STATE_VOTE_SCOPES, ["US-NJ"]);
});

test("a production process cannot reopen the retired aggregate through a test marker", { concurrency: false }, () => {
  const priorNodeEnv = process.env.NODE_ENV;
  const priorTestContext = process.env.NODE_TEST_CONTEXT;
  clearStateVotesProjectionCacheForTest();
  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    Reflect.set(process.env, "NODE_TEST_CONTEXT", "child-v8");
    assert.throws(
      () => getStateVotesSnapshot("US-AZ"),
      /No proof-validated official state roll-call projection/,
    );
  } finally {
    if (priorNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", priorNodeEnv);
    if (priorTestContext === undefined) Reflect.deleteProperty(process.env, "NODE_TEST_CONTEXT");
    else Reflect.set(process.env, "NODE_TEST_CONTEXT", priorTestContext);
    clearStateVotesProjectionCacheForTest();
  }
});

test("a state-vote pointer cannot borrow another state's publisher, identity, or denominator", () => {
  const az = stateSnapshot("US-AZ", "az-legislature:AZ-member-1");
  assert.equal(officialStateVoteProjectionIssue("US-AZ", "az-legislature", az), null);
  assert.equal(
    officialStateVoteProjectionIssue("US-AZ", "nh-general-court", az),
    "SOURCE_AUTHORITY_MISMATCH:nh-general-court:az-legislature",
  );
  assert.equal(
    officialStateVoteProjectionIssue("US-NH", "nh-general-court", az),
    "OFFICIAL_IDENTITY_AUTHORITY_INVALID",
  );
  assert.equal(
    officialStateVoteProjectionIssue("US-AZ", "az-legislature", {
      ...az,
      identifierMatch: { ...az.identifierMatch, peopleMatched: 0 },
    }),
    "IDENTITY_SCOPE_OR_DENOMINATOR_INVALID",
  );
  assert.equal(
    officialStateVoteProjectionIssue("US-AZ", "az-legislature", {
      ...az,
      positions: [{ ...az.positions[0]!, officeholderId: "plural:dddddddd-dddd-4ddd-8ddd-dddddddddddd" }],
    }),
    "POSITION_OFFICEHOLDER_AUTHORITY_INVALID",
  );
});

test("an official empty member result cannot be mislabeled as legacy LegiScan evidence", () => {
  assert.equal(stateVoteAttributionForHolding({ authorityKind: "PROMOTED_OFFICIAL" }, []), null);
  const fixtureAttribution = stateVoteAttributionForHolding({ authorityKind: "RESEARCH_TEST_FIXTURE" }, []);
  assert.ok(fixtureAttribution);
  assert.equal(fixtureAttribution.text, "LegiScan");
});
