import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { candidateChangeSet, canonicalCivicDataJson, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { sourceProjectionEvidence } from "../lib/civic-data/types.ts";
import {
  FEDERAL_KEY_VOTE_SCOPE,
  FEDERAL_ROLLCALL_SCOPE,
  FEDERAL_VOTES_PARSER_VERSION,
  FEDERAL_VOTES_SOURCE_ID,
  federalKeyVotesCandidate,
  federalRollCallsCandidate,
  type FederalKeyVotePositions,
  type FederalKeyVotesSnapshot,
  type OfficialAcquisition,
} from "../lib/votes/data-plane.ts";
import {
  federalKeyVoteSelectionV1Issue,
  federalKeyVoteSelectionV1Snapshot,
} from "../lib/votes/key-vote-selection-v1.ts";
import { readFederalKeyVotesProjection } from "../lib/votes/key-votes-projection.ts";
import {
  billSummariesForRollCallAcquisition,
  readFederalRollCallsProjection,
} from "../lib/votes/snapshot.ts";
import type { BillSummariesFile } from "../lib/votes/bill-summaries.ts";
import type { RollCallVote, VotesSnapshot } from "../lib/votes/types.ts";

const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T12:01:00.000Z";

function rollUrl(chamber: "house" | "senate", congress: number, session: number, rollNumber: number): string {
  if (chamber === "house") {
    const year = 1787 + (congress * 2) + session - 1;
    return `https://clerk.house.gov/evs/${year}/roll${String(rollNumber).padStart(3, "0")}.xml`;
  }
  return `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${congress}${session}/vote_${congress}_${session}_${String(rollNumber).padStart(5, "0")}.xml`;
}

function acquisitionsForRollCalls(snapshot: VotesSnapshot, suffix = "good"): OfficialAcquisition[] {
  return snapshot.votes.map((vote) => {
    const url = rollUrl(vote.chamber, vote.congress, vote.session, vote.rollNumber);
    return { requestedUrl: url, finalUrl: url, httpStatus: 200, body: `${suffix}:${vote.id}` };
  });
}

function acquisitionsForKeyVotes(snapshot: FederalKeyVotesSnapshot, suffix = "good"): OfficialAcquisition[] {
  return snapshot.entries.flatMap((entry) => [
    ...entry.house.map((ref) => ({ requestedUrl: ref.url!, finalUrl: ref.url!, httpStatus: 200, body: `${suffix}:${entry.id}:house:${ref.rollNumber}` })),
    ...entry.senate.map((ref) => ({ requestedUrl: ref.url!, finalUrl: ref.url!, httpStatus: 200, body: `${suffix}:${entry.id}:senate:${ref.rollNumber}` })),
  ]);
}

/** A small synthetic roll-call window: two House rolls, one Senate roll, two summaries and one pending review. */
async function rollCallSeed(): Promise<{ snapshot: VotesSnapshot; billSummaries: BillSummariesFile }> {
  const congress = 119;
  const session = 2;
  const bill = (n: number) => `https://www.congress.gov/bill/119th-congress/house-bill/${n}`;
  const vote = (chamber: "house" | "senate", rollNumber: number, billUrl: string | null): RollCallVote => ({
    id: `${chamber}:${congress}-${session}:${rollNumber}`, chamber, congress, session, rollNumber, date: "2026-09-01",
    title: `Bill ${rollNumber}`, titleSource: "BILL_TITLE", question: "On Passage", legisNum: billUrl ? `H.R. ${rollNumber}` : null,
    result: "Passed 218-210", billUrl, rollCallUrl: rollUrl(chamber, congress, session, rollNumber), retrievedAt: T0,
  });
  return {
    snapshot: {
      generatedAt: T0, congress, session,
      window: { houseRolls: [1, 2], senateRolls: [3] },
      identifierMatch: { houseMatched: 1, houseTotal: 1, senateMatched: 1, senateTotal: 1 },
      votes: [vote("house", 1, bill(1)), vote("house", 2, bill(2)), vote("senate", 3, bill(3))],
      positions: [
        { officeholderId: "congress:A000001", voteId: `house:${congress}-${session}:1`, position: "YES" },
        { officeholderId: "congress:B000002", voteId: `senate:${congress}-${session}:3`, position: "NO" },
      ],
    },
    billSummaries: {
      curatedAt: T0,
      summaries: {
        [bill(1)]: { legisNum: "H.R. 1", title: "Bill 1", summary: "What bill 1 does.", basis: "Official summary.", curatedAt: T0 },
        [bill(2)]: { legisNum: "H.R. 2", title: "Bill 2", summary: "What bill 2 does.", basis: "Official summary.", curatedAt: T0 },
      },
      pending: [{ billUrl: bill(3), legisNum: "H.R. 3", title: "Bill 3", reason: "No official summary yet." }],
    },
  };
}

/** The reviewed v1 selection with every selected roll's official facts filled and one position each. */
async function keyVoteSeed(): Promise<{ snapshot: FederalKeyVotesSnapshot; positions: FederalKeyVotePositions }> {
  const base = federalKeyVoteSelectionV1Snapshot(T0);
  const fill = (chamber: "house" | "senate") => (ref: FederalKeyVotesSnapshot["entries"][number]["house"][number]) => ({
    ...ref, url: rollUrl(chamber, ref.congress, ref.session, ref.rollNumber), question: "On Passage", tally: "60-40", verifiedAt: "2026-08-15",
  });
  const snapshot: FederalKeyVotesSnapshot = {
    ...base,
    entries: base.entries.map((entry) => ({ ...entry, house: entry.house.map(fill("house")), senate: entry.senate.map(fill("senate")) })),
    misses: [{ id: "stock-trading-ban", chamber: "senate", reason: "The Senate has taken no vote." }],
  };
  const positions: FederalKeyVotePositions = {
    formatVersion: 1,
    fetchedAt: T0,
    positions: Object.fromEntries(snapshot.entries.flatMap((entry) => [
      ...entry.house.map((ref) => `${entry.id}|house|${ref.congress}-${ref.session}:${ref.rollNumber}`),
      ...entry.senate.map((ref) => `${entry.id}|senate|${ref.congress}-${ref.session}:${ref.rollNumber}`),
    ]).map((key) => [key, { "congress:A000001": "YES" as const }])),
  };
  return { snapshot, positions };
}

test("congress-rollcalls promotes to the canonical plane and its Reader follows the exact GOOD pointer", async () => {
  const seed = await rollCallSeed();
  const store = new MemoryRoutineDataStore();
  const candidate = federalRollCallsCandidate({
    acquisitions: acquisitionsForRollCalls(seed.snapshot),
    retrievedAt: T0,
    expectedCongress: seed.snapshot.congress,
    expectedSession: seed.snapshot.session,
    snapshot: structuredClone(seed.snapshot),
    billSummaries: structuredClone(seed.billSummaries),
  });
  const outcome = await processRegisteredManualCandidate(store, "congress-rollcalls", candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.promoted?.versionId, candidate.id);
  assert.equal(outcome.readerReadback?.status, "PASS");

  const read = await readFederalRollCallsProjection({ store, bypassCache: true, now: T0 });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") {
    assert.equal(read.metadata.versionId, candidate.id);
    assert.deepEqual(read.value.snapshot, seed.snapshot);
  }
  assert.deepEqual((await store.events(candidate.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"]);
});

test("bill summaries and pending reviews are stable exact Admin members without changing the Reader payload contract", async () => {
  const seed = await rollCallSeed();
  const prior = federalRollCallsCandidate({
    acquisitions: acquisitionsForRollCalls(seed.snapshot),
    retrievedAt: T0,
    expectedCongress: seed.snapshot.congress,
    expectedSession: seed.snapshot.session,
    snapshot: structuredClone(seed.snapshot),
    billSummaries: structuredClone(seed.billSummaries),
  });
  const summaryUrls = Object.keys(seed.billSummaries.summaries).sort();
  assert.ok(summaryUrls.length >= 2);
  assert.ok(seed.billSummaries.pending.length > 0);
  const changedUrl = summaryUrls[0]!;
  const removedUrl = summaryUrls[1]!;
  const addedUrl = "https://www.congress.gov/bill/119th-congress/house-bill/99999";
  const pendingUrl = seed.billSummaries.pending[0]!.billUrl;
  const clonedBillSummaries = structuredClone(seed.billSummaries);
  const billSummaries = {
    ...clonedBillSummaries,
    summaries: { ...clonedBillSummaries.summaries },
    pending: clonedBillSummaries.pending.map((row, index) => index === 0
      ? { ...row, reason: `${row.reason} Reviewed again.` }
      : row),
  };
  billSummaries.summaries[changedUrl] = {
    ...billSummaries.summaries[changedUrl]!,
    summary: `${billSummaries.summaries[changedUrl]!.summary} Exact reviewed update.`,
  };
  delete billSummaries.summaries[removedUrl];
  billSummaries.summaries[addedUrl] = {
    legisNum: "H.R. 99999",
    title: "Exact test title",
    summary: "Exact test summary.",
    basis: "Deterministic data-plane test evidence.",
    curatedAt: T1,
  };
  const next = federalRollCallsCandidate({
    acquisitions: acquisitionsForRollCalls(seed.snapshot, "summary-only"),
    retrievedAt: T1,
    expectedCongress: seed.snapshot.congress,
    expectedSession: seed.snapshot.session,
    snapshot: structuredClone(seed.snapshot),
    billSummaries,
  });

  assert.deepEqual(next.readModel, { formatVersion: 1, snapshot: seed.snapshot, billSummaries });
  assert.equal(
    next.normalization.normalizedHash,
    createHash("sha256").update(canonicalCivicDataJson(next.readModel)).digest("hex"),
    "Admin membership is additive evidence; the canonical Reader payload/hash contract remains exact",
  );
  assert.equal(next.civicRecords, undefined, "the read model is the one copy of each roll call; validation derives its members");
  const changeSet = candidateChangeSet(next, prior.readModel);
  assert.deepEqual(changeSet.added.map(({ key }) => key), [`bill-summary:${addedUrl}`]);
  assert.deepEqual(changeSet.changed.map(({ key }) => key), [
    `bill-summary-pending:${pendingUrl}`,
    `bill-summary:${changedUrl}`,
  ].sort());
  assert.deepEqual(changeSet.removed.map(({ key }) => key), [`bill-summary:${removedUrl}`]);
  assert.ok(
    [...changeSet.added, ...changeSet.changed, ...changeSet.removed]
      .every(({ key }) => key.startsWith("bill-summary")),
    "a summary-only update cannot falsely report a roll-call or member-position change",
  );
});

test("duplicate pending bill-summary identities fail closed before promotion", async () => {
  const seed = await rollCallSeed();
  const clonedBillSummaries = structuredClone(seed.billSummaries);
  assert.ok(clonedBillSummaries.pending.length > 0);
  const billSummaries = {
    ...clonedBillSummaries,
    pending: [...clonedBillSummaries.pending, structuredClone(clonedBillSummaries.pending[0]!)],
  };
  const candidate = federalRollCallsCandidate({
    acquisitions: acquisitionsForRollCalls(seed.snapshot),
    retrievedAt: T0,
    expectedCongress: seed.snapshot.congress,
    expectedSession: seed.snapshot.session,
    snapshot: structuredClone(seed.snapshot),
    billSummaries,
  });
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "congress-rollcalls", candidate, T0);
  assert.equal(outcome.candidate.state, "PARSE_INVALID");
  assert.equal(outcome.candidate.receipt?.checks.find(({ check }) => check === "SCHEMA_PARSE_VALIDITY")?.code, "CIVIC_RECORD_KEYS_DUPLICATED");
  assert.equal(outcome.promoted, null);
});

test("one missing official roll receipt refuses the candidate and preserves roll-call LKG", async () => {
  const seed = await rollCallSeed();
  const store = new MemoryRoutineDataStore();
  const good = federalRollCallsCandidate({
    acquisitions: acquisitionsForRollCalls(seed.snapshot), retrievedAt: T0,
    expectedCongress: seed.snapshot.congress, expectedSession: seed.snapshot.session,
    snapshot: structuredClone(seed.snapshot), billSummaries: structuredClone(seed.billSummaries),
  });
  await processRegisteredManualCandidate(store, "congress-rollcalls", good, T0);
  const incomplete = federalRollCallsCandidate({
    acquisitions: acquisitionsForRollCalls(seed.snapshot, "incomplete").slice(1), retrievedAt: T1,
    expectedCongress: seed.snapshot.congress, expectedSession: seed.snapshot.session,
    snapshot: structuredClone(seed.snapshot), billSummaries: structuredClone(seed.billSummaries),
  });
  const refused = await processRegisteredManualCandidate(store, "congress-rollcalls", incomplete, T1);
  assert.equal(refused.candidate.state, "SEMANTIC_INVALID");
  assert.equal(refused.promoted, null);
  assert.equal((await store.readPromotion("FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE))?.versionId, good.id);
});

test("federal validation refuses dependent evidence from any other source projection", async () => {
  const seed = await rollCallSeed();
  const candidate = federalRollCallsCandidate({
    acquisitions: acquisitionsForRollCalls(seed.snapshot), retrievedAt: T0,
    expectedCongress: seed.snapshot.congress, expectedSession: seed.snapshot.session,
    snapshot: structuredClone(seed.snapshot), billSummaries: structuredClone(seed.billSummaries),
  });
  const mismatched = {
    ...candidate,
    id: `${candidate.id}-wrong-evidence`,
    sourceProjectionEvidence: sourceProjectionEvidence(FEDERAL_VOTES_SOURCE_ID, "FEDERAL_ROLL_CALL", "US:some-other-window"),
  };
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "congress-rollcalls", mismatched, T0);
  assert.equal(outcome.candidate.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(outcome.candidate.receipt?.checks.find(({ check }) => check === "DEPENDENT_READ_MODEL_VALIDITY")?.code, "DEPENDENT_EVIDENCE_SCOPE_MISMATCH");
  assert.equal(outcome.promoted, null);
});

test("federal-key-votes binds mutable official facts to the exact reviewed v1 selection", async () => {
  const seed = await keyVoteSeed();
  assert.equal(federalKeyVoteSelectionV1Issue(seed.snapshot), null);
  const selectedProposal = seed.snapshot.entries.find((entry) => entry.id === "stock-trading-ban");
  assert.equal(selectedProposal?.pending, undefined);
  assert.equal(selectedProposal?.senateNote, undefined);
  const store = new MemoryRoutineDataStore();
  const candidate = federalKeyVotesCandidate({
    acquisitions: acquisitionsForKeyVotes(seed.snapshot),
    retrievedAt: T0,
    snapshot: { ...structuredClone(seed.snapshot), fetchedAt: T0 },
    positions: { ...structuredClone(seed.positions), fetchedAt: T0 },
  });
  const outcome = await processRegisteredManualCandidate(store, "federal-key-votes", candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.readerReadback?.status, "PASS");
  const read = await readFederalKeyVotesProjection({ store, bypassCache: true, now: T0 });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind === "PROMOTED") assert.equal(read.metadata.versionId, candidate.id);

  const altered = structuredClone(seed.snapshot);
  altered.entries[0].title = "unreviewed replacement question";
  assert.equal(federalKeyVoteSelectionV1Issue(altered), "REVIEWED_KEY_VOTE_SELECTION_V1_MISMATCH");

  const unreceiptedStatus = structuredClone(seed.snapshot);
  const proposal = unreceiptedStatus.entries.find((entry) => entry.id === "stock-trading-ban");
  assert.ok(proposal);
  proposal.pending = true;
  proposal.senateNote = "The Senate has not acted.";
  assert.equal(
    federalKeyVoteSelectionV1Issue(unreceiptedStatus),
    "REVIEWED_KEY_VOTE_SELECTION_V1_MISMATCH",
    "mutable law/chamber status cannot enter through the reviewed software input",
  );
});

test("key-vote coverage misses, law misses, and coverage semantics are exact Admin members", async () => {
  const seed = await keyVoteSeed();
  const snapshot = { ...structuredClone(seed.snapshot), fetchedAt: T0 };
  const positions = { ...structuredClone(seed.positions), fetchedAt: T0 };
  const prior = federalKeyVotesCandidate({
    acquisitions: acquisitionsForKeyVotes(snapshot),
    retrievedAt: T0,
    snapshot,
    positions,
  });
  assert.ok(snapshot.misses.length > 0);
  const miss = snapshot.misses[0]!;
  const nextSnapshot: FederalKeyVotesSnapshot = {
    ...structuredClone(snapshot),
    fetchedAt: T1,
    misses: snapshot.misses.map((row, index) => index === 0 ? { ...row, reason: `${row.reason} Exact review update.` } : row),
    lawMisses: [{ id: "law-title-audit", reason: "Exact law-title resolution gap." }],
  };
  const nextPositions: FederalKeyVotePositions = {
    ...structuredClone(positions),
    fetchedAt: T1,
    note: `${positions.note ?? ""} Exact coverage update.`,
  };
  const readModel = { formatVersion: 1 as const, selectionVersion: "v1" as const, snapshot: nextSnapshot, positions: nextPositions };
  const next = {
    ...prior,
    readModel,
    civicRecords: civicRecordsFor("FEDERAL_KEY_VOTE", readModel),
  };
  const changeSet = candidateChangeSet(next, prior.readModel);
  assert.deepEqual(changeSet.added.map(({ key }) => key), ["law-miss:law-title-audit"]);
  assert.deepEqual(changeSet.changed.map(({ key }) => key), [
    "projection:position-coverage-note",
    `selection-miss:${miss.id}:${miss.chamber}`,
  ]);
  assert.equal(
    changeSet.changed.some(({ key }) => key.startsWith("entry:") || key.startsWith("positions:")),
    false,
    "coverage-only facts cannot falsely report a selected question or official position map change",
  );
  assert.equal(prior.civicRecords, undefined, "the read model is the one copy of each key vote; validation derives its members");
});

test("duplicate key-vote coverage-miss identities fail closed before promotion", async () => {
  const seed = await keyVoteSeed();
  assert.ok(seed.snapshot.misses.length > 0);
  const snapshots: FederalKeyVotesSnapshot[] = [
    {
      ...structuredClone(seed.snapshot),
      fetchedAt: T0,
      misses: [...seed.snapshot.misses, structuredClone(seed.snapshot.misses[0]!)],
    },
    {
      ...structuredClone(seed.snapshot),
      fetchedAt: T0,
      lawMisses: [
        { id: "same-law-gap", reason: "first exact gap" },
        { id: "same-law-gap", reason: "conflicting duplicate gap" },
      ],
    },
  ];
  for (const snapshot of snapshots) {
    const candidate = federalKeyVotesCandidate({
      acquisitions: acquisitionsForKeyVotes(snapshot),
      retrievedAt: T0,
      snapshot,
      positions: { ...structuredClone(seed.positions), fetchedAt: T0 },
    });
    const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "federal-key-votes", candidate, T0);
    assert.equal(outcome.candidate.state, "PARSE_INVALID");
    assert.equal(outcome.candidate.receipt?.checks.find(({ check }) => check === "SCHEMA_PARSE_VALIDITY")?.code, "CIVIC_RECORD_KEYS_DUPLICATED");
    assert.equal(outcome.promoted, null);
  }
});

test("bad selected-roll positions are held and the prior federal-key-vote version remains live", async () => {
  const seed = await keyVoteSeed();
  const store = new MemoryRoutineDataStore();
  const snapshot = { ...structuredClone(seed.snapshot), fetchedAt: T0 };
  const positions = { ...structuredClone(seed.positions), fetchedAt: T0 };
  const good = federalKeyVotesCandidate({ acquisitions: acquisitionsForKeyVotes(snapshot), retrievedAt: T0, snapshot, positions });
  await processRegisteredManualCandidate(store, "federal-key-votes", good, T0);

  const badPositions = structuredClone(positions) as FederalKeyVotePositions;
  delete badPositions.positions[Object.keys(badPositions.positions)[0]];
  const badSnapshot = { ...structuredClone(snapshot), fetchedAt: T1 };
  const bad = federalKeyVotesCandidate({ acquisitions: acquisitionsForKeyVotes(badSnapshot, "bad"), retrievedAt: T1, snapshot: badSnapshot, positions: { ...badPositions, fetchedAt: T1 } });
  const refused = await processRegisteredManualCandidate(store, "federal-key-votes", bad, T1);
  assert.equal(refused.candidate.state, "SEMANTIC_INVALID");
  assert.equal(refused.promoted, null);
  assert.equal((await store.readPromotion("FEDERAL_KEY_VOTE", FEDERAL_KEY_VOTE_SCOPE))?.versionId, good.id);
});

test("source failure is a durable data-plane outcome and never erases roll-call LKG", async () => {
  const seed = await rollCallSeed();
  const store = new MemoryRoutineDataStore();
  const good = federalRollCallsCandidate({
    acquisitions: acquisitionsForRollCalls(seed.snapshot), retrievedAt: T0,
    expectedCongress: seed.snapshot.congress, expectedSession: seed.snapshot.session,
    snapshot: structuredClone(seed.snapshot), billSummaries: structuredClone(seed.billSummaries),
  });
  await processRegisteredManualCandidate(store, "congress-rollcalls", good, T0);
  const failed = failedAcquisitionCandidate({
    sourceId: FEDERAL_VOTES_SOURCE_ID,
    recordClass: "FEDERAL_ROLL_CALL",
    scope: FEDERAL_ROLLCALL_SCOPE,
    requestedUrl: "https://clerk.house.gov/evs/2026/roll999.xml",
    attemptedAt: T1,
    failureDetail: "official publisher unavailable",
    parserVersion: FEDERAL_VOTES_PARSER_VERSION,
  });
  const outcome = await processRegisteredManualCandidate(store, "congress-rollcalls", failed, T1);
  assert.equal(outcome.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.events(failed.id)).at(-1)?.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("FEDERAL_ROLL_CALL", FEDERAL_ROLLCALL_SCOPE))?.versionId, good.id);
});

test("a store error never opens either tracked first seed", async () => {
  let candidateReads = 0;
  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { candidateReads += 1; return null; },
  };
  const [rollCalls, keyVotes] = await Promise.all([
    readFederalRollCallsProjection({ store: brokenStore, bypassCache: true }),
    readFederalKeyVotesProjection({ store: brokenStore, bypassCache: true }),
  ]);
  assert.equal(rollCalls.kind, "STORE_UNREACHABLE");
  assert.equal(keyVotes.kind, "STORE_UNREACHABLE");
  assert.equal(candidateReads, 0);
});

test("a roll-call acquisition with an answered absent pointer refuses rather than opening a seed", () => {
  const absent = {
    kind: "NOT_RECORDED" as const,
    value: null,
    metadata: {
      recordClass: "FEDERAL_ROLL_CALL" as const,
      scope: FEDERAL_ROLLCALL_SCOPE,
      sourceId: null,
      version: null,
      versionId: null,
      lastKnownGoodVersionId: null,
      sourceThrough: null,
      retrievedAt: null,
      promotedAt: null,
      stale: "UNKNOWN" as const,
      staleAt: null,
    },
    detail: "The canonical store answered with no pointer.",
  };
  assert.throws(() => billSummariesForRollCallAcquisition(absent), /The canonical store answered with no pointer\./);

  const unreachable = {
    ...absent,
    kind: "STORE_UNREACHABLE" as const,
    code: "STORE_READ_FAILED" as const,
    detail: "database unavailable",
  };
  assert.throws(
    () => billSummariesForRollCallAcquisition(unreachable),
    /database unavailable/,
    "a store failure must not be relabeled as first-seed absence",
  );
});

test("the two live federal acquisition commands have no circular canonical-pointer prerequisite", () => {
  const rollCalls = readFileSync("scripts/fetch-votes.mts", "utf8");
  assert.match(rollCalls, /billSummariesForRollCallAcquisition\(previous\)/);
  assert.doesNotMatch(rollCalls, /previous\.kind\s*!==\s*"PROMOTED"/);

  const keyVotes = readFileSync("scripts/fetch-key-vote-positions.mts", "utf8");
  assert.doesNotMatch(keyVotes, /readFederalKeyVotesProjection/);
  assert.doesNotMatch(keyVotes, /current\.kind\s*!==\s*"PROMOTED"/);
  assert.match(keyVotes, /federalKeyVoteSelectionV1Snapshot/);
});
