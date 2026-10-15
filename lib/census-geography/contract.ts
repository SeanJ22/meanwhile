export type Zcta5 = string;

export type UspsZip = string;

/**
 * A Census GEOID, leading zeros preserved, verbatim from the Census file. The
 * width depends on the layer: 4 for a congressional district (2-digit state
 * FIPS + 2-digit district), 5 for a county (state+county), 5 for a CBSA,
 * 3+3 for an SLDU/SLDL, 7 for a place (state+place), 10 for a county
 * subdivision (state+county+cousub). Never reformatted; it is the stable key.
 */
export type Geoid = string;

/** Present for government layers, null for a CBSA. District numbers are unpadded (`sldl:7`). */
export type OcdId = string;

/**
 * The version key for a geography's plan/delineation, opaque-but-structured and
 * stable. Format `"<layer>:<plan>"`:
 *   - congressional district: `"cd:119"`, `"cd:120"`  (the Congress number)
 *   - county:                 `"county:2020"`, `"county:2023"`  (tabulation vintage)
 *   - CBSA (metro/micro):     `"cbsa:2023"`  (OMB delineation year)
 *   - state upper (SLDU):     `"sldu:2024"`  (TIGER release reflecting the plan)
 *   - state lower (SLDL):     `"sldl:2024"`
 *   - place:                  `"place:2020"`
 *   - county subdivision:     `"cousub:2020"`
 * A consumer treats it as an opaque token for equality and joins; the structure
 * is documented so it is legible, not so it is parsed.
 */
export type GeographyVersionKey = string;

/**
 * The geography layers this lookup covers. The first five are Admin's primary
 * groupings; `place` and `county_subdivision` are additional national coverage
 * this lane also builds (same contract shape) and are not among Admin's five.
 * A CBSA carries a required `cbsaClass` so metro and micro are always
 * distinguished and never merged.
 */
export type GeographyType =
  | "congressional_district"
  | "county"
  | "cbsa"
  | "state_leg_upper"
  | "state_leg_lower"
  | "place"
  | "county_subdivision"
  | "overlay_district"
  | "aiannh";

export const GEOGRAPHY_TYPES: readonly GeographyType[] = [
  "congressional_district",
  "county",
  "cbsa",
  "state_leg_upper",
  "state_leg_lower",
  "place",
  "county_subdivision",
  "overlay_district",
  "aiannh",
];

/** Admin's five primary groupings, in the order Admin renders them. */
export const PRIMARY_GROUPING_TYPES: readonly GeographyType[] = [
  "congressional_district",
  "county",
  "cbsa",
  "state_leg_upper",
  "state_leg_lower",
];

/** Metropolitan vs micropolitan — kept distinct, never merged. */
export type CbsaClass = "metropolitan" | "micropolitan";

/** Source boundaries reprojected to longitude/latitude for exact point lookup. */
export type GeographyGeometry =
  | { readonly type: "Polygon"; readonly coordinates: number[][][] }
  | { readonly type: "MultiPolygon"; readonly coordinates: number[][][][] };

export interface RepresentationGeography {
  readonly chamber?: "upper" | "lower";
  readonly representation?: "overlay" | "tribal";
  readonly geometry?: GeographyGeometry;
  readonly geometryRef?: import("./boundary-artifacts.ts").BoundaryArtifactRef;
  readonly sourceUrls?: readonly string[];
  readonly sourceOrg?: string;
}

export interface GeographyKey {
  readonly type: GeographyType;
  readonly geoid: Geoid;
  readonly version: GeographyVersionKey;
}

export interface GeographyRef extends GeographyKey, RepresentationGeography {
  /** Canonical OCD division id, or null for a CBSA (no OCD division). */
  readonly ocdId: OcdId | null;
  readonly label: string;
  /** Two-digit state FIPS, leading zeros preserved. */
  readonly stateFips: string;
  /** Two-letter USPS state/territory code, uppercased. */
  readonly stateAbbr: string;
  /**
   * Required for `type === "cbsa"`, absent otherwise: metro vs micro. A CBSA
   * must always carry this so a consumer can keep the two apart.
   */
  readonly cbsaClass?: CbsaClass;
  /**
   * States a multi-state geography spans (e.g. a metro area or a ZCTA-relevant
   * cross-state district), as two-letter codes including `stateAbbr`. A
   * single-state geography lists just its own. Cross-state relationships are
   * preserved, never clipped to one state.
   */
  readonly memberStates: readonly string[];
}

/** What an overlap `fraction` measures. `unknown` when no reliable share exists. */
export type FractionBasis = "area" | "population" | "housing" | "block" | "unknown";

export const FRACTION_BASES: readonly FractionBasis[] = [
  "area",
  "population",
  "housing",
  "block",
  "unknown",
];

export interface ZctaOverlap {
  readonly zcta5: Zcta5;
  /**
   * True when the ZCTA lies wholly inside the geography; false when it only
   * partly overlaps. Either way the ZCTA is returned — every wholly-or-partly
   * overlapping ZCTA is included, however small the overlap.
   */
  readonly whole: boolean;
  /**
   * The share of the ZCTA that lies inside the geography, in [0, 1], or null
   * when no reliable Census weight supports one. Never guessed. When `whole`
   * is true the fraction is 1 (or null if the basis is unavailable).
   */
  readonly fraction: number | null;
  /** What `fraction` measures; "unknown" exactly when `fraction` is null. */
  readonly fractionBasis: FractionBasis;
}

export interface Provenance {
  /** The Census file URLs the relationship was built from. */
  readonly sourceUrls: readonly string[];
  readonly sourceDataset: string;
  /** The source filenames (relationship / block-assignment / delineation files). */
  readonly sourceFiles: readonly string[];
  /** SHA-256 of each source file, index-aligned with `sourceFiles`. */
  readonly sourceChecksums: readonly string[];
  /** Transport validators for the exact source files; used to reuse held overlaps after a fresh source check. */
  readonly sourceValidators?: readonly {
    readonly url: string;
    readonly etag: string | null;
    readonly lastModified: string | null;
    readonly bytes: number | null;
  }[];
  /** Parser contract that produced these overlaps, checked before reusing them. */
  readonly parserVersion?: string;
  /** The mapping method, stated plainly. */
  readonly method: string;
  /** When the relationship was computed (ISO 8601). */
  readonly computedAt: string;
}

export interface GeographyVersion {
  /** States whose complete source files are held for this plan; omitted for a national source. */
  readonly states?: readonly string[];
  readonly key: GeographyVersionKey;
  readonly type: GeographyType;
  readonly plan: string;
  readonly stateFips?: string;
  readonly chamber?: "upper" | "lower";
  /** The ZCTA tabulation vintage the overlaps were computed against (e.g. "2020"). */
  readonly zctaTabulation: string;
  readonly effectiveFor: string;
  readonly applicability?: readonly import("./selection.ts").GeographyApplicability[];
  /** False means some requested source pages or state partitions are missing. */
  readonly retrievalComplete?: boolean;
  readonly provenance: Provenance;
}

export type LookupStatus =
  | { readonly kind: "OK" }
  /** We do not know. Never rendered as zero. */
  | { readonly kind: "UNKNOWN"; readonly note: string }
  /** Outside Census ZCTA coverage, or not a Census geography we carry. */
  | { readonly kind: "NOT_IN_COVERAGE"; readonly note: string }
  /** The dataset exists but this (type, version) scope has no active published version yet. */
  | { readonly kind: "NOT_YET_PUBLISHED"; readonly note: string };

export const LOOKUP_STATUS_KINDS = ["OK", "UNKNOWN", "NOT_IN_COVERAGE", "NOT_YET_PUBLISHED"] as const;

export interface ResponseEnvelope {
  readonly publishedVersion: string;
  readonly status: LookupStatus;
}

export interface GroupingZctaResult extends ResponseEnvelope {
  readonly geography: GeographyRef;
  readonly overlaps: readonly ZctaOverlap[];
  /** Always equal to `overlaps.length` — stated N equals returned rows. */
  readonly count: number;
  readonly version: GeographyVersion;
}

export interface ZctaMembership {
  readonly geography: GeographyRef;
  readonly whole: boolean;
  readonly fraction: number | null;
  readonly fractionBasis: FractionBasis;
}

export interface ZctaGroupingsResult extends ResponseEnvelope {
  readonly zcta5: Zcta5;
  readonly memberships: readonly ZctaMembership[];
}

export interface GroupingEnumeration extends ResponseEnvelope {
  readonly type: GeographyType;
  readonly version: GeographyVersion;
  readonly instances: readonly GeographyRef[];
  /** Always equal to `instances.length`. */
  readonly count: number;
}

export interface PostalZipReconciliation {
  readonly zip: UspsZip;
  /** True when a Census ZCTA of the same code exists. */
  readonly isZcta: boolean;
  /**
   * When `!isZcta`: why it is outside Census ZCTA coverage. Only ever
   * "not_a_census_zcta" (the observed fact) or "unknown" — never a guess that
   * it is a PO box, because that classification is not ours to invent.
   */
  readonly outsideCoverageReason: "not_a_census_zcta" | "unknown" | null;
}

export interface DatasetManifest {
  readonly publishedVersion: string;
  readonly publishedAt: string;
  readonly scopes: readonly {
    readonly type: GeographyType;
    readonly version: GeographyVersionKey;
    readonly instanceCount: number;
    readonly zctaEdgeCount: number;
  }[];
  readonly versions: readonly GeographyVersion[];
}

/**
 * The functions the Admin lane calls. Every method returns the active published
 * version pointer and a typed status; a store failure fails closed (it never
 * degrades to a stale or empty answer that reads as zero).
 */
export interface CensusGeographyLookup {
  activePublishedVersion(): Promise<string>;

  manifest(): Promise<DatasetManifest>;

  listVersions(): Promise<readonly GeographyVersion[]>;

  enumerateGroupings(
    type: GeographyType,
    version?: GeographyVersionKey,
  ): Promise<GroupingEnumeration>;

  /**
   * THE PRIMARY CALL. Every ZCTA wholly or partly overlapping a grouping
   * instance, with per-ZCTA whole/partly flag and labeled overlap fraction.
   */
  zctasForGrouping(key: GeographyKey): Promise<GroupingZctaResult>;

  /**
   * The reverse: every grouping instance a ZCTA touches, across all types.
   * The Admin lane uses this to deduplicate bodies/sources/charges across
   * overlapping groupings. `version` scopes the answer when supplied.
   */
  groupingsForZcta(
    zcta5: Zcta5,
    version?: GeographyVersionKey,
  ): Promise<ZctaGroupingsResult>;

  /**
   * Reconcile USPS ZIPs against Census ZCTA coverage: which are ZCTAs and which
   * are outside Census coverage (so Admin can render "outside Census coverage"
   * rather than dropping them). Never filters by PO-box labels.
   */
  reconcilePostalZips(zips: readonly UspsZip[]): Promise<readonly PostalZipReconciliation[]>;
}

/** A well-formed five-digit code (ZCTA or ZIP), leading zeros allowed. */
export const FIVE_DIGIT = /^\d{5}$/;

export function isFiveDigit(value: string): boolean {
  return FIVE_DIGIT.test(value);
}

export function isGeographyType(value: string): value is GeographyType {
  return (GEOGRAPHY_TYPES as readonly string[]).includes(value);
}
