/**
 * Which Census of Governments units resolve to a zip, bridged per government
 * type to the TIGER layers `build-zip-governments.mts` joins:
 *
 *   COUNTY            fips_state + fips_county          -> TIGER county GEOID
 *   MUNICIPAL         fips_state + fips_place           -> TIGER place GEOID
 *   TOWNSHIP          fips_state + fips_county + code   -> TIGER cousub GEOID,
 *                     falling back to the place GEOID (a New England town is both)
 *   SCHOOL DISTRICT   the Census–NCES crosswalk -> nces_leaid -> TIGER unsd/elsd/scsd GEOID
 *   SPECIAL DISTRICT  no bridge: TIGER publishes no special-district boundary.
 *
 * A mailing-address zip is never territory; those are recorded as seeds and
 * counted separately from resolutions.
 *
 * Run:  corepack pnpm territory:resolve
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readTable } from "../lib/reference/index.ts";
import { censusSchoolLeaIds, censusSchoolTerritory } from "../lib/geo/census-school-territory.ts";

const DERIVED = join(process.cwd(), "data", "derived");

type Edge = { layer: string; id: string; name: string; samples: number };
type ZipGov = {
  generatedAt: string;
  method: Record<string, unknown>;
  totals: Record<string, number>;
  zips: Record<string, Edge[]>;
};

const zipGov = JSON.parse(readFileSync(join(DERIVED, "zip-governments.json"), "utf8")) as ZipGov;

/** GEOID -> the zips it touches. The reverse of the join's own output. */
const geoidToZips = new Map<string, string[]>();
for (const [zip, edges] of Object.entries(zipGov.zips)) {
  for (const e of edges) {
    const k = `${e.layer}:${e.id}`;
    const b = geoidToZips.get(k);
    if (b) b.push(zip);
    else geoidToZips.set(k, [zip]);
  }
}

/* ---- the school-district bridge, from the Census–NCES crosswalk ---------- */

const pid6ToLeaid = censusSchoolLeaIds(readFileSync(join(DERIVED, "census-nces-crosswalk.csv"), "utf8"));
console.log(`school-district bridge: ${pid6ToLeaid.size} of 9,776 crosswalk rows parsed`);

/* ---- resolve every Census unit ------------------------------------------- */

const independent = readTable("census_govt_units_2022");
const dependent = readTable("census_govt_units_2022_dependent_school_systems");
// Dependent school systems are included; without their table they stay unplaceable despite an exact LEAID.
const units = { ...independent, rows: [...independent.rows, ...dependent.rows.map(row =>
  independent.header.map(column => row[dependent.header.indexOf(column)] ?? ""))] };
const col = (c: string) => units.header.indexOf(c);
const [PID6, NAME, TYPE, FIPS_ST, FIPS_CTY, FIPS_PL, STATE, ZIPCOL] = [
  "census_id_pid6",
  "unit_name",
  "gov_type",
  "fips_state",
  "fips_county",
  "fips_place",
  "state",
  "zip",
].map(col);

type Resolution = {
  pid6: string;
  name: string;
  type: string;
  state: string;
  zips: string[];
  /** How the bridge was made, or why it could not be. */
  method: string;
};

const resolutions: Resolution[] = [];

function lookup(...keys: string[]): { zips: string[]; via: string } | null {
  for (const k of keys) {
    const zips = geoidToZips.get(k);
    if (zips?.length) return { zips, via: k.split(":")[0]! };
  }
  return null;
}

for (const r of units.rows) {
  const type = r[TYPE] ?? "";
  const st = r[FIPS_ST] ?? "";
  const cty = r[FIPS_CTY] ?? "";
  const pl = r[FIPS_PL] ?? "";
  const pid6 = r[PID6] ?? "";

  let hit: { zips: string[]; via: string } | null = null;
  let method = "";

  if (type === "COUNTY") {
    hit = st && cty ? lookup(`county:${st}${cty}`) : null;
    method = hit ? `county GEOID ${st}${cty}` : "county GEOID not found in TIGER";
  } else if (type === "MUNICIPAL") {
    hit = st && pl ? lookup(`place:${st}${pl}`) : null;
    method = hit ? `place GEOID ${st}${pl}` : "place GEOID not found in TIGER";
  } else if (type === "TOWNSHIP") {
    hit =
      st && cty && pl
        ? lookup(`cousub:${st}${cty}${pl}`, `place:${st}${pl}`)
        : st && pl
          ? lookup(`place:${st}${pl}`)
          : null;
    method = hit
      ? `${hit.via} GEOID`
      : "neither a cousub nor a place GEOID matched in TIGER";
  } else if (type === "SCHOOL DISTRICT" || type === "DEPENDENT SCHOOL SYSTEM") {
    const school = censusSchoolTerritory(pid6ToLeaid.get(pid6), geoidToZips);
    hit = school.zips.length ? { zips: [...school.zips], via: "school" } : null;
    method = school.method;
  } else if (type === "SPECIAL DISTRICT") {
    // Never a lookup. There is no layer to look in.
    method = "TIGER publishes NO special-district boundaries at any vintage";
  } else {
    method = `unrecognized gov_type "${type}"`;
  }

  resolutions.push({
    pid6,
    name: r[NAME] ?? "",
    type,
    state: r[STATE] ?? "",
    zips: hit?.zips ?? [],
    method,
  });
}

// `--dependent-only` refreshes the runner's scope reference without rewriting census-unit-zips.json.
if (process.argv.includes("--dependent-only")) {
  const path = join(process.cwd(), "lib/control-plane/expansion/reference/census-dependent-school-territories.json");
  writeFileSync(path, JSON.stringify({
    source: "census_govt_units_2022_dependent_school_systems + census-nces-crosswalk + zip-governments",
    units: resolutions.filter(unit => unit.type === "DEPENDENT SCHOOL SYSTEM"),
  }, null, 2) + "\n");
  console.log(`WROTE ${path}`);
  process.exit(0);
}

/* ---- report -------------------------------------------------------------- */

const say = (s = "") => {
  console.log(s);
};

const byType = new Map<string, { total: number; resolved: number }>();
for (const r of resolutions) {
  const e = byType.get(r.type) ?? { total: 0, resolved: 0 };
  e.total += 1;
  if (r.zips.length) e.resolved += 1;
  byType.set(r.type, e);
}

const totalResolved = resolutions.filter((r) => r.zips.length).length;
const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(2)}%`;

say("");
say("CENSUS UNITS RESOLVED TO AT LEAST ONE ZIP");
say("");
say("type                  resolved /   total     %");
for (const type of [
  "COUNTY",
  "MUNICIPAL",
  "TOWNSHIP",
  "SCHOOL DISTRICT",
  "DEPENDENT SCHOOL SYSTEM",
  "SPECIAL DISTRICT",
]) {
  const e = byType.get(type)!;
  say(
    `${type.padEnd(20)} ${String(e.resolved).padStart(7)} / ${String(e.total).padStart(7)}  ${pct(e.resolved, e.total).padStart(7)}`,
  );
}
say(
  `${"ALL".padEnd(20)} ${String(totalResolved).padStart(7)} / ${String(resolutions.length).padStart(7)}  ${pct(totalResolved, resolutions.length).padStart(7)}`,
);

const special = byType.get("SPECIAL DISTRICT")!;
say("");
say("*** THE CEILING (item 5.3) ***");
say(
  `SPECIAL DISTRICTS UNRESOLVED: ${special.total - special.resolved} of ${special.total} ` +
    `(${pct(special.total - special.resolved, special.total)})`,
);
say(
  "TIGER publishes boundaries for NONE of them at any vintage. This is not a",
);
say("gap in our retrieval; it is a gap in what the Census publishes as geometry.");
say(`They are ${pct(special.total, resolutions.length)} of every government in the country,`);
say("and this number caps Tier 1 nationally.");
say("");
say("NEXT RUNGS FOR RESOLVING THEM, named and not walked in this session:");
say("  1. County assessor / auditor special-district tax-levy layers, which");
say("     carry district boundaries because they have to bill them.");
say("  2. State special-district registries — many states require a district to");
say("     file its boundary with the secretary of state or a local-government");
say("     commission.");
say("  3. Per-state GIS open-data portals, which publish fire, water and library");
say("     district layers county by county.");
say("  4. The district's own published service-area map, per district.");

/* Seeds, labelled as seeds and never as resolutions. */
const specialRows = units.rows.filter((r) => r[TYPE] === "SPECIAL DISTRICT");
const withPlace = specialRows.filter((r) => (r[FIPS_PL] ?? "").trim() !== "").length;
const withZip = specialRows.filter((r) => (r[ZIPCOL] ?? "").trim() !== "").length;
const withCounty = specialRows.filter((r) => (r[FIPS_CTY] ?? "").trim() !== "").length;
say("");
say("SEEDS FOR THAT HUNT — administrative facts, NEVER territory:");
say(`  special districts carrying a county FIPS:   ${withCounty} of ${special.total}`);
say(`  carrying a mailing-address zip:             ${withZip} of ${special.total}`);
say(`  carrying a place FIPS:                      ${withPlace} of ${special.total}`);
say(
  "  A district office's zip is where its desk is, not where its authority runs.",
);
say("  A county water authority head-quartered downtown serves the county.");

/* Unresolved counts for the non-special types, so none of it hides. */
say("");
say("UNRESOLVED BY TYPE, AND WHY:");
const reasons = new Map<string, number>();
for (const r of resolutions) {
  if (r.zips.length) continue;
  if (r.type === "SPECIAL DISTRICT") continue;
  const k = `${r.type}: ${r.method}`;
  reasons.set(k, (reasons.get(k) ?? 0) + 1);
}
for (const [reason, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  say(`  ${String(n).padStart(5)}  ${reason}`);
}

writeFileSync(
  join(DERIVED, "census-unit-zips.json"),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "data/derived/zip-governments.json + data/reference/census_govt_units_2022.csv + data/reference/census_govt_units_2022_dependent_school_systems.csv",
    totals: {
      units: resolutions.length,
      resolvedToAtLeastOneZip: totalResolved,
      byType: Object.fromEntries([...byType.entries()].map(([k, v]) => [k, v])),
    },
    units: resolutions,
  })}\n`,
  "utf8",
);
say("");
say("WROTE data/derived/census-unit-zips.json");
