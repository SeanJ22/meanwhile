import assert from "node:assert/strict";
import test from "node:test";
import { projectHeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { HeldPlaceFamilies } from "../lib/civic-data/held-place-families.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const neighbour = "ocd-division/country:us/state:az/county:pima";
const at = "2026-09-30T06:00:00.000Z";
const provenance = { sourceUrl: "https://cochise.az.gov/calendar", collectedAt: at };
const published = <T>(value: T) => ({ kind: "PROMOTED", value } as CivicDataReadResult<T>);
const registry = published({ registry: { bodies: [{ id: "shared-body", ocdId: county,
  alsoServesOcdIds: [neighbour], name: "Shared district board", bodyClass: "BOARD", provenance }] },
  bodyRosters: [{ bodyId: "shared-body", ...provenance, members: [{ id: "member", name: "Published Member",
    officeTitle: "Chair", websiteUrl: null }] }] } as unknown as RegistryRuntimeReadModel);
const meeting = { id: "meeting:one", bodyId: "shared-body", ocdId: county, title: "Board meeting",
  startsAt: "2026-10-01T02:00:00.000Z", timeZone: "America/Phoenix", startPrecision: "DAY",
  location: null, online: null, status: "SCHEDULED", provenance };
const meetings = published({ meetings: [meeting] } as unknown as MeetingsSnapshot);

test("held fields reach every served division without filling inventory or missing meeting fields", () => {
  const primary = projectHeldPlaceCapture([county], registry, [meetings], at);
  const secondary = projectHeldPlaceCapture([neighbour], registry, [meetings], at);
  assert.deepEqual(secondary, primary, "a shared body serves either place regardless of the original ZIP/job");
  const ids = primary.held.map(field => field.checklistId);
  assert.deepEqual(ids, ["GOV-01", "OFF-04", "OFF-08", "MTG-05", "MTG-06", "MTG-10", "MTG-12"]);
  assert.ok(!ids.includes("OFF-01") && !ids.includes("OFF-05"));
  assert.ok(!ids.includes("MTG-03") && !ids.includes("MTG-16") && !ids.includes("MTG-07") && !ids.includes("MTG-08"));
  assert.equal(primary.held.find(field => field.checklistId === "MTG-06")?.freshUntil, "2026-09-30T07:00:00.000Z");
  assert.equal(projectHeldPlaceCapture(["unrelated-division"], registry, [meetings], at).held.length, 0);
});

test("only published present fields count, and failed reads cannot look like empty holdings", () => {
  const timed = published({ meetings: [{ ...meeting, startPrecision: "MINUTE", online: { url: "https://cochise.az.gov/meeting" } }] } as unknown as MeetingsSnapshot);
  const result = projectHeldPlaceCapture([county], registry, [timed], at);
  assert.ok(result.held.some(field => field.checklistId === "MTG-07"));
  assert.ok(result.held.some(field => field.checklistId === "MTG-08"));
  const failure = { kind: "STORE_UNREACHABLE", metadata: { recordClass: "MEETING", scope: "held" } } as unknown as CivicDataReadResult<MeetingsSnapshot>;
  assert.throws(() => projectHeldPlaceCapture([county], registry, [failure], at), /HELD_PLACE_READ_FAILED/);
});

test("retained roster contacts keep separate values and their earlier source dates", () => {
  const older = "2026-08-01T00:00:00.000Z";
  const sourceUrl = "https://cochise.az.gov/old-roster";
  const contacts = published({ ...registry.value!, bodyRosters: [{ ...registry.value!.bodyRosters[0], members: [{
    ...registry.value!.bodyRosters[0].members[0], email: "office@cochise.az.gov", phone: "520-555-0100",
    websiteUrl: "https://cochise.az.gov/member", termNote: "Term ends in 2028",
    retainedFieldSources: { email: { sourceUrl, sourceOrg: "County", collectedAt: older },
      websiteUrl: { sourceUrl, sourceOrg: "County", collectedAt: older } },
  }] }] });
  const result = projectHeldPlaceCapture([county], contacts, [], at);
  const email = result.held.find(field => field.checklistId === "OFF-09" && (field.value as { email?: string }).email);
  const phone = result.held.find(field => field.checklistId === "OFF-09" && (field.value as { phone?: string }).phone);
  const profile = result.held.find(field => (field.value as { websiteUrl?: string }).websiteUrl);
  assert.equal(email?.checkedAt, older);
  assert.equal(email?.sourceUrl, sourceUrl);
  assert.equal(phone?.checkedAt, at);
  assert.equal(profile?.checkedAt, older);
  assert.ok(result.held.some(field => field.checklistId === "OFF-06"));
});

test("national seats and campaign totals reuse exact division and target joins across ZIPs", () => {
  const families = { rosters: [{ officeholders: [{ id: "official:1", name: "Official One", officeTitle: "Representative",
    provenance, termStart: "2025-01-03", termEnd: "2027-01-03", email: null, phone: null, contactFormUrl: null, partyLabel: null }],
    divisions: [{ officeholderId: "official:1", ocdId: county }, { officeholderId: "official:1", ocdId: neighbour }] }],
    funding: { candidates: [{ fecCandidateId: "H000001", principalCommitteeId: "C000001", cycle: 2026,
      name: "Official One", targetKeys: ["official:1"], provenance,
      totals: { receipts: 0, disbursements: 15, cashOnHand: 20, coverageEndDate: "2026-06-30" } },
      { fecCandidateId: "H000002", principalCommitteeId: "C000002", cycle: 2026, name: "Official One",
        targetKeys: ["unmatched-same-name"], provenance, totals: { receipts: 100 } }] } } as unknown as HeldPlaceFamilies;
  const primary = projectHeldPlaceCapture([county], registry, [], at, families);
  const secondary = projectHeldPlaceCapture([neighbour], registry, [], at, families);
  assert.deepEqual(primary, secondary);
  assert.ok(primary.held.some(field => field.subjectId === "official:1" && field.checklistId === "OFF-06"));
  const totals = primary.held.find(field => field.checklistId === "CAM-05");
  assert.equal((totals?.value as { amount: number }).amount, 0, "published zero remains a zero");
  assert.ok(!primary.subjects.some(subject => subject.id.includes("H000002")), "same name cannot bind another committee");
  assert.equal(projectHeldPlaceCapture(["other-county"], registry, [], at, families).held.length, 0);
});

test("ballot candidacies, filings and voting sites retain their exact place and publication meaning", () => {
  const state = "ocd-division/country:us/state:az";
  const families = { ballots: [{ election: { id: "az-election", date: "2026-11-03", state: "AZ", name: "General election" },
    contests: [{ id: "contest-1", title: "County Supervisor", ocdId: county, electionId: "az-election", voteFor: 1, termYears: 4, provenance }],
    candidacies: [{ id: "candidate-1", contestId: "contest-1", givenName: "Candidate", familyName: "One", incumbent: null, provenance }],
    measures: [] }],
    votingSites: { jurisdictions: [{ ocdId: county, name: "County", model: "VOTE_CENTER", election: "2026 General",
      sites: [{ id: "site-1", name: "Public hall", address: "1 Main Street" }], refusal: null, sourceUrl: provenance.sourceUrl, collectedAt: at },
      { ocdId: neighbour, sites: [], refusal: { wall: "unread" } }] },
    filings: [{ id: "filing-1", kind: "CANDIDATE_FILING_DOCUMENT", bodyId: "county-body", bodyName: "County",
      ocdId: county, jurisdictionName: "County", sourceUrl: provenance.sourceUrl, documentUrl: "https://cochise.az.gov/filing.pdf",
      collectedAt: at, verifiedAt: at, facts: { candidateName: "Filed Candidate", office: "Supervisor" } }],
    electionDates: [{ state: "AZ", electionDay: "2026-11-03", sourceUrl: provenance.sourceUrl,
      collectedAt: "2026-08-01", steps: [{ label: "Registration deadline", date: "2026-10-05", detail: "11:59 pm" }] }],
  } as unknown as HeldPlaceFamilies;
  const result = projectHeldPlaceCapture([county, state], registry, [], at, families);
  assert.ok(result.held.some(field => field.subjectId === "candidate-1" && field.checklistId === "CAN-02"));
  assert.ok(!result.held.some(field => field.checklistId === "ELE-07"), "filing and candidacy membership do not claim certification");
  assert.deepEqual(result.held.filter(field => field.subjectId === "filing-1").map(field => field.checklistId), ["CAN-01"]);
  assert.ok(result.held.some(field => field.checklistId === "ELE-09"));
  const deadline = result.held.find(field => field.checklistId === "ELE-08");
  assert.equal(deadline?.state, "held");
  assert.equal(deadline?.checkedAt, "2026-08-01");
  assert.ok(Date.parse(deadline!.freshUntil) < Date.parse(at), "adopted calendar is not newly checked by reading it");
  const elsewhere = projectHeldPlaceCapture([neighbour], registry, [], at, families);
  assert.ok(!elsewhere.subjects.some(subject => subject.kind === "contest" || subject.kind === "deadline"));
});

test("unmatched state finance and unreported totals cannot fill published-money fields", () => {
  const makeRecord = (filingState: string, targetKeys: string[], totals: Record<string, unknown>) => ({ dataClass: "STATE_COMMITTEE",
    jurisdiction: "AZ", electionYear: 2026, registeredName: "Committee", candidateNameAsFiled: "Member",
    committeeId: "C1", agency: "Secretary of State", filingsUrl: provenance.sourceUrl, checkedAt: at,
    provenance: { ...provenance, verifiedAt: at }, filingState, targetKeys,
    match: { allThreeAgree: true }, totals,
  });
  const families = { stateMoney: [{ records: [makeRecord("FILED", ["member"], { receipts: 0, expenditures: null, cashOnHand: null, coveringPeriod: "2026 Q2" }),
    makeRecord("LEAD", ["member"], { receipts: 999 }), makeRecord("FILED", ["unknown-person"], { receipts: 888 })] }] } as unknown as HeldPlaceFamilies;
  const result = projectHeldPlaceCapture([county], registry, [], at, families);
  assert.equal(result.held.filter(field => field.checklistId === "CAM-05").length, 1);
  assert.equal((result.held.find(field => field.checklistId === "CAM-05")?.value as { amount: number }).amount, 0);
  assert.ok(!result.held.some(field => field.checklistId === "CAM-06" || field.checklistId === "CAM-07"));
});
