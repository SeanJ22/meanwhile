import assert from "node:assert/strict";
import test from "node:test";

import {
  dotGovCandidate,
  meetingsCandidate,
  njMorrisFilingCandidate,
} from "../lib/civic-data/candidate-builders.ts";
import { morrisCurrentFilingDocumentSet } from "../lib/hunt/nj-filing.ts";
import { processRoutineCandidate, type PromotionOutcome } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { RoutineCandidate, RoutineChangeSet } from "../lib/civic-data/types.ts";
import {
  MEETING_READER_SERVING_WINDOW_CONTRACT,
  meetingReaderServingWindowAt,
} from "../lib/meetings/constants.ts";

const FIRST = "2026-09-08T00:00:00.000Z";
const SECOND = "2026-09-08T01:00:00.000Z";
const THIRD = "2026-09-08T02:00:00.000Z";

type MeetingSnapshot = Parameters<typeof meetingsCandidate>[0]["snapshot"];
type NjBallot = Parameters<typeof njMorrisFilingCandidate>[0]["ballot"];
type DotGovSnapshot = Parameters<typeof dotGovCandidate>[0]["snapshot"];

function changes(outcome: PromotionOutcome): RoutineChangeSet {
  const result = outcome.candidate.candidate.changeSet;
  assert.ok(result, "the persisted candidate carries its exact change-set receipt");
  return result;
}

function changeKeys(changeSet: RoutineChangeSet): {
  added: string[];
  changed: string[];
  removed: string[];
  held: string[];
} {
  return {
    added: changeSet.added.map((row) => row.key),
    changed: changeSet.changed.map((row) => row.key),
    removed: changeSet.removed.map((row) => row.key),
    held: changeSet.held.map((row) => row.code),
  };
}

async function promotedPointer(store: MemoryRoutineDataStore, candidate: RoutineCandidate) {
  const pointer = await store.readPromotion(candidate.recordClass, candidate.scope);
  assert.ok(pointer, `${candidate.sourceId} has an LKG pointer`);
  return pointer;
}

async function assertRefusalHoldsExactLkg(input: {
  store: MemoryRoutineDataStore;
  bad: RoutineCandidate;
  expectedState: string;
  expectedCode: string;
}): Promise<void> {
  const before = await promotedPointer(input.store, input.bad);
  const outcome = await processRoutineCandidate(input.store, input.bad, THIRD);
  assert.equal(outcome.promoted, null);
  assert.equal(outcome.candidate.state, input.expectedState);
  assert.equal(outcome.candidate.failureCode, input.expectedCode);
  assert.equal(outcome.candidate.receipt?.decision, "FAIL");
  assert.deepEqual(
    await promotedPointer(input.store, input.bad),
    before,
    `${input.bad.sourceId} validation failure must not move or rewrite the LKG pointer`,
  );
}

function meetingSnapshot(version: string, changed: boolean): MeetingSnapshot {
  const meetingA = {
    id: "calendar:a",
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    ocdId: "ocd-division/country:us/state:az/county:pima",
    startsAt: changed ? "2026-09-10T18:00:00.000Z" : "2026-09-10T17:00:00.000Z",
    provenance: { sourceUrl: "https://calendar.google.com/calendar/u/0/r", collectedAt: version },
  };
  const meetings = changed
    ? [
        meetingA,
        {
          id: "calendar:c",
          bodyId: "ocd-division/country:us/state:az/county:pima#governing",
          ocdId: "ocd-division/country:us/state:az/county:pima",
          startsAt: "2026-09-11T17:00:00.000Z",
          provenance: { sourceUrl: "https://calendar.google.com/calendar/u/0/r", collectedAt: version },
        },
      ]
    : [
        meetingA,
        {
          id: "calendar:b",
          bodyId: "ocd-division/country:us/state:az/county:pima#governing",
          ocdId: "ocd-division/country:us/state:az/county:pima",
          // Already outside the Reader window at SECOND; an incomplete source horizon may remove it only with the
          // source-scoped window evidence supplied below.
          startsAt: "2026-04-01T17:00:00.000Z",
          provenance: { sourceUrl: "https://calendar.google.com/calendar/u/0/r", collectedAt: version },
        },
      ];
  return {
    formatVersion: 1,
    generatedAt: version,
    counts: { fresh: 2, carried: 0, total: 2 },
    sources: [{ source: "calendar", ok: true, fetched: 2, normalized: 2 }],
    meetings,
    agendaDocuments: changed
      ? [
          { id: "agenda:a", meetingId: "calendar:a" },
          { id: "agenda:c", meetingId: "calendar:c" },
        ]
      : [{ id: "agenda:a", meetingId: "calendar:a" }],
  };
}

function meetingCandidate(version: string, changed: boolean): RoutineCandidate {
  const servingWindow = meetingReaderServingWindowAt(version);
  assert.ok(servingWindow);
  return meetingsCandidate({
    snapshot: meetingSnapshot(version, changed),
    partition: {
      sourceName: "calendar",
      bodyId: "ocd-division/country:us/state:az/county:pima#governing",
      scope: "source:calendar:body:pima-governing",
    },
    requestedUrl: "https://calendar.google.com/calendar/u/0/r",
    finalUrl: "https://calendar.google.com/calendar/u/0/r",
    retrievedAt: version,
    removalEvidence: changed ? [{
      key: "meeting:calendar:b",
      code: "OUTSIDE_REGISTERED_SERVING_WINDOW",
      windowContract: MEETING_READER_SERVING_WINDOW_CONTRACT,
      lowerBound: servingWindow.lowerBound,
      upperBound: servingWindow.upperBound,
      priorStartsAt: "2026-04-01T17:00:00.000Z",
    }] : [],
  });
}

function njBallot(changed: boolean): NjBallot {
  const contest = {
    id: "contest:county",
    ocdId: "ocd-division/country:us/state:nj/county:morris",
    provenance: { sourceUrl: "https://www.morriscountyclerk.org/Elections/Current-Election-Candidates" },
  };
  return {
    formatVersion: 1,
    election: { id: "nj-2026-11-03", date: "2026-11-03" },
    contests: [contest],
    candidacies: changed
      ? [
          { id: "candidacy:a", contestId: contest.id, familyName: "ALPHA", givenName: "Changed" },
          { id: "candidacy:c", contestId: contest.id, familyName: "CHARLIE", givenName: "Case" },
        ]
      : [
          { id: "candidacy:a", contestId: contest.id, familyName: "ALPHA", givenName: "Ann" },
          { id: "candidacy:b", contestId: contest.id, familyName: "BRAVO", givenName: "Bob" },
        ],
    measures: [],
    absences: [],
    removals: changed ? [{ id: "candidacy:b", firstAbsentOn: "2026-09-08" }] : [],
  };
}

function njContacts(changed: boolean) {
  return {
    contacts: changed
      ? [
          { candidacyId: "candidacy:a", email: "changed@example.test" },
          { candidacyId: "candidacy:c", email: "c@example.test" },
        ]
      : [
          { candidacyId: "candidacy:a", email: "a@example.test" },
          { candidacyId: "candidacy:b", email: "b@example.test" },
        ],
  };
}

function njCandidate(version: string, changed: boolean): RoutineCandidate {
  const ballot = njBallot(changed);
  const refused = changed ? [{ key: "malformed-row", detail: "missing filed candidate name" }] : [];
  return njMorrisFilingCandidate({
    ballot,
    contacts: njContacts(changed),
    rawBodies: [`official clerk page ${version}`, `general PDF ${version}`, `school PDF ${version}`],
    currentDocumentSet: {
      generalCandidatesUrl: "https://www.morriscountyclerk.org/files/2026-general-election-candidates-090126.pdf",
      schoolCandidatesUrl: "https://www.morriscountyclerk.org/files/2026-general-school-candidates-090126.pdf",
    },
    finalUrl: "https://www.morriscountyclerk.org/files/current-general-election-candidates.pdf",
    retrievedAt: version,
    inputRecords: (ballot.candidacies?.length ?? 0) + refused.length,
    refused,
  });
}

function dotGovRows(changed: boolean) {
  const initial = Array.from({ length: 500 }, (_, index) => ({
    domain: `election-${String(index).padStart(3, "0")}.gov`,
    type: "County - Election", organization: `Example Election Authority ${index}`, suborganization: null, city: null, state: null,
  }));
  if (!changed) return initial;
  return [
    { ...initial[0]!, type: "State or territory - Election" },
    ...initial.slice(2),
    { domain: "election-new.gov", type: "County - Election", organization: "New Authority", suborganization: null, city: null, state: null },
  ];
}

function dotGov(version: string, changed: boolean, sha?: string): RoutineCandidate {
  const domains = [...dotGovRows(changed), ...Array.from({ length: 14_500 }, (_, index) => ({
    domain: `government-${String(index).padStart(5, "0")}.gov`, type: "City", organization: `Example City ${index}`,
    suborganization: null, city: null, state: null,
  }))];
  const byType: Record<string, number> = {};
  for (const row of domains) byType[row.type] = (byType[row.type] ?? 0) + 1;
  const snapshot: DotGovSnapshot = {
    source: { sha: sha ?? (changed ? "b".repeat(40) : "a".repeat(40)), url: "https://github.com/cisagov/dotgov-data/blob/example/current-full.csv", readAt: version },
    counts: { domains: domains.length, electionDomains: 500, byType }, domains,
    boundary: "The CISA registry enumerates domains, never governments.",
  };
  return dotGovCandidate({
    snapshot,
    rawText: JSON.stringify(snapshot),
    finalUrl: "https://raw.githubusercontent.com/cisagov/dotgov-data/example/current-full.csv",
    retrievedAt: version,
  });
}

test("PDC-8 meetings: changed rows promote with exact added/changed/removed/held evidence; source-auth failure holds LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const initial = meetingCandidate(FIRST, false);
  assert.equal((await processRoutineCandidate(store, initial, FIRST)).candidate.state, "PROMOTED");

  const next = meetingCandidate(SECOND, true);
  const promoted = await processRoutineCandidate(store, next, SECOND);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(changes(promoted).outcome, "CHANGED");
  // A sitting's held agenda is one record keyed by the sitting: new sitting c brings `agenda-document:calendar:c`.
  assert.deepEqual(changeKeys(changes(promoted)), {
    added: ["meeting:calendar:c", "agenda-document:calendar:c"],
    changed: ["meeting:calendar:a"],
    removed: ["meeting:calendar:b"],
    held: [],
  });

  const bad: RoutineCandidate = {
    ...structuredClone(next),
    id: `${next.id}-unauthorized-final-host`,
    retrieval: { ...next.retrieval, finalUrl: "https://untrusted.example/meetings" },
  };
  await assertRefusalHoldsExactLkg({ store, bad, expectedState: "SOURCE_BLOCKED", expectedCode: "FINAL_ROUTE_NOT_REGISTERED" });
});

test("PDC-8 NJ filing: candidate/contact/removal changes and refused rows are exact; semantic failure holds LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const initial = njCandidate(FIRST, false);
  assert.equal((await processRoutineCandidate(store, initial, FIRST)).candidate.state, "PROMOTED");

  const next = njCandidate(SECOND, true);
  const promoted = await processRoutineCandidate(store, next, SECOND);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.deepEqual(changeKeys(changes(promoted)), {
    added: ["candidacy:candidacy:c", "removal:candidacy:b", "contact:candidacy:c"],
    changed: ["candidacy:candidacy:a", "contact:candidacy:a"],
    removed: ["candidacy:candidacy:b", "contact:candidacy:b"],
    held: ["NJ_FILING_ROW_REFUSED"],
  });
  assert.equal(changes(promoted).held[0]?.key, "malformed-row");
  assert.equal(changes(promoted).held[0]?.detail, "missing filed candidate name");

  const partialBallot = njBallot(false);
  const partial = njMorrisFilingCandidate({
    ballot: partialBallot,
    contacts: njContacts(false),
    rawBodies: ["official clerk page", "general PDF without the school PDF"],
    currentDocumentSet: {
      generalCandidatesUrl: "https://www.morriscountyclerk.org/files/2026-general-election-candidates-090126.pdf",
      schoolCandidatesUrl: "https://www.morriscountyclerk.org/files/2026-general-school-candidates-090126.pdf",
    },
    finalUrl: "https://www.morriscountyclerk.org/files/2026-general-election-candidates-090126.pdf",
    retrievedAt: THIRD,
    inputRecords: partialBallot.candidacies?.length ?? 0,
    refused: [],
  });
  await assertRefusalHoldsExactLkg({
    store,
    bad: partial,
    expectedState: "SEMANTIC_INVALID",
    expectedCode: "SEMANTIC_CONTRACT_VIOLATION",
  });

  const bad: RoutineCandidate = {
    ...structuredClone(next),
    id: `${next.id}-semantic-refusal`,
    semantics: { ...next.semantics, violations: ["fixture filing contradicts its contest"] },
  };
  await assertRefusalHoldsExactLkg({ store, bad, expectedState: "SEMANTIC_INVALID", expectedCode: "SEMANTIC_CONTRACT_VIOLATION" });
});

test("PDC-8 NJ filing: the clerk's unstamped 2026-09-18 revision is a current document set, to the validator as to the selector", async () => {
  // The candidate selector and the validator share one naming rule; the URLs are the clerk page's own hrefs.
  const CLERK = "https://www.morriscountyclerk.org/files/sharedassets/clerk";
  const general = `${CLERK}/v/12/elections/past-results/2026-general-candidates.pdf`;
  const school = `${CLERK}/v/14/elections/past-results/2026-general-school-candidates-082126.pdf`;
  const ballot = njBallot(false);
  const build = (generalCandidatesUrl: string) => njMorrisFilingCandidate({
    ballot,
    contacts: njContacts(false),
    rawBodies: ["official clerk page", "general PDF", "school PDF"],
    currentDocumentSet: { generalCandidatesUrl, schoolCandidatesUrl: school },
    finalUrl: "https://www.morriscountyclerk.org/files/current-general-election-candidates.pdf",
    retrievedAt: FIRST,
    inputRecords: ballot.candidacies?.length ?? 0,
    refused: [],
  });

  assert.deepEqual(morrisCurrentFilingDocumentSet([general, school]), { generalCandidatesUrl: general, schoolCandidatesUrl: school },
    "the selector takes the unstamped revision");
  const current = build(general);
  assert.deepEqual(current.semantics.violations, [], "the validator refused what the selector chose");
  assert.equal((await processRoutineCandidate(new MemoryRoutineDataStore(), current, FIRST)).candidate.state, "PROMOTED");

  // The rule still knows the clerk's other PDFs from the candidate list.
  const orderOfBallot = build(`${CLERK}/v/1/elections/past-results/2026-general-candidate-order-081026.pdf`);
  assert.ok(orderOfBallot.semantics.violations.some((violation) => /not both acquired/.test(violation)),
    "the candidate-order PDF was taken for the general candidate list");
});

test("PDC-8 dotgov: SHA-pinned domain changes are exact; dependent-consumer failure holds LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const initial = dotGov(FIRST, false);
  assert.equal((await processRoutineCandidate(store, initial, FIRST)).candidate.state, "PROMOTED");

  const next = dotGov(SECOND, true);
  const promoted = await processRoutineCandidate(store, next, SECOND);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.deepEqual(changeKeys(changes(promoted)), {
    added: ["domain:election-new.gov"],
    changed: ["domain:election-000.gov"],
    removed: ["domain:election-001.gov"],
    held: [],
  });

  const bad: RoutineCandidate = {
    ...structuredClone(next),
    id: `${next.id}-consumer-refusal`,
    dependentChecks: [{ consumer: "registered dotgov discovery operation", passed: false, detail: "fixture read model rejected" }],
  };
  await assertRefusalHoldsExactLkg({ store, bad, expectedState: "DEPENDENT_CONSUMER_INVALID", expectedCode: "DEPENDENT_CONSUMER_REJECTED" });
});

test("PDC-8 dotgov: a later registry commit whose hash sorts lower still promotes; the hash is an identity, not an order", async () => {
  // Which publication is newer is the acquisition order, never a string comparison of commit hashes.
  const store = new MemoryRoutineDataStore();
  const promotedOn0915 = dotGov(FIRST, false, "e68adb11" + "0".repeat(32));
  assert.equal((await processRoutineCandidate(store, promotedOn0915, FIRST)).candidate.state, "PROMOTED");

  const laterCommit = dotGov(SECOND, true, "11fe34b4" + "0".repeat(32));
  const later = await processRoutineCandidate(store, laterCommit, SECOND);
  assert.equal(later.candidate.state, "PROMOTED", `refused: ${later.candidate.failureCode ?? "none"}`);
  assert.equal((await promotedPointer(store, laterCommit)).receipt.candidateId, laterCommit.id, "the pointer moves to the later commit");

  // The order that remains: an acquisition older than the served one is still refused.
  const olderRead = dotGov("2026-09-07T23:00:00.000Z", false, "f".repeat(40));
  const refused = await processRoutineCandidate(store, olderRead, THIRD);
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.failureCode, "ACQUISITION_TIME_REGRESSION");
});

test("run 34232794631 regression: software CI red cannot fail, relabel, or revert a source, and another source still promotes", async () => {
  const store = new MemoryRoutineDataStore();
  const meetingGood = meetingCandidate(FIRST, false);
  const dotGovGood = dotGov(FIRST, false);
  assert.equal((await processRoutineCandidate(store, meetingGood, FIRST)).candidate.state, "PROMOTED");
  assert.equal((await processRoutineCandidate(store, dotGovGood, FIRST)).candidate.state, "PROMOTED");
  const meetingLkg = await promotedPointer(store, meetingGood);
  const dotGovLkg = await promotedPointer(store, dotGovGood);

  // A software-CI failure is independent and is not input to either source candidate or promotion door.
  let softwareCiRed = false;
  try {
    throw new Error("Build 34236904831: tests/office-opening-spell.test.ts M164 temporal boundary");
  } catch {
    softwareCiRed = true;
  }

  const meetingBadBase = meetingCandidate(SECOND, true);
  const meetingBad: RoutineCandidate = {
    ...meetingBadBase,
    id: `${meetingBadBase.id}-source-semantic-refusal`,
    semantics: {
      ...meetingBadBase.semantics,
      violations: [...meetingBadBase.semantics.violations, "Meeting candidate's own source-scoped semantic contract failed."],
    },
  };
  const refused = await processRoutineCandidate(store, meetingBad, SECOND);
  assert.equal(refused.candidate.state, "SEMANTIC_INVALID");
  assert.equal(refused.candidate.failureCode, "SEMANTIC_CONTRACT_VIOLATION");
  assert.equal(refused.candidate.receipt?.sourceId, meetingBad.sourceId);
  assert.equal(refused.candidate.receipt?.recordClass, meetingBad.recordClass);
  assert.equal(refused.candidate.receipt?.scope, meetingBad.scope);
  assert.doesNotMatch(refused.candidate.failureDetail ?? "", /M164|office-opening-spell|34232794631|34236904831/);
  assert.deepEqual(await promotedPointer(store, meetingGood), meetingLkg, "the refused meeting candidate cannot move or revert its LKG");
  assert.deepEqual(await promotedPointer(store, dotGovGood), dotGovLkg, "one source's refusal cannot affect another source's pointer");

  const dotGovNext = dotGov(THIRD, true);
  const unaffected = await processRoutineCandidate(store, dotGovNext, THIRD);
  assert.equal(softwareCiRed, true, "the independent software certification remains red in this scenario");
  assert.equal(unaffected.candidate.state, "PROMOTED", "the unaffected source continues to promote while software CI is independently red");
  assert.equal((await promotedPointer(store, dotGovNext)).versionId, dotGovNext.id);
  assert.deepEqual(await promotedPointer(store, meetingGood), meetingLkg, "promoting an unaffected source does not rewrite the held source's LKG");
  assert.deepEqual((await store.events(meetingBad.id)).map(({ state }) => state), ["FETCHED", "NORMALIZED", "SEMANTIC_INVALID"]);
});
