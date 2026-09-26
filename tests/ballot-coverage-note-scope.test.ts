import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { coverageNotesForScope, curatedCoverageNotes } from "../lib/ballot/coverage-notes.ts";

const AZ = "ocd-division/country:us/state:az";
const raw = JSON.parse(readFileSync(new URL("../data/states/az/ballot/az-pima-2026.json", import.meta.url), "utf8"));

test("retained Pima absence notes cannot become Cochise ballot claims; measured Vail notes survive", () => {
  const notes = curatedCoverageNotes("ballot-az-pima", raw);
  assert.equal(notes.scopedCoverageNotes?.length, 3);
  assert.deepEqual(coverageNotesForScope(notes, "85635", [AZ, `${AZ}/county:cochise`]), []);
  assert.deepEqual(coverageNotesForScope(notes, "85641", [AZ, `${AZ}/county:pima`]), raw.coverageNotes);
  assert.deepEqual(coverageNotesForScope(notes, "85701", [AZ, `${AZ}/county:pima`]), [raw.coverageNotes[2]]);
  assert.deepEqual(coverageNotesForScope(notes, null, [AZ, `${AZ}/county:pima`]), [raw.coverageNotes[2]], "an address visit cannot inherit a ZIP-only finding");
  assert.deepEqual(coverageNotesForScope(notes, "85122", [AZ, `${AZ}/county:pinal`]), [], "a cross-county JTED is not assigned to all of either county");
});

test("a changed legacy note needs new scope and cannot silently reuse the old geographic assertion", () => {
  const notes = curatedCoverageNotes("ballot-az-pima", { coverageNotes: [raw.coverageNotes[2] + " Changed."] });
  const shown = coverageNotesForScope(notes, "85635", [AZ, `${AZ}/county:cochise`]);
  assert.equal(shown.length, 1);
  assert.match(shown[0], /do not yet have a verified geographic scope/);
  assert.doesNotMatch(shown[0], /NOT on the November/);
});

test("explicit future note scopes support shared divisions while statewide freshness warnings remain visible", () => {
  const source = curatedCoverageNotes("ballot-az-pima", { scopedCoverageNotes: [
    { text: "County authority note", scope: { kind: "DIVISIONS", ids: [`${AZ}/county:cochise`] } },
    { text: "Exact ZIP finding", scope: { kind: "ZIPS", ids: ["85635"] } },
  ] });
  const notes = { ...source, coverageNotes: ["Source-through receipt is stale."] };
  assert.deepEqual(coverageNotesForScope(notes, "85635", [AZ, `${AZ}/county:cochise`]), ["Source-through receipt is stale.", "County authority note", "Exact ZIP finding"]);
  assert.deepEqual(coverageNotesForScope(notes, "85701", [AZ, `${AZ}/county:pima`]), ["Source-through receipt is stale."]);
  const partial = curatedCoverageNotes("ballot-az-pima", { scopedCoverageNotes: [{ text: "Missing scope", scope: { kind: "DIVISIONS", ids: [] } }, ...source.scopedCoverageNotes!] });
  assert.equal(partial.scopedCoverageNotes?.length, 2, "one invalid note cannot suppress independently verified notes or the ballot");
  assert.match(partial.coverageNotes![0], /could not be verified and are withheld/);
});
