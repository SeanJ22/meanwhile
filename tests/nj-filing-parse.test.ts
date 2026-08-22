/**
 * The New Jersey filed-candidate parser, guarded against a recorded document.
 *
 * The branch shipped in NJ Hunt with no test at all, and the next run of it
 * found four separate parse defects in one document — three of which put wrong
 * words into rows about NAMED REAL PEOPLE and named governments:
 *
 *  1. `No Nomination Made <Party>` — the clerk's way of recording a seat a
 *     party filed nobody for — bled into the FOLLOWING contest's jurisdiction,
 *     so twenty candidates were filed under places like `Made Democratic Butler
 *     Borough`.
 *  2. The page-one table header did the same thing, producing `City State Zip
 *     Email` as a municipality for the four US Senate candidates.
 *  3. The office heading's all-caps run ate the next word's leading capital, so
 *     `NO LOCAL ELECTION Roxbury Township` was published as a statement about a
 *     municipality called `Township`.
 *  4. Hyphenated names truncated: `Parsippany-Troy Hills Township` became `Troy
 *     Hills Township`, which is not a government.
 *
 * And the same read found something the parser had been DISCARDING: 36 seats
 * where the filing authority states in the document that a party filed nobody.
 * That is publishable information about whether a race is contested, and it is
 * now returned rather than dropped.
 *
 * The fixture is the text layer of the Morris County Clerk's 2026-08-21
 * revision, recorded as bytes. `tests/fixtures/` takes no live calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseNjFiling,
  type FiledCandidate,
  type FiledNoElection,
  type FiledUnfilledSeat,
} from "../lib/hunt/nj-filing.ts";

const FIXTURE = join(
  process.cwd(),
  "tests",
  "fixtures",
  "nj-filing",
  "morris-clerk-2026-general-candidates-082126.txt",
);
const text = readFileSync(FIXTURE, "utf8");

function parse() {
  const out = parseNjFiling(text, "fixture: Morris County Clerk 2026-08-21 revision");
  assert.equal(out.outcome, "EXTRACTED", `parse outcome ${out.outcome}`);
  const items = out.items as Array<FiledCandidate | FiledNoElection | FiledUnfilledSeat>;
  return {
    candidates: items.filter((r): r is FiledCandidate => "familyName" in r),
    noElection: items.filter(
      (r): r is FiledNoElection => !("familyName" in r) && !("office" in r),
    ),
    unfilled: items.filter((r): r is FiledUnfilledSeat => !("familyName" in r) && "office" in r),
  };
}

test("the document yields a real number of candidates, not merely no error", () => {
  const { candidates } = parse();
  // A minimum, not an equality: the clerk republishes and the count grows.
  // Asserting the absence of an error is what let a zero-row parse read as a
  // clean run five separate times in this project.
  assert.ok(candidates.length >= 130, `only ${candidates.length} candidates parsed`);
  assert.ok(
    candidates.filter((c) => c.email).length >= 120,
    "the filed EMAIL is the whole reason this branch exists",
  );
  assert.ok(candidates.filter((c) => c.address).length >= 120);
});

test("no candidate is filed under document furniture instead of a place", () => {
  const { candidates } = parse();
  const furniture = candidates.filter((c) =>
    /\b(?:No Nomination|Made|Street Address|City State Zip|First Name)\b/i.test(c.jurisdiction),
  );
  assert.deepEqual(
    furniture.map((c) => `${c.givenName} ${c.familyName} -> ${c.jurisdiction}`),
    [],
  );
});

/**
 * A jurisdiction is a place name, a congressional district, or EMPTY.
 *
 * Empty is the honest answer for a federal office: the clerk's list heads
 * municipal rows with a municipality and heads the US Senate rows with nothing,
 * because the Senate is not a municipal contest. Before the header strip those
 * four rows read `City State Zip Email`, which looked like a place and was one
 * of the twenty polluted rows.
 *
 * So empty is allowed and CONSTRAINED: it may occur only on a federal office. A
 * blank municipality on a borough council row would be a parse failure wearing
 * the same face.
 */
test("every jurisdiction is a plausible place name, or empty only on a federal office", () => {
  const { candidates } = parse();
  const PLACE = /^(?:[A-Z][A-Za-z.'-]*(?:[-/ ][A-Za-z.'-]+)*|\d+(?:st|nd|rd|th) Congressional|New Jersey)$/;
  const odd = [...new Set(candidates.map((c) => c.jurisdiction))].filter(
    (j) => j !== "" && !PLACE.test(j),
  );
  assert.deepEqual(odd, []);

  const blankAndLocal = candidates.filter(
    (c) => c.jurisdiction === "" && !/UNITED STATES SENATE|HOUSE OF REPRESENTATIVES/.test(c.office),
  );
  assert.deepEqual(
    blankAndLocal.map((c) => `${c.givenName} ${c.familyName} — ${c.office}`),
    [],
    "a local contest with no municipality is a parse failure, not a federal row",
  );
});

test("the four Rockaway Borough council candidates parse with their filed contact", () => {
  const { candidates } = parse();
  const council = candidates.filter(
    (c) => c.jurisdiction === "Rockaway Borough" && /BOROUGH COUNCIL/.test(c.office),
  );
  assert.equal(council.length, 4, "the Borough council contest is a four-candidate race");
  const byName = new Map(council.map((c) => [c.familyName, c]));
  assert.equal(byName.get("BURNSIDE")?.party, "Republican");
  assert.equal(byName.get("MCDONALD")?.party, "Republican");
  assert.equal(byName.get("DAWKINS, JR.")?.party, "Democratic");
  assert.equal(byName.get("NATALE")?.party, "Democratic");
  for (const c of council) {
    assert.ok(c.email, `${c.familyName} has no filed email`);
    assert.ok(c.address, `${c.familyName} has no filed address`);
    assert.equal(c.voteFor, 2);
    assert.equal(c.termYears, 3);
  }
});

/**
 * BURNSIDE is the specific row the first defect corrupted — the fragment that
 * bled into her jurisdiction read `Made Democratic`, immediately before a
 * Republican candidate's name. Nothing shipped it, but a party label on a named
 * person is exactly the class of claim that must never be one regex away from
 * wrong.
 */
test("a candidate's party is never taken from the preceding unfilled-seat row", () => {
  const { candidates } = parse();
  const burnside = candidates.find((c) => c.familyName === "BURNSIDE");
  assert.ok(burnside);
  assert.equal(burnside!.party, "Republican");
  assert.equal(burnside!.jurisdiction, "Rockaway Borough");
});

test("NO LOCAL ELECTION is recorded against the municipality the document names", () => {
  const { noElection } = parse();
  const names = noElection.map((n) => n.jurisdiction).sort();
  assert.ok(names.includes("Parsippany-Troy Hills Township"), `saw ${names.join(", ")}`);
  assert.ok(names.includes("Roxbury Township"), `saw ${names.join(", ")}`);
  assert.ok(
    !names.some((n) => n === "Township" || n === "Troy Hills Township"),
    `a truncated municipality name survived: ${names.join(", ")}`,
  );
});

test("a seat a party filed nobody for is RECORDED, not discarded", () => {
  const { unfilled } = parse();
  assert.ok(unfilled.length >= 30, `only ${unfilled.length} unfilled seats recorded`);
  for (const u of unfilled) {
    assert.ok(u.jurisdiction, "an unfilled seat with no jurisdiction says nothing");
    assert.ok(u.office, "an unfilled seat with no office says nothing");
    assert.match(u.statement, /stated by the filing authority/);
  }
});

test("every unfilled seat in the document is accounted for", () => {
  const { unfilled } = parse();
  const inDocument = (text.match(/No Nomination Made/g) ?? []).length;
  assert.equal(
    unfilled.length,
    inDocument,
    `the document says No Nomination Made ${inDocument} times and ${unfilled.length} were recorded`,
  );
});

test("an empty text layer is a FAILED parse naming itself, never an empty filing", () => {
  const out = parseNjFiling("", "fixture: nothing");
  assert.notEqual(out.outcome, "EXTRACTED");
  assert.match(String(out.reason), /fact about the fetch/);
});

test("a document with no office headings is ZERO_ROWS with a reason, not success", () => {
  const out = parseNjFiling("Some prose that is not a filed-candidate list at all.", "fixture: prose");
  assert.notEqual(out.outcome, "EXTRACTED");
  assert.match(String(out.reason), /grammar/);
});
