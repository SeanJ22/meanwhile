import assert from "node:assert/strict";
import test from "node:test";
import jurisdictionLabels from "../data/reference/us-jurisdiction-labels.json" with { type: "json" };
import { officeIdentity, officeBlurbType, officeNumber, sameOffice } from "../lib/officials/office-identity.ts";

const division = (state: string, district: string) => `ocd-division/country:us/state:${state}/${district}`;

test("official ballot spellings retain their exact federal or state office family", () => {
  const forms = [
    ["HOUSE DISTRICT 14", "ak", "sldl:14", "State Representative"],
    ["U.S. Congress District 1", "ar", "cd:1", "U.S. Representative"],
    ["FOR REPRESENTATIVE IN CONGRESS TWELFTH CONGRESSIONAL DISTRICT", "il", "cd:12", "U.S. Representative"],
    ["FIRST CONGRESSIONAL DISTRICT FOR REPRESENTATIVE IN CONGRESS", "il", "cd:1", "U.S. Representative"],
    ["FOR THE 14TH CONGRESSIONAL DISTRICT REPRESENTATIVE IN CONGRESS", "il", "cd:14", "U.S. Representative"],
    ["Eleventh Congressional District", "il", "cd:11", "U.S. Representative"],
    ["Rep in Congress 5th", "il", "cd:5", "U.S. Representative"],
    ["U. S. REPRESENTATIVE DISTRICT 7", "tx", "cd:7", "U.S. Representative"],
    ["U. S. Representative 1st Congressional District", "la", "cd:1", "U.S. Representative"],
    ["For US House of Representatives, 2nd Congressional District", "ms", "cd:2", "U.S. Representative"],
    ["For United States Senate", "ms", "", "U.S. Senator"],
    ["Member, United States Senate", "va", "", "U.S. Senator"],
    ["Member of the House of Representatives (District 6)", "nj", "cd:6", "U.S. Representative"],
    ["Member, House of Representatives — 10th District", "va", "cd:10", "U.S. Representative"],
    ["FOR REPRESENTATIVE IN THE GENERAL ASSEMBLY ONE HUNDRED AND SECOND REPRESENTATIVE DISTRICT", "il", "sldl:102", "State Representative"],
    ["FOR THE 43RD REPRESENTATIVE THE GENERAL ASSEMBLY", "il", "sldl:43", "State Representative"],
    ["FOR THE 96TH REPRESENTATIVE DISTRICT IN THE GENERAL ASSEMBLY", "il", "sldl:96", "State Representative"],
    ["REPRESENTATIVE DISTRICT TWENTY-NINTH THE GENERAL ASSEMBLY FOR REPRESENTATIVE IN", "il", "sldl:29", "State Representative"],
    ["FOR STATE SENATOR FORTY-FIFTH LEGISLATIVE DISTRICT", "il", "sldu:45", "State Senator"],
    ["SEVENTEENTH LEGISLATIVE DISTRICT FOR STATE SENATOR", "il", "sldu:17", "State Senator"],
    ["State Senator, 30th Dist", "il", "sldu:30", "State Senator"],
    ["Representative General Assembly 62nd District", "il", "sldl:62", "State Representative"],
    ["99th District Representative in State Legislature", "mi", "sldl:99", "State Representative"],
    ["Representative to the Assembly District 15", "wi", "sldl:15", "Assemblymember"],
    ["REPRESENTATIVE IN GENERAL ASSEMBLY REP 20", "ri", "sldl:20", "State Representative"],
    ["SENATOR IN GENERAL ASSEMBLY SEN 12", "ri", "sldu:12", "State Senator"],
    ["Senator in the General Assembly – 12th District", "pa", "sldu:12", "State Senator"],
    ["House of Delegates, Delegate District 22", "wv", "sldl:22", "Delegate"],
    ["State Senate, Senatorial District 17 — Unexpired Term", "wv", "sldu:17", "State Senator"],
    ["State Representative Pos. 1, Legislative District 24", "wa", "sldl:24", "State Representative"],
    ["State Representative - District 10, Seat B", "id", "sldl:10", "State Representative"],
    ["STATE SENATOR, DIST 23 VACANCY", "hi", "sldu:23", "State Senator"],
  ];
  for (const [published, state, district, held] of forms) {
    const context = division(state, district).replace(/\/$/, "");
    assert.ok(sameOffice(published, held, context), published);
    assert.equal(officeBlurbType(published, context), officeBlurbType(held, context), published);
  }
});

test("known jurisdiction names and postal codes qualify state legislative offices", () => {
  for (const jurisdiction of jurisdictionLabels.jurisdictions) {
    const context = division(jurisdiction.postal.toLowerCase(), "sldl:1");
    for (const prefix of [jurisdiction.name, jurisdiction.postal]) {
      assert.equal(officeIdentity(`${prefix} House of Representatives District 1`, context), "state_lower_house", prefix);
      assert.equal(officeIdentity(`${prefix} State Senate District 1`, context.replace("sldl", "sldu")), "state_senator", prefix);
    }
  }
  assert.equal(officeIdentity("NC State Senate District 1", division("va", "sldu:1")), null);
  assert.equal(officeIdentity("Unrecognized State House of Representatives District 1", division("ut", "sldl:1")), null);
});

test("ambiguous chamber wording uses its own sourced division without changing explicit offices", () => {
  for (const title of ["Member, House of Representatives", "House"]) {
    assert.equal(officeIdentity(title), null);
    assert.equal(officeIdentity(title, division("va", "cd:1")), "us_representative");
    assert.equal(officeIdentity(title, division("va", "sldl:1")), "state_lower_house");
  }
  assert.equal(officeIdentity("Member of the Legislature", division("ne", "sldu:3")), "state_senator");
  assert.equal(officeIdentity("Member of the Legislature", division("ne", "sldl:3")), "state_lower_house");
  assert.equal(officeIdentity("Member of the Legislature", division("ne", "cd:3")), null);
  assert.equal(officeIdentity("Member of the Legislature"), null);
  assert.equal(officeIdentity("Member of the House of Representatives"), "us_representative");
  assert.equal(officeIdentity("State House of Representatives", division("va", "cd:1")), "state_lower_house");
});

test("numeric and written district numbers have one exact value", () => {
  for (const [published, expected] of [["03", "3"], ["102nd", "102"], ["forty-fifth", "45"], ["ONE HUNDRED AND SECOND", "102"],
    ["one hundred tenth", "110"], ["Twenty-Ninth", "29"], ["NINETIETH", "90"], ["four hundred", "400"]])
    assert.equal(officeNumber(published), expected, published);
  for (const invalid of ["", "and first", "two first", "one hundred hundred", "twenty thirty", "first second", "one hundred and"])
    assert.equal(officeNumber(invalid), null, invalid);
});

test("exact executive and municipal formats do not make unlike roles equivalent", () => {
  assert.equal(officeIdentity("Secretary of the State"), "secretary_of_state");
  assert.equal(officeIdentity("Auditor of State"), "state_auditor");
  assert.equal(officeIdentity("Governor and Lieutenant Governor – Statewide"), "governor_and_lieutenant_governor");
  assert.equal(officeIdentity("Governor / Lt. Governor"), "governor_and_lieutenant_governor");
  assert.ok(sameOffice("Los Angeles — Mayor", "Mayor", division("ca", "place:los_angeles")));
  assert.ok(sameOffice("Mayor - Leesburg — Town of Leesburg", "Mayor", division("va", "place:leesburg")));
  for (const title of ["Deputy State Senator", "Assistant to U.S. Senator", "State Senate Research Commission", "For Proposition 123: State Senate"])
    assert.equal(officeIdentity(title), null, title);
  for (const [candidate, held] of [["Auditor of State", "Lieutenant Governor"], ["FOR UNITED STATES SENATOR", "Lieutenant Governor"],
    ["U. S. SENATOR", "Attorney General"], ["Member of the Township Committee", "Deputy Mayor"],
    ["Member of the Board of Education", "Board Member"], ["County Treasurer", "State Treasurer"]])
    assert.equal(sameOffice(candidate, held), false, `${candidate} / ${held}`);
});
