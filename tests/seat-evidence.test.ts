import assert from "node:assert/strict";
import test from "node:test";
import { seatIn, seatQuoteOnPage, seatTitleIn } from "../lib/facts/seat-evidence.ts";
import { normalizeText } from "../lib/facts/check.ts";
import { visibleText } from "../lib/extract/visible-text.ts";

test("the government's saved heading and appointment sentence prove the named person's seat", () => {
  const cases = [
    ["Jon Post", "town#governing", "<h1>Mayor Jon Post</h1><p>Marana native Jon Post owns Post Farms.</p>", "Marana native Jon Post owns Post Farms."],
    ["Steve Herring", "town#governing", "<h2>Mayor &amp; Council</h2><table><tr><th>District</th><th>Member</th></tr><tr><td>Mayor</td><td>Rod Northam</td></tr><tr><td>1</td><td>Steve Herring</td></tr></table>", "Steve Herring"],
    ["Jon Post", "town#governing", "<h1>MAYOR JON POST</h1>", "Mayor Jon Post"],
    ["Tony Bruno", "school#board", "<h2>Tony Bruno</h2><p>Board Member</p>", "Tony Bruno"],
    ["Mary Jo Heye-Townsell", "district#governing", "<p><strong>Mary Jo Heye-Townsell</strong><br/><strong>Mayor, Sherwood</strong></p>", "Mary Jo Heye-Townsell"],
    ["Robert Retallick", "town#governing", "<p>Robert Retallick</p><p>TERM-11/29</p>", "Robert Retallick"],
    ["Jerry Tingle", "county#governing", "<h2>Commission District 2</h2><p>Jerry Tingle</p><p>district2@example.gov</p>", "Jerry Tingle"],
    ["Tony Bruno", "school#board", "<h2>Tony Bruno</h2><p>Governing Board Clerk</p>", "Tony Bruno"],
    ["Pat Rochford", "school#board", "<h2>Board Members</h2><p>Steve Conroy</p><p>Kimberly Robinson</p><p>Pat Rochford</p><h2>Board Meetings</h2>", "Pat Rochford"],
    ["Susan Lovegreen", "school#board", "<h2>Regional School District #11 Board of Education Members &amp; Contact Information</h2><p>Joy Becker</p><p>Susan Lovegreen</p>", "Susan Lovegreen"],
    ["DUSTY ESCAPULE", "town#governing", "<h2>Mayor</h2><h3>DUSTY ESCAPULE</h3>", "<h3>DUSTY ESCAPULE</h3>"],
    ["Karen Tidwell", "school#board", "<p>School Superintendent Jill Broussard has appointed Karen Tidwell to the Picacho Elementary School District No. 33 Governing Board.</p>", "School Superintendent Jill Broussard has appointed Karen Tidwell to the Picacho Elementary School District No. 33 Governing Board."],
    ["Pat Lee", "town#governing", "<p>Mayor Pat Lee. City Manager Dana Jones handles permits.</p>", "Mayor Pat Lee. City Manager Dana Jones handles permits."],
    ["Pat Lee", "town#governing", "<p>Mayor Pat Lee and City Manager Dana Jones handle permits.</p>", "Mayor Pat Lee and City Manager Dana Jones handle permits."],
  ];
  for (const [name, body, page, original] of cases) {
    const quote = seatQuoteOnPage(page!, name!, body!, original!);
    assert.ok(quote, name);
    assert.ok(normalizeText(visibleText(page!)).includes(normalizeText(quote!)), "the replacement quote is actually on the saved page");
  }
});

test("another member's title and a school district's number do not become this person's office or ward", () => {
  assert.equal(seatTitleIn("Board Members\nDonald Lee, President\nPat Rochford", "school#board", "Pat Rochford"), null);
  assert.deepEqual(seatIn("School Superintendent Jill Broussard appointed Karen Tidwell to the Picacho Elementary School District No. 33 Governing Board", "school#board", "Karen Tidwell"), { ward: null });
});

test("staff, non-persons, former officeholders and an unrelated council heading cannot seat a person", () => {
  for (const [name, page] of [
    ["Pat Lee", "<h1>City Council</h1><p>Pat Lee, City Clerk</p>"],
    ["Pat Lee", "<p>Pat Lee</p><p>district2@example.gov</p>"],
    ["Noni Stapleton", "<p>Cory Dickard</p><p>Mayor</p><p>mayor@cityofmelba.org</p><p>Noni Stapleton</p><p>City Clerk</p>"],
    ["Destany Smith", "<p>Destany Smith Purchasing/Procurement / Governing Board Secretary</p>"],
    ["James D. Perey", "<p>James D. Perey</p><p>Administrative Head</p><p>President</p>"],
    ["Cody Gonzalez", "<p>Supervisor</p><p>Cody Gonzalez</p>"],
    ["Joey Byars", "<p>Industrial Development Board Larry Pinkerton, Chairman 205-932-5367 203 Temple Ave. N.</p><p>Maintenance Joey Byars 205-932-5367 203 Temple Ave. N.</p>"],
    ["Scholarship Fund Raising", "<p>Steve Sides, Immediate Past President - Education, Scholarship Fund Raising, Nominating</p>"],
    ["Steve Sides", "<p>Steve Sides, Immediate Past President</p>"],
    ["Pat Lee", "<h1>Mayor and Council</h1><p>Pat Lee</p>"],
    ["OPEN RECORDS REQUEST", "<h1>City Council</h1><p>OPEN RECORDS REQUEST</p>"],
    ["Vice President", "<h1>City Council</h1><p>Vice President, District 5</p>"],
    ["F. M. Warmcastle", "<h1>Former Mayors</h1><p>Mayor F. M. Warmcastle 1884–1886</p>"],
    ["Pat Lee", "<h1>Government</h1><h2>Past Mayors</h2><p>Mayor Pat Lee</p>"],
    ["Pat Lee", "<h1>Mayor</h1><p>Former Mayor Pat Lee</p>"],
  ]) assert.equal(seatQuoteOnPage(page!, name!, "town#governing", name!), null, name);
});

test("a board's clerk title does not erase that same person's separate staff job", () => {
  assert.equal(seatQuoteOnPage("<p>Destany Smith Purchasing/Procurement / Governing Board Secretary</p>", "Destany Smith", "school#board", "Destany Smith"), null);
  assert.equal(seatQuoteOnPage("<p>James D. Perey</p><p>Administrative Head</p><p>President</p>", "James D. Perey", "school#board", "James D. Perey"), null);
  assert.deepEqual(seatIn("Supervisor Rex Scott, District 1", "az:county:pima#governing", "Rex Scott"), { ward: "1" });
});
