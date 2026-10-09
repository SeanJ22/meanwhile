import assert from "node:assert/strict";
import test from "node:test";
import { parseOfficeAddress } from "../lib/officials/member-offices.ts";
import { memberDirectoryReaches } from "../lib/officials/member-directory-scope.ts";

test("an Open States office address splits into street, city, state and ZIP as written", () => {
  assert.deepEqual(parseOfficeAddress("680 Broadway Suite 207, Paterson, NJ 07514"),
    { address: "680 Broadway Suite 207", city: "Paterson", state: "NJ", zip: "07514" });
  assert.deepEqual(parseOfficeAddress("State House; 107 North Main Street, Concord, NH 03301-4951"),
    { address: "State House, 107 North Main Street", city: "Concord", state: "NH", zip: "03301-4951" });
  assert.deepEqual(parseOfficeAddress("Legislative Office Building, Room 210"),
    { address: "Legislative Office Building, Room 210", city: null, state: null, zip: null }, "an unparsed address is kept whole, never guessed into parts");
});

test("offices reach federal members and the legislatures' own roster rows; committees stay federal", () => {
  assert.equal(memberDirectoryReaches("congress:C001133", "offices"), true);
  assert.equal(memberDirectoryReaches("congress:C001133"), true);
  for (const id of ["nj-legislature:498", "az-legislature:2355", "nh-general-court:1234"]) {
    assert.equal(memberDirectoryReaches(id, "offices"), true, `${id} offices`);
    assert.equal(memberDirectoryReaches(id, "committees"), false, `${id} committees: no source reaches them, so no false "sits on none"`);
  }
  assert.equal(memberDirectoryReaches("plural:c6a181c7", "offices"), false, "the retired intermediary id never enters the reader");
  assert.equal(memberDirectoryReaches("plural:oh:00000000-0000-4000-8000-000000000001", "offices"), true);
  assert.equal(memberDirectoryReaches("plural:00000000-0000-4000-8000-000000000001", "offices", "OH"), true);
  assert.equal(memberDirectoryReaches("plural:00000000-0000-4000-8000-000000000001", "offices"), false, "a global native ID needs one known state scope, never a national scan");
  assert.equal(memberDirectoryReaches("roster:ocd-division/country:us/state:az/place:benson#governing#ab12", "offices"), false);
});
