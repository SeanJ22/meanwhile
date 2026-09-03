import { geometryFiles } from "../lib/holdings/files.ts";
/**
 * **A ZIP IS AN AREA, AND THE BALLOT PAGE WAS READING IT AS A POINT**
 * (`NJ01`, NJ Hunt 2, 2026-08-22).
 *
 *   corepack pnpm zip:divisions
 *
 * ## The defect this exists to close
 *
 * `app/ballot/page.tsx` resolved a zip to its ZCTA centroid and asked which
 * divisions contain that ONE point. 07866's centroid falls inside Rockaway
 * Township. Rockaway BOROUGH is a separate municipality — separate council,
 * separate school district, separate ballot — whose territory is also inside
 * the 07866 ZCTA, and whose residents give 07866 as their address.
 *
 * So a Rockaway Borough resident entering their own zip saw the Township's
 * government, none of their own, and a four-candidate Borough council contest
 * that did not render at all.
 *
 * `CLAUDE.md` already says the thing this fixes: **a ZCTA crosses city, county,
 * school district and legislative boundaries, so a zip can never resolve a
 * ballot.** Resolving one point and rendering the result as the zip's ballot
 * treats a ZCTA as if it did.
 *
 * ## What this produces, and what it deliberately does not
 *
 * Every division whose territory overlaps the ZCTA's AREA, from
 * `data/derived/zip-governments.json` — which is built by sampling each ZCTA on
 * a lattice and testing every sample against the committed TIGER polygons. That
 * file is 30 MB and cannot be traced into a route; this is its per-zip index,
 * carrying OCD ids instead of GEOIDs and nothing else.
 *
 * **It is not a claim that a reader at this zip votes in all of these.** It is a
 * claim that these governments' territory reaches inside this zip, which is why
 * every contest it surfaces renders with the jurisdiction it belongs to printed
 * beside it. The reader decides which is theirs; the product's job is to stop
 * hiding one of them.
 *
 * ## Scope is OURS
 *
 * Written for the zips in the states this repo has committed geometry for. A
 * zip outside them is simply absent from the file, and the consumer falls back
 * to the centroid answer — which is what it did for every zip before today, so
 * nothing regresses and no absence here is a claim about a place.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { COVERED_FIPS } from "../lib/coverage/artifacts.ts";
import { resolveZipGeography } from "../lib/geo/zip-geography.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();

/* GEOID → OCD id, read off the committed layers themselves. A hand-kept second
 * copy of this mapping is a copy that goes wrong; the layers already carry it. */
/*
 * ── THE KEY IS (LAYER, GEOID), AND GEOID ALONE COLLIDES ──────────────────
 *
 * A county GEOID is state + county — Morris County is `34027`. A state upper
 * legislative district GEOID is state + district — New Jersey's District 27 is
 * ALSO `34027`. Keyed on GEOID alone, whichever file was read second won, and
 * 07866's index came out carrying `sldu:27` and NO Morris County at all.
 *
 * That is the same collapsed join as everywhere else in this session, and the
 * same rule applies: distinct keys must produce distinct results, and it is
 * ASSERTED rather than assumed. The edge list already carries its layer, so the
 * discriminator was there all along.
 */
const LAYER_OF_FILE: Record<string, string> = {
  "county-us": "county",
  place: "place",
  cousub: "cousub",
  unsd: "unsd",
  elsd: "elsd",
  scsd: "scsd",
};
const ocdByLayerGeoid = new Map<string, string>();
let features = 0;
for (const file of geometryFiles(ROOT)) {
  const name = basename(file);
  if (!name.endsWith(".geojson") || name === "state-outlines.geojson") continue;
  const stem = name.replace(/\.geojson$/, "");
  const layer = LAYER_OF_FILE[stem] ?? LAYER_OF_FILE[stem.replace(/-\d{2}$/, "")];
  // Layers the ZCTA edge list does not use — legislative and congressional
  // districts — are skipped rather than folded in under a guessed layer name.
  if (!layer) continue;
  const parsed = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as {
    features?: { properties: Record<string, string> }[];
  };
  for (const f of parsed.features ?? []) {
    const geoid = String(f.properties.geoid ?? "");
    const ocdId = String(f.properties.ocdId ?? "");
    if (!geoid || !ocdId) continue;
    const key = `${layer}:${geoid}`;
    const existing = ocdByLayerGeoid.get(key);
    if (existing && existing !== ocdId) {
      throw new Error(
        `${key} maps to two different OCD ids (${existing} and ${ocdId}). A key that resolves to two ` +
          "governments is a collapsed join, never a coverage result.",
      );
    }
    ocdByLayerGeoid.set(key, ocdId);
    features++;
  }
}
console.log(`(layer, geoid) → ocdId, read off ${features} committed features across ${ocdByLayerGeoid.size} keys`);

const zipGov = JSON.parse(
  readFileSync(join(ROOT, "data", "derived", "zip-governments.json"), "utf8"),
) as { zips: Record<string, { layer: string; id: string; name: string; samples: number }[]> };

const out: Record<string, string[]> = {};
/*
 * ── RULING 71: WHICH OF THESE CERTAINLY GOVERN THE READER ────────────────
 *
 * The union above is every government whose territory REACHES INSIDE the zip.
 * It is not a claim that a reader at this zip votes in all of them, and it
 * never was — but the page rendered them all identically, so a reader had no
 * way to tell "this is your county, definitely" from "this may or may not be
 * your municipality, depending on which side of a street you live on".
 *
 * The distinction is already measured and nobody was reading it. Each edge
 * carries the number of LATTICE SAMPLE POINTS of the ZCTA that fell inside that
 * government. So:
 *
 *   samples === the zip's total  →  the government's territory covers the whole
 *                                   zip. Everyone here is governed by it.
 *   samples <  the zip's total   →  it covers part. Whether it governs THIS
 *                                   reader is a fact about their street.
 *
 * At 07866 that separates cleanly and correctly: Morris County 64 of 64 and
 * Morris Hills Regional School District 64 of 64 — no pill; Rockaway Township
 * 55, Rockaway Borough 6, Denville Township 3, and their three local school
 * districts on the same numbers — pill. Which is exactly what RULING 71 says
 * should happen, arrived at from the geometry rather than from a hand-list.
 *
 * **THE ZIP TOTAL IS THE SUM OF ITS COUNTY EDGES**, and that is a derivation
 * rather than an assumption: counties (and county-equivalents) tile the United
 * States with no gaps and no overlaps, so every sampled point of a ZCTA falls
 * in exactly one of them. Checked across all 33,791 zips in the national file
 * before it was relied on — every zip has at least one county edge, and no
 * edge anywhere exceeds its zip's county sum.
 *
 * **The lattice is 0.01° and this is stated as a measurement, not a proof.** A
 * government covering every sampled point could still miss a sliver finer than
 * the lattice. The error runs one way — toward calling something certain that
 * is very nearly certain — and the honest description of the output is "covers
 * every sampled point of this ZCTA", which is what the consumer says.
 */
const partial: Record<string, string[]> = {};
const zipSamples: Record<string, number> = {};
let considered = 0;
let unmapped = 0;
let noCountyEdge = 0;
const unmappedLayers = new Map<string, number>();

for (const [zip, edges] of Object.entries(zipGov.zips)) {
  const geo = resolveZipGeography(zip);
  if (!geo.ok) continue;
  if (!COVERED_FIPS.includes(geo.stateFips)) continue;
  considered++;

  const totalSamples = edges
    .filter((e) => e.layer === "county")
    .reduce((n, e) => n + e.samples, 0);

  const ids = new Set<string>();
  const partialIds = new Set<string>();
  for (const e of edges) {
    const ocdId = ocdByLayerGeoid.get(`${e.layer}:${e.id}`);
    if (!ocdId) {
      unmapped++;
      unmappedLayers.set(e.layer, (unmappedLayers.get(e.layer) ?? 0) + 1);
      continue;
    }
    ids.add(ocdId);
    /*
     * A zip with no county edge cannot have its total established, so NOTHING
     * is called certain there — every division is marked partial. Guessing the
     * other way would print "this definitely governs you" on the strength of a
     * number that was never measured, which is the render-default rule failing
     * in the direction that makes a claim.
     */
    if (totalSamples === 0 || e.samples < totalSamples) partialIds.add(ocdId);
  }
  if (totalSamples === 0) noCountyEdge++;
  if (ids.size > 0) {
    out[zip] = [...ids].sort();
    zipSamples[zip] = totalSamples;
    if (partialIds.size > 0) partial[zip] = [...partialIds].sort();
  }
}

if (considered === 0) {
  throw new Error(
    "no zip in zip-governments.json resolved to a covered state. That is a failed read of the file or a " +
      "broken geography resolver, not a country with no zips.",
  );
}

const payload = {
  generatedAt: today(),
  source: "data/derived/zip-governments.json, joined to canonical state and national geometry by GEOID",
  sourceOrg: "U.S. Census Bureau (TIGER) via this repo's own lattice sampling",
  scope:
    `zips whose ZCTA sits in state FIPS ${COVERED_FIPS.join(", ")} — the states this repo has committed ` +
    "geometry for. A zip absent from this file is outside OUR committed geometry and the consumer falls " +
    "back to the centroid answer; absence here is never a claim about a place.",
  note:
    "Every division whose TERRITORY overlaps the zip's area. NOT a claim that a reader at this zip votes " +
    "in all of them — a ZCTA crosses jurisdiction lines, which is why anything surfaced from this renders " +
    "with the jurisdiction it belongs to printed beside it.",
  /**
   * RULING 71. The subset of `zips[zip]` whose territory covers only PART of
   * the zip — so whether it governs a given reader depends on their street.
   * An id in `zips` and absent from `partial` covers every sampled point.
   */
  partialNote:
    "Divisions covering only PART of this zip's area, measured on a 0.01-degree lattice. An id present in " +
    "`zips` and absent here covers every sampled point of the ZCTA. The zip total is the sum of its " +
    "county-layer samples: counties tile the country with no gaps or overlaps, checked across all 33,791 " +
    "zips in the national source before being relied on. A zip with no county edge has every division " +
    "marked partial rather than any called certain.",
  counts: {
    zips: Object.keys(out).length,
    considered,
    edgesWithNoOcdId: unmapped,
    zipsWithAPartialDivision: Object.keys(partial).length,
    zipsWithNoCountyEdge: noCountyEdge,
  },
  zipSamples,
  partial,
  zips: out,
};

const dest = join(ROOT, "data", "derived", "zip-division-ids.json");
writeFileSync(dest, `${JSON.stringify(payload, null, 0)}\n`, "utf8");

console.log(`zips considered (covered states): ${considered}`);
console.log(`zips written with at least one division: ${Object.keys(out).length}`);
console.log(
  `edges with no OCD id in the committed layers: ${unmapped}` +
    (unmapped > 0
      ? `  — by layer: ${[...unmappedLayers].map(([l, n]) => `${l} ${n}`).join(", ")}. ` +
        "These are governments the lattice reached whose polygon this repo has not committed; stated rather " +
        "than dropped silently."
      : ""),
);
console.log(`written ${dest}`);
