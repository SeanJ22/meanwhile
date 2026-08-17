import assert from "node:assert/strict";
import test from "node:test";

import { deriveWhoGoverns } from "../lib/registry/who-governs.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";

/**
 * ITEM 1a (2026-08-17): the Who Governs Here card stated three different
 * numbers for one list — prose 4, disclosure link "Why these 5?", rows 5.
 *
 * This file proves the invariant STRUCTURALLY rather than against today's
 * data. At the four pilot zips the governing set is 4, 2, 4 and 3 bodies, all
 * of them under the old five-row cut, so a test built from production would
 * pass on a build where the cut still bit — and would go on passing right up
 * until the first zip with six governments.
 *
 * So the inputs below are synthetic and deliberately larger than anything the
 * registry holds.
 */

let seq = 0;
function body(
  bodyClass: CoveredBody["bodyClass"],
  over: Partial<CoveredBody> = {},
): CoveredBody {
  seq += 1;
  return {
    bodyId: `body-${seq}`,
    ocdId: `ocd-division/country:us/state:zz/thing:${seq}`,
    name: `Body ${seq}`,
    divisionLabel: `Division ${seq}`,
    divisionType: "place",
    bodyClass,
    coverageStatus: "LIVE",
    lookedAt: true,
    ...over,
  } as CoveredBody;
}

test("the stated count and the rendered rows are the same expression, at any size", () => {
  // Twelve governments and forty-eight boards — three times the largest
  // governing set the product has ever rendered, and far past the old cut.
  for (const governing of [0, 1, 2, 3, 4, 5, 6, 12, 40]) {
    const bodies = [
      ...Array.from({ length: governing }, () => body("GOVERNING")),
      ...Array.from({ length: 48 }, () => body("COMMISSION")),
    ];
    const d = deriveWhoGoverns(bodies, new Set());
    assert.equal(
      d.rows.length,
      d.governingCount,
      `stated ${d.governingCount} against ${d.rows.length} rendered rows at size ${governing}`,
    );
    assert.equal(d.others, 48, "the boards are counted, not dropped");
    assert.ok(
      d.rows.every((b) => b.bodyClass === "GOVERNING"),
      "no non-government may sit in the governments list",
    );
  }
});

test("the 85701 shape: the Board of Adjustment is the row that moved, not the PHA", () => {
  // The real classes, reproduced. The brief's named suspect was the Public
  // Housing Authority board; the evidence says otherwise, and this pins which
  // row it actually was so the diagnosis survives the fix.
  const pima = body("GOVERNING", { name: "Pima" });
  const tucson = body("GOVERNING", { name: "Tucson" });
  const pha = body("GOVERNING", {
    name: "Public Housing Authority Board of Commissioners",
  });
  const tusd = body("GOVERNING", { name: "Tucson Unified District" });
  const baj = body("COMMISSION", { name: "Board of Adjustment (BAJ)" });

  const d = deriveWhoGoverns([pima, tucson, pha, tusd, baj], new Set());

  assert.equal(d.governingCount, 4, "four governments, as the prose always said");
  assert.equal(d.rows.length, 4, "and four rows, which is what changed");
  assert.ok(
    d.rows.some((b) => b.name?.startsWith("Public Housing")),
    "the PHA board IS a government and stays in the list",
  );
  assert.ok(
    !d.rows.some((b) => b.name?.startsWith("Board of Adjustment")),
    "the Board of Adjustment is a commission and leaves the governments list",
  );
  assert.equal(d.others, 1);
});

test("narrowing cannot re-open the gap — the count follows the reader's own list", () => {
  /*
   * The second instance, and the one a server-side fix would have left live.
   * `counts.governing` is computed on the server; the M26 narrowing happens on
   * the device. A reader narrowing to one school district used to shrink the
   * rows while the prose kept quoting the server's number.
   */
  const county = body("GOVERNING", { divisionType: "county" });
  const districtA = body("GOVERNING", { divisionType: "school_district" });
  const districtB = body("GOVERNING", { divisionType: "school_district" });
  const districtC = body("GOVERNING", { divisionType: "school_district" });

  const wide = deriveWhoGoverns([county, districtA, districtB, districtC], new Set());
  assert.equal(wide.governingCount, 4);
  assert.equal(wide.rows.length, 4);

  const narrowed = deriveWhoGoverns(
    [county, districtA, districtB, districtC],
    new Set([districtB.ocdId as string]),
  );
  assert.equal(narrowed.rows.length, 2, "the county plus the chosen district");
  assert.equal(
    narrowed.governingCount,
    narrowed.rows.length,
    "the stated number followed the narrowing — this is the assertion that fails on the old code",
  );
  assert.equal(narrowed.others, 0);
});

test("wired counts are partitioned, never double-counted across the two sets", () => {
  const bodies = [
    body("GOVERNING", { coverageStatus: "LIVE" }),
    body("GOVERNING", { coverageStatus: "KNOWN_UNCOVERED" }),
    body("COMMISSION", { coverageStatus: "MANUAL" }),
    body("COMMISSION", { coverageStatus: "KNOWN_UNCOVERED" }),
    body("ADVISORY", { coverageStatus: "KNOWN_UNCOVERED" }),
  ];
  const d = deriveWhoGoverns(bodies, new Set());
  assert.equal(d.governingCount, 2);
  assert.equal(d.governingWithSource, 1);
  assert.equal(d.others, 3);
  assert.equal(d.othersWithSource, 1);
  assert.ok(d.governingWithSource <= d.governingCount);
  assert.ok(d.othersWithSource <= d.others);
});
