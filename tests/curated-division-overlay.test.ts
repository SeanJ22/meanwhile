import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { CURATED_DIVISIONS, RETIRED_CURATED_ROWS } from "../lib/registry/curated-divisions.ts";
import registry from "../lib/registry/registry.json" with { type: "json" };

/**
 * **THE CURATED DIVISION OVERLAY, AND THE TWO THINGS IT MUST NEVER BECOME.**
 * (NH Hunt 5, 2026-08-21; RULING 57.)
 *
 * `lib/registry/curated-divisions.ts` exists because the committed TIGER
 * geometry is clipped to one county per state, and six whole New Hampshire
 * towns inside 03255's first-rung circle therefore had no division here — so
 * every board this session enumerated for them was refused by the registry
 * build. RULING 57 says a body is NAMED FIRST and hunted second; a body that
 * cannot be named because a map file was clipped is the opposite of that.
 *
 * A hand-maintained list of governments is a useful tool and a dangerous one,
 * and the danger is not hypothetical — this repo's whole discipline is built
 * around the fact that a plausible entry is indistinguishable from a real one
 * once it is in a file. Two failure modes, both held shut here:
 *
 * 1. **AN INVENTED JURISDICTION.** Every row must be a government an OUTSIDE
 *    enumeration already lists, because coverage claims are made against the
 *    official universe and never against our own records. A registry that can
 *    add its own governments can also add its own denominator.
 * 2. **SHADOWING A REAL DIVISION.** A curated row whose identifier the
 *    geometry already carries would replace a division that HAS a polygon
 *    with one that does not, taking a shape off the map and saying nothing.
 *    `scripts/build-registry.ts` throws on this; here it is asserted against
 *    the built artifact, so the two cannot drift.
 */

const DIVISIONS = registry.divisions as {
  ocdId: string;
  geoid: string | null;
  divisionType: string;
  sourceDataset: string;
  canonicalGap?: string;
  canonicalMatch: string;
  provenance?: { sourceOrg?: string };
}[];

const REFERENCE = {
  cog: readFileSync("data/reference/census_govt_units_2022.csv", "utf8"),
  nces: readFileSync("data/reference/nces_ccd_lea_directory_2025_26.csv", "utf8"),
};

test("every curated division is enumerated by an OUTSIDE authority", () => {
  // The GEOID is the check, not the name. A name can be typed; a GEOID either
  // appears in the committed federal reference file or it does not.
  const unverified: string[] = [];
  for (const d of CURATED_DIVISIONS) {
    assert.ok(d.geoid, `${d.ocdId} carries no GEOID and cannot be verified`);
    if (d.divisionType === "school_district") {
      // NCES LEA id, first column of its own row.
      if (!new RegExp(`^${d.geoid},`, "m").test(REFERENCE.nces)) {
        unverified.push(`${d.ocdId} (NCES LEA ${d.geoid})`);
      }
      continue;
    }
    if (d.divisionType === "county") {
      // A county GEOID is state+county; the reference carries the two parts.
      const [state, county] = [d.geoid.slice(0, 2), d.geoid.slice(2)];
      if (!new RegExp(`,${state},${county},`, "m").test(REFERENCE.cog)) {
        unverified.push(`${d.ocdId} (county FIPS ${d.geoid})`);
      }
      continue;
    }
    // A county-subdivision GEOID is state(2) + county(3) + cousub(5), and the
    // Census file carries those as three separate columns.
    const [state, county, place] = [
      d.geoid.slice(0, 2),
      d.geoid.slice(2, 5),
      d.geoid.slice(5),
    ];
    if (!new RegExp(`,${state},${county},${place},`, "m").test(REFERENCE.cog)) {
      unverified.push(`${d.ocdId} (${state}/${county}/${place})`);
    }
  }
  assert.deepEqual(
    unverified,
    [],
    "a curated division must be a government the Census of Governments or " +
      "NCES already enumerates. These are not in the committed reference " +
      "files, which means either the GEOID is wrong or the government is " +
      "invented — and this file may never be the place a jurisdiction is " +
      "invented.",
  );
});

test("no curated division shadows one the geometry already carries", () => {
  const fromGeometry = new Set(
    DIVISIONS.filter((d) => d.sourceDataset === "TIGER_GENZ2025").map(
      (d) => d.ocdId,
    ),
  );
  const shadows = CURATED_DIVISIONS.filter((d) => fromGeometry.has(d.ocdId));
  assert.deepEqual(
    shadows.map((d) => d.ocdId),
    [],
    "these divisions have polygons in public/geo and must come from there — " +
      "a curated stand-in would take their shape off the map silently",
  );
});

test("every curated division reaches the built registry", () => {
  const built = new Set(DIVISIONS.map((d) => d.ocdId));
  const missing = CURATED_DIVISIONS.filter((d) => !built.has(d.ocdId));
  assert.deepEqual(
    missing.map((d) => d.ocdId),
    [],
    "a curated division that never lands is a hunt nobody can see the result of",
  );
  /*
   * **THE ZERO-ROW CHECK MOVED, AND IT DID NOT WEAKEN.** (RULING 80, NJ Hunt 4
   * item 4, 2026-08-22.)
   *
   * It used to be `CURATED_DIVISIONS.length > 0` — a list that silently emptied
   * would otherwise pass every assertion above by having nothing to assert
   * about. That was right for as long as the overlay was carrying thirteen New
   * Hampshire governments the one-county clip could not draw.
   *
   * RULING 80 widened the clip and all thirteen now have real TIGER geometry.
   * `scripts/build-registry.ts` refuses a curated row that shadows a polygon,
   * correctly, so the overlay HAD to empty — an empty overlay is now the
   * correct state and the old assertion would have failed forever.
   *
   * The check that replaces it is stronger, not weaker: the thirteen retired
   * rows are still in the file, and every one of them must be IN THE GEOMETRY.
   * A clip that narrows again — a vintage change, a build-size decision — puts
   * thirteen real governments back out of reach, and it fails here rather than
   * being noticed by a reader at 03255.
   */
  const geometryIds = new Set(DIVISIONS.map((d) => d.ocdId));
  assert.ok(
    RETIRED_CURATED_ROWS.length > 0,
    "the retired list is empty — the record of what the narrow clip could not draw is gone",
  );
  const backOutOfReach = RETIRED_CURATED_ROWS.filter((r) => !geometryIds.has(r.ocdId));
  assert.deepEqual(
    backOutOfReach.map((r) => r.ocdId),
    [],
    "these governments were retired from the curated overlay because the widened clip " +
      "draws them, and the registry no longer carries them — the clip has narrowed and " +
      "thirteen real governments are unreachable again",
  );
});

test("every curated division says why it has no geometry", () => {
  for (const d of CURATED_DIVISIONS) {
    assert.match(
      d.provenance?.sourceOrg ?? "",
      /no committed geometry:/,
      `${d.ocdId} does not state why it has no polygon. The map cannot draw ` +
        "it, and a shortfall the map cannot explain is one nobody can audit " +
        "— tests/municipal-layer.test.ts reconciles against exactly this string.",
    );
  }
});

test("no curated division is left with an UNDETERMINED canonical gap", () => {
  // The same standard every derived division is held to. A gap nobody worked
  // out is what this whole registry's reconciliation exists to eliminate, and
  // an overlay that got a pass on it would be a hole in that guarantee.
  const built = new Map(DIVISIONS.map((d) => [d.ocdId, d]));
  const undetermined = CURATED_DIVISIONS.map((c) => built.get(c.ocdId))
    .filter((d) => d && d.canonicalMatch === "none" && d.canonicalGap === "UNDETERMINED")
    .map((d) => d!.ocdId);
  assert.deepEqual(undetermined, []);
});
