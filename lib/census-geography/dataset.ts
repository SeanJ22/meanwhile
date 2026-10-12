import type { CbsaClass, FractionBasis, GeographyType, GeographyVersion, RepresentationGeography } from "./contract.ts";

export interface BuiltOverlap {
  readonly zcta5: string;
  /** The ZCTA lies wholly inside the grouping (area share ≈ 1). */
  readonly whole: boolean;
  /** Area share in [0,1], or null when the ZCTA has no tabulated land area. */
  readonly fraction: number | null;
}

export interface BuiltGrouping extends RepresentationGeography {
  readonly geoid: string;
  readonly ocdId: string | null;
  readonly label: string;
  readonly stateFips: string;
  readonly stateAbbr: string;
  readonly cbsaClass?: CbsaClass;
  readonly memberStates: readonly string[];
  /** Every wholly-or-partly overlapping ZCTA, sorted by zcta5. */
  readonly overlaps: readonly BuiltOverlap[];
}

export interface BuiltScope {
  readonly type: GeographyType;
  readonly version: string;
  readonly versionMeta: GeographyVersion;
  /** The basis of every fraction in this scope (all rows share it). */
  readonly fractionBasis: FractionBasis;
  readonly groupings: readonly BuiltGrouping[];
  readonly instanceCount: number;
  readonly zctaEdgeCount: number;
}

export interface BuiltDataset {
  readonly formatVersion: 1;
  readonly builtAt: string;
  /**
   * What this build actually covers, in reader terms — e.g. "national, 4 of 7
   * geography types (CD119, county, SLDU2024, SLDL2024)". A priority batch
   * states its actual coverage and is never labelled national.
   */
  readonly coverage: string;
  /** District/source disagreements reported during acquisition; agreeing districts publish independently. */
  readonly sourceDiscrepancies?: readonly import("../overlay-geography/build.ts").SourceDiscrepancy[];
  readonly sourceFailures?: readonly GeographySourceFailure[];
  readonly scopes: readonly BuiltScope[];
  /**
   * Every Census ZCTA present in this build (union across scopes; the county
   * scope, when included, makes this the full ZCTA universe since every ZCTA
   * lies in some county). Used by `reconcilePostalZips` to tell a USPS ZIP that
   * is a ZCTA from one that is outside Census ZCTA coverage.
   */
  readonly zctaUniverse: readonly string[];
}

export interface GeographySourceFailure {
  readonly type: GeographyType;
  readonly sourceId: string;
  readonly version: string;
  readonly sourceUrls: readonly string[];
  readonly reason: string;
}
