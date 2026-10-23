import assert from "node:assert/strict";
import test from "node:test";
import { localElectionOfficeCoverage } from "../lib/reference/local-election-office-coverage.ts";
import type { LocalElectionOfficeFile } from "../lib/sources/local-election-offices/model.ts";
import type { ReferenceDivision } from "../lib/registration/reference.ts";

test("a missing county cannot hide behind another county's duplicate office", () => {
  const reference: ReferenceDivision[] = [["ocd-division/country:us/state:ca/county:alpine", "county", "06003", "Alpine County"],
    ["ocd-division/country:us/state:ca/county:alameda", "county", "06001", "Alameda County"]];
  const office = { id: "one", state: "CA", divisionId: reference[0][0], office: "County Clerk", directoryUrl: "https://www.sos.ca.gov/", checkedAt: "2026-10-23", fields: {} };
  const file: LocalElectionOfficeFile = { formatVersion: 1, state: "CA", checkedAt: "2026-10-23", offices: [office, { ...office, id: "two" }] };
  const result = localElectionOfficeCoverage("CA", reference, file);
  assert.equal(result.complete, false);
  assert.deepEqual(result.missing, [{ divisionId: reference[1][0], name: "Alameda County" }]);
  assert.equal(result.missingSources.length, 2);
});

test("town coverage stays unknown until a state roster distinguishes clerks from unorganized geography", () => {
  const reference: ReferenceDivision[] = [["ocd-division/country:us/state:me/place:unorganized", "cousub", "2300399999", "Unorganized Territory"]];
  const result = localElectionOfficeCoverage("ME", reference, null);
  assert.equal(result.expected, null);
  assert.equal(result.missing, null);
  assert.equal(result.complete, false);
});

test("a municipal directory omission stays visible against independent geography", () => {
  const reference: ReferenceDivision[] = [["ocd-division/country:us/state:ma/place:monroe", "cousub", "2500341815", "Monroe town"]];
  const result = localElectionOfficeCoverage("MA", reference, { formatVersion: 1, state: "MA", checkedAt: "2026-10-23", offices: [] },
    { sourceUrl: "https://www.mass.gov/clerks.csv", checkedAt: "2026-10-23", divisions: [] });
  assert.equal(result.expected, 0);
  assert.equal(result.complete, false);
  assert.deepEqual(result.unreconciledGeographies, [{ divisionId: reference[0][0], name: "Monroe town" }]);
});
