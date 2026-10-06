/**
 * THE MEASURE STANDARD — Item 6a's guards.
 * (2026-08-26, the descent session.)
 *
 * The load-bearing case is the LAST one: **the symmetry check must REFUSE, not
 * report.** The brief's words are *build the check to enforce it, not to report
 * it*, and the difference is that a report of asymmetry is something somebody
 * reads after the asymmetric card has already been in front of a reader.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  moneyCoverageSymmetry,
  fieldSatisfied,
  isStale,
  MEASURE_FIELDS,
  MEASURE_FIELD_EXPIRY_DAYS,
  MEASURE_MONEY_EXPIRY_DAYS,
  MONEY_PAIR,
  FORBIDDEN_MEASURE_KEYS,
  scoreMeasure,
  type MeasureField,
  type MeasureFieldReading,
  type MeasureReading,
} from "../lib/hunt/measure-depth.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TODAY = "2026-08-26";

const read = (field: MeasureField, over: Partial<MeasureFieldReading> = {}): MeasureFieldReading => ({
  field,
  state: "FOUND",
  at: TODAY,
  ...over,
});

const full = (over: Partial<Record<MeasureField, Partial<MeasureFieldReading>>> = {}): MeasureReading => ({
  measureId: "vail-override-2026",
  title: "Vail Unified Override Reauthorization",
  certifyingBody: "Pima County Elections Department",
  fields: MEASURE_FIELDS.map((f) => read(f, over[f] ?? {})),
});

test("the standard is seven fields and the money is a PAIR", () => {
  assert.equal(MEASURE_FIELDS.length, 7, "the measure standard changed size — was that a decision?");
  assert.deepEqual([...MONEY_PAIR], ["moneyFor", "moneyAgainst"]);
  for (const f of MONEY_PAIR) {
    assert.ok(MEASURE_FIELDS.includes(f), `${f} left the standard — the pair cannot be enforced without it`);
  }
});

test("a complete measure is DONE, and a missing field is OWED with the field named", () => {
  const done = scoreMeasure(full(), TODAY);
  assert.equal(done.verdict, "DONE");
  assert.equal(done.satisfied, 7);
  assert.deepEqual([...done.owed], []);

  const thin = scoreMeasure(full({ plainLanguage: { state: "NOT_HUNTED", at: null } }), TODAY);
  assert.equal(thin.verdict, "OWED");
  assert.ok(thin.owed.includes("plainLanguage"), "a count is not a name — the owed field is named");
});

test("CP-17: uneven money coverage is a scoreboard reading, not a publication refusal", () => {
  /* THE LOAD-BEARING CASE. Support hunted, opposition untouched: everything
   * else about this measure is complete; its remaining research is still visible. */
  const lopsided = full({ moneyAgainst: { state: "NOT_HUNTED", at: null } });
  const v = scoreMeasure(lopsided, TODAY);
  assert.equal(
    v.verdict,
    "ASYMMETRIC_COVERAGE",
    "six of seven fields complete and one-sided money must BLOCK — showing who funded the yes and not the no " +
      "is taking a side by omission",
  );
  assert.equal(v.symmetry.symmetric, false);
  assert.match(v.symmetry.reason, /opposition/, "the reason names WHICH side was not hunted");

  /* And blocked is NOT the same instruction as owed. */
  assert.notEqual(v.verdict, "OWED", "the scoreboard separately names uneven coverage; both remain open work.");

  /* The mirror: opposition hunted, support not. Same refusal. */
  const otherWay = scoreMeasure(full({ moneyFor: { state: "NOT_HUNTED", at: null } }), TODAY);
  assert.equal(otherWay.verdict, "ASYMMETRIC_COVERAGE");
  assert.match(otherWay.symmetry.reason, /support/);
});

test("neither side hunted is symmetric and still owed", () => {
  const neither = full({
    moneyFor: { state: "NOT_HUNTED", at: null },
    moneyAgainst: { state: "NOT_HUNTED", at: null },
  });
  const v = scoreMeasure(neither, TODAY);
  assert.equal(v.symmetry.symmetric, true, "no side favoured means no side taken");
  assert.equal(v.verdict, "OWED", "symmetric and incomplete is OWED — more hunting, not a block");
});

test("NONE_REGISTERED is a finding and needs its filing officer; NOT_HUNTED is ours", () => {
  /* A contest can genuinely have no registered opposition committee. That is a
   * fact about the world and it renders as one. The two must never be
   * interchangeable, or a session skips the hard side and calls it an absence. */
  const honest = full({
    moneyAgainst: { state: "NONE_REGISTERED", filingOfficer: "Pima County Recorder, A.R.S. § 16-928" },
  });
  const v = scoreMeasure(honest, TODAY);
  assert.equal(v.verdict, "DONE", "a named finding about the world satisfies the field");

  const unsourced = full({ moneyAgainst: { state: "NONE_REGISTERED" } });
  assert.equal(
    scoreMeasure(unsourced, TODAY).verdict,
    "ASYMMETRIC_COVERAGE",
    "an unsourced finding is an assertion — the thing this product exists not to make",
  );
});

test("NO_OFFICIAL_ESTIMATE is the only honest household cost when the body publishes none", () => {
  const noEstimate = full({
    householdCost: { state: "NO_OFFICIAL_ESTIMATE", estimateSource: "Vail USD publishes no fiscal impact statement; checked its own site" },
  });
  assert.equal(scoreMeasure(noEstimate, TODAY).verdict, "DONE");

  assert.equal(
    fieldSatisfied(read("householdCost", { state: "NO_OFFICIAL_ESTIMATE" }), TODAY),
    false,
    "saying no estimate exists without saying where we looked is an unsourced claim",
  );
});

test("the money clock is SHORTER than the text clock, and both expire", () => {
  assert.equal(MEASURE_FIELD_EXPIRY_DAYS, 14);
  assert.equal(MEASURE_MONEY_EXPIRY_DAYS, 7);
  assert.ok(MEASURE_MONEY_EXPIRY_DAYS < MEASURE_FIELD_EXPIRY_DAYS, "committee filings move faster than certified text");

  /* Ten days old: the text is still current, the money is not. */
  assert.equal(isStale(read("officialText", { at: "2026-08-16" }), TODAY), false);
  assert.equal(isStale(read("moneyFor", { at: "2026-08-16" }), TODAY), true);

  /* A reading with no date reads as stale rather than fresh (RULING 53). */
  assert.equal(isStale(read("officialText", { at: null }), TODAY), true);
});

test("a stale money reading on one side re-opens the asymmetry", () => {
  const stale = full({ moneyAgainst: { at: "2026-08-01" } });
  assert.equal(
    scoreMeasure(stale, TODAY).verdict,
    "ASYMMETRIC_COVERAGE",
    "an absence expires, and so does a presence — one side going stale is one side unshown",
  );
});

test("the vote-recommendation ban is unchanged, and asserted where a measure is defined", () => {
  for (const key of ["score", "rank", "rating", "match", "fit", "grade", "alignment", "recommendation", "lean"]) {
    assert.ok(FORBIDDEN_MEASURE_KEYS.includes(key as never), `${key} left the forbidden list`);
  }

  /* And the module must not have grown one itself. Read as SHAPE, not as a
   * string search over the whole file: the doc comment discusses the ban by
   * name, and a naive grep would flag the prohibition as the violation. */
  const src = readFileSync(join(ROOT, "lib", "hunt", "measure-depth.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
  for (const key of ["score", "rank", "rating", "recommendation", "lean"]) {
    assert.ok(
      !new RegExp(`readonly\\s+${key}\\s*[?:]`).test(code),
      `measure-depth.ts declares a "${key}" field — the product never ranks, scores or leans`,
    );
  }
});
