import test from "node:test";
import assert from "node:assert/strict";

import {
  looksLikePersonName,
  parseGoverningBody,
  parseMember,
  parseRoster,
  splitMembers,
} from "../lib/hunt/wikipedia.ts";

const BOONTON =
  "Members of the Town Council are Council President Benjamin Weisman (Ward 4; D, 2026), " +
  "Daniel Balan (Ward 3; R, 2026), Danielle Cascone (Ward 2; D, 2027), " +
  "Marie DeVenezia (Ward 2; D, 2026), Luisa F. Lopez (Ward 4; D, 2027) " +
  "Kimberly Mazzei (Ward 3; D, 2027) John P. Meehan (Ward 1; R, 2027) " +
  "and Cy Wekilsky (Ward 1; R, 2026).";

const MOUNT_OLIVE =
  "Members of the Township Council are Council President Alex Roman(R, 2023), " +
  "Council Vice President Charles Aaron Jr. (R, 2025; appointed to serve an unexpired term), " +
  "John Ferrante (R, 2025), Colleen Labow (R, 2023), John Mania (R, 2025), " +
  "Mary Lalama, and Raffaele Ruggiero.";

const PEQUANNOCK =
  "As of 2023, Pequannock's Township Council was composed of Mayor David G. Kohle " +
  "(R, term on council ends December 31, 2024; term as mayor ends 2023), " +
  "Deputy Mayor Ryan Herd (R, term on council ends 2024; term as deputy mayor ends 2023), " +
  "John Driesse (R, 2026), Melissa Florance-Lynch (R, 2026) and Kyle Russell (R, 2026).";

test("Boonton — a closing parenthesis separates entries when nothing else does", () => {
  const roster = parseRoster(BOONTON, "Town Council");
  const names = roster.officials.map((o) => o.name);
  assert.equal(names.length, 8, `expected 8 seated members, parsed ${names.length}: ${names.join(", ")}`);
  assert.ok(names.includes("Kimberly Mazzei"), "Mazzei is seated and must not be absorbed into Lopez");
  assert.ok(names.includes("John P. Meehan"), "Meehan is seated and must not be absorbed into Lopez");

  const lopez = roster.officials.find((o) => o.name === "Luisa F. Lopez");
  assert.equal(lopez?.seat, "Ward 4");
  assert.equal(lopez?.termEnds, 2027);
  assert.equal(
    lopez?.rawParenthetical,
    "Ward 4; D, 2027",
    "the raw parenthetical must hold only this member's own text",
  );
});

test("Mount Olive — a member Wikipedia says nothing else about is still a member", () => {
  const roster = parseRoster(MOUNT_OLIVE, "Township Council");
  const names = roster.officials.map((o) => o.name);
  assert.equal(names.length, 7, `expected 7 seated members, parsed ${names.length}: ${names.join(", ")}`);
  assert.ok(names.includes("Mary Lalama"), "a bare name in the list is a member, not prose");
  assert.ok(names.includes("Raffaele Ruggiero"), "a bare name in the list is a member, not prose");

  const lalama = roster.officials.find((o) => o.name === "Mary Lalama");
  assert.equal(lalama?.party, null);
  assert.equal(lalama?.termEnds, null);
});

test("Pequannock — the past tense is a copula too", () => {
  const roster = parseRoster(PEQUANNOCK, "council");
  const names = roster.officials.map((o) => o.name);
  assert.equal(names.length, 5, `expected 5 seated members, parsed ${names.length}: ${names.join(", ")}`);
  assert.ok(names.includes("David G. Kohle"));
  assert.ok(names.includes("Kyle Russell"));

  const kohle = roster.officials.find((o) => o.name === "David G. Kohle");
  assert.equal(kohle?.termEnds, 2024);
});

test("prose is not a roster, however capitalised it is", () => {
  const composition =
    "The members of the governing body are elected to staggered four-year terms " +
    "in office on a partisan basis as part of the November general election.";
  assert.equal(parseRoster(composition, "council").officials.length, 0);

  const manager =
    "The Township Council hires a Township Manager, who serves as the chief " +
    "executive and administrative officer of the township.";
  assert.equal(parseRoster(manager, "council").officials.length, 0);
});

test("looksLikePersonName rejects offices and clauses, accepts real name shapes", () => {
  for (const person of [
    "Mary Lalama",
    "Raffaele Ruggiero",
    "John P. Meehan",
    "Charles Aaron Jr.",
    "Susan Fahrman Royek",
    "Melissa Florance-Lynch",
    "Marcos Tapia-Aguilar",
  ]) {
    assert.ok(looksLikePersonName(person), `${person} is a person`);
  }
  for (const notPerson of [
    "Township Manager",
    "Township Council",
    "Board of Education",
    "the mayor",
    "Ward 3",
    "an unexpired term",
    "Mayor",
  ]) {
    assert.ok(!looksLikePersonName(notPerson), `${notPerson} is not a person`);
  }
});

test("a generational suffix is part of the name, not a separator", () => {
  const parts = splitMembers("Marcos Tapia-Aguilar, Sr. (Ward 4; D, 2026), Christopher Almada (Ward 3; D, 2027)");
  assert.equal(parts.length, 2, `split into ${parts.length}: ${parts.join(" | ")}`);
  assert.ok(parts[0].startsWith("Marcos Tapia-Aguilar, Sr."));
});

test("a well-punctuated list is never double-split by the parenthesis rule", () => {
  const parts = splitMembers(
    "Howard Morrison (R, 2027; At-large), Jonathan Sackett (D, 2026; Ward 4) and Tucker Kelley (R, 2028; Ward 6)",
  );
  assert.equal(parts.length, 3, `split into ${parts.length}: ${parts.join(" | ")}`);
});

test("the seat, the party and the term year survive every live shape", () => {
  const rockaway = parseMember("Howard Morrison (R, 2027; At-large)", "township council");
  assert.deepEqual(
    { name: rockaway?.name, party: rockaway?.party, seat: rockaway?.seat, termEnds: rockaway?.termEnds },
    { name: "Howard Morrison", party: "R", seat: "At-large", termEnds: 2027 },
  );

  const dover = parseMember("Christopher Almada (Ward 3; D, 2027)", "board of aldermen");
  assert.equal(dover?.seat, "Ward 3");
  assert.equal(dover?.party, "D");

  const glued = parseMember("Council President Alex Roman(R, 2023)", "Township Council");
  assert.equal(glued?.name, "Alex Roman", "a glued title is stripped and a glued paren still parses");
  assert.equal(glued?.title, "Council President");
});

test("a spelled-out, hyphenated seat count is still a seat count", () => {
  // `seats` is the denominator the roster completeness gate checks against.
  const denville = parseGoverningBody(
    "Denville Township is governed within the Faulkner Act, formally known as the Optional " +
      "Municipal Charter Law, under Mayor-Council plan F, as implemented as of January 1, 1972. " +
      "The township is one of 71 municipalities (of the 564) statewide governed under this form. " +
      "The governing body is comprised of the mayor and the seven-member township council, all " +
      "elected to four-year terms of office on a partisan basis in odd-numbered years.",
  );
  assert.equal(denville.seats, 7, "the seven-member township council has seven seats");
  assert.equal(denville.bodyName, "township council");
  assert.equal(denville.form, "Faulkner Act");

  const explicit = parseGoverningBody(
    "The Borough Council is comprised of six members elected to three-year terms on a staggered basis.",
  );
  assert.equal(explicit.seats, 6);
  assert.equal(explicit.bodyName, "Borough Council");
});

test("the form-of-government line predicts the body, and is read not inferred", () => {
  const rockaway = parseGoverningBody(
    "Rockaway Township is governed within the Faulkner Act (formally known as the Optional " +
      "Municipal Charter Law) under the Mayor-Council system of municipal government (Plan F), " +
      "implemented based on the recommendations of a Charter Study Commission as of January 1, 1968. " +
      "The township is one of 71 municipalities (of the 564) statewide that use this form of government. " +
      "The governing body is comprised of the mayor and the township council.",
  );
  assert.equal(rockaway.form, "Faulkner Act");
  assert.equal(rockaway.plan, "F");
  assert.equal(rockaway.usingFormStatewide, 71);
  assert.equal(rockaway.statewideTotal, 564);
});
