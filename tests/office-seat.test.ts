import assert from "node:assert/strict";
import test from "node:test";
import { sameSeatDiscriminators } from "../lib/officials/office-seat.ts";

test("lettered Idaho and Nevada seats and Washington positions remain separate votes", () => {
  for (const [first, second, division] of [
    ["State Representative - District 16, Seat A", "State Representative - District 16, Seat B", "ocd-division/country:us/state:id/sldl:16"],
    ["State Representative Pos. 1, Legislative District 24", "State Representative Pos. 2, Legislative District 24", "ocd-division/country:us/state:wa/sldl:24"],
    ["Supreme Court Justice Seat B", "Supreme Court Justice Seat D", "ocd-division/country:us/state:nv"],
    ["Circuit Court Judge Group 2", "Circuit Court Judge Group 3", "ocd-division/country:us/state:fl/county:miami-dade"],
  ]) {
    assert.equal(sameSeatDiscriminators(first, second, division), false);
    assert.equal(sameSeatDiscriminators(first, second, division, { allowUnspecified: true }), false);
  }
});

test("distinct Ohio full-term commencement dates remain separate races", () => {
  const first = "Justice of the Supreme Court (Full term commencing 1/1/2027)";
  const second = "Justice of the Supreme Court (Full term commencing 1/2/2027)";
  const division = "ocd-division/country:us/state:oh";
  assert.equal(sameSeatDiscriminators(first, second, division), false);
  assert.equal(sameSeatDiscriminators(first, second, division, { allowUnspecified: true }), false);
  assert.equal(sameSeatDiscriminators(first, first.replace("1/1/2027", "2027-01-01"), division), true);
});

test("missing seat detail can identify a person without proving incumbency in that seat", () => {
  const division = "ocd-division/country:us/state:wa/sldl:24";
  const candidacy = "State Representative Pos. 1, Legislative District 24";
  assert.equal(sameSeatDiscriminators(candidacy, "State Representative", division), false);
  assert.equal(sameSeatDiscriminators(candidacy, "State Representative", division, { allowUnspecified: true }), true);
  assert.equal(sameSeatDiscriminators(candidacy, "State Representative Position 1, District 24", division), true);
});

test("written, abbreviated and Roman source districts must agree with each other and the OCD district", () => {
  for (const [first, second, division] of [
    ["U.S. Representative, DIST I", "U.S. Representative District 1", "ocd-division/country:us/state:hi/cd:1"],
    ["Senator in the General Assembly FORTY-FIFTH DISTRICT", "State Senator District 45", "ocd-division/country:us/state:pa/sldu:45"],
    ["FOR THE ONE HUNDRED AND SECOND REPRESENTATIVE DISTRICT", "State Representative District 102", "ocd-division/country:us/state:il/sldl:102"],
    ["SENATOR IN GENERAL ASSEMBLY SEN02", "State Senator District 2", "ocd-division/country:us/state:ri/sldu:2"],
  ]) assert.equal(sameSeatDiscriminators(first, second, division), true, first);
  const division = "ocd-division/country:us/state:il/sldl:43";
  assert.equal(sameSeatDiscriminators("FOR THE 44TH REPRESENTATIVE THE GENERAL ASSEMBLY", "State Representative", division, { allowUnspecified: true }), false);
  assert.equal(sameSeatDiscriminators("U.S. Representative District 2", "U.S. Representative", "ocd-division/country:us/state:wa/cd:1", { allowUnspecified: true }), false);
});
