/**
 * Looks up the stored coverage tier for a ZIP. It never computes a tier from
 * live data.
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
  /** Absent on a ledger written before the column existed. */
  governmentTierDistribution?: GovernmentTierDistribution;
};

/** The compact on-disk shape the read path actually loads. */
type RuntimeLedger = {
  stampedAt: string;
  tiers: CoverageTier[];
  denominator: { zips: number; source?: string };
  distribution: Record<string, number>;
  ocdTiers: Record<string, CoverageTier>;
  /** OCD division id -> distinct governments touching its zips at Tier 0, 1, 2, 3. */
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

/** The stamped government tiers counted rather than floored. Stored only; never shown to readers. */
export interface GovernmentTierDistribution {
  TIER_0: number;
  TIER_1: number;
  TIER_2: number;
  TIER_3: number;
}

/** Text encoding for the stored column. UNKNOWN, never zeros, when the distribution is unavailable. */
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
  /** OCD division id -> the stamped tier for that division. */
  ocdTiers: Record<string, CoverageTier>;
  ocdDistributions: Record<string, [number, number, number, number]>;
};

/**
 * Loaded lazily and cached. Read through process.cwd(), so next.config.ts must
 * list this file in outputFileTracingIncludes for every route that reaches it;
 * otherwise every ZIP silently reads UNKNOWN.
 */
const RUNTIME_FILE = "zip-coverage-tiers-runtime.json";

let ledger: Ledger | null = null;

export function loadLedger(): Ledger | null {
  if (ledger) return ledger;
  try {
    const raw = JSON.parse(
      readFileSync(join(process.cwd(), "data", "derived", RUNTIME_FILE), "utf8"),
    ) as RuntimeLedger;

    const zips: Record<string, StampedZipRow> = {};
    for (const [zip, t] of Object.entries(raw.zips)) {
      zips[zip] = {
        tier: raw.tiers[t[0]]!,
        stampedAt: raw.stampedAt,
        evidence: {
          // Resolved governments plus unresolved special districts.
          universeGovernments: t[1] + t[3],
          territoryResolved: t[1],
          bodiesEnumeratedFor: t[2],
          people: 0,
          peopleAtKellyDepth: 0,
        },
        unresolvedSpecialDistrictsInCounties: t[3],
        edges: [],
        // An older four-number tuple has no distribution; it reads UNKNOWN, not zeros.
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
    // Callers turn a missing ledger into UNKNOWN, never TIER_0.
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

/** UNKNOWN, never TIER_0, when the zip is absent, malformed, or the ledger is unreadable. */
export function coverageTierForZip(zip: string | null | undefined): CoverageTierOrUnknown {
  if (!zip) return COVERAGE_TIER_UNKNOWN;
  return stampedRowForZip(zip)?.tier ?? COVERAGE_TIER_UNKNOWN;
}

/** Null for an unstamped zip; the caller encodes it as UNKNOWN. */
export function tierDistributionForZip(
  zip: string | null | undefined,
): GovernmentTierDistribution | null {
  if (!zip) return null;
  return stampedRowForZip(zip)?.governmentTierDistribution ?? null;
}

/**
 * Summed over divisions: a count of government-to-division relationships, not
 * distinct governments (two divisions can share a government). Null when no
 * division is stamped.
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

/** The floor tier across the zips that resolve. */
export function coverageTierForZips(zips: string[]): CoverageTierOrUnknown {
  const tiers = zips
    .map((z) => stampedRowForZip(z)?.tier)
    .filter((t): t is CoverageTier => Boolean(t));
  if (tiers.length === 0) return COVERAGE_TIER_UNKNOWN;
  return tiers.reduce((lowest, t) => (RANK[t] < RANK[lowest] ? t : lowest));
}

/** The floor tier across the divisions that resolve; UNKNOWN when none do. */
export function coverageTierForOcdIds(ocdIds: string[]): CoverageTierOrUnknown {
  const ledgerNow = loadLedger();
  if (!ledgerNow) return COVERAGE_TIER_UNKNOWN;

  const tiers = ocdIds
    .map((id) => ledgerNow.ocdTiers?.[id])
    .filter((t): t is CoverageTier => Boolean(t));
  if (tiers.length === 0) return COVERAGE_TIER_UNKNOWN;
  return tiers.reduce((lowest, t) => (RANK[t] < RANK[lowest] ? t : lowest));
}
