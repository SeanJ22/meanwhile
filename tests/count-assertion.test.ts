import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCount,
  assertionLine,
  isShort,
  notAssertable,
  numberFrom,
  statedCountIn,
} from "../lib/extract/count-assertion.ts";
import {
  assertionCensus,
  cannotRun,
  describe,
  extracted,
  isComplete,
  zeroRows,
} from "../lib/extract/types.ts";
import { extractRosterTables } from "../lib/extract/roster-table.ts";
import { parseRoster } from "../lib/hunt/wikipedia.ts";

/**
 * A partial extraction that reconciles is a failed extraction. None of these throw, and some return a non-zero row
 * count, so the check is whether the document was read in full, not whether something came back.
 */

test("a stated count that beats the row count reports PARTIAL, not EXTRACTED", () => {
  const r = extracted(
    "ROSTER_TABLE",
    "rockaway",
    1000,
    [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }],
    {},
    { count: 9, evidence: "nine members, with", shape: "members-with-breakdown" },
  );
  assert.equal(r.outcome, "PARTIAL");
  // The rows SURVIVE. Throwing away five real council members to signal a
  // failure would destroy evidence to make a point.
  assert.equal(r.rows, 5);
  assert.equal(r.items.length, 5);
  assert.equal(r.count.verdict, "SHORT");
  assert.equal(r.count.stated, 9);
  assert.match(r.reason, /4 missing/);
});

test("PARTIAL is not complete, and a caller testing EXTRACTED alone would miss it", () => {
  const partial = extracted("ROSTER_TABLE", "s", 10, [{ n: 1 }], {}, {
    count: 5,
    evidence: "five members",
    shape: "copula-of-n-members",
  });
  assert.equal(isComplete(partial), false);
  assert.equal(partial.rows > 0, true, "the row count is non-zero — this is the blind spot");
});

test("a matching count reports EXTRACTED and records that it was CHECKED", () => {
  const r = extracted("ROSTER_TABLE", "s", 10, [1, 2, 3], {}, {
    count: 3,
    evidence: "three members serve",
    shape: "n-members-serve",
  });
  assert.equal(r.outcome, "EXTRACTED");
  assert.equal(r.count.verdict, "MATCHED");
});

test("more rows than the source states is OVER — reported, never silent, never a failure", () => {
  // A roster sentence naming nine council members can legitimately sit beside
  // a table that also carries the mayor and the clerk.
  const r = extracted("ROSTER_TABLE", "s", 10, [1, 2, 3, 4], {}, {
    count: 3,
    evidence: "three members",
    shape: "copula-of-n-members",
  });
  assert.equal(r.outcome, "EXTRACTED");
  assert.equal(r.count.verdict, "OVER");
  assert.match(r.count.reason, /1 more than the document claims/);
});

test("a source stating no count is NOT_ASSERTABLE — a named state, never a pass", () => {
  const r = extracted("ROSTER_TABLE", "s", 10, [1, 2], {}, "this page carries no membership sentence");
  assert.equal(r.outcome, "EXTRACTED");
  assert.equal(r.count.verdict, "NOT_ASSERTABLE");
  assert.equal(r.count.stated, null);
  assert.match(r.count.reason, /no count is stated by the source/);
  assert.match(r.count.reason, /no membership sentence/);
});

test("every constructor carries an assertion — there is no result without one", () => {
  // Making the field required is the mechanism: a new layer cannot be written
  // without answering the question, and "did not consider" is not expressible.
  for (const r of [
    zeroRows("OCR", "s", 1, "nothing recognised"),
    cannotRun("OCR", "s", "no engine"),
    extracted("TEXT_LAYER", "s", 1, [1]),
  ]) {
    assert.ok(r.count, "result carries a count assertion");
    assert.equal(typeof r.count.verdict, "string");
  }
});

test("describe() prints the assertion on every line, including NOT_ASSERTABLE", () => {
  const r = extracted("TEXT_LAYER", "s", 1, [1, 2]);
  assert.match(describe(r), /count NOT_ASSERTABLE stated=— extracted=2/);
});

test("the census counts what could be checked at all", () => {
  const census = assertionCensus([
    extracted("TEXT_LAYER", "s", 1, [1], {}, { count: 1, evidence: "e", shape: "x" }),
    extracted("TEXT_LAYER", "s", 1, [1], {}, { count: 3, evidence: "e", shape: "x" }),
    extracted("TEXT_LAYER", "s", 1, [1]),
  ]);
  assert.deepEqual(census, { MATCHED: 1, SHORT: 1, OVER: 0, NOT_ASSERTABLE: 1 });
});

test("statedCountIn reads the shapes a body's own page actually uses", () => {
  const cases: Array<[string, number]> = [
    ["The Township Council is comprised of nine members, with one member elected from each of six wards", 9],
    ["The governing body is composed of five members", 5],
    ["Pequannock's Township Council was composed of five members", 5],
    ["the nine-member Township Council meets twice monthly", 9],
    ["a five-member Board of Education", 5],
    ["The Borough Council of six members serves staggered terms", 6],
    ["The governing body consists of a Mayor and eight council members", 8],
    ["Seven members serve staggered three-year terms", 7],
  ];
  for (const [text, expected] of cases) {
    const got = statedCountIn(text);
    assert.ok(got !== null, `no count read from: ${text}`);
    assert.equal(got.count, expected, text);
    assert.ok(got.shape.length > 0, "the matching shape is named");
    assert.ok(got.evidence.length > 0, "the clause is quoted for a human to check");
  }
});

test("a bare count in unrelated prose is NOT read as a seat count", () => {
  /* A wrong denominator fails a correct extraction, so every shape is anchored and this sentence must not match. */
  assert.equal(statedCountIn("Nine members of the public spoke at the hearing."), null);
  assert.equal(statedCountIn("The town has nine parks and two libraries."), null);
});

test("implausible counts are refused rather than asserted", () => {
  assert.equal(statedCountIn("a 400-member assembly"), null);
  assert.equal(statedCountIn("is composed of one members"), null);
});

test("numberFrom reads digits and English number words, and nothing else", () => {
  assert.equal(numberFrom("9"), 9);
  assert.equal(numberFrom("nine"), 9);
  assert.equal(numberFrom("twenty-one"), 21);
  assert.equal(numberFrom("many"), null);
  assert.equal(numberFrom(undefined), null);
});

test("parseRoster carries an assertion against the article's own composition sentence", () => {
  /* The article states nine and the roster sentence is cut short. */
  const section =
    "The Township is governed within the Faulkner Act, formally known as the Optional " +
    "Municipal Charter Law, under the Mayor-Council system of New Jersey municipal " +
    "government (Plan F). The governing body is comprised of a Mayor and a Township " +
    "Council of nine members, with one member elected from each of six wards and three " +
    "elected on an at-large basis. " +
    "The members of the Township Council are Michael Puzio (R, 2027; Ward 1), " +
    "Jeremy Jedynak (R, 2026; Ward 2), Adam Salberg (R, 2028; Ward 3), " +
    "Tucker Kelley (R, 2027; Ward 4), Phyllis Smith (R, 2026; Ward 5).";
  const parsed = parseRoster(section, "Township Council");
  assert.equal(parsed.count.stated, 9, "the article's nine is read");
  assert.equal(parsed.officials.length, 5, "the truncated sentence yields five");
  assert.equal(parsed.count.verdict, "SHORT");
  assert.equal(isShort(parsed.count), true);
  assert.match(parsed.count.reason, /4 missing/);
});

test("parseRoster on an article stating no size reports NOT_ASSERTABLE, not a pass", () => {
  const section =
    "The members of the Board of Selectmen are Kristen Schultz (2027), " +
    "Scott Wheeler (2026), Sandra Warde (2028).";
  const parsed = parseRoster(section, "Board of Selectmen");
  assert.equal(parsed.officials.length, 3);
  assert.equal(parsed.count.verdict, "NOT_ASSERTABLE");
  assert.equal(parsed.count.stated, null);
});

test("an empty roster parse still carries the denominator it failed against", () => {
  // The sentence states a size and the parse returns nothing. ZERO_ROWS catches this; the assertion says how many
  // were lost.
  const section = "The Township Council is composed of five members. No roster is given here.";
  const parsed = parseRoster(section, "Township Council");
  assert.equal(parsed.officials.length, 0);
  assert.equal(parsed.count.stated, 5);
  assert.equal(parsed.count.verdict, "SHORT");
});

test("extractRosterTables asserts against the page's own membership sentence", () => {
  const html =
    "<html><body><p>The five-member Board of Education meets monthly.</p>" +
    "<table><thead><tr><th>Name</th><th>Position</th></tr></thead><tbody>" +
    "<tr><td>Ann Alvarez</td><td>President</td></tr>" +
    "<tr><td>Ben Boyle</td><td>Vice President</td></tr>" +
    "</tbody></table></body></html>";
  const r = extractRosterTables(html, "district.example");
  assert.equal(r.rows, 2);
  assert.equal(r.count.stated, 5);
  assert.equal(r.outcome, "PARTIAL", "two people read off a five-member board is a failed read");
});

test("extractRosterTables with no membership sentence names what it looked for", () => {
  const html =
    "<html><body><table><thead><tr><th>Name</th><th>Position</th></tr></thead><tbody>" +
    "<tr><td>Ann Alvarez</td><td>President</td></tr>" +
    "</tbody></table></body></html>";
  const r = extractRosterTables(html, "district.example");
  assert.equal(r.outcome, "EXTRACTED");
  assert.equal(r.count.verdict, "NOT_ASSERTABLE");
  assert.match(r.count.reason, /no sentence stating how many people sit on this body/);
});

test("assertionLine is printable on every verdict", () => {
  assert.equal(assertionLine(notAssertable(3, "x")), "count NOT_ASSERTABLE stated=— extracted=3");
  assert.equal(assertionLine(assertCount(3, 9, "e")), "count SHORT stated=9 extracted=3");
});
