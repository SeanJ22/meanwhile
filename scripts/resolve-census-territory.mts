/**
 * Which of the 90,837 Census governments resolve to a zip (Prompt B items 5.3
 * to 5.6, 2026-08-20).
 *
 * `build-zip-governments.mts` answers the question in TIGER's vocabulary — a
 * county GEOID, a place GEOID, a school-district LEAID. This answers it in the
 * CENSUS OF GOVERNMENTS' vocabulary, which is the one every coverage
 * denominator in this product is stated against. The two are bridged per
 * government type, and each bridge is named because each one can fail
 * differently.
 *
 * THE BRIDGES
 *
 *   COUNTY            fips_state + fips_county          -> TIGER county GEOID
 *   MUNICIPAL         fips_state + fips_place           -> TIGER place GEOID
 *   TOWNSHIP          fips_state + fips_county + code   -> TIGER cousub GEOID,
 *                     falling back to the place GEOID, because in New England
 *                     a town is both an incorporated place and a county
 *                     subdivision and the Census file carries one code.
 *   SCHOOL DISTRICT   item 4's crosswalk -> nces_leaid  -> TIGER unsd/elsd/scsd
 *                     GEOID, which IS the LEAID. That is the whole reason the
 *                     crosswalk was built before this ran.
 *   SPECIAL DISTRICT  NO BRIDGE EXISTS. See below.
 *
 * SPECIAL DISTRICTS ARE THE CEILING (item 5.3). The Census counts 39,555 of
 * them — 43.5% of all governments in the country — and TIGER publishes
 * boundaries for none of them at any vintage. Not a subset: none. So the
 * geometric method that resolves every other type resolves ZERO special
 * districts, and that number caps Tier 1 nationally. It is a headline of this
 * session, not a footnote.
 *
 * A mailing-address zip is NOT territory and is never counted as resolution
 * here. 1,341 special districts carry a `fips_place` and many more carry a
 * `zip`, but a district's administrative office being in a zip says nothing
 * about which zips it governs — a county water authority head-quartered
 * downtown serves the county. Those are recorded as SEEDS for the hunt that
 * closes them, labelled as seeds, and counted separately from resolutions.
 *
 * Run:  corepack pnpm territory:resolve
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readTable } from "../lib/reference/index.ts";

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

/* ---- the school-district bridge, from item 4's crosswalk ------------------ */

const crosswalk = readFileSync(join(DERIVED, "census-nces-crosswalk.csv"), "utf8")
  .split("\n")
  .slice(1)
  .filter(Boolean);
const pid6ToLeaid = new Map<string, string>();
for (const line of crosswalk) {
  // The crosswalk writer quotes any field holding a comma; pid6 and leaid
  // never do, so reading the first and fourth unquoted fields is safe here
  // and is asserted by the count check below.
  const parts = line.split(",");
  if (parts.length < 4) continue;
  const pid6 = parts[0]!;
  // Find the LEAID: 7 digits, in the field after the census_kind marker.
  const kindAt = parts.findIndex((p) => p === "INDEPENDENT" || p === "DEPENDENT");
  const leaid = kindAt >= 0 ? parts[kindAt + 1] : undefined;
  if (pid6 && leaid && /^\d{7}$/.test(leaid)) pid6ToLeaid.set(pid6, leaid);
}
console.log(`school-district bridge: ${pid6ToLeaid.size} of 9,776 crosswalk rows parsed`);

/* ---- resolve every Census unit ------------------------------------------- */

const independent = readTable("census_govt_units_2022");
const dependent = readTable("census_govt_units_2022_dependent_school_systems");
// The registry includes dependent school systems. Omitting their Census table
// leaves those real governments permanently unplaceable despite an exact LEAID.
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
    const leaid = pid6ToLeaid.get(pid6);
    hit = leaid ? lookup(`unsd:${leaid}`, `elsd:${leaid}`, `scsd:${leaid}`) : null;
    method = !leaid
      ? "no NCES match in the crosswalk — UNRESOLVED, a work item"
      : hit
        ? `${hit.via} GEOID ${leaid} via the NCES crosswalk`
        : `crosswalk gave LEAID ${leaid} but TIGER publishes no boundary for it`;
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

// The runner's scope reference can be refreshed without rewriting the frozen
// reader territory artifact. Both outputs use this same Census/LEAID resolver.
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

const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
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
writeFileSync(join(DERIVED, "census-unit-zips.report.txt"), `${lines.join("\n")}\n`, "utf8");
say("");
say("WROTE data/derived/census-unit-zips.json");
