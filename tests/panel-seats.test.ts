import assert from "node:assert/strict";
import test from "node:test";

import {
  panelSeatsFor,
  STATE_SEAT_TYPES,
  type ConfirmedRow,
} from "../lib/state/panel-seats.ts";
import type { ResolvedLocation } from "../lib/state/resolved-location.ts";
import type { CoverageSummary } from "../lib/registry/coverage.ts";
import { summarizeCoverage } from "../lib/registry/coverage.ts";
import type { Division } from "../lib/registry/types.ts";
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

/** What `hooks/use-confirmed-divisions.ts` hands the splitter for District 17. */
function confirmed17(over: Partial<ConfirmedRow> = {}): ConfirmedRow {
  return {
    ocdId: SLDL_17,
    label: "State House District 17",
    divisionType: "sldl",
    tier: "state",
    holders: [],
    status: "unsourced",
    ...over,
  };
}

test("THE INSTRUMENT DEFECT: coverage.divisions cannot carry a seat coverage.seats lacks", () => {
  // `summarizeCoverage` builds `seats` by filtering `divisions`, so the two cannot disagree at seat levels.
  const divisions = [
    {
      ocdId: SLDL_19,
      divisionType: "sldl",
      tier: "state",
      state: "az",
      label: "State House District 19",
      parentOcdId: null,
      lsad: null,
      funcstat: "A",
      classfp: null,
      geoid: null,
      canonicalOcdId: null,
      canonicalMatch: "none",
      sourceDataset: "census-cartographic",
      provenance: { fetchedAt: "2026-08-31", sourceUrl: "" },
    },
  ] as unknown as Division[];
  const summary = summarizeCoverage(
    [-110.7, 32.05],
    [],
    new Map(divisions.map((d) => [d.ocdId, d])),
    [],
    0,
    new Map(),
    divisions,
    null,
  );

  const seatIds = new Set(summary.seats.map((s) => s.ocdId));
  const divisionSeatIds = summary.divisions
    .filter((d) => ["sldl", "sldu", "cd"].includes(d.divisionType))
    .map((d) => d.ocdId);

  assert.deepEqual(
    divisionSeatIds.filter((id) => !seatIds.has(id)),
    [],
    "no seat-level division exists outside coverage.seats — the two lists are one list",
  );
  assert.ok(!seatIds.has(SLDL_17), "and the ZIP centroid's answer simply does not carry 17");
});

test("RULING 222: a district the address EXCLUDES leaves the panel entirely", () => {
  const summary = coverage({ seats: [seat(SLDL_19, "State House District 19", "sldl")] });
  const panel = panelSeatsFor(summary, atAddress(), STATE_SEAT_TYPES, []);

  assert.equal(panel.yours.length, 0, "District 19 is not the reader's");
  assert.equal(
    panel.excluded.length,
    1,
    "it is DROPPED rather than never found — the count stays inspectable",
  );
  assert.equal(panel.excluded[0].ocdId, SLDL_19);
  assert.equal(panel.excluded[0].standing, "ELSEWHERE_IN_ZIP");
});

test("WGH-22: the district the reader IS in appears, from the confirmed list", () => {
  // The reader's own divisions are not in the ZIP-scoped payload; they arrive here as rows asked for by key.
  const summary = coverage({ seats: [seat(SLDL_19, "State House District 19", "sldl")] });
  const panel = panelSeatsFor(summary, atAddress(), STATE_SEAT_TYPES, [confirmed17()]);

  assert.deepEqual(
    panel.yours.map((s) => s.ocdId),
    [SLDL_17],
  );
  assert.equal(panel.yours[0].standing, "CONFIRMED");
  assert.equal(panel.yours[0].label, "State House District 17");
  assert.deepEqual(
    panel.excluded.map((s) => s.ocdId),
    [SLDL_19],
  );
});

test("WGH-22: an excluded row is NEVER promoted to CONFIRMED by a caller", () => {
  // A division the location does not confirm may not widen the panel; `standingOf` alone says what a row is.
  const summary = coverage({ seats: [seat(SLDL_19, "State House District 19", "sldl")] });
  const panel = panelSeatsFor(summary, atAddress(), STATE_SEAT_TYPES, [
    confirmed17({ ocdId: SLDL_19, label: "State House District 19" }),
  ]);

  assert.deepEqual(panel.yours, [], "the address excludes 19, whatever the caller passed");
  assert.equal(panel.excluded.length, 1);
});

test("WGH-22: a confirmed row at another level is not this section's row", () => {
  /* The State section must not render the reader's county because it was
     confirmed. The level gate is structural, not a label match. */
  const summary = coverage({ seats: [] });
  const panel = panelSeatsFor(summary, atAddress(), STATE_SEAT_TYPES, [
    confirmed17({
      ocdId: "ocd-division/country:us/state:az/county:pima",
      label: "Pima",
      divisionType: "county",
    }),
  ]);
  assert.deepEqual(panel.yours, []);
});

test("WGH-22: a row still being looked up carries its sourcing, not an absence", () => {
  const summary = coverage({ seats: [] });
  const panel = panelSeatsFor(summary, atAddress(), STATE_SEAT_TYPES, [
    confirmed17({ label: null, status: "looking" }),
  ]);
  assert.equal(panel.yours.length, 1);
  assert.equal(panel.yours[0].sourcing, "looking");
  assert.equal(panel.yours[0].label, null, "a null label is renderable; an OCD-ID is not");
});

test("WGH-22: without an address nothing is partitioned and nothing is hidden", () => {
  /* With only a ZIP there is nothing to partition on. */
  const summary = coverage({
    seats: [
      seat(SLDL_17, "State House District 17", "sldl"),
      seat(SLDL_19, "State House District 19", "sldl"),
    ],
  });
  const panel = panelSeatsFor(summary, browsing(), STATE_SEAT_TYPES, []);

  assert.equal(panel.yours.length, 2);
  assert.equal(panel.excluded.length, 0);
  assert.equal(panel.settled, false);
});
