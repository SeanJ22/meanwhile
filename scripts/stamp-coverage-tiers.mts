/**
 * Stamp a coverage tier on every zip and every government-to-zip edge
 * (Prompt B item 6.3, 2026-08-20).
 *
 * RULING 6: the tier is STORED and STAMPED, never inferred at read time from
 * what happens to be present.
 *
 * WHERE "STORED" IS, AND WHY IT IS NOT A DATABASE TABLE. This repo's databases
 * hold exactly four things — meetings, the search log, reactions and feedback —
 * and three of those are the COLLECTION STORES that CLAUDE.md forbids from
 * joining to anything. Reference geography is not collection: every other
 * reference dataset in this product (the meetings snapshot, dotgov, FEC, state
 * votes) is a committed, immutable, reviewable artifact, and the tier ledger is
 * the same kind of thing. Committing it also means a tier change shows up in a
 * diff, which a row update in Neon would not.
 *
 * The tier DOES reach the database, once, where it has to: item 8 puts it on
 * every aggregate record at write time, because a buyer weighting interest by
 * coverage depth needs it on the row.
 *
 * WHAT THIS RUN CAN HONESTLY STAMP. Territory resolution is done (item 5), so
 * Tier 1 is reachable. Body enumeration is NOT done nationally — RULING 9 says
 * Census can never establish it — so no zip is stamped Tier 2 by this script
 * except where the product's own registry actually enumerates bodies, and the
 * registry covers three states. Kelly depth is not done anywhere, so nothing
 * is stamped Tier 3. RULING 6's last clause: a tier may never be raised by a
 * session that did not do the work that raises it.
 *
 * Run:  corepack pnpm tiers:stamp
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { promote, tierExceedsEvidence } from "../lib/coverage/tier.ts";
import type { CoverageEvidence, CoverageTier } from "../lib/coverage/tier.ts";
import { readTable } from "../lib/reference/index.ts";
// The one Phoenix day formatter in this repo.
import { today } from "./doc-dates.mjs";

const DERIVED = join(process.cwd(), "data", "derived");

/**
 * The stamp comes from the clock, never from a plausible-looking string — and
 * from the ONE formatter, not a private copy. Guard 0B caught this file
 * keeping its own `Intl.DateTimeFormat`, which is how two places in a repo
 * start disagreeing about what day it is.
 */
const STAMPED_AT = today();

type Edge = {
  layer: string;
  id: string;
  name: string;
  samples: number;
  entity: "GOVERNMENT" | "STATISTICAL" | "UNCLASSIFIED";
  lsad: string;
};

const zipGov = JSON.parse(readFileSync(join(DERIVED, "zip-governments.json"), "utf8")) as {
  zips: Record<string, Edge[]>;
};

/* -------------------------------------------------------------------------- */
/* What the registry actually enumerates — the ONLY route to Tier 2           */
/* -------------------------------------------------------------------------- */

/**
 * The product's own body registry. This is the one place a Tier 2 claim can
 * come from, and it is deliberately read as "which governments have bodies
 * enumerated", never as "how many governments do we know about" — the second
 * question is the self-referential denominator this whole model replaces.
 */
type Registry = {
  divisions: Array<{ ocdId: string; geoid: string | null }>;
  bodies: Array<{ ocdId: string | null; bodyClass?: string }>;
};

const registry = JSON.parse(
  readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
) as Registry;

// The bridge is an IDENTIFIER, not a name. Registry divisions carry the TIGER
// `geoid` — `04019` for Pima County — which is exactly the id the territory
// join keys its edges on. Matching on names here would have reintroduced the
// crosswalk's whole normalization problem for no reason.
const divisionGeoid = new Map<string, string>();
for (const d of registry.divisions) {
  if (d.geoid) divisionGeoid.set(d.ocdId, d.geoid);
}

/** GEOIDs of governments whose bodies this product has actually enumerated. */
const enumeratedGeoids = new Set<string>();
let bodiesWithoutDivision = 0;
for (const body of registry.bodies) {
  if (!body.ocdId) {
    bodiesWithoutDivision += 1;
    continue;
  }
  const geoid = divisionGeoid.get(body.ocdId);
  if (geoid) enumeratedGeoids.add(geoid);
}
console.log(
  `registry: ${registry.bodies.length} bodies across ${registry.divisions.length} divisions — ` +
    `${enumeratedGeoids.size} distinct governments have at least one enumerated body ` +
    `(${bodiesWithoutDivision} bodies carry no division and cannot be bridged)`,
);

/* -------------------------------------------------------------------------- */
/* The unresolved half of the universe                                        */
/* -------------------------------------------------------------------------- */

/**
 * Special districts per county, from the Census of Governments.
 *
 * Every one of these is UNRESOLVED — TIGER publishes no special-district
 * boundary at any vintage — so this is a count of governments known to exist
 * inside a county and not known to reach any particular zip. It is the honest
 * form of "we do not know", and it is what keeps a zip from claiming Tier 1 on
 * the strength of the governments that happened to have geometry.
 */
const specialDistrictsByCountyGeoid = new Map<string, number>();
{
  const units = readTable("census_govt_units_2022");
  const [T, S, C] = ["gov_type", "fips_state", "fips_county"].map((c) =>
    units.header.indexOf(c),
  );
  let unplaceable = 0;
  for (const r of units.rows) {
    if (r[T] !== "SPECIAL DISTRICT") continue;
    const st = (r[S] ?? "").trim();
    const cty = (r[C] ?? "").trim();
    if (!st || !cty) {
      unplaceable += 1;
      continue;
    }
    const geoid = `${st}${cty}`;
    specialDistrictsByCountyGeoid.set(geoid, (specialDistrictsByCountyGeoid.get(geoid) ?? 0) + 1);
  }
  const placed = [...specialDistrictsByCountyGeoid.values()].reduce((a, b) => a + b, 0);
  console.log(
    `special districts: ${placed} placed in ${specialDistrictsByCountyGeoid.size} counties, ` +
      `${unplaceable} carrying no county FIPS at all — ${placed + unplaceable} of 39,555 accounted for`,
  );
}

/* -------------------------------------------------------------------------- */
/* Stamp                                                                      */
/* -------------------------------------------------------------------------- */

type StampedZip = {
  tier: CoverageTier;
  stampedAt: string;
  evidence: CoverageEvidence;
  /**
   * Governments known to exist in the counties over this zip whose territory
   * nobody has resolved. Stated per zip and never folded into a ratio —
   * naming the number is what makes the tier readable.
   */
  unresolvedSpecialDistrictsInCounties: number;
  /** Per-edge tiers, so an edge carries its own claim and not the zip's. */
  edges: Array<{ layer: string; id: string; tier: CoverageTier }>;
};

const stamped: Record<string, StampedZip> = {};
const distribution = new Map<CoverageTier, number>();
let edgeCount = 0;
const edgeDistribution = new Map<CoverageTier, number>();

for (const [zip, edges] of Object.entries(zipGov.zips)) {
  // ONLY governments count toward a coverage denominator. A CDP and a CCD are
  // Census statistical entities with no council, no budget and no meeting;
  // counting them would inflate both halves of every ratio below. An
  // UNCLASSIFIED row is excluded too — it is a work item, and including a row
  // whose governmental status is unknown would be asserting one.
  const governments = edges.filter((e) => e.entity === "GOVERNMENT");

  // THE UNIVERSE IS NOT WHAT WE RESOLVED, AND THE FIRST DRAFT OF THIS FILE
  // SET IT TO EXACTLY THAT.
  //
  // Writing `universeGovernments = territoryResolved` makes Tier 1 true by
  // construction for every zip in the country — which is the self-referential
  // denominator this entire model exists to replace, reintroduced inside the
  // model. It produced 99.71% Tier 1 nationally, a number that looked
  // excellent and meant nothing.
  //
  // The real universe includes the special districts. TIGER publishes no
  // geometry for any of the 39,555, so not one can be attributed to a
  // particular zip — but "we cannot attribute it" is not "it is not there".
  // What IS knowable is the county: the Census gives every special district a
  // `fips_county`, so for every county overlapping this ZCTA we know how many
  // special districts exist inside it and that ZERO of them are resolved.
  //
  // Those are Tier 0 governments — roster only, present in the Census
  // universe, nothing else known — and under RULING 6 a zip's tier is the
  // FLOOR across the governments touching it, not the ceiling. One
  // unresolved government drops the zip, because that is precisely the
  // government a reader might live under and hear nothing about.
  const territoryResolved = governments.length;
  const counties = governments.filter((e) => e.layer === "county").map((e) => e.id);
  const unresolvedSpecialDistricts = counties.reduce(
    (n, geoid) => n + (specialDistrictsByCountyGeoid.get(geoid) ?? 0),
    0,
  );
  const universeGovernments = territoryResolved + unresolvedSpecialDistricts;

  const bodiesEnumeratedFor = governments.filter((e) => enumeratedGeoids.has(e.id)).length;

  const evidence: CoverageEvidence = {
    universeGovernments,
    territoryResolved,
    bodiesEnumeratedFor,
    // Kelly depth is not established anywhere yet, and zero people is NOT
    // "every person is complete" — promote() refuses the vacuous truth.
    people: 0,
    peopleAtKellyDepth: 0,
  };

  const tier = promote(evidence);
  if (tierExceedsEvidence(tier, evidence)) {
    throw new Error(`${zip}: stamped tier ${tier} exceeds its own evidence — a bug in promote()`);
  }

  const edgeTiers = governments.map((e) => {
    // An EDGE's tier is about that one government-to-zip relationship, not the
    // zip's overall position. The edge exists because territory resolved, so it
    // is at least Tier 1; it reaches Tier 2 only if that government's bodies
    // are enumerated. This is why the tier is carried per edge as well as per
    // zip: a zip can hold a Tier 2 county and a Tier 1 fire district, and one
    // number for the pair would be a claim about neither.
    const enumerated = enumeratedGeoids.has(e.id);
    const t: CoverageTier = enumerated ? "TIER_2" : "TIER_1";
    edgeDistribution.set(t, (edgeDistribution.get(t) ?? 0) + 1);
    edgeCount += 1;
    return { layer: e.layer, id: e.id, tier: t };
  });

  stamped[zip] = {
    tier,
    stampedAt: STAMPED_AT,
    evidence,
    unresolvedSpecialDistrictsInCounties: unresolvedSpecialDistricts,
    edges: edgeTiers,
  };
  distribution.set(tier, (distribution.get(tier) ?? 0) + 1);
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* The same ledger, keyed by OCD division                                     */
/*                                                                            */
/* The reaction write path holds DIVISIONS, not a zip: the reader was looking */
/* at a map view, and a view resolves to divisions. Rather than making that   */
/* caller do a geometry lookup at write time, the stamp is published in the   */
/* shape it can actually ask in.                                              */
/*                                                                            */
/* A division's tier is the FLOOR across the zips it touches, matching how a  */
/* zip's tier is the floor across its governments. A county holding one       */
/* Tier 0 zip is a county a reader can land in and be told nothing, and       */
/* taking the maximum would describe the best zip in it.                      */
/* -------------------------------------------------------------------------- */

const RANK: Record<CoverageTier, number> = { TIER_0: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 };
const geoidToOcd = new Map<string, string[]>();
for (const [ocdId, geoid] of divisionGeoid) {
  geoidToOcd.set(geoid, [...(geoidToOcd.get(geoid) ?? []), ocdId]);
}

const ocdTiers = new Map<string, CoverageTier>();
for (const [zip, row] of Object.entries(stamped)) {
  void zip;
  for (const e of row.edges) {
    for (const ocdId of geoidToOcd.get(e.id) ?? []) {
      const current = ocdTiers.get(ocdId);
      if (!current || RANK[row.tier] < RANK[current]) ocdTiers.set(ocdId, row.tier);
    }
  }
}
console.log(
  `\nOCD DIVISIONS STAMPED: ${ocdTiers.size} of ${divisionGeoid.size} divisions carrying a TIGER geoid`,
);

const total = Object.keys(stamped).length;
console.log("");
console.log(`COVERAGE TIER STAMPED ON ${total} ZIPS (stamped ${STAMPED_AT}, America/Phoenix)`);
console.log("");
console.log("NATIONAL DISTRIBUTION — denominator is the 33,791 ZCTAs in the 2020 boundary file:");
for (const t of ["TIER_0", "TIER_1", "TIER_2", "TIER_3"] as CoverageTier[]) {
  const n = distribution.get(t) ?? 0;
  console.log(
    `  ${t}  ${String(n).padStart(6)} of ${total}  ${((n / total) * 100).toFixed(2)}%`,
  );
}
console.log("");
console.log(`GOVERNMENT-TO-ZIP EDGES STAMPED: ${edgeCount}`);
for (const t of ["TIER_1", "TIER_2", "TIER_3"] as CoverageTier[]) {
  console.log(`  ${t}  ${String(edgeDistribution.get(t) ?? 0).padStart(6)}`);
}

console.log("");
console.log("THE PILOTS:");
for (const zip of ["85701", "85641", "07866", "03255"]) {
  const s = stamped[zip];
  console.log(
    s
      ? `  ${zip}  ${s.tier}  — ${s.evidence.territoryResolved} governments resolved, ` +
          `${s.evidence.bodiesEnumeratedFor} with bodies enumerated`
      : `  ${zip}  NO ZCTA — unstampable, and that is a fact about our method`,
  );
}

writeFileSync(
  join(DERIVED, "zip-coverage-tiers.json"),
  `${JSON.stringify({
    stampedAt: STAMPED_AT,
    timezone: "America/Phoenix",
    ruling: "RULING 6 — four coverage tiers, stored and stamped, never inferred at read time",
    denominator: { zips: total, source: "cb_2020_us_zcta520_500k" },
    distribution: Object.fromEntries(distribution),
    edgeDistribution: Object.fromEntries(edgeDistribution),
    ocdTiers: Object.fromEntries(ocdTiers),
    zips: stamped,
  })}\n`,
  "utf8",
);
console.log("\nWROTE data/derived/zip-coverage-tiers.json");

/* -------------------------------------------------------------------------- */
/* THE RUNTIME LEDGER — a second, compact file                                */
/*                                                                            */
/* The file above is the AUDITABLE artifact: every zip, its evidence, and     */
/* every government-to-zip edge with its own tier. It is 18 MB, and tracing   */
/* 18 MB into a serverless function to answer "what tier is 85701" would be   */
/* paying the whole ledger's weight on every cold start.                      */
/*                                                                            */
/* So the read path gets its own file holding exactly what it needs: the tier,*/
/* the two evidence counts the reader note prints, and the unresolved         */
/* special-district count. Encoded as a fixed four-number tuple per zip,      */
/* because 33,791 objects of named keys is mostly key names.                  */
/*                                                                            */
/* THE TWO FILES ARE WRITTEN IN THE SAME PASS, FROM THE SAME VALUES. That is  */
/* the property that matters: a runtime copy generated separately is a copy   */
/* that can drift, and a tier that disagrees with its own audit trail is      */
/* worse than no tier at all. `tests/coverage-tier.test.ts` asserts they      */
/* agree, zip for zip.                                                        */
/* -------------------------------------------------------------------------- */

const RUNTIME_TIERS: CoverageTier[] = ["TIER_0", "TIER_1", "TIER_2", "TIER_3"];
const compact: Record<string, [number, number, number, number]> = {};
for (const [zip, row] of Object.entries(stamped)) {
  compact[zip] = [
    RUNTIME_TIERS.indexOf(row.tier),
    row.evidence.territoryResolved,
    row.evidence.bodiesEnumeratedFor,
    row.unresolvedSpecialDistrictsInCounties,
  ];
}

writeFileSync(
  join(DERIVED, "zip-coverage-tiers-runtime.json"),
  `${JSON.stringify({
    stampedAt: STAMPED_AT,
    tiers: RUNTIME_TIERS,
    shape: [
      "tierIndex",
      "territoryResolved",
      "bodiesEnumeratedFor",
      "unresolvedSpecialDistrictsInCounties",
    ],
    denominator: { zips: total },
    distribution: Object.fromEntries(distribution),
    ocdTiers: Object.fromEntries(ocdTiers),
    zips: compact,
  })}\n`,
  "utf8",
);
console.log("WROTE data/derived/zip-coverage-tiers-runtime.json (the read path's copy)");
