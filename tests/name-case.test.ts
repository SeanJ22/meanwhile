import assert from "node:assert/strict";
import { test } from "node:test";

import { surnameDisplayCase } from "../lib/ballot/name-case.ts";

/**
 * Filed ledger-caps surnames render as names, not shouting.
 * The pass is display-only and fires only on all-caps input.
 */

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
