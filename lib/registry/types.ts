import type { OcdId } from "../sources/types.ts";
import type { Tier } from "../ocd/tiers.ts";

export type DivisionType = string;

export type BodyClass = string;

export type CoverageStatus =
  /** An adapter reads this body's calendar today. */
  | "LIVE"
  /** Hand-entered from a source someone read. */
  | "MANUAL"
  /** A usable source was located; no adapter reads it yet. */
  | "KNOWN_UNCOVERED"
  /** The ladder was walked and came back empty. A finding, not a default. */
  | "NO_SOURCE_FOUND"
  /** Nobody has looked yet. The derivation's default, and a real state. */
  | "NOT_ATTEMPTED";

// There is no blocked status: a closed route is recorded on its audit rung (`BLOCKED_TERMS` /
// `BLOCKED_ROBOTS`) and the next rung is attempted; a body is never marked blocked.

export type BodyOrigin =
  | "DERIVED_FROM_DIVISION_TYPE"
  | "SOURCED"
  | "USER_REPORTED"
  | "CURATED"
  // Bodies promoted by the descent and Census-of-Governments promotions. `lib/registry/promoted-bodies.json`
  // is validated against this union.
  | "PROMOTED_FROM_DESCENT_CANDIDATE"
  | "PROMOTED_FROM_CENSUS_OF_GOVERNMENTS"
  // A government the 2022 Census of Governments lists, registered on its Census division by the
  // REGISTRATION contract (`lib/registration/`). Nothing else about it has been sourced; unlike
  // PROMOTED_FROM_CENSUS_OF_GOVERNMENTS, no reported website was checked.
  | "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS"
  // A territory's government: TIGER/Line 2023 gives this division a governing functional status (A, B, C
  // or G), and nothing else about the government has been sourced.
  | "REGISTERED_FROM_TIGER_FUNCSTAT";

export type AgendaSourceType =
  | "LEGISTAR"
  | "DILIGENT"
  | "CIVICWEB"
  | "CIVICPLUS"
  | "APPTEGY"
  | "ONBASE"
  | "IQM2"
  | "REVIZE"

  | "CLERKSBOARDS"

  | "CIVICCLERK"

  | "BOARDBOOK"
  /** BoardDocs public committee meeting list and per-meeting agenda page. */
  | "BOARDDOCS"
  | "MUNICODE"
  | "ESCRIBE"

  | "SCHEDULEPAGE"

  | "PIMA_EDU"

  | "SMARTSITES"

  | "TUSD_GOVBOARD"

  | "OFFICIAL_PAGE_EVENTS"

  | "DOCUMENT_LISTING"

  | "SUITEONE"
  | "PRIMEGOV"
  | "NOVUSAGENDA"
  | "SIMBLI"
  | "ICAL"
  | "RSS"
  | "HTML"
  | "PDF"
  | "MANUAL"
  | "NONE";

/** Which dataset a row came from, so a bad one can be retracted without taking everything with it. */
export type SourceDataset =
  | "CENSUS_RELATIONSHIPS"
  | "TIGER_GENZ2025"
  | "COG_2022"
  | "NCES"
  | "DERIVED"
  | "VENDOR_DISCOVERY"
  /** A government's own published directory of its bodies. */
  | "GOV_DIRECTORY"
  // `DESCENT`: a body a link descent reached and whose own page named it. `GUS_2022`: a government the
  // 2022 Census of Governments enumerates and whose reported website answered.
  | "DESCENT"
  | "GUS_2022"
  | "USER_REPORTED"
  // The 2023 Census cartographic boundary files (GENZ2023, 1:500k) that registration and the national ZIP
  // index share as retained geographic aliases.
  | "TIGER_CB2023"
  /** Full TIGER/Line 2023, read for its attribute table only: the territories' functional status. */
  | "TIGER_LINE2023"
  /** Census TIGERweb current map services, queried live by place (S9 place-first hunts); the saved query response is the source. */
  | "TIGERWEB_CURRENT";

export type CanonicalMatch =
  /** The identifiers are the same string. */
  | "exact"

  | "geoid"

  | "census_name"
  /** Same terminal segment, same state, different nesting. */
  | "high"
  /** Same terminal segment, several candidates. A review item, never a join. */
  | "low"
  /** Nothing corresponds. `canonicalGap` says what was established about why. */
  | "none";

export type CanonicalGap =
  /** Census FUNCSTAT S — a statistical entity, not a government. */
  | "NOT_A_GOVERNMENT"
  /** Census FUNCSTAT F — created only to fill the geographic hierarchy. */
  | "FICTITIOUS"
  /** Active government (FUNCSTAT A/B/C/G) absent from the canonical list. */
  | "GOVERNMENT_NOT_LISTED"
  /** FUNCSTAT is not published for this layer, so nothing can be established. */
  | "UNDETERMINED";

export interface RegistryProvenance {
  kind?: import("../control-plane/promotion/source-kinds.ts").SourceKind;
  sourceUrl: string | null;
  sourceOrg: string;
  collectedAt: string;
  verifiedAt: string | null;
}

export interface Division {
  /** Internal join key. Unique across the registry. */
  ocdId: OcdId;
  divisionType: DivisionType;
  tier: Tier;
  state: string;
  label: string;
  /** The containing division, where the identifier nests. */
  parentOcdId: OcdId | null;
  /** Census LSAD, on place and county-subdivision rows. */
  lsad: string | null;

  funcstat: string | null;
  /** Census class code. Names the duplicate directly — `C2`/`C5`/`C6`, `Z7`. */
  classfp: string | null;

  geoid: string | null;
  /** The canonical identifier, if one could be matched. */
  canonicalOcdId: OcdId | null;
  canonicalMatch: CanonicalMatch;
  /** Present exactly when `canonicalMatch` is `none`: what was established about why. See `CanonicalGap`. */
  canonicalGap?: CanonicalGap;
  sourceDataset: SourceDataset;
  provenance: RegistryProvenance;
}

export interface Body {
  fieldSources?: Record<string, import("../sources/types.ts").Provenance>;
  /** Stable within the registry: `<ocdId>#<slot>`. */
  id: string;

  ocdId: OcdId | null;

  alsoServesOcdIds?: readonly OcdId[];

  name: string | null;
  bodyClass: BodyClass;

  censusId?: string;
  /** The Census's own unit type for it, verbatim. */
  censusUnitType?: string;
  bodyOrigin: BodyOrigin;
  coverageStatus: CoverageStatus;
  agendaSourceType: AgendaSourceType;

  agendaSourceRef: string | null;
  /** When the body regularly meets, in its official page's own words; never computed into dates. */
  meetingCadence: string | null;
  /** The saved official page that states `meetingCadence`, when it is not the body's own source. */
  meetingCadenceSource?: { sourceUrl: string; collectedAt: string };
  homepageUrl: string | null;
  /** The body's office address, as its own page states it. Its source is the body's `provenance`. */
  officeAddress?: string;
  /** The body's office phone, as its own page states it. */
  officePhone?: string;

  demandCount: number;
  sourceDataset: SourceDataset;
  provenance: RegistryProvenance;
}

export interface Registry {
  generatedAt: string;
  divisions: Division[];
  bodies: Body[];
}
