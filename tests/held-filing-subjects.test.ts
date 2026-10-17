import assert from "node:assert/strict";
import { test } from "node:test";

import { heldFilingSubjects, requestedHeldFilings } from "../lib/ask/held-filing-subjects.ts";
import type { Contest } from "../lib/ballot/types.ts";
import type { LineupOutcome } from "../lib/identity/types.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { readFileSync } from "node:fs";

interface SyntheticLineupNominee {
  readonly name: string;
  readonly partyLabel: string;
  readonly outcome: LineupOutcome;
  readonly candidacyId?: string;
  readonly filingParty?: string;
}

interface SyntheticContest {
  readonly id: string;
  readonly title: string;
  readonly ocdId?: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly lineup?: readonly SyntheticLineupNominee[];
}

function syntheticAzBallot(contests?: readonly SyntheticContest[]): BallotSet {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/synthetic-az-ballots.json", import.meta.url), "utf8")) as Record<string, BallotSet>;
  const ballot = fixtures[JSON.stringify(contests ?? null)];
  if (!ballot) throw new Error("The synthetic Arizona ballot input has no recorded fixture");
  return ballot;
}


test("published source-filing profiles retain exact identities outside the mapped ballot without duplicating joined people", () => {
  const provenance = { sourceUrl: "https://azsos.gov/elections/candidates", sourceOrg: "Arizona Secretary of State", collectedAt: "2026-09-26", verifiedAt: null };
  const ballot = syntheticAzBallot([
    { id: "us-house-2", title: "U.S. Representative in Congress, District 2", ocdId: "ocd-division/country:us/state:az/cd:2",
      candidacies: [{ id: "az-sos-2026:us-house-2:crane-eli", givenName: "Eli", familyName: "Crane" }] },
    { id: "governor", title: "Governor", candidacies: [{ id: "ballot-az:governor:schweikert-david", givenName: "David", familyName: "Schweikert" }] },
  ]);
  for (const candidate of ballot.candidacies) candidate.filing = {
    id: candidate.id.includes("schweikert") ? "az-sos-2026:governor:schweikert-david" : candidate.id,
    publishedName: `${candidate.givenName} ${candidate.familyName}`, provenance,
  };
  ballot.filingCandidacies = ballot.candidacies.filter(candidate => candidate.contestId === "us-house-2");
  ballot.candidacies = ballot.candidacies.filter(candidate => candidate.contestId === "governor");
  const rows = heldFilingSubjects(ballot);
  const crane = rows.find(row => row.entity.id === "az-sos-2026:us-house-2:crane-eli")!;
  assert.equal(crane.entity.name, "Eli Crane");
  assert.equal(crane.ocdId, "ocd-division/country:us/state:az/cd:2");
  assert.match(crane.record.sourceUrl!, /azsos.gov/);
  assert.match(crane.record.text, /does not establish a current general-election ballot position/);
  assert.deepEqual(requestedHeldFilings(rows, "What biography is held?", [crane.entity.id], new Set()), [crane]);
  const david = rows.find(row => row.entity.id === "az-sos-2026:governor:schweikert-david")!;
  assert.deepEqual(requestedHeldFilings(rows, "David Schweikert", [], new Set([david.heldCandidacyId!])), []);
  assert.deepEqual(requestedHeldFilings(rows, "David Schweikert", [david.entity.id], new Set([david.heldCandidacyId!])), [david]);
  const historic = requestedHeldFilings(rows, "What biography is held?", [david.candidacyId], new Set());
  assert.equal(historic[0]?.entity.id, david.candidacyId);
  assert.equal(historic[0]?.record.sourceUrl, provenance.sourceUrl);
  assert.deepEqual(requestedHeldFilings(rows, "What biography is held?", ["invented-person"], new Set()), []);
  assert.deepEqual(heldFilingSubjects(null), []);
});
