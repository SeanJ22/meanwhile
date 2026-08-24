import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SWEEP = join(ROOT, "data/derived/class-stamp-sweep.json");
const FORMS = join(ROOT, "data/derived/body-forms.json");

/**
 * **RULING 114 — AN ALWAYS-ON STAMP IS ASSERTED AGAINST A SOURCE OF RECORD.**
 * (`NH106` session, 2026-08-23, item 3.)
 *
 * ## The defect this exists because of
 *
 * `classKeyFor` had Census LSAD 43 and 44 the wrong way round — 43 is `town`,
 * 44 is `township` — so New Jersey's township definition rendered on
 * **Morristown, Kearny, Dover, Newton, Boonton, Westfield, Clinton,
 * Hackettstown, Phillipsburg, Harrison and Belvidere**, none of which is a
 * township. Eleven readers of eleven municipalities were told, in the app's own
 * voice, how a form of government they do not live under works.
 *
 * ## What generalises past it
 *
 * Closing the class layer to 1,253 of 1,253 **removed the empty state that used
 * to be honest.** While it was incomplete, a body with no definition rendered
 * nothing — and nothing is never wrong. Completing it meant every
 * misclassification became a false claim instead of a silence, and a wrong
 * definition looks exactly as healthy as a right one.
 *
 * So the completeness figure needs a companion that can go red, and this is it.
 *
 * ## Why it checks the ARTIFACT rather than recomputing
 *
 * `pnpm class:sweep` needs `data/reference/census_govt_units_2022.csv`, which is
 * megabytes, and re-parsing it in the suite would make every run slower for a
 * check whose input changes about once a year. The digest register (RULING 102)
 * already fails the build when the sweep's own source moves without its output
 * being regenerated, so the pairing is: the register keeps the artifact fresh,
 * and this keeps the artifact honest.
 */

interface SweepRow {
  bodyId: string;
  label: string;
  stamped: string | null;
  rosterName: string | null;
  verdict: "VERIFIED" | "MISMATCH" | "ADJUDICATED" | "NO-SOURCE";
  why: string;
}

interface Sweep {
  sweptAt: string;
  counts: { swept: number; verified: number; mismatched: number; adjudicated: number; noSource: number };
  rows: SweepRow[];
}

function sweep(): Sweep {
  return JSON.parse(readFileSync(SWEEP, "utf8")) as Sweep;
}

test("RULING 114: no class stamp disagrees with its source of record", () => {
  const s = sweep();
  const bad = s.rows.filter((r) => r.verdict === "MISMATCH");
  assert.deepEqual(
    bad.map((r) => `${r.label}: ${r.why}`),
    [],
    "a stamp disagrees with the 2022 Census of Governments. Two authorities disagreeing is a " +
      "FINDING (RULING 57) and it is resolved by walking a third branch and recording what it " +
      "said in the sweep's ADJUDICATED map — never by editing the expectation.",
  );
});

test("RULING 114: the sweep covers every stamped body, not a sample", () => {
  const s = sweep();
  const forms = JSON.parse(readFileSync(FORMS, "utf8")) as {
    counts: { bodiesWithADivision: number };
  };
  assert.equal(
    s.counts.swept,
    forms.counts.bodiesWithADivision,
    "the sweep and the stamp file disagree about how many bodies there are — a sweep with a " +
      "smaller denominator than the thing it sweeps is reporting confidence it did not measure",
  );
  assert.equal(s.rows.length, s.counts.swept, "the stated count and the rows disagree (RULING 100)");
});

test("RULING 114: the three outcomes are a partition, and none is a subtraction", () => {
  const s = sweep();
  const { verified, mismatched, adjudicated, noSource, swept } = s.counts;
  assert.equal(
    verified + mismatched + adjudicated + noSource,
    swept,
    "the outcomes do not sum to the population, so at least one figure is a residual rather " +
      "than a measurement (RULING 105)",
  );
  for (const v of ["VERIFIED", "MISMATCH", "ADJUDICATED", "NO-SOURCE"] as const) {
    const counted = s.rows.filter((r) => r.verdict === v).length;
    const stated = { VERIFIED: verified, MISMATCH: mismatched, ADJUDICATED: adjudicated, "NO-SOURCE": noSource }[v];
    assert.equal(counted, stated, `the summary states ${stated} ${v} rows and the rows hold ${counted}`);
  }
});

test("RULING 114: a real second authority was actually consulted", () => {
  /*
   * The denominator, stated. A sweep whose roster failed to load would report
   * every row as NO-SOURCE and zero mismatches — a green run that checked
   * nothing, which is the empty-success shape this repo names most often. A
   * floor on VERIFIED is what makes the green mean something.
   */
  const s = sweep();
  assert.ok(
    s.counts.verified > 500,
    `only ${s.counts.verified} stamps were verified against the roster. That is too few for a ` +
      "tree this size and means the join, not the data, is what failed — which is exactly how " +
      "467 New Hampshire towns and New Jersey townships first read as unsourced.",
  );
});

test("RULING 114: NO-SOURCE says why, and never reads as agreement", () => {
  const s = sweep();
  for (const r of s.rows.filter((x) => x.verdict === "NO-SOURCE")) {
    assert.ok(
      r.why.length > 30,
      `${r.label}: a row with no source to check against must say WHY. An unexplained gap is ` +
        "indistinguishable from a gap nobody looked at.",
    );
  }
  /*
   * A school district may never be matched against the MUNICIPAL roster. Its
   * GEOID is state+district, the same seven characters a place code occupies,
   * and an ungated lookup joined six districts to unrelated towns and cities —
   * Maricopa Unified School District to CITY OF AVONDALE, Merrimack School
   * District to TOWN OF BELMONT. Nothing shipped, because a school-district
   * stamp is not a municipal form, but the LEDGER carried a wrong reason.
   */
  const crossJoined = s.rows.filter(
    (r) => (r.stamped ?? "").startsWith("school_district") && r.rosterName !== null,
  );
  assert.deepEqual(
    crossJoined.map((r) => `${r.label} -> ${r.rosterName}`),
    [],
    "a school district matched a row in the MUNICIPAL roster. Their GEOIDs share a key space, " +
      "so the lookup must be gated on the division TYPE and not on the code alone.",
  );
});

test("RULING 114: an adjudicated disagreement carries the branch that settled it", () => {
  const s = sweep();
  for (const r of s.rows.filter((x) => x.verdict === "ADJUDICATED")) {
    assert.match(
      r.why,
      /RESOLVED/,
      `${r.label}: an adjudicated row must state the resolution, not merely be excused`,
    );
    assert.ok(
      /rung \d+|Wikipedia|Archive/.test(r.why),
      `${r.label}: an adjudication must name the route that settled it — a disagreement closed ` +
        "without a stated read is a suppression with better manners",
    );
  }
});
