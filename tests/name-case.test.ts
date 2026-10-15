import assert from "node:assert/strict";
import { test } from "node:test";

import { ballotCandidateDisplayName, surnameDisplayCase } from "../lib/ballot/name-case.ts";

test("all-caps filed surnames case as names", () => {
  assert.equal(surnameDisplayCase("ROACH"), "Roach");
  assert.equal(surnameDisplayCase("BOOKER"), "Booker");
  assert.equal(surnameDisplayCase("KUNIANSKY"), "Kuniansky");
});

test("Mc names keep the internal capital", () => {
  assert.equal(surnameDisplayCase("MCDONALD"), "McDonald");
  assert.equal(surnameDisplayCase("MCKEON"), "McKeon");
});

test("apostrophe names keep the capital after the apostrophe", () => {
  assert.equal(surnameDisplayCase("O'BRIEN"), "O'Brien");
  assert.equal(surnameDisplayCase("D'AMATO"), "D'Amato");
});

test("internal-capital names resolve via the exceptions map", () => {
  assert.equal(surnameDisplayCase("DECROCE"), "DeCroce");
  assert.equal(surnameDisplayCase("DIMAIO"), "DiMaio");
});

test("particles and multi-word surnames case per word", () => {
  assert.equal(surnameDisplayCase("VAN DREW"), "Van Drew");
  assert.equal(surnameDisplayCase("VON BERG"), "Von Berg");
  assert.equal(surnameDisplayCase("TANG-WILLIAMS"), "Tang-Williams");
});

test("generational suffixes stay as filed", () => {
  assert.equal(surnameDisplayCase("SMITH III"), "Smith III");
});

test("mixed-case input passes through byte-identical — never 'corrected'", () => {
  assert.equal(surnameDisplayCase("Roach"), "Roach");
  assert.equal(surnameDisplayCase("DeCroce"), "DeCroce");
  assert.equal(surnameDisplayCase("van der Berg"), "van der Berg");
  assert.equal(surnameDisplayCase("McDonald"), "McDonald");
});

test("surname-first candidate tickets display each person's given name first without changing the official quote", () => {
  const candidate = { givenName: "", familyName: "Benson, Jocelyn / Brinks, Winnie",
    provenance: { quote: "Democratic Party | Benson, Jocelyn / Brinks, Winnie | 04/16/2026 | Petitions" } };
  const saved = structuredClone(candidate);
  assert.equal(ballotCandidateDisplayName(candidate), "Jocelyn Benson / Winnie Brinks");
  assert.deepEqual(candidate, saved);
  assert.equal(ballotCandidateDisplayName({ givenName: "", familyName: "O'BRIEN, ALEX / McDonald, Jordan" }), "Alex O'Brien / Jordan McDonald");
  assert.equal(ballotCandidateDisplayName({ givenName: "", familyName: "SMITH, JOHN, JR." }), "John Smith, Jr.");
  assert.equal(ballotCandidateDisplayName({ givenName: "", familyName: "John Smith, Jr." }), "John Smith, Jr.");
  assert.equal(ballotCandidateDisplayName({ givenName: "Jocelyn", familyName: "Benson" }), "Jocelyn Benson");
  assert.equal(ballotCandidateDisplayName({ givenName: "", familyName: "Jocelyn Benson / Winnie Brinks" }), "Jocelyn Benson / Winnie Brinks");
});
