import type { OcdId } from "../sources/types.ts";
import type { Tier } from "../ocd/tiers.ts";

/**
 * Census layer a division's geometry came from. Accepted builder values come from the freshly loaded
 * kinds setting.
 */
export type DivisionType = string;

/**
 * What kind of body this is, so a reader can tell a school board from a private association. Accepted
 * builder values come from the freshly loaded kinds setting.
 */
export type BodyClass = string;

/**
 * How much we actually know about this body's meetings, so coverage silence is distinguishable from
 * civic silence. `NO_SOURCE_FOUND` is a claim that may only come from a `lib/registry/audit.ts` row
 * recording an exhausted hunt; a body with no audit row is `NOT_ATTEMPTED`.
 */
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

/**
 * Which adapter can read this body's agendas. Open-ended by design. `CIVICWEB` (iCompass, a Diligent
 * brand) is not `CIVICPLUS` (CivicEngage and AgendaCenter); folding them together would point one
 * adapter at two unrelated systems.
 */
export type AgendaSourceType =
  | "LEGISTAR"
  | "DILIGENT"
  | "CIVICWEB"
  | "CIVICPLUS"
  | "APPTEGY"
  | "ONBASE"
  | "IQM2"
  | "REVIZE"
  /**
   * A city clerk's boards application: server-rendered per-board pages carrying the published meeting
   * schedule, location and current agenda. Named for the host until it turns out to be a product other
   * cities run.
   */
  | "CLERKSBOARDS"
  /**
   * CivicClerk: a meeting portal delivered as an embed script, whose tenant slug the host page carries in
   * `window.clerkEmbedProps` and whose public OData API answers an unauthenticated GET at
   * `https://<tenant>.api.civicclerk.com/v1/Events`. Distinct from `CIVICPLUS`.
   */
  | "CIVICCLERK"
  /**
   * BoardBook Premier (Sparq Data Solutions): school-board agenda portal at
   * `meetings.boardbook.org/Public/Organization/<id>`, server-rendered with the full meeting archive,
   * per-row venue name and street address, and public agenda/notice links.
   */
  | "BOARDBOOK"
  /** BoardDocs public committee meeting list and per-meeting agenda page. */
  | "BOARDDOCS"
  | "PRIMEGOV"
  /**
   * Not a vendor; a shape. The body publishes its whole year of meeting dates as a list on its own page,
   * with one sentence naming the time and the room.
   */
  | "SCHEDULEPAGE"
  /**
   * A community college's own publication of its governing board sittings on its own hosts, named for
   * the host. Its agenda platform disallows this client in `robots.txt`; this is the permitted route to
   * the same sittings.
   */
  | "PIMA_EDU"
  /**
   * ParentSquare SmartSites: the school-district CMS whose calendar component reads its own public JSON
   * at `<site>/api/calendars/<id>/events`. Built; not wired.
   */
  | "SMARTSITES"
  /**
   * A school district's governing board site: the board calendar's own month fragment
   * (`/inflow/xti/inCal.aspx`) and the Board Actions PDFs. Built; not wired.
   */
  | "TUSD_GOVBOARD"
  /**
   * Dated public events a body publishes on its own official page in whatever shape it chose (JSON-LD,
   * microdata, linked `.ics`, event cards, dated headings, "Next meeting <date>"). Every event is verified
   * against the body or held by name. See `lib/sources/official-page-events`.
   */
  | "OFFICIAL_PAGE_EVENTS"
  /**
   * Not a vendor; a shape. A body's own agendas-and-minutes page, one page per year, one link per
   * document labelled with its sitting's kind and date. See `lib/sources/document-listing`.
   */
  | "DOCUMENT_LISTING"
  /**
   * SuiteOne Media meeting management: a hosted agenda portal at `<tenant>.suiteonemedia.com` listing
   * upcoming and past meetings with agenda, packet, minutes and video. See `lib/sources/suiteone`.
   */
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

/**
 * How well this repo's identifier matches the canonical OCD vocabulary. The identifiers here are the
 * internal join key, built from Census fields, and do not match `opencivicdata/ocd-division-ids`
 * everywhere; adopting the canonical shape wholesale would make some real governments unrepresentable.
 * The canonical identifier is carried alongside with a confidence. Anything below `high` is a review
 * item, not a join.
 */
export type CanonicalMatch =
  /** The identifiers are the same string. */
  | "exact"
  /**
   * Matched on Census GEOID, which both sides carry and neither invents: a join on the Census Bureau's own
   * primary key, stronger than `high`.
   */
  | "geoid"
  /**
   * Built from the Census's own NAME field and then found in the canonical set. Not a similarity match:
   * accepted only on exact membership.
   */
  | "census_name"
  /** Same terminal segment, same state, different nesting. */
  | "high"
  /** Same terminal segment, several candidates. A review item, never a join. */
  | "low"
  /** Nothing corresponds. `canonicalGap` says what was established about why. */
  | "none";

/**
 * Why a division has no canonical counterpart, read off a Census field this repo already carries.
 * `NOT_A_GOVERNMENT` and `FICTITIOUS` are correctly absent. `GOVERNMENT_NOT_LISTED` is a gap in the
 * canonical list: an active general-purpose government with a published boundary that opencivicdata does
 * not enumerate.
 */
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
  /**
   * Census functional status — the field that decides whether this polygon is
   * a government, and the one that resolves the place/cousub duplicate.
   *
   * `F` means Census created the row only to fill its geographic hierarchy: the
   * same government is already listed in the other layer. Joined in from
   * TIGER/Line, because the cartographic release drops it.
   */
  funcstat: string | null;
  /** Census class code. Names the duplicate directly — `C2`/`C5`/`C6`, `Z7`. */
  classfp: string | null;
  /**
   * The Census Bureau's own primary key for this entity, so the canonical join is on an identifier rather
   * than slug rules.
   */
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
  /**
   * The division this body is associated with: an association, not an identity. A body can exist without
   * being a division (e.g. a county-recognized area council).
   */
  ocdId: OcdId | null;
  /**
   * The other divisions this one body also governs. A body keeps one id in its primary division and lists
   * the others here; `bodiesAt` matches on either, so readers in every division see it and a count sees
   * one body.
   */
  alsoServesOcdIds?: readonly OcdId[];
  /**
   * Null until sourced. Names vary by state; minting a plausible one would be a fabrication. `bodyClass`
   * carries what is actually known.
   */
  name: string | null;
  bodyClass: BodyClass;
  /**
   * The Census's own id for this government, where the row came from an official enumeration. The Census
   * counts governments and this product renders bodies; carrying the id keeps that difference inspectable.
   */
  censusId?: string;
  /** The Census's own unit type for it, verbatim. */
  censusUnitType?: string;
  bodyOrigin: BodyOrigin;
  coverageStatus: CoverageStatus;
  agendaSourceType: AgendaSourceType;
  /**
   * Where this body's agendas live, as a URL a reader can open. Always a URL, never an adapter slug: the
   * link ladder renders this field.
   */
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
  /**
   * How many readers said this division applies to them. A bare count, never per person and never with an
   * identifier: a work queue for ingestion, not telemetry.
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
