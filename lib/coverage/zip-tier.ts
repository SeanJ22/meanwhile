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
};

type Ledger = {
  stampedAt: string;
  denominator: { zips: number; source: string };
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
};

/**
 * Loaded lazily and cached. The ledger is 33,791 rows and most requests never
 * need it; a top-level read would put it in every cold start.
 */
let ledger: Ledger | null = null;

export function loadLedger(): Ledger | null {
  if (ledger) return ledger;
  try {
    // The READ is lazy, not the import. `node:fs` costs nothing to import, and
    // an earlier draft deferred it with a CommonJS loader instead — which does
    // not exist in an ES module and would have thrown the first time a
    // reaction was written, inside a try/catch that would have reported the
    // throw as "no ledger". Caught by tests/package-module-type.test.ts.
    ledger = JSON.parse(
      readFileSync(join(process.cwd(), "data", "derived", "zip-coverage-tiers.json"), "utf8"),
    ) as Ledger;
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
