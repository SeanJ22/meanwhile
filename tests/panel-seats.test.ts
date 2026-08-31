/**
 * **WGH-22 — THE PANEL SHOWS THE READER'S OWN DISTRICTS.** (Session B, WS2.)
 *
 * Reported three sessions running. On 2026-08-30 the owner photographed, on
 * one screen at a resolved address in 85641: a districts popup correctly
 * reading State House 17 and State Senate 17, and a Who Governs Here panel
 * listing State House 19 and State Senate 19, each labelled *not yours —
 * covers another part of 85641*, with District 17 nowhere on the panel.
 *
 * The app resolved correctly and then displayed the other answer, wearing a
 * label that proves it knew.
 *
 * The first repair attempt failed on the real surface in an instructive way,
 * and the third test below is that failure, seeded. It built the reader's list
 * from `coverage.divisions` and stamped every row CONFIRMED — which at 85641
 * promoted the two excluded rows from a hedged claim to a confident wrong one.
 * A rendering defect turned into a false claim about a government, which is
 * the one direction this product cannot trade toward.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { panelSeatsFor, elsewhereDisclosureLabel, STATE_SEAT_TYPES } from "../lib/state/panel-seats.ts";
import type { ResolvedLocation } from "../lib/state/resolved-location.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";

const SLDL_17 = "ocd-division/country:us/state:az/sldl:17";
const SLDL_19 = "ocd-division/country:us/state:az/sldl:19";
const SLDU_17 = "ocd-division/country:us/state:az/sldu:17";

function seat(ocdId: string, label: string, divisionType: "sldl" | "sldu" | "cd") {
  return {
    ocdId,
    label,
    divisionType,
    tier: "state" as const,
    representatives: [],
  };
}

function coverage(over: Partial<CoverageSummary> = {}): CoverageSummary {
  return {
    seats: [],
    divisions: [],
    bodies: [],
    senators: [],
    statewideExecutives: [],
    counts: { withoutSource: 0 },
    seatCounts: { named: 0, total: 0 },
    unincorporated: false,
    ...over,
  } as unknown as CoverageSummary;
}

/** An address that settled the reader into District 17. */
function atAddress(): ResolvedLocation {
  return {
    certainty: "ADDRESS_RESOLVED",
    zip: "85641",
    confirmedDivisionIds: [SLDL_17, SLDU_17],
    splitLevels: [],
  };
}

/** A reader who gave only a zip. Nothing is settled and nothing may be split. */
function browsing(): ResolvedLocation {
  return { certainty: "SELF_DECLARED_ZIP", zip: "85641", confirmedDivisionIds: [], splitLevels: [] };
}

const noHolders = () => [];

test("SEEDED WGH-22: a district the address EXCLUDES leaves the reader's list", () => {
  const summary = coverage({
    seats: [seat(SLDL_19, "State House District 19", "sldl")],
    divisions: [],
  });
  const panel = panelSeatsFor(summary, atAddress(), STATE_SEAT_TYPES, noHolders);

  assert.equal(panel.yours.length, 0, "District 19 is not the reader's");
  assert.equal(panel.elsewhere.length, 1, "and it is KEPT, not dropped");
  assert.equal(panel.elsewhere[0].ocdId, SLDL_19);
  assert.equal(panel.elsewhere[0].standing, "ELSEWHERE_IN_ZIP");
});

test("SEEDED WGH-22: a district the reader IS in appears even when the zip's seat list omits it", () => {
  /*
   * The half nobody had named. `coverage.seats` is the ZIP's seats; the
   * reader's own divisions are in `coverage.divisions`. Hiding the excluded
   * rows without this would have left the state section emptier rather than
   * righter — which is why the two halves ship together.
   */
  const summary = coverage({
    seats: [seat(SLDL_19, "State House District 19", "sldl")],
    divisions: [
      { ocdId: SLDL_17, label: "State House District 17", divisionType: "sldl", tier: "state" },
    ],
  });
  const panel = panelSeatsFor(summary, atAddress(), STATE_SEAT_TYPES, noHolders);

  assert.deepEqual(
    panel.yours.map((s) => s.ocdId),
    [SLDL_17],
  );
  assert.equal(panel.yours[0].standing, "CONFIRMED");
  assert.deepEqual(
    panel.elsewhere.map((s) => s.ocdId),
    [SLDL_19],
  );
});

test("SEEDED WGH-22: an excluded row is NEVER promoted to CONFIRMED", () => {
  /*
   * The first repair did exactly this, and driving it against the real surface
   * is how it was caught: `coverage.divisions` at 85641 still carried District
   * 19, so stamping the reader's list CONFIRMED upgraded two rows the address
   * excludes into a confident wrong claim. `keepsCouldGovernPill` refuses the
   * same move one level down and records why.
   *
   * `standingOf` is the only thing that may say what a row IS. This function
   * only chooses which list it goes in.
   */
  const summary = coverage({
    seats: [seat(SLDL_19, "State House District 19", "sldl")],
    /* The trap: the division list ALSO carries 19. */
    divisions: [
      { ocdId: SLDL_19, label: "State House District 19", divisionType: "sldl", tier: "state" },
    ],
  });
  const panel = panelSeatsFor(summary, atAddress(), STATE_SEAT_TYPES, noHolders);

  for (const row of [...panel.yours, ...panel.elsewhere]) {
    assert.notEqual(
      row.standing === "CONFIRMED" && row.ocdId === SLDL_19,
      true,
      "a row the address excludes may never render as the reader's own",
    );
  }
  assert.deepEqual(panel.yours, []);
  assert.equal(panel.elsewhere.length, 1);
});

test("WGH-22: without an address nothing is partitioned and nothing is hidden", () => {
  /* A reader who gave only a zip sees exactly what they saw before. There is
     nothing to partition on, and inventing one would be the panel guessing. */
  const summary = coverage({
    seats: [
      seat(SLDL_17, "State House District 17", "sldl"),
      seat(SLDL_19, "State House District 19", "sldl"),
    ],
    divisions: [],
  });
  const panel = panelSeatsFor(summary, browsing(), STATE_SEAT_TYPES, noHolders);

  assert.equal(panel.yours.length, 2);
  assert.equal(panel.elsewhere.length, 0);
  assert.equal(panel.settled, false);
});

test("WGH-22: the disclosure label counts the rows behind it", () => {
  /* WGH-21 is what happens when a label states a number the list can
     contradict. This one is derived from `elsewhere.length` at the call site. */
  assert.equal(elsewhereDisclosureLabel(1, "85641"), "1 more district covers another part of 85641");
  assert.equal(
    elsewhereDisclosureLabel(3, "85641"),
    "3 more districts cover other parts of 85641",
  );
});
