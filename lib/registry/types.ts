import type { OcdId } from "../sources/types.ts";
import type { Tier } from "../ocd/tiers.ts";

/**
 * The division and body registry.
 *
 * This is the thing that was missing. The app had district polygons and it had
 * meetings, and **nothing connected them** — no list of which governing bodies
 * exist inside a division. So a point could resolve to Vail Unified School
 * District and the app still could not say that district has a governing board
 * that meets twice a month.
 *
 * The registry is *generated*, never hand-written. American local government is
 * structurally regular: a county has a board, an incorporated municipality has
 * a council, a school district has a governing board. That is a fact about the
 * shape of the division, and the division type is already in every committed
 * boundary file. Hand-enumeration does not reach 90,837 local governments; this
 * does.
 *
 * What it derives is *existence only*. A derived body's name, schedule, members
 * and agenda are all still unknown, and none of them may be inferred — see
 * `bodyOrigin`.
 */

/** Census layer a division's geometry came from. */
export type DivisionType =
  | "county"
  | "place"
  | "school_district"
  | "sldu"
  | "sldl"
  | "cd";

/**
 * What kind of body this is, so a reader can tell a school board from an HOA.
 *
 * `PRIVATE_ASSOCIATION` exists because Pima County's own meetings page lists
 * the Mount Lemmon Home Owners Association board alongside real government.
 * That is genuinely useful to a resident and genuinely not their government,
 * and the UI has to be able to say which.
 */
export type BodyClass =
  | "GOVERNING"
  | "ADVISORY"
  | "COMMISSION"
  | "REGIONAL"
  | "PRIVATE_ASSOCIATION";

/**
 * How much we actually know about this body's meetings.
 *
 * This is what makes coverage silence distinguishable from civic silence. An
 * empty map reads as "your government does nothing"; the truth is usually "we
 * have no source for the bodies that govern here", and those are completely
 * different statements.
 */
export type CoverageStatus =
  | "LIVE"
  | "MANUAL"
  | "KNOWN_UNCOVERED"
  | "NO_SOURCE_FOUND";

/**
 * Where this row's claim comes from.
 *
 * `DERIVED_FROM_DIVISION_TYPE` is a **structural** claim that a body exists —
 * this division is a school district, school districts have governing boards.
 * It is never a sourced claim about the body's name, schedule or members, and
 * the UI must not present it as one.
 */
export type BodyOrigin =
  | "DERIVED_FROM_DIVISION_TYPE"
  | "SOURCED"
  | "USER_REPORTED"
  | "CURATED";

/** Which adapter can read this body's agendas. Open-ended by design. */
export type AgendaSourceType =
  | "LEGISTAR"
  | "DILIGENT"
  | "CIVICPLUS"
  | "APPTEGY"
  | "PRIMEGOV"
  | "NOVUSAGENDA"
  | "SIMBLI"
  | "ICAL"
  | "RSS"
  | "HTML"
  | "PDF"
  | "MANUAL"
  | "NONE";

/**
 * Which dataset a row came from, so a bad one can be retracted without taking
 * everything with it.
 */
export type SourceDataset =
  | "TIGER_GENZ2025"
  | "COG_2022"
  | "NCES"
  | "DERIVED"
  | "VENDOR_DISCOVERY"
  | "USER_REPORTED";

/**
 * How well this repo's identifier matches the canonical OCD vocabulary.
 *
 * The identifiers here are the **internal join key**. They are built from
 * Census fields and they do not match `opencivicdata/ocd-division-ids`
 * everywhere: `state:az/school_district:*` matches none of its 194,977 rows,
 * New Jersey nests places under county where New Hampshire does not, and the
 * canonical list appears to omit New Jersey's townships entirely.
 *
 * Adopting the canonical shape wholesale would therefore make some real
 * governments — Rockaway Township, which has its own council — unrepresentable.
 * So the internal key stays authoritative and the canonical identifier is
 * carried alongside it with a confidence, which is the shape Phase 4.7.4
 * prescribes for national scale anyway. Anything below `high` is a review
 * item, not a join.
 */
export type CanonicalMatch = "exact" | "high" | "low" | "none";

export interface RegistryProvenance {
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
  /** The canonical identifier, if one could be matched. */
  canonicalOcdId: OcdId | null;
  canonicalMatch: CanonicalMatch;
  sourceDataset: SourceDataset;
  provenance: RegistryProvenance;
}

export interface Body {
  /** Stable within the registry: `<ocdId>#<slot>`. */
  id: string;
  /**
   * The division this body is **associated with** — an association, not an
   * identity. A body can exist without being a division: the Southeast Regional
   * Council is a county-recognized area council with no OCD division and never
   * will have one, and it is exactly the kind of hyperlocal meeting a resident
   * cares about most.
   */
  ocdId: OcdId | null;
  /**
   * **Null until sourced.** Names vary by state — supervisors in Arizona,
   * commissioners in New Jersey, select boards in New Hampshire — and minting a
   * plausible one is the same failure as a fabricated agenda URL, except it
   * gets read aloud. `bodyClass` carries what is actually known.
   */
  name: string | null;
  bodyClass: BodyClass;
  bodyOrigin: BodyOrigin;
  coverageStatus: CoverageStatus;
  agendaSourceType: AgendaSourceType;
  agendaSourceRef: string | null;
  meetingCadence: string | null;
  homepageUrl: string | null;
  /**
   * How many readers said this division applies to them. A bare count, never
   * per person and never with an identifier attached — it is a work queue for
   * ingestion, not telemetry about anybody.
   */
  demandCount: number;
  sourceDataset: SourceDataset;
  provenance: RegistryProvenance;
}

export interface Registry {
  generatedAt: string;
  divisions: Division[];
  bodies: Body[];
}
