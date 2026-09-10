import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { classifyAgendaPublication } from "../lib/ask/agenda-publication.ts";
import { answers } from "../lib/answerability/record-class.ts";
import { nhMembersCandidate } from "../lib/civic-data/candidate-builders.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { decidingVotesFromActions } from "../scripts/law-votes-resolver.mts";

const read = <T>(path: string): T => JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as T;

type NhMembers = Parameters<typeof nhMembersCandidate>[0]["extraction"]["members"];

function exactNhIdentitySeed(members: NhMembers) {
  const current = members.filter((member) => member.electedStatus === "INCUMBENT" || member.electedStatus === "NEW");
  return {
    rawIdentityText: "explicit deterministic official PersonID seed",
    identityFinalUrl: "https://gc.nh.gov/dynamicdatadump/legislators.txt",
    identityHttpStatus: 200,
    identityCrosswalk: {
      matches: current.map((member, index) => ({
        member,
        officialPersonId: String(index + 1),
        officeholderId: `nh-general-court:${index + 1}`,
        matchBasis: "EXACT_OFFICIAL_NAME_BODY" as const,
      })),
      sourceVersion: "deterministic-official-person-id-seed",
      observedIdentityRows: current.length,
      ordinaryMatches: current.length,
      reviewedExceptionMatches: 0,
    },
  };
}

test("RCD-9: the current NH holding cannot regress to the disproved no-question absence", () => {
  const ballot = read<{
    contests: { id: string; type: string }[];
    measures: { contestId: string; questionText: string }[];
    absences: { statement: string }[];
  }>("data/states/nh/ballot/nh-merrimack-2026.json");
  assert.ok(ballot.contests.some((row) => row.id === "ballot-nh-merrimack:cacr-13" && row.type === "MEASURE"));
  assert.ok(ballot.measures.some((row) => row.contestId === "ballot-nh-merrimack:cacr-13" && row.questionText.includes("register of probate")));
  assert.ok(ballot.absences.every((row) => !/no statewide ballot question/i.test(row.statement)));
});

test("RCD-9: the recent House window reaches the official current roll 295", () => {
  const snapshot = read<{ votes: { chamber: string; congress: number; session: number; rollNumber: number }[] }>(
    "data/votes/votes-snapshot.json",
  );
  const rolls = snapshot.votes
    .filter((vote) => vote.chamber === "house" && vote.congress === 119 && vote.session === 2)
    .map((vote) => vote.rollNumber);
  assert.equal(Math.max(...rolls), 295);
  assert.equal(Math.min(...rolls), 276, "the bounded 20-roll window must remain explicit");
});

test("RCD-9: CARES has no fabricated House member positions for an unrelated 2019 vote", () => {
  const snapshot = read<{
    entries: { id: string; house: unknown[]; houseNote?: string }[];
  }>("data/votes/key-votes-snapshot.json");
  const positions = read<{ positions: Record<string, unknown> }>("data/votes/key-vote-positions.json");
  const cares = snapshot.entries.find((entry) => entry.id === "cares-act");
  assert.ok(cares);
  assert.deepEqual(cares.house, []);
  assert.match(cares.houseNote ?? "", /voice vote on March 27, 2020/i);
  assert.ok(Object.keys(positions.positions).every((key) => !key.startsWith("cares-act|house|")));
});

test("RCD-9: a later voice decision suppresses an older recorded vote on earlier text", () => {
  const votes = decidingVotesFromActions([
    {
      actionDate: "2019-07-17",
      type: "Floor",
      text: "Passed House by the Yeas and Nays: 419 - 6.",
      recordedVotes: [{ chamber: "House", congress: 116, sessionNumber: 1, rollNumber: 493, url: "https://clerk.house.gov/evs/2019/roll493.xml" }],
    },
    {
      actionDate: "2020-03-27",
      type: "ResolvingDifferences",
      text: "House agreed to the Senate amendment by voice vote.",
      recordedVotes: [],
    },
    {
      actionDate: "2020-03-25",
      type: "Floor",
      text: "Passed Senate by Yea-Nay Vote. 96 - 0.",
      recordedVotes: [{ chamber: "Senate", congress: 116, sessionNumber: 2, rollNumber: 80, url: "https://senate.gov/vote80" }],
    },
  ]);
  assert.deepEqual(votes.map((vote) => `${vote.chamber}:${vote.rollNumber}`), ["Senate:80"]);
});

test("RCD-9: an agenda index can never answer what was decided", () => {
  assert.equal(answers("AGENDA", "WHAT_WAS_DECIDED"), false);
  assert.equal(answers("ROLL_CALL", "WHAT_WAS_DECIDED"), true, "positive control");
});

test("RCD-9: a blocked route remains our acquisition gap, never an official absence", () => {
  const reading = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "meeting-1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    discoveredDocumentUrl: "https://example.gov/agenda.pdf",
    routeAttempts: [{
      meetingId: "meeting-1",
      routeId: "official:direct",
      outcome: "BLOCKED",
      attemptedAt: "2026-09-07T12:00:00.000Z",
      note: "HTTP 403",
    }],
    now: Date.parse("2026-09-07T12:00:00.000Z"),
  });
  assert.equal(reading.acquisition, "ROUTE_BLOCKED");
  assert.equal(reading.gap?.whose, "OURS");
  assert.equal(reading.alternateSearchOpen, true);
});

test("RCD-9: a freshly fetched stale state roster is refused", () => {
  const member = (chamber: "H" | "S", seatNo: string, district: string) => ({
    chamber,
    familyName: chamber === "H" ? "House" : "Senate",
    givenName: "Member",
    middleName: null,
    seatNo,
    county: "Merrimack",
    district,
    electedStatus: "INCUMBENT" as const,
    party: "U",
    title: chamber === "H" ? "Representative" : "Senator",
    phone: null,
    email: `${chamber.toLowerCase()}${seatNo}@leg.state.nh.us`,
    town: "Concord",
    committees: [],
  });
  const extraction = {
    members: [member("H", "1", "Merrimack 1"), member("S", "2", "15")],
    counts: { logicalInput: 2, produced: 2, dropped: 0, statedTotal: null, verdict: "COULD_NOT_ASSERT" as const },
    byStatus: { INCUMBENT: 2, NEW: 0, FORMER: 0, UNSTATED: 0 },
    byChamber: { H: 1, S: 1 },
  };
  const base = nhMembersCandidate({
    rawText: "official roster bytes",
    finalUrl: "https://gc.nh.gov/downloads/Members.txt",
    httpStatus: 200,
    retrievedAt: "2026-09-07T12:00:00.000Z",
    extraction,
    ...exactNhIdentitySeed(extraction.members),
  });
  const stale = { ...base, temporal: { ...base.temporal, sourceThrough: "2024-12-01", staleAtRetrieval: true } };
  const result = validateRoutineCandidate(stale, null, "2026-09-07T12:00:00.000Z");
  assert.equal(result.state, "TEMPORAL_INVALID");
  assert.equal(result.receipt.checks.find((check) => check.check === "TEMPORAL_VALIDITY")?.code, "FRESH_FETCH_STALE_FACTS");
});

test("PDC: a thin NH response with one plausible member per chamber cannot replace LKG", () => {
  const member = (chamber: "H" | "S", seatNo: string, district: string) => ({
    chamber,
    familyName: chamber === "H" ? "House" : "Senate",
    givenName: "Member",
    middleName: null,
    seatNo,
    county: "Merrimack",
    district,
    electedStatus: "INCUMBENT" as const,
    party: "U",
    title: chamber === "H" ? "Representative" : "Senator",
    phone: null,
    email: `${chamber.toLowerCase()}${seatNo}@leg.state.nh.us`,
    town: "Concord",
    committees: [],
  });
  const extraction = {
    members: [member("H", "1", "Merrimack 1"), member("S", "2", "15")],
    counts: { logicalInput: 2, produced: 2, dropped: 0, statedTotal: null, verdict: "COULD_NOT_ASSERT" as const },
    byStatus: { INCUMBENT: 2, NEW: 0, FORMER: 0, UNSTATED: 0 },
    byChamber: { H: 1, S: 1 },
  };
  const candidate = nhMembersCandidate({
    rawText: "truncated but parseable official roster bytes",
    finalUrl: "https://gc.nh.gov/downloads/Members.txt",
    httpStatus: 200,
    retrievedAt: "2026-09-08T12:00:00.000Z",
    extraction,
    ...exactNhIdentitySeed(extraction.members),
  });
  const result = validateRoutineCandidate(candidate, null, "2026-09-08T12:00:00.000Z");
  assert.equal(result.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(
    result.receipt.checks.find((check) => check.check === "DEPENDENT_READ_MODEL_VALIDITY")?.code,
    "DEPENDENT_CONSUMER_REJECTED",
  );
});

test("RCD-9: the current NH parser expires before the next biennial roster", () => {
  const members: NhMembers = [{
    chamber: "H", familyName: "House", givenName: "Member", middleName: null,
    seatNo: "1", county: "Merrimack", district: "Merrimack 1", electedStatus: "INCUMBENT",
    party: "U", title: "Representative", phone: null, email: "member@leg.state.nh.us", town: "Concord", committees: [],
  }];
  const candidate = nhMembersCandidate({
    rawText: "official next-term roster bytes",
    finalUrl: "https://gc.nh.gov/downloads/Members.txt",
    httpStatus: 200,
    retrievedAt: "2027-01-02T12:00:00.000Z",
    extraction: {
      members,
      counts: { logicalInput: 1, produced: 1, dropped: 0, statedTotal: null, verdict: "COULD_NOT_ASSERT" },
      byStatus: { INCUMBENT: 1, NEW: 0, FORMER: 0, UNSTATED: 0 },
      byChamber: { H: 1, S: 0 },
    },
    ...exactNhIdentitySeed(members),
  });
  const result = validateRoutineCandidate(candidate, null, "2027-01-02T12:00:00.000Z");
  assert.equal(candidate.temporal.expectedVersion, "2027-2028");
  assert.equal(result.state, "TEMPORAL_INVALID");
  assert.equal(result.receipt.checks.find((check) => check.check === "TEMPORAL_VALIDITY")?.code, "WRONG_PERIOD_OR_VINTAGE");
});
