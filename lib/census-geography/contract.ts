/**
 * THE CENSUS-GEOGRAPHY LOOKUP CONTRACT — the one shared typed schema between
 * the Census-geography lane (which produces it) and the Admin lane (which
 * consumes it). RULING 273 (carrying the old RULING 228): an interface between
 * independently built lanes is ONE shared typed schema, never prose.
 *
 * OWNERSHIP. This file is owned by the Census-geography session. The Admin
 * session imports it and builds its screens/fixtures against these types; it
 * does not edit this file. Changes are coordinated before they land so the
 * fixture and the published lookup never disagree.
 *
 * WHAT THIS DESCRIBES. For a selected geography (a congressional district, a
 * county, a metro/micro area, a state upper- or lower-chamber legislative
 * district, a place, or a county subdivision) it returns EVERY Census ZCTA that
 * lies wholly or partly inside it — regardless of how small the overlap is. It
 * is the possible-coverage map Admin uses for navigation, collection scope
 * previews, assignments, and geographic reporting.
 *
 * FOUR INVARIANTS, non-negotiable, enforced by the producer and relied on by
 * the consumer:
 *
 *  1. A ZCTA IS NOT A ZIP CODE (RULING 275). A ZCTA is the Census Bureau's
 *     approximation of a ZIP's delivery area built from census blocks; USPS
 *     ZIPs that are PO-box-only or single-site "unique" ZIPs have no ZCTA.
 *     Every result states its mapping method (`Provenance.method`), and USPS
 *     ZIPs with no ZCTA are reported by `reconcilePostalZips`, never silently
 *     dropped and never guessed to be PO boxes.
 *
 *  2. THE FIVE PRIMARY GROUPINGS ARE PARALLEL, NEVER NESTED. A ZCTA is in a
 *     congressional district AND (independently) a county AND (maybe) a metro
 *     area AND a state upper district AND a state lower district. These are
 *     alternative groupings over the same ZCTA universe; a consumer must never
 *     render them as one hierarchy.
 *
 *  3. UNKNOWN IS NEVER ZERO. Absence is typed (`LookupStatus`): a scope we have
 *     not published is `NOT_YET_PUBLISHED`, a thing outside Census ZCTA coverage
 *     is `NOT_IN_COVERAGE`, and a thing we cannot determine is `UNKNOWN`. An
 *     empty `overlaps` array is only ever returned with `status.kind === "OK"`,
 *     and only when the geography genuinely contains no ZCTA.
 *
 *  4. KEYS ARE STABLE AND VERSIONED. A geography is addressed by
 *     `(type, geoid, version)`. Membership is IMMUTABLE per version: a refresh
 *     that changes a geography's ZCTA set publishes a NEW version key; the old
 *     version key keeps resolving to the old membership so a consumer's
 *     historical assignments and spend attribution are never silently
 *     rewritten. This mirrors the production data plane's version pointer
 *     (RULING 289/290): `activePublishedVersion()` is that pointer.
 *
 * This lookup describes POSSIBLE coverage. It says which governments' territory
 * a ZCTA touches; it does not decide which government applies to a given
 * resident — that is address-based resolution, which is a different question
 * answered elsewhere.
 */

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

/**
 * A five-character Census ZCTA code, leading zeros preserved (e.g. "07866").
 * A string, always — never a number, because "07866" and "7866" are different
 * claims and only one of them is a ZCTA.
 */
export type Zcta5 = string;

/**
 * A five-digit USPS ZIP as entered by a user (e.g. "07866"). Distinct from a
 * ZCTA at the type level on purpose: not every ZIP is a ZCTA (invariant 1).
 */
export type UspsZip = string;

/**
 * A Census GEOID, leading zeros preserved, verbatim from the Census file. The
 * width depends on the layer: 4 for a congressional district (2-digit state
 * FIPS + 2-digit district), 5 for a county (state+county), 5 for a CBSA,
 * 3+3 for an SLDU/SLDL, 7 for a place (state+place), 10 for a county
 * subdivision (state+county+cousub). Never reformatted; it is the stable key.
 */
export type Geoid = string;

/**
 * An Open Civic Data division id, matching `OcdId` in lib/sources/types.ts
 * (kept as a plain string here so this contract has no imports). This is the
 * authoritative internal join key (RULING 275); the Admin lane maps
 * ZCTA/ZIP -> OCD division ids on its side to attach bodies. Present for the
 * layers that are governments (cd, county, sldu, sldl, place, county
 * subdivision); null for a CBSA, which is a statistical area with no OCD
 * division.
 *
 * Note the repo convention: GEOIDs keep leading zeros, but OCD-id district
 * NUMBERS are unpadded (`.../sldl:7`, not `.../sldl:007`).
 */
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

/* ------------------------------------------------------------------ *
 * Geography types
 * ------------------------------------------------------------------ */

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
  | "county_subdivision";

export const GEOGRAPHY_TYPES: readonly GeographyType[] = [
  "congressional_district",
  "county",
  "cbsa",
  "state_leg_upper",
  "state_leg_lower",
  "place",
  "county_subdivision",
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

/**
 * The stable address of a geography instance. This is the key the Admin lane
 * attaches bodies, assignments, and spend to.
 */
export interface GeographyKey {
  readonly type: GeographyType;
  readonly geoid: Geoid;
  readonly version: GeographyVersionKey;
}

/** A geography instance, with the descriptive fields a consumer renders. */
export interface GeographyRef extends GeographyKey {
  /** Canonical OCD division id, or null for a CBSA (no OCD division). */
  readonly ocdId: OcdId | null;
  /** Human label, e.g. "Arizona Congressional District 6 (119th Congress)". */
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

/* ------------------------------------------------------------------ *
 * Overlap semantics
 * ------------------------------------------------------------------ */

/** What an overlap `fraction` measures. `unknown` when no reliable share exists. */
export type FractionBasis = "area" | "population" | "housing" | "block" | "unknown";

export const FRACTION_BASES: readonly FractionBasis[] = [
  "area",
  "population",
  "housing",
  "block",
  "unknown",
];

/** One ZCTA's overlap with a geography. */
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

/* ------------------------------------------------------------------ *
 * Provenance and versions
 * ------------------------------------------------------------------ */

export interface Provenance {
  /** The Census file URLs the relationship was built from. */
  readonly sourceUrls: readonly string[];
  /** Vintage label, aligned with lib/registry SourceDataset where a DB division is involved. */
  readonly sourceDataset: string;
  /** The source filenames (relationship / block-assignment / delineation files). */
  readonly sourceFiles: readonly string[];
  /** SHA-256 of each source file, index-aligned with `sourceFiles`. */
  readonly sourceChecksums: readonly string[];
  /**
   * The mapping method, stated plainly (RULING 275). E.g. "Census 2020 ZCTA-to-
   * county relationship file (tab20)"; "derived by joining the 2020 ZCTA-to-
   * block relationship with the block assignment file for the 119th Congress".
   */
  readonly method: string;
  /** When the relationship was computed (ISO 8601). */
  readonly computedAt: string;
}

export interface GeographyVersion {
  readonly key: GeographyVersionKey;
  readonly type: GeographyType;
  /** Plan/delineation identity in prose: "119th Congress", "2023 OMB delineation". */
  readonly plan: string;
  /** The ZCTA tabulation vintage the overlaps were computed against (e.g. "2020"). */
  readonly zctaTabulation: string;
  /** What this version is the geography of: "current representation", "2026 general election", etc. */
  readonly effectiveFor: string;
  readonly provenance: Provenance;
}

/* ------------------------------------------------------------------ *
 * Typed status / absence — unknown is never zero
 * ------------------------------------------------------------------ */

export type LookupStatus =
  | { readonly kind: "OK" }
  /** We do not know. Never rendered as zero. */
  | { readonly kind: "UNKNOWN"; readonly note: string }
  /** Outside Census ZCTA coverage, or not a Census geography we carry. */
  | { readonly kind: "NOT_IN_COVERAGE"; readonly note: string }
  /** The dataset exists but this (type, version) scope has no active published version yet. */
  | { readonly kind: "NOT_YET_PUBLISHED"; readonly note: string };

export const LOOKUP_STATUS_KINDS = ["OK", "UNKNOWN", "NOT_IN_COVERAGE", "NOT_YET_PUBLISHED"] as const;

/** Common envelope fields present on every lookup response. */
export interface ResponseEnvelope {
  /** The active published version pointer id (RULING 289/290) this response was served from. */
  readonly publishedVersion: string;
  readonly status: LookupStatus;
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/** Result of the primary call: every ZCTA overlapping a grouping instance. */
export interface GroupingZctaResult extends ResponseEnvelope {
  readonly geography: GeographyRef;
  /** Every wholly-or-partly overlapping ZCTA, however small the overlap. */
  readonly overlaps: readonly ZctaOverlap[];
  /** Always equal to `overlaps.length` — stated N equals returned rows. */
  readonly count: number;
  readonly version: GeographyVersion;
}

/** One grouping a ZCTA belongs to, in the reverse lookup. */
export interface ZctaMembership {
  readonly geography: GeographyRef;
  readonly whole: boolean;
  readonly fraction: number | null;
  readonly fractionBasis: FractionBasis;
}

/** Result of the reverse call: every grouping a ZCTA touches, across all types. */
export interface ZctaGroupingsResult extends ResponseEnvelope {
  readonly zcta5: Zcta5;
  readonly memberships: readonly ZctaMembership[];
}

/** Result of enumerating every instance of a grouping type at a version. */
export interface GroupingEnumeration extends ResponseEnvelope {
  readonly type: GeographyType;
  readonly version: GeographyVersion;
  readonly instances: readonly GeographyRef[];
  /** Always equal to `instances.length`. */
  readonly count: number;
}

/** One USPS ZIP reconciled against Census ZCTA coverage. */
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

/**
 * The published-dataset manifest: what scopes are available and the active
 * pointer. Lets a consumer distinguish NOT_YET_PUBLISHED from genuinely empty.
 */
export interface DatasetManifest {
  readonly publishedVersion: string;
  readonly publishedAt: string;
  /** Every (type, version) scope that is published, with its instance count. */
  readonly scopes: readonly {
    readonly type: GeographyType;
    readonly version: GeographyVersionKey;
    readonly instanceCount: number;
    readonly zctaEdgeCount: number;
  }[];
  readonly versions: readonly GeographyVersion[];
}

/* ------------------------------------------------------------------ *
 * The lookup interface
 * ------------------------------------------------------------------ */

/**
 * The functions the Admin lane calls. Every method returns the active published
 * version pointer and a typed status; a store failure fails closed (it never
 * degrades to a stale or empty answer that reads as zero).
 */
export interface CensusGeographyLookup {
  /** The active published version pointer id (RULING 289/290). */
  activePublishedVersion(): Promise<string>;

  /** The published-dataset manifest: available scopes + versions + pointer. */
  manifest(): Promise<DatasetManifest>;

  /** Every geography version this dataset carries. */
  listVersions(): Promise<readonly GeographyVersion[]>;

  /**
   * Every instance of a grouping type at a version (the default version when
   * omitted). Drives Admin's grouping trees.
   */
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

/* ------------------------------------------------------------------ *
 * Small pure guards (no runtime dependencies)
 * ------------------------------------------------------------------ */

/** A well-formed five-digit code (ZCTA or ZIP), leading zeros allowed. */
export const FIVE_DIGIT = /^\d{5}$/;

export function isFiveDigit(value: string): boolean {
  return FIVE_DIGIT.test(value);
}

export function isGeographyType(value: string): value is GeographyType {
  return (GEOGRAPHY_TYPES as readonly string[]).includes(value);
}
