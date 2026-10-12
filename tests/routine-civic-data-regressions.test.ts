import assert from "node:assert/strict";
import test from "node:test";

import { classifyAgendaPublication } from "../lib/ask/agenda-publication.ts";
import { answers } from "../lib/answerability/record-class.ts";
import { nhMembersCandidate } from "../lib/civic-data/candidate-builders.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";

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

test("PDC: independently sourced NH members publish without a whole-chamber floor", () => {
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
  assert.equal(result.state, "VALIDATED");
  assert.equal(
    result.receipt.checks.find((check) => check.check === "DEPENDENT_READ_MODEL_VALIDITY")?.code,
    "DEPENDENT_CONSUMERS_ACCEPT",
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

test("NH publishes exact matched current members while unmatched and former rows remain outside the new fact set", () => {
  const member: NhMembers[number] = { chamber: "H", familyName: "Matched", givenName: "Member", middleName: null,
    seatNo: "1", county: "Merrimack", district: "Merrimack 1", electedStatus: "INCUMBENT", party: "U", title: "Representative",
    phone: null, email: null, town: "Concord", committees: [] };
  const members: NhMembers = [member, { ...member, seatNo: "2", familyName: "Unresolved" }, { ...member, seatNo: "3", electedStatus: "FORMER" }];
  const identity = exactNhIdentitySeed([member]);
  const candidate = nhMembersCandidate({ rawText: "three source rows", finalUrl: "https://gc.nh.gov/downloads/Members.txt",
    httpStatus: 200, retrievedAt: "2026-09-08T12:00:00.000Z", ...identity,
    identityCrosswalk: { ...identity.identityCrosswalk, unresolved: ["Member Unresolved lacks an exact official identity"] },
    extraction: { members, counts: { logicalInput: 3, produced: 3, dropped: 0, statedTotal: null, verdict: "COULD_NOT_ASSERT" },
      byStatus: { INCUMBENT: 2, NEW: 0, FORMER: 1, UNSTATED: 0 }, byChamber: { H: 3, S: 0 } } });
  assert.equal(validateRoutineCandidate(candidate, null, "2026-09-08T12:00:00.000Z").state, "VALIDATED");
  assert.equal(candidate.normalization.outputRecords, 1);
  assert.equal(candidate.normalization.droppedRecords, 2);
  assert.equal(candidate.horizon.returnedRecords, 1);
  assert.equal(candidate.horizon.claimsComplete, false);
  assert.equal(candidate.absence.claimsAbsence, false);
  assert.deepEqual((candidate.normalizedPayload as { unresolved: string[] }).unresolved, ["Member Unresolved lacks an exact official identity"]);
});
