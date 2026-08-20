/**
 * The stamped coverage tier for a zip, read from the committed ledger
 * (Prompt B items 6 to 8, 2026-08-20).
 *
 * RULING 6: the tier is STORED and STAMPED, never inferred at read time from
 * what happens to be present. This module is the read side of that — it looks
 * a stamp up, and it has no way to compute one. There is deliberately no
 * function here that derives a tier from live data: a tier that recomputed
 * itself would drift every time a vendor had a bad afternoon, and a zip would
 * quietly demote and promote without anybody deciding either.
 *
 * The ledger is `data/derived/zip-coverage-tiers.json`, written by
 * `corepack pnpm tiers:stamp`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { COVERAGE_TIER_UNKNOWN } from "./tier.ts";
import type { CoverageTier, CoverageTierOrUnknown } from "./tier.ts";

export type StampedZipRow = {
  tier: CoverageTier;
  stampedAt: string;
  evidence: {
    universeGovernments: number;
    territoryResolved: number;
    bodiesEnumeratedFor: number;
    people: number;
    peopleAtKellyDepth: number;
  };
  unresolvedSpecialDistrictsInCounties: number;
  edges: Array<{ layer: string; id: string; tier: CoverageTier }>;
  /** Item 3. Absent on a ledger written before the column existed. */
  governmentTierDistribution?: GovernmentTierDistribution;
};

/** The compact on-disk shape the read path actually loads. */
type RuntimeLedger = {
  stampedAt: string;
  tiers: CoverageTier[];
  denominator: { zips: number; source?: string };
  distribution: Record<string, number>;
  ocdTiers: Record<string, CoverageTier>;
  /**
   * OCD division id -> [governments at Tier 0, 1, 2, 3] (Prompt C item 3).
   * Counted over DISTINCT governments touching the division's zips, so it
   * means the same thing as the per-zip distribution rather than merely
   * sharing its name.
   */
  ocdDistributions?: Record<string, [number, number, number, number]>;
  /**
   * [tierIndex, territoryResolved, bodiesEnumeratedFor, unresolvedSpecial,
   *  governmentsAtTier0, governmentsAtTier1, governmentsAtTier2,
   *  governmentsAtTier3]
   */
  zips: Record<string, CompactZip>;
};

/** The eight-number per-zip tuple the runtime ledger stores. */
type CompactZip = [number, number, number, number, number, number, number, number];

/**
 * THE PER-GOVERNMENT TIER DISTRIBUTION (Prompt C item 3, 2026-08-20).
 *
 * The floor tier is the honest public headline and it does not move. It is
 * also TIER_0 for 97.88% of zips nationally — because no special district
 * anywhere resolved and nearly every zip contains one — so as a FIELD on a
 * sold row it separates almost nothing: a zip with a fully enumerated county
 * and one unresolved fire district reads identically to a zip where nothing
 * is known.
 *
 * This is the same stamped values counted rather than floored. STORED ONLY —
 * it reaches no reader-facing surface, no headline figure, no report summary
 * and no national distribution.
 */
export interface GovernmentTierDistribution {
  TIER_0: number;
  TIER_1: number;
  TIER_2: number;
  TIER_3: number;
}

/**
 * The wire form for the sold stores' column: a fixed, parseable text encoding.
 * `UNKNOWN` where the distribution genuinely cannot be recovered — never
 * zeros, which would claim we counted and found none.
 */
export const TIER_DISTRIBUTION_UNKNOWN = "UNKNOWN";

export function encodeTierDistribution(
  d: GovernmentTierDistribution | null,
): string {
  if (!d) return TIER_DISTRIBUTION_UNKNOWN;
  return `T0:${d.TIER_0},T1:${d.TIER_1},T2:${d.TIER_2},T3:${d.TIER_3}`;
}

export function decodeTierDistribution(
  encoded: string,
): GovernmentTierDistribution | null {
  const m = /^T0:(\d+),T1:(\d+),T2:(\d+),T3:(\d+)$/.exec(encoded);
  if (!m) return null;
  return {
    TIER_0: Number(m[1]),
    TIER_1: Number(m[2]),
    TIER_2: Number(m[3]),
    TIER_3: Number(m[4]),
  };
}

type Ledger = {
  stampedAt: string;
  denominator: { zips: number; source?: string };
  distribution: Record<string, number>;
  zips: Record<string, StampedZipRow>;
  /**
   * OCD division id -> the stamped tier for that division.
   *
   * The reaction write path holds DIVISIONS, not a zip — the reader was
   * looking at a map view, and the view resolves to divisions. This is the
   * same ledger keyed the way that caller can actually ask.
   */
  ocdTiers: Record<string, CoverageTier>;
  ocdDistributions: Record<string, [number, number, number, number]>;
};

/**
 * Loaded lazily and cached. The ledger is 33,791 rows and most requests never
 * need it; a top-level read would put it in every cold start.
 */
/**
 * THE READ PATH READS THE COMPACT FILE, NOT THE AUDIT FILE.
 *
 * `zip-coverage-tiers.json` is the auditable artifact — every zip, its
 * evidence, and every government-to-zip edge with its own tier — and it is
 * 18 MB. Tracing that into a serverless function to answer "what tier is
 * 85701" would pay the whole ledger's weight on every cold start.
 *
 * `zip-coverage-tiers-runtime.json` is 666 KB and holds exactly what the
 * reader note and the two sold-store write paths need. Both are written in
 * the SAME pass from the SAME values by `corepack pnpm tiers:stamp`, so they
 * cannot drift, and the suite asserts they agree zip for zip.
 *
 * IT MUST ALSO BE TRACED INTO THE DEPLOY. This file is read through
 * `process.cwd()`, which Next cannot see statically, so `next.config.ts`
 * names it in `outputFileTracingIncludes` for every route that reaches it.
 * Without that the read throws, the catch below returns null, and every zip
 * on production renders UNKNOWN while every sold row is stamped UNKNOWN —
 * a silent degradation that looks exactly like honest missing data.
 */
const RUNTIME_FILE = "zip-coverage-tiers-runtime.json";

let ledger: Ledger | null = null;

export function loadLedger(): Ledger | null {
  if (ledger) return ledger;
  try {
    // The READ is lazy, not the import. `node:fs` costs nothing to import, and
    // an earlier draft deferred it with a CommonJS loader instead — which does
    // not exist in an ES module and would have thrown the first time a
    // reaction was written, inside a try/catch that would have reported the
    // throw as "no ledger". Caught by tests/package-module-type.test.ts.
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "data", "derived", RUNTIME_FILE), "utf8"),
    ) as RuntimeLedger;

    // Decode the tuples once, on load, so every caller below sees the same
    // named shape whichever file it came from.
    const zips: Record<string, StampedZipRow> = {};
    for (const [zip, t] of Object.entries(raw.zips)) {
      zips[zip] = {
        tier: raw.tiers[t[0]]!,
        stampedAt: raw.stampedAt,
        evidence: {
          // The universe is the resolved set PLUS the unresolved special
          // districts — the same sum the stamper promoted from.
          universeGovernments: t[1] + t[3],
          territoryResolved: t[1],
          bodiesEnumeratedFor: t[2],
          people: 0,
          peopleAtKellyDepth: 0,
        },
        unresolvedSpecialDistrictsInCounties: t[3],
        edges: [],
        // Item 3. A ledger written before this existed has a four-number
        // tuple, and `undefined` here becomes UNKNOWN on the row rather than
        // four zeros — a distribution of zeros is a claim that we counted.
        governmentTierDistribution:
          t.length >= 8
            ? { TIER_0: t[4]!, TIER_1: t[5]!, TIER_2: t[6]!, TIER_3: t[7]! }
            : undefined,
      };
    }
    ledger = {
      stampedAt: raw.stampedAt,
      denominator: raw.denominator,
      distribution: raw.distribution,
      ocdTiers: raw.ocdTiers,
      ocdDistributions: raw.ocdDistributions ?? {},
      zips,
    };
    return ledger;
  } catch {
    // A missing ledger is a STATE, not a tier. Every caller below turns it
    // into UNKNOWN, which is the named gap — never TIER_0, which would be a
    // claim that we looked and found nothing.
    return null;
  }
}

const RANK: Record<CoverageTier, number> = {
  TIER_0: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
};

export function stampedRowForZip(zip: string): StampedZipRow | null {
  if (!/^\d{5}$/.test(zip)) return null;
  return loadLedger()?.zips[zip] ?? null;
}

/**
 * The value that goes on a sold row.
 *
 * Returns `UNKNOWN` — never a tier — when the zip is absent, malformed, or
 * the ledger is unreadable. A zip with no ZCTA genuinely has no stamped tier,
 * and saying `TIER_0` about it would assert that we looked at its governments
 * and found none, which is a different and false statement.
 */
export function coverageTierForZip(zip: string | null | undefined): CoverageTierOrUnknown {
  if (!zip) return COVERAGE_TIER_UNKNOWN;
  return stampedRowForZip(zip)?.tier ?? COVERAGE_TIER_UNKNOWN;
}

/**
 * THE DISTRIBUTION THAT GOES ON A SOLD ROW, for a zip (item 3.1).
 *
 * Never inferred: it is read from the stamped ledger, and a zip with no stamp
 * returns null, which the caller encodes as UNKNOWN.
 */
export function tierDistributionForZip(
  zip: string | null | undefined,
): GovernmentTierDistribution | null {
  if (!zip) return null;
  return stampedRowForZip(zip)?.governmentTierDistribution ?? null;
}

/**
 * The same, for a set of OCD division ids — what the reaction write path
 * holds.
 *
 * SUMMED OVER DIVISIONS, and the double-counting that implies is real and
 * stated: two divisions in one view can share a government, and this ledger
 * cannot tell which. It is a count of government-to-division relationships in
 * view, not of distinct governments, and it is the same unit for every row so
 * it stays comparable. Rows whose divisions carry no stamp return null, which
 * becomes UNKNOWN — never zeros.
 */
export function tierDistributionForOcdIds(
  ocdIds: string[],
): GovernmentTierDistribution | null {
  const ledgerNow = loadLedger();
  if (!ledgerNow) return null;
  const rows = ocdIds
    .map((id) => ledgerNow.ocdDistributions[id])
    .filter((d): d is [number, number, number, number] => Array.isArray(d));
  if (rows.length === 0) return null;
  return {
    TIER_0: rows.reduce((n, d) => n + d[0], 0),
    TIER_1: rows.reduce((n, d) => n + d[1], 0),
    TIER_2: rows.reduce((n, d) => n + d[2], 0),
    TIER_3: rows.reduce((n, d) => n + d[3], 0),
  };
}

/**
 * The tier for a set of OCD division ids, for callers that have divisions
 * rather than a zip — which is what the reaction write path holds.
 *
 * Takes the FLOOR across the zips it can resolve, matching how a zip's own
 * tier is the floor across its governments: a reader looking at a view that
 * spans a well-covered zip and a bare one saw the bare one too.
 */
export function coverageTierForZips(zips: string[]): CoverageTierOrUnknown {
  const tiers = zips
    .map((z) => stampedRowForZip(z)?.tier)
    .filter((t): t is CoverageTier => Boolean(t));
  if (tiers.length === 0) return COVERAGE_TIER_UNKNOWN;
  return tiers.reduce((lowest, t) => (RANK[t] < RANK[lowest] ? t : lowest));
}


/**
 * The tier for a set of OCD division ids — what the reaction write path holds.
 *
 * FLOOR, not maximum, and not an average. A reader whose map view spanned a
 * well-covered county and a bare one saw the bare one too, and a buyer
 * weighting this row needs to know that the page had gaps on it. Taking the
 * maximum would describe the best thing in view; averaging would invent a
 * tier that is not one of the four.
 *
 * `UNKNOWN` when nothing resolves — never `TIER_0`, which is a claim that we
 * looked at this place's governments and found none.
 */
export function coverageTierForOcdIds(ocdIds: string[]): CoverageTierOrUnknown {
  const ledgerNow = loadLedger();
  if (!ledgerNow) return COVERAGE_TIER_UNKNOWN;

  const tiers = ocdIds
    .map((id) => ledgerNow.ocdTiers?.[id])
    .filter((t): t is CoverageTier => Boolean(t));
  if (tiers.length === 0) return COVERAGE_TIER_UNKNOWN;
  return tiers.reduce((lowest, t) => (RANK[t] < RANK[lowest] ? t : lowest));
}
