import assert from "node:assert/strict";
import test from "node:test";

import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import type { RoutineCandidate, RoutineRecordClass } from "../lib/civic-data/types.ts";

/*
 * A re-read that finds the same facts is not a change. The stamps stay on the
 * stored records; they only stop deciding.
 */

function candidate(recordClass: RoutineRecordClass, readModel: unknown): RoutineCandidate {
  return { recordClass, readModel, excludedFacts: [] } as unknown as RoutineCandidate;
}

function member(id: string, at: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name: "Assembly Member",
    phone: "609-555-0100",
    chamber: "lower",
    provenance: { sourceUrl: "https://www.njleg.state.nj.us/api/legislators", sourceOrg: "New Jersey Legislature", collectedAt: at, verifiedAt: at },
    ...over,
  };
}

function roll(id: string, at: string, over: Record<string, unknown> = {}) {
  return { id, officialRollCallId: id, billNumber: "A1", motion: "Third reading", date: "2026-06-30", yea: 50, nay: 20, absent: 5, nv: 5, result: "Passed", retrievedAt: at, ...over };
}

const EARLIER = "2026-09-24T18:00:03.000Z";
const LATER = "2026-09-24T19:10:04.000Z";

test("voting and money rechecks ignore collection stamps but keep actual election and filing facts", () => {
  const voting = (at: string, election = "November 3, 2026") => ({ jurisdictions: [{
    ocdId: "ocd-division/country:us/state:az/county:cochise", collectedAt: at, election,
    sourceUrl: "https://www.cochise.az.gov/elections", sites: [{ id: "center", name: "Vote center" }],
  }] });
  assert.equal(candidateChangeSet(candidate("VOTING_SITE", voting(LATER)), voting(EARLIER)).outcome, "UNCHANGED");
  assert.equal(candidateChangeSet(candidate("VOTING_SITE", voting(LATER, "November 2, 2026")), voting(EARLIER)).outcome, "CHANGED");
  const money = (at: string, raised = 100) => ({ records: [{ jurisdiction: "AZ", electionYear: 2026,
    committeeId: "committee", filingState: "FILED", checkedAt: at, totals: { raised },
    provenance: { sourceUrl: "https://seethemoney.az.gov/", collectedAt: at },
  }] });
  assert.equal(candidateChangeSet(candidate("STATE_CAMPAIGN_FINANCE", money(LATER)), money(EARLIER)).outcome, "UNCHANGED");
  assert.equal(candidateChangeSet(candidate("STATE_CAMPAIGN_FINANCE", money(LATER, 101)), money(EARLIER)).outcome, "CHANGED");
});

test("a roster re-read whose members differ only in provenance stamps is unchanged", () => {
  const prior = { roster: { officeholders: [member("nj-legislature:1", EARLIER), member("nj-legislature:2", EARLIER)] } };
  const next = { roster: { officeholders: [member("nj-legislature:1", LATER), member("nj-legislature:2", LATER)] } };
  const delta = candidateChangeSet(candidate("STATE_LEGISLATOR", next), prior);
  assert.equal(delta.outcome, "UNCHANGED");
  assert.deepEqual([delta.added, delta.changed, delta.removed].map((rows) => rows.length), [0, 0, 0]);
});

test("a roster fact is still a change, and the persisted before and after keep their stamps", () => {
  const prior = { roster: { officeholders: [member("nj-legislature:1", EARLIER), member("nj-legislature:2", EARLIER)] } };
  const next = { roster: { officeholders: [member("nj-legislature:1", LATER, { phone: "609-555-0199" }), member("nj-legislature:2", LATER)] } };
  const delta = candidateChangeSet(candidate("STATE_LEGISLATOR", next), prior);
  assert.equal(delta.outcome, "CHANGED");
  assert.deepEqual(delta.changed.map(({ key }) => key), ["member:nj-legislature:1"]);
  assert.equal((delta.changed[0]!.before as { provenance: { collectedAt: string } }).provenance.collectedAt, EARLIER);
  assert.equal((delta.changed[0]!.after as { provenance: { collectedAt: string } }).provenance.collectedAt, LATER);
  // Where the record was read from is a fact, not a stamp.
  const moved = { roster: { officeholders: [member("nj-legislature:1", LATER, { provenance: { ...member("x", LATER).provenance, sourceUrl: "https://example.org/other" } }), member("nj-legislature:2", LATER)] } };
  assert.equal(candidateChangeSet(candidate("STATE_LEGISLATOR", moved), prior).outcome, "CHANGED");
});

test("a roll-call re-read that differs only in each roll's retrievedAt is unchanged; a tally is a change", () => {
  const positions = [{ rollCallId: "r1", officeholderId: "nj-legislature:1", position: "YES", publisherPosition: "Yes" }];
  const prior = { rollCalls: [roll("r1", EARLIER), roll("r2", EARLIER)], positions };
  const same = { rollCalls: [roll("r1", LATER), roll("r2", LATER)], positions };
  assert.equal(candidateChangeSet(candidate("STATE_ROLL_CALL", same), prior).outcome, "UNCHANGED");
  const recounted = { rollCalls: [roll("r1", LATER, { yea: 51 }), roll("r2", LATER)], positions };
  const delta = candidateChangeSet(candidate("STATE_ROLL_CALL", recounted), prior);
  assert.equal(delta.outcome, "CHANGED");
  assert.deepEqual(delta.changed.map(({ key }) => key), ["roll:r1"]);
});

test("other record classes still compare whole records", () => {
  const prior = { candidates: [{ fecCandidateId: "H0NJ00001", name: "A", retrievedAt: EARLIER }] };
  const next = { candidates: [{ fecCandidateId: "H0NJ00001", name: "A", retrievedAt: LATER }] };
  assert.equal(candidateChangeSet(candidate("FEC_FUNDING", next), prior).outcome, "CHANGED");
});

test("a re-check whose cited roster moved is not a no-change, even when its records are unchanged", async () => {
  const { sameCitedAuthority } = await import("../lib/civic-data/promotion.ts");
  const cite = (versionId: string) => candidate("STATE_ROLL_CALL", {
    rollCalls: [roll("r1", LATER)],
    officialIdentityAuthority: { contractId: "nj-legislators", sourceId: "nj-legislature", scope: "US-NJ", versionId, currentOfficeholderIdsSha256: "d".repeat(64) },
  });
  assert.equal(sameCitedAuthority(cite("cv-roster-1"), cite("cv-roster-1")), true);
  assert.equal(sameCitedAuthority(cite("cv-roster-2"), cite("cv-roster-1")), false, "a moved roster promotes, so the pointer never names a superseded one");
  // Classes that cite no authority compare equal: the rule adds nothing for them.
  assert.equal(sameCitedAuthority(candidate("MEETING", { meetings: [] }), candidate("MEETING", { meetings: [] })), true);
});

test("the confirmation door requires the cited authority, and a confirmation takes no second readback", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../lib/civic-data/promotion.ts", import.meta.url), "utf8");
  const eligibility = source.slice(source.indexOf("options.confirmUnchanged !== false &&"), source.indexOf("const retained ="));
  assert.match(eligibility, /sameHeldRecords\(candidate, lkg\.candidate\) &&\s+sameFinanceProgress\(candidate, lkg\.candidate\) &&\s+sameCitedAuthority\(candidate, lkg\.candidate\)/);
  assert.match(source, /if \(outcome\.promoted === null \|\| outcome\.confirmed \|\| contract\.readerProjection === null\) return outcome;/);
});
