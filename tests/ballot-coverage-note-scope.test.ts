import assert from "node:assert/strict";
import test from "node:test";
import { coverageNotesForScope } from "../lib/ballot/coverage-notes.ts";
import type { ScopedBallotCoverageNote } from "../lib/ballot/types.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BallotSet } from "../lib/ballot/types.ts";









const azBallot = Object.values(JSON.parse(readFileSync(join(import.meta.dirname, "../data/ballot/2026-general/az.json"), "utf8")).ballots)[0] as BallotSet;



const AZ = "ocd-division/country:us/state:az";

test("national Arizona notes retain Pima and Vail scope without becoming Cochise ballot claims", () => {
  const notes = azBallot.scopedCoverageNotes ?? [];
  assert.equal(notes.length, 3);
  assert.deepEqual(coverageNotesForScope(azBallot, "85635", [AZ, `${AZ}/county:cochise`]), []);
  assert.deepEqual(coverageNotesForScope(azBallot, "85641", [AZ, `${AZ}/county:pima`]), notes.map(note => note.text));
  const countyNotes = notes.filter(note => note.scope.kind === "DIVISIONS").map(note => note.text);
  assert.deepEqual(coverageNotesForScope(azBallot, "85701", [AZ, `${AZ}/county:pima`]), countyNotes);
  assert.deepEqual(coverageNotesForScope(azBallot, null, [AZ, `${AZ}/county:pima`]), countyNotes);
  assert.deepEqual(coverageNotesForScope(azBallot, "85122", [AZ, `${AZ}/county:pinal`]), []);
});

test("explicit note scopes support shared divisions and statewide source warnings", () => {
  const scopedCoverageNotes: ScopedBallotCoverageNote[] = [
    { text: "County authority note", scope: { kind: "DIVISIONS", ids: [`${AZ}/county:cochise`] } },
    { text: "Exact ZIP finding", scope: { kind: "ZIPS", ids: ["85635"] } },
  ];
  const notes = { scopedCoverageNotes, coverageNotes: ["Source-through receipt is stale."] };
  assert.deepEqual(coverageNotesForScope(notes, "85635", [AZ, `${AZ}/county:cochise`]), ["Source-through receipt is stale.", "County authority note", "Exact ZIP finding"]);
  assert.deepEqual(coverageNotesForScope(notes, "85701", [AZ, `${AZ}/county:pima`]), ["Source-through receipt is stale."]);
});
