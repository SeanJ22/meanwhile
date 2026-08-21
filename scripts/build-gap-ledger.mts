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

import {
  COVERAGE_TIER_NEXT_STEP,
  COVERAGE_TIER_READER_LABEL,
  COVERAGE_TIER_ZIP_HEADLINE,
} from "../lib/coverage/tier.ts";
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

/**
 * Special districts resolved by a DOCUMENT rather than by geometry — a statute,
 * a tax table, a district saying in its own words which towns it lies in.
 * See the file's own note; a district absent from it stays UNRESOLVED.
 */
const districtTerritory = JSON.parse(
  readFileSync(join(DERIVED, "special-district-territory.json"), "utf8"),
) as {
  evidenceDoc: string;
  districts: {
    pid6: string;
    name: string;
    reaches?: string[];
    reachesNot?: string[];
    basis: string;
    evidence: string;
    sourceUrl: string;
  }[];
};

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
  const inCounties = counties.flatMap((c) => specialByCounty.get(c.id) ?? []);

  /*
   * **A DISTRICT RESOLVED BY A DOCUMENT LEAVES THE UNRESOLVED LIST.**
   * (NH Hunt 2, item 4, 2026-08-21.)
   *
   * TIGER publishes no boundary for any special district, so the geometric join
   * resolves none of the country's 39,555 and this file reported every one at
   * every pilot zip as UNRESOLVED. That was right, and it had no way to become
   * wrong: a hunt that resolved one by reading a statute or a tax table had
   * nowhere to put the answer, so the resolution lived in an evidence page and
   * the ledger went on saying nobody had tried.
   *
   * `data/derived/special-district-territory.json` is that place. A district
   * with `reaches` including this zip moves into the resolved list; one with
   * `reachesNot` including it leaves the picture entirely, because it is not a
   * government over this zip at all. A district ABSENT from that file stays
   * UNRESOLVED, which is the honest default this whole section exists to
   * protect — "we could not find its boundary" is never "it does not govern
   * here".
   */
  const reaches = new Set(
    districtTerritory.districts
      .filter((d) => (d.reaches ?? []).includes(pilot.zip))
      .map((d) => d.pid6),
  );
  const reachesNot = new Set(
    districtTerritory.districts
      .filter((d) => (d.reachesNot ?? []).includes(pilot.zip))
      .map((d) => d.pid6),
  );
  const namedSpecial = inCounties.filter(
    (d) => !reaches.has(d.pid6) && !reachesNot.has(d.pid6),
  );
  const resolvedSpecial = inCounties.filter((d) => reaches.has(d.pid6));
  const ruledOutSpecial = inCounties.filter((d) => reachesNot.has(d.pid6));

  w(`### ${pilot.zip} — ${pilot.what}`);
  w();
  /*
   * **PLAIN SENTENCES FIRST** (Prompt E item 11.1, 2026-08-20).
   *
   * The tier CODE stays — RULING 6 requires that vocabulary verbatim wherever
   * it appears — and it stops being the first thing a person meets. What comes
   * first is the sentence the product would say to a reader standing here, and
   * then the numbers. Legibility does not cost precision: every denominator
   * below is the one that was there before, unrounded.
   */
  w(`**${COVERAGE_TIER_ZIP_HEADLINE[stamp?.tier ?? "TIER_0"]}**`);
  w();
  w(
    `${COVERAGE_TIER_READER_LABEL[stamp?.tier ?? "TIER_0"]} ` +
      `(Coverage tier \`${stamp?.tier ?? "UNKNOWN"}\`, stamped ${stamp ? tiers.stampedAt : "never"}.)`,
  );
  w();
  w("| Denominator | Count |");
  w("|---|---:|");
    /*
   * A district resolved as REACHING this zip is a government touching it and a
   * government whose territory is resolved, so it counts in both numbers. One
   * ruled OUT is neither — it is not over this zip at all, and counting it as a
   * government here would be the opposite error to the one this section exists
   * to avoid.
   */
  w(
    `| Governments in the universe touching this zip | ${(
      governments.length +
      resolvedSpecial.length +
      namedSpecial.length
    ).toLocaleString()} |`,
  );
  w(`| — territory-resolved | ${governments.length + resolvedSpecial.length} |`);
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
  w("#### Governments we can locate, whose boards we have not listed");
  w();
  w(
    "We know these governments cover this zip. What we do not have is the list " +
      "of boards, councils and commissions inside them — so a reader here could " +
      "be governed by a body this product has never named.",
  );
  w();
  if (unenumerated.length === 0) {
    w("None. Every government resolved to this zip has at least one enumerated body.");
  } else {
    for (const g of unenumerated) {
      w(
        `- **${g.name}** — last thing tried: the boundary join of ${tiers.stampedAt}, ` +
          `which placed it over this zip and does not enumerate what is inside it. ` +
          `Nobody has read its own roster page. (${g.layer} ${g.id})`,
      );
    }
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
    if (resolvedSpecial.length || ruledOutSpecial.length) {
    w("#### Special districts, resolved by document rather than by map");
    w();
    w(
      "TIGER publishes no boundary for a special district, so geometry cannot " +
        "answer these and never will. These were settled by reading something — a " +
        "statute, a state tax table, a district describing its own territory. The " +
        "evidence for each is in `" + districtTerritory.evidenceDoc + "`.",
    );
    w();
    w("| District | Reaches this zip | Settled by |");
    w("|---|---|---|");
    for (const d of resolvedSpecial) {
      const rec = districtTerritory.districts.find((x) => x.pid6 === d.pid6)!;
      w(`| **${d.name}** | **YES** | ${rec.basis} |`);
    }
    for (const d of ruledOutSpecial) {
      const rec = districtTerritory.districts.find((x) => x.pid6 === d.pid6)!;
      w(`| ${d.name} | no | ${rec.basis} |`);
    }
    w();
    if (resolvedSpecial.length) {
      w(
        `**${resolvedSpecial.length} of these govern part of this zip and are not in ` +
          "the registry.** A reader here can live under one and hear nothing about " +
          "it, which is what an unresolved government was always the risk of.",
      );
      w();
    }
  }

w(
    `#### The ${namedSpecial.length.toLocaleString()} districts we cannot yet say you live in`,
  );
  w();
  w(
    "Each of these is a real government — a fire district, a water district, an " +
      "irrigation or library district — that the federal Census counts, in a county " +
      "over this zip. Nobody publishes a map of where any of them starts and stops, " +
      "so we cannot say whether it reaches this zip. **That is a work item and " +
      "never a no**: recording one as \"does not govern here\" because we could not " +
      "find its boundary would be inventing an answer.",
  );
  w();
  w(
    `**The last thing tried, and when.** The national boundary join of ` +
      `${STAMPED_AT}, run against every published boundary vintage. It resolved ` +
      `47,834 of the country's 90,837 governments and **not one special district** — ` +
      "the boundaries are not published anywhere in that data at all. Nothing has " +
      "been tried on these districts individually yet; the four routes that have " +
      "not been walked are listed at the top of this file.",
  );
  w();
  if (namedSpecial.length === 0) {
    w("None. No county over this zip holds a special district.");
  } else {
    w("| District | Where its office is | State | Census id |");
    w("|---|---|---|---|");
    for (const d of namedSpecial.sort((a, b) => a.name.localeCompare(b.name))) {
      w(`| ${d.name} | ${d.city} | ${d.state} | ${d.pid6} |`);
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

/* ---- 03255 against HUNT05 ---------------------------------------------------- */

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

/*
 * **THE READABLE HALF LIVES IN `docs/`** (Prompt E item 11, 2026-08-20).
 *
 * It was written to `data/derived/`, beside the JSON that feeds it, and a
 * person looking for where the project stands does not open `data/derived`.
 * The machine half stays where machines read it; the ledger a human reads moves
 * next to the tracker and the log. One copy of each — RULING 34.
 */
writeFileSync(join(process.cwd(), "docs", "gap-ledger.md"), `${md.join("\n")}\n`, "utf8");
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

console.log(`WROTE docs/gap-ledger.md (${md.length} lines)`);
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
