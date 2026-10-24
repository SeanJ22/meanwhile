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

test("the fresh seven-day cohort's false seats stay refused: a school's street address, menu labels, a library board, a cut-off name and a name glued to its title", () => {
  // Saved Kodiak staff directory: the district's street number on the next line is not a seat.
  assert.equal(seatQuoteOnPage("<li><h3>Tania Silva-Johnson</h3><p>School Social Worker, District-wide</p><p>Phone: (907) 486-7426</p><p>Kodiak Island Borough School District<br>722 Mill Bay Rd.</p></li>",
    "Tania Silva-Johnson", "ak:depschool:kodiak-island-borough-school-district#board", "Tania Silva-Johnson"), null);
  assert.equal(seatIn("Kent Example\nArbor Park School District 145", "school#board"), null, "a school district's own number is its name, not a seat");
  // Saved Pinellas County, Orlando, Tampa and New Britain pages: menu entries and leadership labels are not people.
  for (const [name, page] of [
    ["Community Development", "<p>Animal Services Building Services Housing and Community Development Development Review Services Office of Human Rights Board of County Commissioners</p>"],
    ["Human Rights", "<p>Animal Services Building Services Housing and Community Development Development Review Services Office of Human Rights Board of County Commissioners</p>"],
    ["Harry P. Leu Gardens", "<h3>Harry P. Leu Gardens Board of Trustees</h3>"],
    ["Urban Forest Management Plan", "<p>The City of Tampa Urban Forest Management Plan calls for the creation of a Natural Resources Advisory Committee.</p>"],
    ["Majority Leader", "<p>Majority Leader</p><p>Alderman Ward 4</p>"],
  ]) assert.equal(seatQuoteOnPage(page!, name!, "county#governing", name!), null, name);
  // Saved Homedale library page: the library's vice chair is not on the city council, and "Gibbens-" is a name glued to a title.
  const library = "<title>Board of Trustees &#8211; Gypsy Jackson Memorial Library</title><p>Pam Gibbens- Vice Chair</p><p>Amanda Rice, Chair</p>";
  assert.equal(seatQuoteOnPage(library, "Amanda Rice", "id:city:city-of-homedale#governing", "Amanda Rice"), null);
  assert.equal(seatQuoteOnPage(library.replace(/<title>.*<\/title>/, ""), "Pam Gibbens- Vice", "id:city:city-of-homedale#governing", "Pam Gibbens- Vice"), null);
  // Saved Aberdeen page: the link holds "Brian Schneide" and the page writes "Schneider".
  const aberdeen = '<p>City Council Members</p><p><span><a href="x.html">Karl Vollmer</a></span></p><p><span><a href="dept-head-contact-form.html">Brian Schneide</a>r</span></p>';
  assert.equal(seatQuoteOnPage(aberdeen, "Brian Schneide", "id:city:city-of-aberdeen#governing", "Brian Schneide"), null);
  assert.ok(seatQuoteOnPage(aberdeen, "Karl Vollmer", "id:city:city-of-aberdeen#governing", "Karl Vollmer"), "a whole name on the same list still seats");
});
