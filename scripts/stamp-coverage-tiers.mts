/**
 * Stamps a coverage tier on every zip and every government-to-zip edge, and
 * writes the read path's compact ledger. A zip's tier is the floor across the
 * governments touching it.
 *
 * Run:  corepack pnpm tiers:stamp
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { promote, tierExceedsEvidence } from "../lib/coverage/tier.ts";
import type { CoverageEvidence, CoverageTier } from "../lib/coverage/tier.ts";
import { readTable } from "../lib/reference/index.ts";
import { withoutPlaceholderBodies } from "../lib/registry/census-placeholders.ts";
import { today } from "./doc-dates.mjs";

const DERIVED = join(process.cwd(), "data", "derived");

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

type Registry = {
  divisions: Array<{ ocdId: string; divisionType: string; geoid: string | null }>;
  bodies: Array<{ ocdId: string | null; bodyClass?: string }>;
};

// A body minted on a Census "no district here" placeholder is not a government, so it never enumerates one.
const registry = withoutPlaceholderBodies(JSON.parse(
  readFileSync(join(process.cwd(), "lib", "registry", "registry.json"), "utf8"),
) as Registry);

// Keyed by TIGER geoid, the id the territory join uses; never by name.
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
  `registry: ${registry.bodies.length} bodies (none on a Census placeholder) across ${registry.divisions.length} divisions — ` +
    `${enumeratedGeoids.size} distinct governments have at least one enumerated body ` +
    `(${bodiesWithoutDivision} bodies carry no division and cannot be bridged)`,
);

/* -------------------------------------------------------------------------- */
/* The unresolved half of the universe                                        */
/* -------------------------------------------------------------------------- */

/** Special districts per county, from the Census of Governments. TIGER publishes no special-district boundary, so all are unresolved. */
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
  /** Governments known to exist in the counties over this zip whose territory nobody has resolved. */
  unresolvedSpecialDistrictsInCounties: number;
  /** Per-edge tiers, so an edge carries its own claim and not the zip's. */
  edges: Array<{ layer: string; id: string; tier: CoverageTier }>;
  /** How many of this zip's governments sit at each tier. Stored only; the floor tier is the public figure. */
  governmentTierDistribution: Record<CoverageTier, number>;
};

const stamped: Record<string, StampedZip> = {};
const distribution = new Map<CoverageTier, number>();
let edgeCount = 0;
const edgeDistribution = new Map<CoverageTier, number>();

for (const [zip, edges] of Object.entries(zipGov.zips)) {
  // Only governments count; statistical and unclassified entities would inflate both halves of every ratio.
  const governments = edges.filter((e) => e.entity === "GOVERNMENT");

  // Special districts have no TIGER geometry, so every one in an overlapping
  // county is an unresolved Tier 0 government, and the zip's tier is the floor.
  const counties = governments.filter((e) => e.layer === "county").map((e) => e.id);
  const unresolvedSpecialDistricts = counties.reduce(
    (n, geoid) => n + (specialDistrictsByCountyGeoid.get(geoid) ?? 0),
    0,
  );
  const territoryResolved = governments.length;
  const universeGovernments = territoryResolved + unresolvedSpecialDistricts;

  const bodiesEnumeratedFor = governments.filter((e) => enumeratedGeoids.has(e.id)).length;

  const evidence: CoverageEvidence = {
    universeGovernments,
    territoryResolved,
    bodiesEnumeratedFor,
    // Zero people is not "every person is complete"; promote() refuses the vacuous truth.
    people: 0,
    peopleAtKellyDepth: 0,
  };

  const tier = promote(evidence);
  if (tierExceedsEvidence(tier, evidence)) {
    throw new Error(`${zip}: stamped tier ${tier} exceeds its own evidence — a bug in promote()`);
  }

  const edgeTiers: StampedZip["edges"] = governments.map((e) => {
    // An edge is at least Tier 1 (its territory resolved); Tier 2 only if that government's bodies are enumerated.
    const enumerated = enumeratedGeoids.has(e.id);
    const t: CoverageTier = enumerated ? "TIER_2" : "TIER_1";
    edgeDistribution.set(t, (edgeDistribution.get(t) ?? 0) + 1);
    edgeCount += 1;
    return { layer: e.layer, id: e.id, tier: t };
  });

  // TIER_0 is the remainder, so the four numbers always sum to the universe.
  const governmentTierDistribution: Record<CoverageTier, number> = {
    TIER_0: universeGovernments - edgeTiers.length,
    TIER_1: edgeTiers.filter((e) => e.tier === "TIER_1").length,
    TIER_2: edgeTiers.filter((e) => e.tier === "TIER_2").length,
    TIER_3: edgeTiers.filter((e) => e.tier === "TIER_3").length,
  };
  const distSum =
    governmentTierDistribution.TIER_0 +
    governmentTierDistribution.TIER_1 +
    governmentTierDistribution.TIER_2 +
    governmentTierDistribution.TIER_3;
  if (distSum !== universeGovernments) {
    throw new Error(
      `${zip}: the per-government tier distribution sums to ${distSum} against a ` +
        `universe of ${universeGovernments} — a distribution that does not add up ` +
        `to its own denominator is not a measurement`,
    );
  }

  stamped[zip] = {
    tier,
    stampedAt: STAMPED_AT,
    evidence,
    unresolvedSpecialDistrictsInCounties: unresolvedSpecialDistricts,
    edges: edgeTiers,
    governmentTierDistribution,
  };
  distribution.set(tier, (distribution.get(tier) ?? 0) + 1);
}

/* -------------------------------------------------------------------------- */
/* The same ledger, keyed by OCD division. A division's tier is the FLOOR     */
/* across the zips it touches.                                                */
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

/* The same distribution keyed by OCD division, counted over DISTINCT        */
/* governments (a government touching nine of a county's zips is one), plus  */
/* the unresolved special districts in the counties those zips lie in.       */

const govsByOcd = new Map<string, Map<string, CoverageTier>>();
const countiesByOcd = new Map<string, Set<string>>();
for (const row of Object.values(stamped)) {
  // Every division this zip touches, via any of its government edges.
  const divisions = new Set<string>();
  for (const e of row.edges) {
    for (const ocdId of geoidToOcd.get(e.id) ?? []) divisions.add(ocdId);
  }
  if (divisions.size === 0) continue;
  const counties = row.edges.filter((e) => e.layer === "county").map((e) => e.id);
  for (const ocdId of divisions) {
    let govs = govsByOcd.get(ocdId);
    if (!govs) {
      govs = new Map<string, CoverageTier>();
      govsByOcd.set(ocdId, govs);
    }
    for (const e of row.edges) {
      // Keep the floor, so a per-zip difference degrades safely.
      const seen = govs.get(e.id);
      if (!seen || RANK[e.tier] < RANK[seen]) govs.set(e.id, e.tier);
    }
    let cs = countiesByOcd.get(ocdId);
    if (!cs) {
      cs = new Set<string>();
      countiesByOcd.set(ocdId, cs);
    }
    for (const c of counties) cs.add(c);
  }
}

const ocdDistributions: Record<string, [number, number, number, number]> = {};
for (const [ocdId, govs] of govsByOcd) {
  let t1 = 0;
  let t2 = 0;
  let t3 = 0;
  for (const t of govs.values()) {
    if (t === "TIER_1") t1 += 1;
    else if (t === "TIER_2") t2 += 1;
    else if (t === "TIER_3") t3 += 1;
  }
  const t0 = [...(countiesByOcd.get(ocdId) ?? [])].reduce(
    (n, geoid) => n + (specialDistrictsByCountyGeoid.get(geoid) ?? 0),
    0,
  );
  ocdDistributions[ocdId] = [t0, t1, t2, t3];
}
console.log(
  `OCD DIVISIONS WITH A GOVERNMENT TIER DISTRIBUTION: ${Object.keys(ocdDistributions).length}`,
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

/* The read path's compact ledger: a fixed eight-number tuple per zip. */
const RUNTIME_TIERS: CoverageTier[] = ["TIER_0", "TIER_1", "TIER_2", "TIER_3"];
type CompactZip = [number, number, number, number, number, number, number, number];
const compact: Record<string, CompactZip> = {};
for (const [zip, row] of Object.entries(stamped)) {
  compact[zip] = [
    RUNTIME_TIERS.indexOf(row.tier),
    row.evidence.territoryResolved,
    row.evidence.bodiesEnumeratedFor,
    row.unresolvedSpecialDistrictsInCounties,
    row.governmentTierDistribution.TIER_0,
    row.governmentTierDistribution.TIER_1,
    row.governmentTierDistribution.TIER_2,
    row.governmentTierDistribution.TIER_3,
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
      "governmentsAtTier0",
      "governmentsAtTier1",
      "governmentsAtTier2",
      "governmentsAtTier3",
    ],
    denominator: { zips: total },
    distribution: Object.fromEntries(distribution),
    ocdTiers: Object.fromEntries(ocdTiers),
    ocdDistributions,
    zips: compact,
  })}\n`,
  "utf8",
);
console.log("WROTE data/derived/zip-coverage-tiers-runtime.json (the read path's copy)");
