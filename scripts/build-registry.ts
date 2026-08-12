/**
 * Generate the division and body registry from the committed boundary files.
 *
 *   pnpm registry:build
 *
 * Writes lib/registry/registry.json, committed the way the boundary files and
 * the ZCTA centroids are. Nothing here touches the network except the optional
 * canonical reconciliation pass.
 *
 * The registry is derived, never hand-written: the polygons say which divisions
 * exist, lib/registry/derive.ts says which bodies each division implies, and
 * every generated row is labelled as structural rather than sourced.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TIER_SEGMENTS, type Tier } from "../lib/ocd/tiers.ts";
import { bodiesFor, slotsFor, type SkipReason } from "../lib/registry/derive.ts";
import type {
  CanonicalMatch,
  Division,
  DivisionType,
  Registry,
} from "../lib/registry/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const GEO_DIR = join(here, "..", "public", "geo");
const OUT = join(here, "..", "lib", "registry", "registry.json");

const CANONICAL_URL =
  "https://raw.githubusercontent.com/opencivicdata/ocd-division-ids/master/identifiers/country-us.csv";

/** Which committed file feeds which division type. */
const SOURCES: { file: string; divisionType: DivisionType }[] = [
  { file: "county-us.geojson", divisionType: "county" },
  { file: "place-04.geojson", divisionType: "place" },
  { file: "place-33.geojson", divisionType: "place" },
  { file: "place-34.geojson", divisionType: "place" },
  { file: "cousub-04.geojson", divisionType: "place" },
  { file: "cousub-33.geojson", divisionType: "place" },
  { file: "cousub-34.geojson", divisionType: "place" },
  { file: "unsd-04.geojson", divisionType: "school_district" },
  { file: "unsd-33.geojson", divisionType: "school_district" },
  { file: "unsd-34.geojson", divisionType: "school_district" },
  { file: "elsd-04.geojson", divisionType: "school_district" },
  { file: "elsd-33.geojson", divisionType: "school_district" },
  { file: "elsd-34.geojson", divisionType: "school_district" },
  { file: "scsd-04.geojson", divisionType: "school_district" },
  { file: "scsd-33.geojson", divisionType: "school_district" },
  { file: "scsd-34.geojson", divisionType: "school_district" },
  { file: "sldu-04.geojson", divisionType: "sldu" },
  { file: "sldu-33.geojson", divisionType: "sldu" },
  { file: "sldu-34.geojson", divisionType: "sldu" },
  { file: "sldl-04.geojson", divisionType: "sldl" },
  { file: "sldl-33.geojson", divisionType: "sldl" },
  { file: "sldl-34.geojson", divisionType: "sldl" },
  { file: "cd119.geojson", divisionType: "cd" },
];

interface GeoFeature {
  properties: {
    ocdId: string;
    state: string;
    district: string;
    label: string;
    lsad?: string;
    funcstat?: string;
    classfp?: string;
  };
}

/** Tier from the deepest recognised segment, matching lib/ocd/tiers.ts. */
function tierOf(ocdId: string): Tier | null {
  const segments = ocdId.split("/").slice(1);
  for (let i = segments.length - 1; i >= 0; i--) {
    const key = segments[i].split(":")[0];
    for (const tier of ["local", "state", "national"] as Tier[]) {
      if (TIER_SEGMENTS[tier].includes(key)) return tier;
    }
  }
  return null;
}

/** The containing division: everything but the last segment. */
function parentOf(ocdId: string): string | null {
  const parts = ocdId.split("/");
  if (parts.length <= 2) return null;
  return parts.slice(0, -1).join("/");
}

async function loadDivisions(now: string): Promise<Division[]> {
  const byId = new Map<string, Division>();
  let dropped = 0;

  for (const { file, divisionType } of SOURCES) {
    let raw: string;
    try {
      raw = await readFile(join(GEO_DIR, file), "utf8");
    } catch {
      console.log(`  skip ${file} (absent)`);
      continue;
    }

    const collection = JSON.parse(raw) as { features: GeoFeature[] };
    for (const feature of collection.features) {
      const p = feature.properties;
      const tier = tierOf(p.ocdId);
      if (!tier) {
        // An unknown segment must not inherit a parent's tier — that is a
        // silent misfiling, and lib/ocd/tiers.ts refuses it for the same reason.
        dropped++;
        continue;
      }

      // A municipality present in both the place and county-subdivision files
      // is one government. First writer wins; they carry the same identifier.
      if (byId.has(p.ocdId)) continue;

      byId.set(p.ocdId, {
        ocdId: p.ocdId,
        divisionType,
        tier,
        state: p.state,
        label: p.label,
        parentOcdId: parentOf(p.ocdId),
        lsad: p.lsad ?? null,
        funcstat: p.funcstat ?? null,
        classfp: p.classfp ?? null,
        canonicalOcdId: null,
        canonicalMatch: "none",
        sourceDataset: "TIGER_GENZ2025",
        provenance: {
          sourceUrl: `https://www2.census.gov/geo/tiger/GENZ2025/shp/`,
          sourceOrg: "U.S. Census Bureau",
          collectedAt: now,
          verifiedAt: null,
        },
      });
    }
  }

  if (dropped > 0) console.log(`  dropped ${dropped} feature(s) with an unrecognised segment`);
  return [...byId.values()];
}

/**
 * Match each internal identifier to the canonical vocabulary.
 *
 * The internal key stays authoritative — adopting the canonical shape wholesale
 * would make Rockaway Township unrepresentable, since the canonical list
 * appears not to carry New Jersey's townships. This records how well the two
 * agree so a low-confidence match is a review item rather than a silent join.
 */
async function reconcile(divisions: Division[]): Promise<void> {
  let text: string;
  try {
    text = await (await fetch(CANONICAL_URL)).text();
  } catch {
    console.log("  canonical list unreachable — leaving every match as 'none'");
    return;
  }

  const canonical = new Set<string>();
  for (const line of text.split("\n")) {
    const id = line.split(",")[0]?.trim();
    if (id.startsWith("ocd-division/")) canonical.add(id);
  }
  console.log(`  canonical identifiers: ${canonical.size}`);

  // Index by the last segment so a differently-nested identifier can still be
  // found: canonical nests NJ places under county and AZ school districts under
  // county, where this repo does not.
  const byTail = new Map<string, string[]>();
  for (const id of canonical) {
    const tail = id.split("/").pop()!;
    const list = byTail.get(tail) ?? [];
    list.push(id);
    byTail.set(tail, list);
  }

  for (const division of divisions) {
    if (canonical.has(division.ocdId)) {
      division.canonicalOcdId = division.ocdId;
      division.canonicalMatch = "exact";
      continue;
    }

    const tail = division.ocdId.split("/").pop()!;
    const stateSegment = division.ocdId.split("/")[2];
    const candidates = (byTail.get(tail) ?? []).filter((id) =>
      id.includes(`/${stateSegment}/`),
    );

    if (candidates.length === 1) {
      // Same terminal segment, same state, different nesting. Confident.
      division.canonicalOcdId = candidates[0];
      division.canonicalMatch = "high";
    } else if (candidates.length > 1) {
      division.canonicalOcdId = candidates[0];
      division.canonicalMatch = "low";
    } else {
      division.canonicalOcdId = null;
      division.canonicalMatch = "none";
    }
  }
}

async function main() {
  const now = new Date().toISOString();

  console.log("divisions");
  const divisions = await loadDivisions(now);
  console.log(`  ${divisions.length} divisions`);

  console.log("reconciliation");
  if (!process.argv.includes("--offline")) await reconcile(divisions);

  console.log("bodies");
  const bodies = divisions.flatMap((d) => bodiesFor(d, now));

  // Report what the rule did, including what it deliberately refused to do.
  const perType = new Map<string, { divisions: number; bodies: number }>();
  const skips = new Map<SkipReason, number>();
  for (const division of divisions) {
    const entry = perType.get(division.divisionType) ?? { divisions: 0, bodies: 0 };
    entry.divisions++;
    const { slots, skipped } = slotsFor(division);
    entry.bodies += slots.length;
    if (skipped) skips.set(skipped, (skips.get(skipped) ?? 0) + 1);
    perType.set(division.divisionType, entry);
  }

  console.log("\n  division type      divisions   bodies");
  for (const [type, n] of [...perType.entries()].sort()) {
    console.log(`  ${type.padEnd(18)} ${String(n.divisions).padStart(8)} ${String(n.bodies).padStart(8)}`);
  }

  console.log("\n  skipped, and why");
  for (const [reason, n] of [...skips.entries()].sort()) {
    console.log(`  ${reason.padEnd(38)} ${String(n).padStart(5)}`);
  }

  const matches = new Map<CanonicalMatch, number>();
  for (const d of divisions) matches.set(d.canonicalMatch, (matches.get(d.canonicalMatch) ?? 0) + 1);
  console.log("\n  canonical match");
  for (const [m, n] of [...matches.entries()].sort()) {
    console.log(`  ${m.padEnd(10)} ${String(n).padStart(5)}`);
  }

  const registry: Registry = { generatedAt: now, divisions, bodies };
  await writeFile(OUT, JSON.stringify(registry, null, 1) + "\n", "utf8");
  console.log(`\nwrote ${OUT}`);
  console.log(`  ${divisions.length} divisions, ${bodies.length} bodies`);
}

void main();
