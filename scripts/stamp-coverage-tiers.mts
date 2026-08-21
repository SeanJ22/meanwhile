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

/**
 * **A DISTRICT RESOLVED BY A DOCUMENT IS A RESOLVED DISTRICT** (NH Hunt 4,
 * 2026-08-21, item 6).
 *
 * The count below used to treat EVERY special district in an overlapping
 * county as unresolved, because TIGER publishes no geometry for any of them.
 * That was true when it was written and it stopped being true on 2026-08-21,
 * when HUNT05 resolved two of Merrimack County's by DOCUMENT — RSA 432:12 for
 * the conservation district, and the district's own words plus the state's
 * village-district register for Lake Todd.
 *
 * The consequence was a live contradiction on the reader's own page: 03255
 * renders Lake Todd Village District's meetings, and the coverage note on the
 * same page said "18 more ... we have not worked out which of them reach this
 * ZIP code" — with Lake Todd among the eighteen. A resolution recorded in a
 * derived file that only the gap ledger reads is not a resolution a reader can
 * see, and while it sat there the product was contradicting itself in print.
 */
const resolvedByDocument = (() => {
  /*
   * IT REPORTS WHAT IT READ, and the first draft of this loader did not.
   *
   * Sixteen of the eighteen rows in that file carry no `reaches` key at all —
   * a district whose territory is recorded as UNRESOLVED has nothing to list.
   * The first version iterated `district.reaches` unguarded, threw a
   * TypeError on the third row, and the surrounding try/catch turned that into
   * an empty map. The stamp then came out byte-identical and looked like a
   * correct no-op. A failed read reported as nothing found, in the very file
   * whose comment says an absent file must never become "everything is
   * resolved" — caught by asking for the count instead of the exit code.
   */
  const byZip = new Map<string, Set<string>>();
  let districtsRead = 0;
  let withTerritory = 0;
  try {
    const file = JSON.parse(
      readFileSync(join(DERIVED, "special-district-territory.json"), "utf8"),
    ) as { districts?: { pid6: string; name: string; reaches?: string[] }[] };
    const districts = file.districts ?? [];
    districtsRead = districts.length;
    for (const district of districts) {
      if (!Array.isArray(district.reaches) || district.reaches.length === 0) continue;
      withTerritory += 1;
      for (const zip of district.reaches) {
        const set = byZip.get(zip) ?? new Set<string>();
        set.add(district.pid6);
        byZip.set(zip, set);
      }
    }
  } catch (error) {
    /*
     * Absent or unreadable is "nothing has been resolved by document", which is
     * the honest default and the one this file started from. It is NOT "every
     * district is resolved". It is PRINTED, because a silent fallback here is
     * indistinguishable from a file with nothing in it.
     */
    console.log(
      `  special-district-territory.json COULD NOT BE READ — ${(error as Error).message}. ` +
        "Nothing is treated as resolved by document. This is not 'no districts are resolved'.",
    );
    return byZip;
  }
  console.log(
    `  document-resolved special districts: ${withTerritory} of ${districtsRead} rows carry a territory, ` +
      `covering ${byZip.size} zip(s)`,
  );
  return byZip;
})();

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
  /**
   * THE PER-GOVERNMENT TIER DISTRIBUTION (Prompt C item 3, 2026-08-20).
   *
   * The floor tier above is the honest public headline and it stays exactly
   * as it is. It is also, nationally, TIER_0 for 97.88% of zips — because no
   * special district anywhere resolved and nearly every zip contains one — so
   * as a FIELD on a sold row it carries almost no information. A buyer
   * weighting a row cannot tell a zip with one unresolved fire district and a
   * fully enumerated county from a zip where nothing at all is known, and
   * those are not the same measurement.
   *
   * This is the same stamped values counted rather than floored: how many of
   * this zip's governments sit at each tier. TIER_0 is the universe minus what
   * resolved — the governments we know exist over this zip and could not
   * attribute to it — and TIER_1 upward come from the edges, each carrying its
   * own claim.
   *
   * STORED ONLY. It reaches no reader-facing surface, no headline figure, no
   * report summary and no national distribution. The floor tier remains the
   * only tier stated publicly.
   */
  governmentTierDistribution: Record<CoverageTier, number>;
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
  const counties = governments.filter((e) => e.layer === "county").map((e) => e.id);
  const inCounties = counties.reduce(
    (n, geoid) => n + (specialDistrictsByCountyGeoid.get(geoid) ?? 0),
    0,
  );
  /*
   * Districts resolved to THIS zip by a document move across: they are
   * governments we have worked out, so they count as resolved and they stop
   * being counted as "we have not worked out which of them reach this ZIP".
   * Floored at zero — a territory file naming more districts than the county
   * holds is a data problem and must not produce a negative count that reads
   * as a discount.
   */
  const documentResolved = resolvedByDocument.get(zip)?.size ?? 0;
  const territoryResolved = governments.length + documentResolved;
  const unresolvedSpecialDistricts = Math.max(0, inCounties - documentResolved);
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

  const edgeTiers: StampedZip["edges"] = governments.map((e) => {
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

  /*
   * Counted from the same stamped values the floor came from, never inferred
   * and never recomputed at read time. TIER_0 is the arithmetic remainder:
   * every government in this zip's universe that did not resolve to it — which
   * is exactly the unresolved special districts, and is written as the
   * subtraction so the four numbers always sum to the universe.
   */
  /*
   * The document-resolved districts belong in this distribution too, and at
   * TIER_1: their TERRITORY is known and nothing further is. Leaving them out
   * is what broke tests/coverage-tier.test.ts item 3.1 the moment they started
   * counting as resolved — the distribution stopped reconciling with the
   * evidence stamped beside it, which is exactly the check that test exists to
   * make. It caught this in the same run that introduced it.
   */
  const governmentTierDistribution: Record<CoverageTier, number> = {
    TIER_0: universeGovernments - edgeTiers.length - documentResolved,
    TIER_1: edgeTiers.filter((e) => e.tier === "TIER_1").length + documentResolved,
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

/* -------------------------------------------------------------------------- */
/* THE SAME DISTRIBUTION, KEYED BY OCD DIVISION (Prompt C item 3, 2026-08-20)  */
/*                                                                            */
/* The reaction write path holds divisions, not a zip, so it needs the        */
/* distribution in the shape it can ask in — and it must MEAN THE SAME THING  */
/* as the search log's, or the column is two different measurements sharing a */
/* name, which is worse than not having it.                                   */
/*                                                                            */
/* So it is counted over GOVERNMENTS, not over divisions: the distinct        */
/* governments touching any zip this division covers, each at its own edge    */
/* tier, plus the distinct unresolved special districts in the counties those */
/* zips lie in. DISTINCT is the load-bearing word — a government touching     */
/* nine of a county's zips is one government, and summing per-zip counts      */
/* would count it nine times.                                                 */
/* -------------------------------------------------------------------------- */

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
      // A government's edge tier can differ by zip only if enumeration
      // differed, which it cannot — enumeration is per government. Keeping
      // the FLOOR anyway, so a future per-zip difference degrades safely.
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
    ocdDistributions,
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
type CompactZip = [number, number, number, number, number, number, number, number];
const compact: Record<string, CompactZip> = {};
for (const [zip, row] of Object.entries(stamped)) {
  compact[zip] = [
    RUNTIME_TIERS.indexOf(row.tier),
    row.evidence.territoryResolved,
    row.evidence.bodiesEnumeratedFor,
    row.unresolvedSpecialDistrictsInCounties,
    // Item 3: the per-government distribution, so the write paths can stamp it
    // without loading the 18 MB audit file. Four more integers per zip.
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
