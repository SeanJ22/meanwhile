import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { classKeyFor } from "../lib/officials/body-definitions.ts";
import { formFor, knownForms, stateOf } from "../lib/officials/body-form.ts";

const ROOT = join(import.meta.dirname, "..");

const forms = JSON.parse(
  readFileSync(join(ROOT, "data", "derived", "body-forms.json"), "utf8"),
) as {
  counts: {
    bodiesWithADivision: number;
    /** The other half of the pair. A single figure in front of two measurements hides one. */
    alreadyCarryingAFormDefinition: number;
    owedAFormDefinition: number;
    stamped: number;
    unstampable: number;
    distinctForms: number;
  };
  distinctForms: Record<string, number>;
  unstampable: Array<{ bodyId: string; reason: string; divisionLabel: string }>;
  rows: Array<{ ocdId: string; formKey: string | null; basis: string | null }>;
};

/* ========================================================================== */
/* LSAD 43 is `town`. LSAD 44 is `township`. They were the other way round.   */
/* ========================================================================== */

/**
 * The defect this guard is built from, and it was live on eleven cards:
 * `classKeyFor` read `lsad === "43" ? "township" : "municipality"` on the
 * belief that 43 was Township. It is not — 43 is the `town` suffix, 44 is
 * `township` — so New Jersey's township definition, which says in as many words
 * *"in New Jersey a township is a TYPE of municipality"*, was rendering on the
 * cards of Morristown, Kearny, Dover, Newton, Boonton, Westfield, Clinton,
 * Hackettstown, Phillipsburg, Harrison and Belvidere. **None of those is a
 * township.** A wrong claim about a named government is the one failure this
 * product cannot survive.
 */
test("forms: LSAD 44 is a township and LSAD 43 is not", () => {
  assert.equal(classKeyFor({ divisionType: "place", lsad: "44" }), "township");
  assert.equal(classKeyFor({ divisionType: "place", lsad: "43" }), "municipality");
  assert.equal(classKeyFor({ divisionType: "place", lsad: "21" }), "municipality");
  assert.equal(classKeyFor({ divisionType: "place", lsad: "25" }), "municipality");
});

test("forms: the eleven New Jersey Towns are stamped as Towns, not townships", () => {
  /*
   * By OCD-ID, never by name string. Each of these carries LSAD 43 in the
   * committed registry and each is one of New Jersey's Towns.
   */
  for (const slug of ["morristown", "kearny", "newton", "boonton", "westfield"]) {
    const stamp = formFor({
      ocdId: `ocd-division/country:us/state:nj/place:${slug}`,
      divisionType: "place",
      lsad: "43",
    });
    assert.equal(stamp.formKey, "nj:town", `${slug} is stamped ${stamp.formKey}`);
    assert.equal(stamp.label, "a New Jersey Town");
    assert.equal(stamp.basis, "tiger-lsad");
  }
});

test("forms: a New Jersey township and a New Hampshire town are DIFFERENT forms", () => {
  const njTownship = formFor({
    ocdId: "ocd-division/country:us/state:nj/county:sussex/place:frankford_township",
    divisionType: "place",
    lsad: "44",
  });
  const nhTown = formFor({
    ocdId: "ocd-division/country:us/state:nh/county:strafford/place:madbury_town",
    divisionType: "place",
    lsad: "43",
  });
  assert.equal(njTownship.formKey, "nj:township");
  assert.equal(nhTown.formKey, "nh:town");
  assert.notEqual(njTownship.formKey, nhTown.formKey);
});

test("forms: the same LSAD in two states never produces one national form", () => {
  const njTown = formFor({
    ocdId: "ocd-division/country:us/state:nj/place:morristown",
    divisionType: "place",
    lsad: "43",
  });
  const azTown = formFor({
    ocdId: "ocd-division/country:us/state:az/place:patagonia",
    divisionType: "place",
    lsad: "43",
  });
  assert.notEqual(
    njTown.formKey,
    azTown.formKey,
    "a national `town` form would be false in both states — the stamp is state-scoped",
  );
});

/* ========================================================================== */
/* Unstampable is NAMED, never guessed                                        */
/* ========================================================================== */

test("forms: an unclassified school district is unstampable, never assumed independent", () => {
  const stamp = formFor({
    ocdId: "ocd-division/country:us/state:nh/school_district:nothing_the_census_knows",
    divisionType: "school_district",
    schoolDependency: "UNCLASSIFIED",
  });
  assert.equal(stamp.formKey, null);
  assert.match(stamp.unstampableReason ?? "", /independent or dependent/);

  // And omitting it entirely is the same answer — never a base-rate guess.
  const omitted = formFor({
    ocdId: "ocd-division/country:us/state:nh/school_district:nothing_the_census_knows",
    divisionType: "school_district",
  });
  assert.equal(omitted.formKey, null);
});

test("forms: a place with no legal type code is unstampable, never named from its label", () => {
  const noCode = formFor({
    ocdId: "ocd-division/country:us/state:nj/place:princeton",
    divisionType: "place",
    lsad: "00",
  });
  assert.equal(noCode.formKey, null);
  assert.match(noCode.unstampableReason ?? "", /no legal municipal type/);

  const noLsad = formFor({
    ocdId: "ocd-division/country:us/state:nj/place:somewhere",
    divisionType: "place",
    lsad: null,
  });
  assert.equal(noLsad.formKey, null);
  assert.match(noLsad.unstampableReason ?? "", /not guessable from a name/);
});

test("forms: a body with no division is unstampable rather than defaulted", () => {
  const stamp = formFor({ ocdId: null, divisionType: "place", lsad: "43" });
  assert.equal(stamp.formKey, null);
  assert.match(stamp.unstampableReason ?? "", /no division/);
});

test("forms: every unstampable body carries a reason naming the missing input", () => {
  for (const row of forms.unstampable) {
    assert.ok(row.reason && row.reason.length > 20, `${row.bodyId} has no real reason`);
    assert.ok(row.divisionLabel, `${row.bodyId} is not identifiable`);
  }
});

/* ========================================================================== */
/* The collapse — 1,037 bodies into a bounded list of forms                   */
/* ========================================================================== */

test("forms: the stamped and unstampable account for every owed body (RULING 100)", () => {
  assert.equal(
    forms.counts.stamped + forms.counts.unstampable,
    forms.counts.owedAFormDefinition,
    "a partial that reconciles is still a failure — account for every owed body",
  );
  /*
   * **The owed count MOVES, and it moves DOWN.** (2026-08-24, item 6.)
   *
   * This asserted `owedAFormDefinition === 1037` and `stamped >= 1030`, which
   * pinned the size of the GAP rather than the health of the stamp. Reading
   * eight municipal statutes and writing `lib/officials/form-definitions.ts`
   * took bodies carrying a form definition from 216 to 857, so owed fell to
   * 396 — and a frozen number turns that into a red test, which trains a
   * reader to raise the constant rather than to look.
   *
   * What is actually worth guarding is the INVARIANT above — every owed body is
   * either stamped or named unstampable — plus the DIRECTION. The pair is
   * stated rather than a single figure, because `owed` falling while `already`
   * stays put would mean bodies had gone missing rather than been defined.
   */
  assert.equal(
    forms.counts.alreadyCarryingAFormDefinition + forms.counts.owedAFormDefinition,
    forms.counts.bodiesWithADivision,
    "the pair does not reconcile: a body must be either carrying a form definition or owed one",
  );
  assert.ok(
    forms.counts.owedAFormDefinition <= 1037,
    `owed rose to ${forms.counts.owedAFormDefinition} from 1037 — bodies do not become LESS ` +
      "defined on their own, so something was removed",
  );
  assert.ok(
    forms.counts.unstampable <= 5,
    `${forms.counts.unstampable} bodies are unstampable — each must be named with the input ` +
      "that was missing, and a rising count is a finding rather than noise",
  );
});

test("forms: the collapse is real — far fewer distinct forms than bodies", () => {
  const distinct = Object.keys(forms.distinctForms).length;
  assert.equal(distinct, forms.counts.distinctForms, "the stated count is not the rendered rows");
  assert.ok(
    distinct < 40,
    `${distinct} distinct forms — the point of the stamp is a bounded list, not a per-body one`,
  );
  assert.equal(
    Object.values(forms.distinctForms).reduce((a, b) => a + b, 0),
    forms.counts.stamped,
    "the per-form counts do not sum to the stamped total",
  );
});

test("forms: every stamped form carries a reader-facing label", () => {
  for (const formKey of Object.keys(forms.distinctForms)) {
    assert.ok(
      knownForms().includes(formKey),
      `${formKey} is stamped on real bodies and has no label written for it`,
    );
  }
});

test("forms: every stamp names which committed input decided it", () => {
  const bases = new Set(forms.rows.filter((r) => r.formKey !== null).map((r) => r.basis));
  for (const basis of bases) {
    assert.ok(
      ["tiger-lsad", "division-type", "census-school-dependency"].includes(basis as string),
      `unknown basis ${basis} — a stamp must say what decided it`,
    );
  }
  assert.ok(bases.size >= 2, "every stamp came from one input — that is suspicious, not clean");
});

test("forms: stateOf reads the state structurally and refuses a nameless id", () => {
  assert.equal(stateOf("ocd-division/country:us/state:nj/place:morristown"), "nj");
  assert.equal(stateOf("ocd-division/country:us"), null);
});
