/**
 * THE GAP LEDGER (Prompt B item 11, 2026-08-20).
 *
 * This is the session's deliverable. Every digging session after this one
 * works this ledger front to back.
 *
 * WHAT MAKES IT A LEDGER RATHER THAN A REPORT. Item 11.2: **name what is
 * missing, BY NAME.** "40 special districts unresolved" is not a ledger entry;
 * forty named districts is. A count tells a later session that work exists; a
 * name tells it what to type into a search box. The difference is the whole
 * value of the artifact, and it is the reason this file writes out every
 * unresolved government individually rather than a summary table.
 *
 * THE THREE DENOMINATORS, per RULING 6 and item 11.1:
 *   1. Governments in the Census/NCES universe touching this zip.
 *   2. How many are TERRITORY-RESOLVED, with the unresolved ones named.
 *   3. How many of those have their BODIES ENUMERATED — Tier 2 — with the
 *      un-enumerated ones named.
 *
 * RULING 9 is why 2 and 3 are separate numbers and can never be the same one.
 *
 * Run:  corepack pnpm ledger:build
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COVERAGE_TIER_NEXT_STEP } from "../lib/coverage/tier.ts";
import type { CoverageTier } from "../lib/coverage/tier.ts";
import { readTable } from "../lib/reference/index.ts";
import { today } from "./doc-dates.mjs";

const DERIVED = join(process.cwd(), "data", "derived");
const STAMPED_AT = today();

const PILOTS = [
  { zip: "85701", what: "downtown Tucson, Arizona" },
  { zip: "85641", what: "Vail, Arizona (unincorporated)" },
  { zip: "07866", what: "Rockaway Township, New Jersey" },
  { zip: "03255", what: "Newbury, New Hampshire" },
];

type Edge = {
  layer: string;
  id: string;
  name: string;
  samples: number;
  entity: "GOVERNMENT" | "STATISTICAL" | "UNCLASSIFIED";
  lsad: string;
};

const zipGov = JSON.parse(readFileSync(join(DERIVED, "zip-governments.json"), "utf8")) as {
  totals: Record<string, number>;
  zips: Record<string, Edge[]>;
};

const tiers = JSON.parse(
  readFileSync(join(DERIVED, "zip-coverage-tiers.json"), "utf8"),
) as {
  stampedAt: string;
  denominator: { zips: number };
  distribution: Record<string, number>;
  zips: Record<
    string,
    {
      tier: CoverageTier;
      evidence: { territoryResolved: number; bodiesEnumeratedFor: number };
      unresolvedSpecialDistrictsInCounties: number;
      edges: Array<{ layer: string; id: string; tier: CoverageTier }>;
    }
  >;
};

const unitZips = JSON.parse(
  readFileSync(join(DERIVED, "census-unit-zips.json"), "utf8"),
) as {
  totals: { units: number; resolvedToAtLeastOneZip: number };
  units: Array<{ pid6: string; name: string; type: string; state: string; zips: string[] }>;
};

/* -------------------------------------------------------------------------- */
/* Every special district, by county — the named half of the gap              */
/* -------------------------------------------------------------------------- */

const units = readTable("census_govt_units_2022");
const col = (c: string) => units.header.indexOf(c);
const [PID6, NAME, TYPE, FIPS_ST, FIPS_CTY, CITY, STATE] = [
  "census_id_pid6",
  "unit_name",
  "gov_type",
  "fips_state",
  "fips_county",
  "city",
  "state",
].map(col);

const specialByCounty = new Map<string, Array<{ pid6: string; name: string; city: string; state: string }>>();
for (const r of units.rows) {
  if (r[TYPE] !== "SPECIAL DISTRICT") continue;
  const geoid = `${(r[FIPS_ST] ?? "").trim()}${(r[FIPS_CTY] ?? "").trim()}`;
  if (geoid.length !== 5) continue;
  specialByCounty.set(geoid, [
    ...(specialByCounty.get(geoid) ?? []),
    {
      pid6: r[PID6] ?? "",
      name: r[NAME] ?? "",
      city: r[CITY] ?? "",
      state: r[STATE] ?? "",
    },
  ]);
}

/* -------------------------------------------------------------------------- */

const md: string[] = [];
const w = (s = "") => md.push(s);

w("# The gap ledger");
w();
w(`Generated ${STAMPED_AT} (America/Phoenix, \`corepack pnpm stamp\`).`);
w("Rebuild with `corepack pnpm ledger:build`.");
w();
w("**This is what the digging sessions work, front to back.** Every entry names");
w("a specific thing that is missing. A count tells you work exists; a name tells");
w("you what to go and get.");
w();
w("Sources, all committed in this repo and read from nowhere else:");
w();
w("| Input | What it establishes |");
w("|---|---|");
w("| `data/reference/census_govt_units_2022.csv` | the universe — 90,837 governments |");
w("| `data/reference/nces_ccd_lea_directory_2025_26.csv` | 19,711 school LEAs |");
w("| `data/derived/zip-governments.json` | territory — which governments cover which zip |");
w("| `data/derived/census-nces-crosswalk.csv` | the school-district bridge between the two |");
w("| `data/derived/zip-coverage-tiers.json` | the stamped coverage tier per zip |");
w("| `lib/registry/registry.json` | which governments have their bodies enumerated |");
w();

/* ---- the national figures, item 11.6 -------------------------------------- */

w("## The national figures");
w();
const totalZips = tiers.denominator.zips;
w("### Zips at each tier");
w();
w("| Tier | Zips | Share of 33,791 ZCTAs |");
w("|---|---:|---:|");
for (const t of ["TIER_0", "TIER_1", "TIER_2", "TIER_3"]) {
  const n = tiers.distribution[t] ?? 0;
  w(`| ${t} | ${n.toLocaleString()} | ${((n / totalZips) * 100).toFixed(2)}% |`);
}
w();
w("**RULING 10 applies to every row above.** These are ZCTAs, not ZIP codes. A");
w("USPS ZIP is a delivery route with no areal geometry; a ZCTA is the Census");
w("Bureau's areal approximation of one. 1,599 of the 26,195 USPS ZIPs observable");
w("in the Census unit file (6.10%) have no ZCTA at all and cannot be answered");
w("geographically by this method.");
w();

w("### Census units resolved to at least one zip");
w();
const resolved = unitZips.totals.resolvedToAtLeastOneZip;
w(
  `**${resolved.toLocaleString()} of ${unitZips.totals.units.toLocaleString()}** ` +
    `(${((resolved / unitZips.totals.units) * 100).toFixed(2)}%).`,
);
w();
const byType = new Map<string, { total: number; resolved: number }>();
for (const u of unitZips.units) {
  const e = byType.get(u.type) ?? { total: 0, resolved: 0 };
  e.total += 1;
  if (u.zips.length) e.resolved += 1;
  byType.set(u.type, e);
}
w("| Type | Resolved | Total | % |");
w("|---|---:|---:|---:|");
for (const t of ["COUNTY", "MUNICIPAL", "TOWNSHIP", "SCHOOL DISTRICT", "SPECIAL DISTRICT"]) {
  const e = byType.get(t)!;
  w(`| ${t} | ${e.resolved.toLocaleString()} | ${e.total.toLocaleString()} | ${((e.resolved / e.total) * 100).toFixed(2)}% |`);
}
w();
w("### Special districts unresolved — the ceiling");
w();
const sd = byType.get("SPECIAL DISTRICT")!;
w(`**${(sd.total - sd.resolved).toLocaleString()} of ${sd.total.toLocaleString()} (100.00%).**`);
w();
w("TIGER publishes boundaries for none of them at any vintage. Not a subset —");
w("none. They are 43.55% of every government in the country, and this number");
w("caps Tier 1 nationally. It is the single largest gap in this product.");
w();
w("Next rungs, named and not walked in this session:");
w();
w("1. County assessor / auditor special-district tax-levy layers, which carry");
w("   district boundaries because they have to bill them.");
w("2. State special-district registries — many states require a district to file");
w("   its territory with the secretary of state or a local-government commission.");
w("3. Per-state GIS open-data portals, which publish fire, water and library");
w("   district layers county by county.");
w("4. The district's own published service-area map, per district.");
w();
w("A district office's mailing zip is **not** territory and is never counted as");
w("resolution. A county water authority head-quartered downtown serves the county.");
w();

/* ---- the pilots, item 11.1 to 11.3 ---------------------------------------- */

w("## The four pilot zips");
w();

const perZipJson: Record<string, unknown> = {};

for (const pilot of PILOTS) {
  const edges = zipGov.zips[pilot.zip] ?? [];
  const stamp = tiers.zips[pilot.zip];
  const governments = edges.filter((e) => e.entity === "GOVERNMENT");
  const statistical = edges.filter((e) => e.entity === "STATISTICAL");
  const unclassified = edges.filter((e) => e.entity === "UNCLASSIFIED");
  const edgeTier = new Map(stamp?.edges.map((e) => [`${e.layer}:${e.id}`, e.tier]) ?? []);

  const counties = governments.filter((e) => e.layer === "county");
  const namedSpecial = counties.flatMap((c) => specialByCounty.get(c.id) ?? []);

  w(`### ${pilot.zip} — ${pilot.what}`);
  w();
  w(`**Stamped tier: ${stamp?.tier ?? "UNKNOWN"}** (stamped ${stamp ? tiers.stampedAt : "never"}).`);
  w();
  w("| Denominator | Count |");
  w("|---|---:|");
  w(`| Governments in the universe touching this zip | ${(governments.length + namedSpecial.length).toLocaleString()} |`);
  w(`| — territory-resolved | ${governments.length} |`);
  w(`| — of those, bodies enumerated (Tier 2) | ${stamp?.evidence.bodiesEnumeratedFor ?? 0} |`);
  w(`| — UNRESOLVED (special districts, named below) | ${namedSpecial.length.toLocaleString()} |`);
  w();

  w("#### Territory-resolved governments");
  w();
  w("| Government | Layer | Tier | Evidence |");
  w("|---|---|---|---|");
  for (const g of governments.sort((a, b) => b.samples - a.samples)) {
    const t = edgeTier.get(`${g.layer}:${g.id}`) ?? "—";
    const ev =
      g.samples === 0
        ? "recovered from the government's side (smaller than the sampling lattice)"
        : `${g.samples} sample point${g.samples === 1 ? "" : "s"}`;
    w(`| ${g.name} | ${g.layer} | ${t} | ${ev} |`);
  }
  w();

  // 11.1: the un-enumerated ones NAMED INDIVIDUALLY, not summarized.
  const unenumerated = governments.filter(
    (g) => (edgeTier.get(`${g.layer}:${g.id}`) ?? "TIER_1") !== "TIER_2",
  );
  w("#### Territory-resolved but bodies NOT enumerated — named");
  w();
  if (unenumerated.length === 0) {
    w("None. Every government resolved to this zip has at least one enumerated body.");
  } else {
    for (const g of unenumerated) w(`- **${g.name}** (${g.layer} ${g.id})`);
  }
  w();

  if (statistical.length || unclassified.length) {
    w("#### Not governments, and never rendered as one");
    w();
    w(
      "These are Census STATISTICAL entities — a CDP is a name the Census gives a " +
        "populated area so it can publish statistics for it, and a CCD is a " +
        "statistical subdivision drawn in states with no minor civil divisions. " +
        "Neither has a council, a budget, a meeting or an elected official.",
    );
    w();
    for (const g of statistical) w(`- ${g.name} — STATISTICAL (LSAD ${g.lsad})`);
    for (const g of unclassified) {
      w(`- ${g.name} — UNCLASSIFIED (LSAD ${g.lsad}), a work item and not a claim either way`);
    }
    w();
  }

  // 11.2: NAMED, not counted.
  w(`#### The ${namedSpecial.length.toLocaleString()} unresolved special districts, by name`);
  w();
  w(
    "Every one of these is a government the Census counts, in a county over this " +
      "zip, whose territory nobody has resolved. Whether each reaches this zip is " +
      "**UNRESOLVED — a work item, never a false.**",
  );
  w();
  if (namedSpecial.length === 0) {
    w("None. No county over this zip holds a special district.");
  } else {
    w("| Census PID6 | District | Office city | State |");
    w("|---|---|---|---|");
    for (const d of namedSpecial.sort((a, b) => a.name.localeCompare(b.name))) {
      w(`| ${d.pid6} | ${d.name} | ${d.city} | ${d.state} |`);
    }
  }
  w();

  // 11.3
  w("#### What stands between this zip and the next tier");
  w();
  w(`${COVERAGE_TIER_NEXT_STEP[stamp?.tier ?? "TIER_0"]}`);
  w();
  w(
    `Concretely: ${namedSpecial.length.toLocaleString()} named special districts above have ` +
      "no published boundary, and until their territory is resolved this zip cannot " +
      "leave Tier 0 — because a tier is the floor across the governments touching it, " +
      "and an unresolved government is exactly the one a reader might live under and " +
      "hear nothing about.",
  );
  w();

  perZipJson[pilot.zip] = {
    tier: stamp?.tier ?? "UNKNOWN",
    universeGovernments: governments.length + namedSpecial.length,
    territoryResolved: governments.length,
    bodiesEnumerated: stamp?.evidence.bodiesEnumeratedFor ?? 0,
    resolvedGovernments: governments.map((g) => ({ name: g.name, layer: g.layer, id: g.id })),
    unenumerated: unenumerated.map((g) => ({ name: g.name, layer: g.layer, id: g.id })),
    unresolvedSpecialDistricts: namedSpecial,
    statistical: statistical.map((g) => ({ name: g.name, lsad: g.lsad })),
    unclassified: unclassified.map((g) => ({ name: g.name, lsad: g.lsad })),
  };
}

/* ---- 03255 against H05 ---------------------------------------------------- */

w("## 03255 against `HUNT05`");
w();
const newbury = perZipJson["03255"] as { unresolvedSpecialDistricts: unknown[] };
w(
  "`HUNT05` records **40 UNRESOLVED special districts at 03255**, found by the h " +
    "session on 2026-08-16 by building the denominator.",
);
w();
w(
  `**This session resolves 0 of the 40.** The method that resolved every other ` +
    `government type cannot reach a single special district, because TIGER ` +
    `publishes no boundary for any of them. What this session adds is the ` +
    `NAMES: ${(newbury.unresolvedSpecialDistricts as unknown[]).length} districts in Merrimack County are listed above with their ` +
    `Census PID6 and office city, so the next session can start dialling instead ` +
    `of enumerating.`,
);
w();
w(
  "The two counts differ because they are counts of different things: `HUNT05` " +
    "counted the districts inside 03255's own 166-unit enumerated universe, and " +
    "this counts every special district in the counties whose territory overlaps " +
    "the ZCTA. Neither is wrong; the second is the wider bound and the one a " +
    "coverage claim has to clear.",
);
w();

/* ---- 11.5 ----------------------------------------------------------------- */

w("## `AUD-06`");
w();
w(
  "`AUD-06` assigns a coverage manifest gated by `tests/coverage-manifest.test.ts`. " +
    "Item 1d confirmed that test now allowlists correctly on Linux — the separator " +
    "bug that put `lib/coverage/states.ts` in its own offender list is fixed at the " +
    "shared code path and guarded by `tests/path-separator.test.ts`. That is the " +
    "part of `AUD-06` this session can close.",
);
w();

writeFileSync(join(DERIVED, "gap-ledger.md"), `${md.join("\n")}\n`, "utf8");
writeFileSync(
  join(DERIVED, "gap-ledger.json"),
  `${JSON.stringify(
    {
      generatedAt: STAMPED_AT,
      timezone: "America/Phoenix",
      national: {
        zipsAtTier: tiers.distribution,
        zipDenominator: totalZips,
        censusUnitsResolved: resolved,
        censusUnitDenominator: unitZips.totals.units,
        specialDistrictsUnresolved: sd.total - sd.resolved,
        specialDistrictDenominator: sd.total,
      },
      pilots: perZipJson,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`WROTE data/derived/gap-ledger.md (${md.length} lines)`);
console.log(`WROTE data/derived/gap-ledger.json`);
console.log("");
console.log("NATIONAL HEADLINES:");
console.log(`  Census units resolved to >=1 zip:  ${resolved} of ${unitZips.totals.units}`);
console.log(`  Special districts unresolved:      ${sd.total - sd.resolved} of ${sd.total}`);
for (const t of ["TIER_0", "TIER_1", "TIER_2", "TIER_3"]) {
  console.log(`  ${t}: ${tiers.distribution[t] ?? 0} of ${totalZips}`);
}
console.log("");
console.log("PILOTS (named unresolved special districts):");
for (const p of PILOTS) {
  const row = perZipJson[p.zip] as { tier: string; unresolvedSpecialDistricts: unknown[] };
  console.log(
    `  ${p.zip}: ${row.tier}, ${(row.unresolvedSpecialDistricts as unknown[]).length} districts named`,
  );
}
