import assert from "node:assert/strict";
import test from "node:test";

import {
  officialStateIdentityAuthorityEvidence,
  officialStateLegislatorVotesCandidate,
  officialStateLegislatorVotesSessionMarker,
} from "../lib/civic-data/candidate-builders.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { processRegisteredFanOutCandidate } from "../lib/civic-data/promotion.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type {
  StateLegislatorVotePosition,
  StateLegislatorVotes,
  StateLegislatorVotesSessionMarker,
} from "../lib/sources/legiscan/types.ts";

const T0 = "2026-09-15T12:00:00.000Z";
const T1 = "2026-09-15T12:10:00.000Z";
const SOURCE_ID = "nh-general-court" as const;
const JURISDICTION = "US-NH" as const;
const CONTRACT_ID = "nh-state-rollcalls";
const MEMBERS = ["nh-general-court:1", "nh-general-court:2", "nh-general-court:3"];

function identityAuthority(tag: string) {
  return officialStateIdentityAuthorityEvidence({
    sourceId: SOURCE_ID,
    jurisdiction: JURISDICTION,
    term: "2026",
    session: "regular",
    identityAuthority: {
      contractId: "nh-members",
      versionId: `nh-members-${tag}`,
      currentOfficeholderIds: MEMBERS,
      sessionParticipantIds: MEMBERS,
      sessionParticipantSourceVersion: `participants-${tag}`,
    },
  });
}

function pos(roll: number, position: StateLegislatorVotePosition["position"] = "YES"): StateLegislatorVotePosition {
  return { rollCallId: `nh-general-court:roll-${roll}`, position, date: "2026-09-09" };
}

function member(officeholderId: string, positions: StateLegislatorVotePosition[], retrievedAt = T0) {
  return officialStateLegislatorVotesCandidate({
    sourceId: SOURCE_ID,
    jurisdiction: JURISDICTION,
    officeholderId,
    chamber: "House",
    term: "2026",
    session: "regular",
    positions,
    requestedUrl: "https://gc.nh.gov/rollcalls",
    finalUrl: "https://gc.nh.gov/rollcalls",
    httpStatus: 200,
    retrievedAt,
    identityAuthority: identityAuthority("v1"),
  });
}

function marker(retrievedAt = T0) {
  return officialStateLegislatorVotesSessionMarker({
    sourceId: SOURCE_ID,
    jurisdiction: JURISDICTION,
    term: "2026",
    session: "regular",
    requestedUrl: "https://gc.nh.gov/rollcalls",
    finalUrl: "https://gc.nh.gov/rollcalls",
    httpStatus: 200,
    retrievedAt,
    throughRollId: "nh-general-court:roll-9",
    throughDate: "2026-09-09",
    rollCount: 9,
    legislatorCount: MEMBERS.length,
    positionCount: 9 * MEMBERS.length,
    sourceDocumentsSha256: "a".repeat(64),
    identityAuthority: identityAuthority("v1"),
  });
}

test("the NH state-roll contract is a per-legislator fan-out over STATE_LEGISLATOR_VOTES", () => {
  const contract = ROUTINE_SOURCE_CONTRACTS.find(({ id }) => id === CONTRACT_ID);
  assert.ok(contract);
  assert.equal(contract.recordClass, "STATE_LEGISLATOR_VOTES");
  assert.equal(contract.scope, JURISDICTION);
  assert.equal(contract.fanOut, true);
  assert.equal(contract.readerProjection?.id, "nh-official-state-legislator-votes");
});

test("every member and the per-state marker promote GOOD at their own bounded scope", async () => {
  const store = new MemoryRoutineDataStore();

  for (const id of MEMBERS) {
    const outcome = await processRegisteredFanOutCandidate(store, CONTRACT_ID, member(id, [pos(1), pos(2)]), T0);
    // Promotion only reaches PROMOTED if the source-scoped per-member verifier
    // passed, so this transitively proves the fan-out reader verifier.
    assert.equal(outcome.candidate.state, "PROMOTED", id);
    assert.equal(outcome.promoted?.scope, id);
    assert.equal(outcome.promoted?.recordClass, "STATE_LEGISLATOR_VOTES");
    // A PASS readback proves the per-contract readback read this member's own
    // promoted scope: it reads promoted.scope and FAILs if the version mismatches.
    assert.equal(outcome.readerReadback?.status, "PASS", JSON.stringify(outcome.readerReadback));
  }

  const markerOutcome = await processRegisteredFanOutCandidate(store, CONTRACT_ID, marker(T0), T0);
  assert.equal(markerOutcome.candidate.state, "PROMOTED");
  assert.equal(markerOutcome.promoted?.scope, JURISDICTION);
  assert.equal(markerOutcome.readerReadback?.status, "PASS");

  // The fan-out never writes the whole-chamber STATE_ROLL_CALL pointer, so a
  // promoted marker can never render as a false "no votes" for any member.
  assert.equal(await store.readPromotion("STATE_ROLL_CALL", JURISDICTION), null);

  for (const id of MEMBERS) {
    const read = await readPromotedCivicData<StateLegislatorVotes>("STATE_LEGISLATOR_VOTES", id, { store, now: T0, bypassCache: true });
    assert.equal(read.kind, "PROMOTED", id);
    if (read.kind === "PROMOTED") {
      assert.equal(read.value.officeholderId, id);
      assert.deepEqual(read.value.positions.map((position) => position.rollCallId), [
        "nh-general-court:roll-1",
        "nh-general-court:roll-2",
      ]);
    }
  }

  const markerRead = await readPromotedCivicData<StateLegislatorVotesSessionMarker>("STATE_LEGISLATOR_VOTES", JURISDICTION, { store, now: T0, bypassCache: true });
  assert.equal(markerRead.kind, "PROMOTED");
  if (markerRead.kind === "PROMOTED") {
    assert.equal(markerRead.value.legislatorCount, MEMBERS.length);
    assert.equal(markerRead.value.throughRollId, "nh-general-court:roll-9");
    assert.equal(markerRead.value.sourceDocumentsSha256, "a".repeat(64));
  }
});

test("a member scope and the marker scope never collide", async () => {
  const store = new MemoryRoutineDataStore();
  await processRegisteredFanOutCandidate(store, CONTRACT_ID, member("nh-general-court:1", [pos(1)]), T0);
  await processRegisteredFanOutCandidate(store, CONTRACT_ID, marker(T0), T0);
  const memberRead = await readPromotedCivicData<StateLegislatorVotes>("STATE_LEGISLATOR_VOTES", "nh-general-court:1", { store, now: T0, bypassCache: true });
  const markerRead = await readPromotedCivicData<StateLegislatorVotesSessionMarker>("STATE_LEGISLATOR_VOTES", JURISDICTION, { store, now: T0, bypassCache: true });
  assert.equal(memberRead.kind, "PROMOTED");
  assert.equal(markerRead.kind, "PROMOTED");
  // The member payload carries its own positions; the marker payload is a
  // watermark carrying none — distinct records at distinct scopes.
  if (memberRead.kind === "PROMOTED") assert.ok("officeholderId" in memberRead.value);
  if (markerRead.kind === "PROMOTED") assert.ok(!("positions" in markerRead.value));
});

test("a changed member re-promotes to a new version; unchanged votes confirm that version", async () => {
  const store = new MemoryRoutineDataStore();
  const first = await processRegisteredFanOutCandidate(store, CONTRACT_ID, member("nh-general-court:1", [pos(1)], T0), T0);
  // A changed vote set is a new version.
  const changed = await processRegisteredFanOutCandidate(store, CONTRACT_ID, member("nh-general-court:1", [pos(1), pos(2)], T1), T1);
  assert.equal(changed.candidate.state, "PROMOTED");
  assert.notEqual(changed.promoted?.versionId, first.promoted?.versionId);

  // Unchanged facts never mint a new version.
  const recheck = member("nh-general-court:1", [pos(1), pos(2)], "2026-09-15T12:20:00.000Z");
  const again = await processRegisteredFanOutCandidate(store, CONTRACT_ID, recheck, "2026-09-15T12:20:00.000Z");
  assert.equal(again.candidate.state, "PROMOTED");
  assert.equal(again.promoted?.versionId, changed.promoted?.versionId);
  assert.equal(again.confirmed?.recheck.changeSet?.outcome, "UNCHANGED");
  assert.equal(await store.readCandidate(recheck.id), null, "identical votes do not store another payload");
});

test("the fan-out door refuses a candidate scope outside the state's family", async () => {
  const store = new MemoryRoutineDataStore();
  // A member id belonging to another publisher authority is not in the NH family.
  const foreign = member("az-legislature:1", [pos(1)]);
  await assert.rejects(
    () => processRegisteredFanOutCandidate(store, CONTRACT_ID, foreign, T0),
    /FANOUT_CANDIDATE_CONTRACT_MISMATCH/,
  );
});

test("one acquired member renders exact roll metadata before the session marker exists", async () => {
  const { readStateMemberVoteSnapshot } = await import("../lib/state-rollcalls/member-votes.ts");
  const store = new MemoryRoutineDataStore();
  const position = { ...pos(1), publisherPosition: "Yea" };
  const candidate = officialStateLegislatorVotesCandidate({ sourceId: SOURCE_ID, jurisdiction: JURISDICTION,
    officeholderId: MEMBERS[0], chamber: "House", term: "2026", session: "regular", positions: [position],
    rollCalls: [{ id: position.rollCallId, sourceId: SOURCE_ID, officialRollCallId: "2026:H:1", eventId: "nh-general-court:event:2026:H:1",
      chamber: "House", term: "2026", session: "regular", actionStage: "Passage", state: "NH", sessionId: 0,
      billNumber: "HB1", billTitle: "Official bill title", motion: "Passage", date: position.date, yea: 1, nay: 0, absent: 0, nv: 0,
      result: "Yea 1; Nay 0", billUrl: null, rollCallUrl: "https://gc.nh.gov/dynamicdatadump/RollCallSummary.txt", retrievedAt: T0 }],
    requestedUrl: "https://gc.nh.gov/dynamicdatadump/RollCallSummary.txt", finalUrl: "https://gc.nh.gov/dynamicdatadump/RollCallSummary.txt",
    httpStatus: 200, retrievedAt: T0, identityAuthority: identityAuthority("v1") });
  assert.ok((await processRegisteredFanOutCandidate(store, CONTRACT_ID, candidate, T0)).promoted);
  assert.equal(await store.readPromotion("STATE_LEGISLATOR_VOTES", "US-NH"), null);
  const read = await readStateMemberVoteSnapshot(MEMBERS[0], { store, now: T0, bypassCache: true });
  assert.equal(read?.snapshot.rollCalls[0].billTitle, "Official bill title");
  assert.equal(read?.snapshot.positions[0].publisherPosition, "Yea");
  assert.equal(await readStateMemberVoteSnapshot(MEMBERS[1], { store, now: T0, bypassCache: true }), null);
});
