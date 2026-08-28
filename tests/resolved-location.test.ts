import assert from "node:assert/strict";
import test from "node:test";

import {
  applyResolvedLocation,
  keepsCouldGovernPill,
  levelKeyOf,
  standingOf,
  zipOnly,
  type ResolvedLocation,
} from "../lib/state/resolved-location.ts";

/**
 * WGH-12/13/14, BAL-31 — one resolved location, and what may be said about it.
 *
 * The reported geography is 85641 with `10723 South Bear Table Tank Drive`,
 * whose point resolves to `place:tucson_ccd`, `place:vail`,
 * `school_district:vail_unified_district`, `county:pima`, `sldl:17`, `sldu:17`
 * and `cd:6` — measured against the running app, not assumed.
 *
 * The unnamed control is a DIFFERENT seam in a different state, because the
 * rule is about evidence strength and not about Arizona.
 */

const D = "ocd-division/country:us/state:az";
const VAIL_ADDRESS: ResolvedLocation = {
  certainty: "ADDRESS_RESOLVED",
  zip: "85641",
  confirmedDivisionIds: [
    `${D}/county:pima/place:tucson_ccd`,
    `${D}/place:vail`,
    `${D}/school_district:vail_unified_district`,
    `${D}/county:pima`,
    `${D}/sldl:17`,
    `${D}/sldu:17`,
    `${D}/cd:6`,
  ],
  splitLevels: [],
};

const body = (ocdId: string | null, couldGovern = false) => ({ ocdId, couldGovern });

/* ------------------------------------------------------- the zip state --- */

test("WGH: a zip alone settles nothing, and every hedge stands", () => {
  const location = zipOnly("85641");
  assert.equal(standingOf(body(`${D}/place:tucson`, true), location), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(body(`${D}/place:tucson`, true), location), true);
  // An empty confirmed list is "not asked", never "asked and nothing governs".
  assert.deepEqual(location.confirmedDivisionIds, []);
});

/* ------------------------------------------------- the named regression --- */

test("WGH-14: a body the address CONFIRMED stops asking for the address", () => {
  const vail = body(`${D}/school_district:vail_unified_district`, true);
  assert.equal(standingOf(vail, VAIL_ADDRESS), "CONFIRMED");
  assert.equal(
    keepsCouldGovernPill(vail, VAIL_ADDRESS),
    false,
    "the reader already answered this; asking again is the product not listening",
  );
});

test("WGH-13: Tucson is ELSEWHERE, and it is the widening that put it there", () => {
  /*
   * The point's own divisions are `place:tucson_ccd` and `place:vail`. The
   * City of Tucson arrives only through the zip-area widening, and the address
   * settles the `place` level against it.
   */
  const tucson = body(`${D}/place:tucson`, true);
  assert.equal(standingOf(tucson, VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
  // The mark STAYS, deliberately. An unmarked row reads as "this governs you",
  // so clearing it here would upgrade a body the address excludes from a hedged
  // claim to a confident wrong one. See keepsCouldGovernPill.
  assert.equal(keepsCouldGovernPill(tucson, VAIL_ADDRESS), true);

  // And the CCD it is confused with is a different division entirely.
  assert.equal(
    standingOf(body(`${D}/county:pima/place:tucson_ccd`), VAIL_ADDRESS),
    "CONFIRMED",
  );
});

test("WGH-12: the district the address named is confirmed and its neighbour is not", () => {
  assert.equal(standingOf(body(`${D}/sldl:17`), VAIL_ADDRESS), "CONFIRMED");
  assert.equal(standingOf(body(`${D}/sldl:19`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
  assert.equal(standingOf(body(`${D}/sldl:21`), VAIL_ADDRESS), "ELSEWHERE_IN_ZIP");
});

/* --------------------------------------- partial ambiguity stays hedged --- */

test("WGH: an address does NOT make every fact certain — a crossed level stays hedged", () => {
  // The overreach this rule is written against. The street crosses the school
  // district line, so that level is genuinely unsettled and keeps its pill,
  // while the levels the address DID settle retire theirs.
  const partial: ResolvedLocation = {
    ...VAIL_ADDRESS,
    confirmedDivisionIds: [`${D}/county:pima`, `${D}/sldl:17`],
    splitLevels: ["school_district"],
  };
  const school = body(`${D}/school_district:vail_unified_district`, true);
  assert.equal(standingOf(school, partial), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(school, partial), true);
  assert.equal(standingOf(body(`${D}/sldl:17`, true), partial), "CONFIRMED");
});

test("WGH: a level the address never spoke to is left alone, not contradicted", () => {
  const onlyState: ResolvedLocation = {
    ...VAIL_ADDRESS,
    confirmedDivisionIds: [`${D}/sldl:17`],
    splitLevels: [],
  };
  // Nothing was settled at `school_district`, so a school body is UNSETTLED
  // rather than "elsewhere" — silence is not a contradiction.
  assert.equal(
    standingOf(body(`${D}/school_district:vail_unified_district`, true), onlyState),
    "UNSETTLED",
  );
});

test("WGH: a division-less body is never contradicted by an address", () => {
  // D28 bodies — special districts, regional councils — have no level to be
  // compared at. Inferring "elsewhere" from an absence asserts an absence.
  assert.equal(standingOf(body(null, true), VAIL_ADDRESS), "UNSETTLED");
  assert.equal(keepsCouldGovernPill(body(null, true), VAIL_ADDRESS), true);
});

/* ------------------------------------------------- the unnamed control --- */

test("WGH control: a different state's zip seam behaves the same way", () => {
  /*
   * 07866 crosses Rockaway Township and Rockaway Borough — the seam NJ01 was
   * adopted over, a different state, a different level, the same rule. Nothing
   * in this module knows about Arizona.
   */
  const NJ = "ocd-division/country:us/state:nj";
  const rockaway: ResolvedLocation = {
    certainty: "ADDRESS_RESOLVED",
    zip: "07866",
    confirmedDivisionIds: [`${NJ}/county:morris`, `${NJ}/place:rockaway_township`],
    splitLevels: [],
  };
  assert.equal(standingOf(body(`${NJ}/place:rockaway_township`, true), rockaway), "CONFIRMED");
  assert.equal(standingOf(body(`${NJ}/place:rockaway_borough`, true), rockaway), "ELSEWHERE_IN_ZIP");
  assert.equal(standingOf(body(`${NJ}/county:morris`, true), rockaway), "CONFIRMED");
});

/* -------------------------------------------------------- completeness --- */

test("WGH: applying a location never drops a body", () => {
  const bodies = [
    body(`${D}/place:vail`, true),
    body(`${D}/place:tucson`, true),
    body(`${D}/sldl:19`, true),
    body(null, true),
  ];
  const applied = applyResolvedLocation(bodies, VAIL_ADDRESS);
  assert.equal(applied.length, bodies.length, "show everything we find");
  assert.deepEqual(
    applied.map((b) => b.standing),
    ["CONFIRMED", "ELSEWHERE_IN_ZIP", "ELSEWHERE_IN_ZIP", "UNSETTLED"],
  );
  // Only the CONFIRMED row stops asking. The excluded ones keep the mark
  // until there is copy that says "not yours" rather than "could govern you".
  assert.deepEqual(
    applied.filter((b) => b.couldGovern === true).map((b) => b.ocdId),
    [`${D}/place:tucson`, `${D}/sldl:19`, null],
  );
});

test("WGH: browsing elsewhere never rewrites where the reader lives", () => {
  // A display state, not a truth state. Nothing here mutates a location, and
  // BROWSING settles nothing.
  const browsing: ResolvedLocation = { ...VAIL_ADDRESS, certainty: "BROWSING" };
  assert.equal(standingOf(body(`${D}/sldl:21`, true), browsing), "UNSETTLED");
  assert.equal(standingOf(body(`${D}/sldl:17`, true), browsing), "UNSETTLED");
});

test("WGH: the level key is the deepest segment, never a string match on a label", () => {
  assert.equal(levelKeyOf(`${D}/sldl:17`), "sldl");
  assert.equal(levelKeyOf(`${D}/county:pima/place:tucson_ccd`), "place");
  assert.equal(levelKeyOf(`${D}/county:pima`), "county");
  assert.equal(levelKeyOf("not-an-ocd-id"), null);
});
