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
  | "PRIVATE_ASSOCIATION"
  /** Run by an appointed head, not an elected one — NS07, RULING 118. */
  | "EXECUTIVE_AGENCY"
  /** A sovereign nation: neither federal nor state nor local — NS08, RULING 119. */
  | "SOVEREIGN_TRIBAL";

/**
 * How much we actually know about this body's meetings.
 *
 * This is what makes coverage silence distinguishable from civic silence. An
 * empty map reads as "your government does nothing"; the truth is usually "we
 * have no source for the bodies that govern here", and those are completely
 * different statements.
 *
 * **`NOT_ATTEMPTED` was added in 4.6.10 and it is the important one.** Until it
 * existed, `NO_SOURCE_FOUND` was the derivation's default for every body, so it
 * meant both "we walked the ladder and there is nothing to find" and "nobody
 * has ever looked" — and those demand opposite responses. `NO_SOURCE_FOUND` is
 * now a *claim* that may only be made from a `lib/registry/audit.ts` row
 * recording an exhausted hunt. A body with no audit row is `NOT_ATTEMPTED`.
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

// `SOURCE_BLOCKED` was removed 2026-08-13 under the public-records constraint
// (CLAUDE.md): a terminal "we gave up" state encoded in the schema is how
// giving up becomes routine. A route that is genuinely closed is recorded on
// its audit *rung* (`BLOCKED_TERMS` / `BLOCKED_ROBOTS`) and the next rung is
// attempted — the body itself is never marked blocked. The one body that
// carried it (Tucson) got a real hunt and is LIVE via OnBase.

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
  /*
   * **THE TWO PROMOTION ORIGINS, ADDED 2026-08-27 (NH232).**
   *
   * 731 rows in the committed registry already carried these values, and the
   * type did not have them. Both promotion scripts typed their own local
   * `RegistryBody` with `bodyOrigin: string`, so the compiler never compared
   * what they wrote against what the registry declares — which is a small part
   * of why nothing noticed when `pnpm registry:build` deleted every one of
   * those rows. The store that now owns them is
   * `lib/registry/promoted-bodies.json`, and it is validated against THIS
   * union rather than against a private copy of it.
   */
  | "PROMOTED_FROM_DESCENT_CANDIDATE"
  | "PROMOTED_FROM_CENSUS_OF_GOVERNMENTS"
  /*
   * **REGISTERED, NOT YET RESEARCHED (2026-09-23).** A government the 2022
   * Census of Governments lists, registered on the Census division that is its
   * territory by the runner's REGISTRATION contract (`lib/registration/`).
   * Nothing about it has been sourced beyond that: no name, no website, no
   * calendar. Unlike PROMOTED_FROM_CENSUS_OF_GOVERNMENTS, no reported website
   * was checked.
   */
  | "REGISTERED_FROM_CENSUS_OF_GOVERNMENTS"
  /*
   * **A TERRITORY'S GOVERNMENT, REGISTERED FROM ITS CENSUS STATUS
   * (2026-09-25).** The Census of Governments does not enumerate the five
   * territories; TIGER/Line 2023 gives this division a governing functional
   * status (A, B, C or G: docs/state.md §4.6 M17), and nothing else about
   * the government has been sourced.
   */
  | "REGISTERED_FROM_TIGER_FUNCSTAT";

/**
 * Which adapter can read this body's agendas. Open-ended by design.
 *
 * **`CIVICWEB` is not `CIVICPLUS`.** They are different companies with
 * confusingly similar names: CivicPlus builds CivicEngage and the AgendaCenter
 * (Rockaway Township NJ), while CivicWeb is iCompass, *a Diligent brand* —
 * its portal footer reads "© iCompass - A Diligent Brand" (Newbury NH). Folding
 * them together would point one adapter at two unrelated systems.
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
   * The City of Tucson Clerk's boards application at
   * `clerksboards.tucsonaz.gov` — server-rendered per-board pages carrying
   * the published meeting schedule, location, and current agenda. Named for
   * the host until it turns out to be a product other cities run.
   */
  | "CLERKSBOARDS"
  /**
   * CivicClerk — a meeting portal delivered as an embed script, whose tenant
   * slug the host page carries in `window.clerkEmbedProps` and whose own
   * public OData API answers an unauthenticated GET at
   * `https://<tenant>.api.civicclerk.com/v1/Events`. First tenant: the Central
   * Arizona Water Conservation District (2026-08-27).
   *
   * Kept distinct from `CIVICPLUS`, which is a different product from the same
   * corporate family: a reader following a CivicPlus agenda link would not
   * arrive here.
   */
  | "CIVICCLERK"
  /**
   * BoardBook Premier (Sparq Data Solutions) — school-board agenda portal at
   * `meetings.boardbook.org/Public/Organization/<id>`, server-rendered with
   * the full meeting archive, per-row venue name AND street address, and
   * public agenda/notice links. First tenant: Amphitheater USD (2026-08-18).
   */
  | "BOARDBOOK"
  /**
   * Not a vendor — a shape. The body publishes its whole year of meeting
   * dates as a list on its own page, with one sentence underneath naming the
   * time and the room. Ladder rung 2, no portal in the path, and how a very
   * large number of American school boards publish. First body: Morris Hills
   * Regional School District (2026-08-15, M78).
   */
  | "SCHEDULEPAGE"
  /**
   * Pima Community College's own publication of its Governing Board sittings
   * on `www.pima.edu` and `events.pima.edu` — named for the host, as
   * `CLERKSBOARDS` is, until it turns out to be a product other bodies run.
   * The college's agenda platform (a Diligent Community tenant) disallows this
   * client in `robots.txt`; this is the permitted route to the same sittings
   * (2026-09-23).
   */
  | "PIMA_EDU"
  /**
   * ParentSquare SmartSites — the school-district CMS whose calendar component
   * reads its own public JSON at `<site>/api/calendars/<id>/events`. First
   * tenant read: Sunnyside USD (2026-09-23). Built and recorded; not wired.
   */
  | "SMARTSITES"
  /**
   * Tucson Unified's Governing Board site, `govboard.tusd1.org`: the board
   * calendar's own month fragment (`/inflow/xti/inCal.aspx`) and the Board
   * Actions PDFs. Built and recorded 2026-09-23; not wired.
   */
  | "TUSD_GOVBOARD"
  /**
   * Not a vendor and not a schedule — dated public events a body publishes on
   * its OWN official page in whatever shapes it chose: schema.org JSON-LD or
   * microdata, linked `.ics`, embedded event state, event cards, dated
   * headings and "Next meeting <date>" statements. Every event is verified
   * against the body (official host, unambiguous in-window date, a title that
   * names the body) or held by name. First body: Tucson Unified's
   * reconfiguration page (2026-09-23). See `lib/sources/official-page-events`.
   */
  | "OFFICIAL_PAGE_EVENTS"
  /**
   * Not a vendor — a shape. A body's own agendas-and-minutes page, one page
   * per year, one link per document labelled with its sitting's kind and date
   * ("Regular Meeting 9-9-2026") under an "Agendas" or "Minutes" heading. One
   * sitting per kind per date, its agenda cited. First body: the City of
   * Holbrook, AZ City Council (2026-09-25). See `lib/sources/document-listing`.
   */
  | "DOCUMENT_LISTING"
  /**
   * SuiteOne Media meeting management — a hosted agenda portal at
   * `<tenant>.suiteonemedia.com` whose server-rendered home page lists the
   * next ten meetings and each body's past meetings with agenda, packet,
   * minutes and video. First tenant: the City of Winslow, AZ (2026-09-25).
   * See `lib/sources/suiteone`.
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
  /** A government's own published directory of its bodies — e.g. the Tucson
   *  City Clerk's Boards, Committees & Commissions listing. */
  | "GOV_DIRECTORY"
  /*
   * **THE TWO PROMOTION DATASETS, ADDED 2026-08-27 (NH232).**
   *
   * `DESCENT` is a body a link descent reached and whose own page named it;
   * `GUS_2022` is a government the 2022 Census of Governments enumerates and
   * whose reported website answered. 731 committed rows carried these values
   * while the union did not, because both promotion scripts typed their rows
   * against a local copy of `Body` with `sourceDataset: string`.
   */
  | "DESCENT"
  | "GUS_2022"
  | "USER_REPORTED"
  /*
   * **REGISTRATION'S GEOGRAPHY (2026-09-23).** The 2023 Census cartographic
   * boundary files (GENZ2023, 1:500k) that the registration reference and the
   * national ZIP index assign division ids from
   * (`scripts/lib/national-division-ids.mts`). Named for its own vintage
   * rather than filed under TIGER_GENZ2025.
   */
  | "TIGER_CB2023"
  /** Full TIGER/Line 2023, read for its attribute table only: the territories' functional status. */
  | "TIGER_LINE2023"
  /** Census TIGERweb current map services, queried live by place (S9 place-first hunts); the saved query response is the source. */
  | "TIGERWEB_CURRENT";

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
export type CanonicalMatch =
  /** The identifiers are the same string. */
  | "exact"
  /**
   * Matched on **Census GEOID**, which both sides carry and neither invents
   * (D24, 2026-08-17).
   *
   * The strongest match after an identical string, and stronger than `high`:
   * a GEOID is the Census Bureau's own primary key for the entity, so this is
   * a join on an identifier rather than on a name. It exists because the
   * canonical list nests differently from this repo — New Jersey places under
   * county, Arizona school districts under county — and slugs the same
   * government differently often enough that a tail comparison misses it.
   * `census_geoid` is a column of the canonical CSV; nothing here derives it.
   */
  | "geoid"
  /**
   * Built from the Census's own NAME field and then FOUND in the canonical
   * set (D24). Not a similarity match: the identifier is constructed from
   * published components and accepted only on exact membership. Today this
   * is New Hampshire's House districts alone, which the canonical list slugs
   * by county and number where this repo carries the Census SLDLST code.
   */
  | "census_name"
  /** Same terminal segment, same state, different nesting. */
  | "high"
  /** Same terminal segment, several candidates. A review item, never a join. */
  | "low"
  /** Nothing corresponds. `canonicalGap` says what was established about why. */
  | "none";

/**
 * Why a division has no canonical counterpart (D24, 2026-08-17).
 *
 * The row asked for the gap to be closed where a match exists and RECORDED
 * PER DIVISION where it does not, and this is that record. Every value is
 * read off a Census field this repo already carries — never inferred from a
 * name, and never a guess dressed as a category.
 *
 * `NOT_A_GOVERNMENT` and `FICTITIOUS` are not failures. A CDP is a
 * statistical area the Census draws so it can publish numbers for a populated
 * place with no government; nobody is elected to it and no canonical list
 * should carry it. A fictitious entity exists only to fill the geographic
 * hierarchy. Both are correctly absent, and saying so is the finding.
 *
 * `GOVERNMENT_NOT_LISTED` is the one that is a real gap, and it is a gap in
 * the CANONICAL LIST rather than here: an active general-purpose government,
 * with a boundary the Census publishes, that opencivicdata does not enumerate.
 * It is stated as what it is and never smoothed over.
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
   * The Census Bureau's own primary key for this entity (D24).
   *
   * Carried on every boundary feature and, until this row, dropped at the
   * registry build — which is why 348 divisions had no canonical counterpart
   * while the canonical list published a `census_geoid` column that would
   * have matched many of them exactly. Retained so the canonical join is on
   * an identifier and the whole reconciliation is re-derivable from an exact
   * key rather than from slug rules.
   */
  geoid: string | null;
  /** The canonical identifier, if one could be matched. */
  canonicalOcdId: OcdId | null;
  canonicalMatch: CanonicalMatch;
  /**
   * Present exactly when `canonicalMatch` is `none` — what was established
   * about why (D24). Never a guess; see `CanonicalGap`.
   */
  canonicalGap?: CanonicalGap;
  sourceDataset: SourceDataset;
  provenance: RegistryProvenance;
}

export interface Body {
  fieldSources?: Record<string, import("../sources/types.ts").Provenance>;
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
   * **THE OTHER DIVISIONS THIS ONE BODY ALSO GOVERNS.** (RULING 121, Sean's
   * decision of 2026-08-24, closing `NH33`.)
   *
   * A body id is `<ocdId>#<slot>`, which quietly assumed one body sits in one
   * division. Lake Todd Village District governs territory in Bradford AND
   * Newbury; the New London–Springfield Water System Precinct serves New London
   * AND Springfield. Each therefore shipped as TWO rows carrying the same name
   * — one body wearing two ids — and every count that walked the registry
   * counted them twice.
   *
   * **Filing each under one division only would be worse**, because it hides a
   * real body from readers in the other town, who are governed by it just the
   * same.
   *
   * So the body keeps ONE id, in its primary division, and lists the others
   * here. `bodiesAt` matches on either, so a reader in EITHER town sees it, and
   * a count that walks the registry sees ONE body.
   *
   * **This is the first pair of many.** Village districts, precincts, fire
   * districts and regional school committees routinely cross municipal lines,
   * and a product that reaches the smallest bodies (RULING 57) meets this
   * constantly.
   */
  alsoServesOcdIds?: readonly OcdId[];
  /**
   * **Null until sourced.** Names vary by state — supervisors in Arizona,
   * commissioners in New Jersey, select boards in New Hampshire — and minting a
   * plausible one is the same failure as a fabricated agenda URL, except it
   * gets read aloud. `bodyClass` carries what is actually known.
   */
  name: string | null;
  bodyClass: BodyClass;
  /**
   * **The Census's own id for this government, where the row came from an
   * official enumeration.** (Declared on the type 2026-08-27; 57 committed
   * rows have carried it since 2026-08-26.)
   *
   * RULING 9: the Census counts GOVERNMENTS and this product renders BODIES,
   * and they are not the same unit. Carrying the census id ON the row is what
   * keeps that disagreement inspectable rather than resolved by whichever
   * number was loaded last — so it belongs in the type, not only in the data.
   */
  censusId?: string;
  /** The Census's own unit type for it, verbatim. */
  censusUnitType?: string;
  bodyOrigin: BodyOrigin;
  coverageStatus: CoverageStatus;
  agendaSourceType: AgendaSourceType;
  /**
   * Where this body's agendas live, as a URL a reader can open.
   *
   * **Always a URL, never an adapter slug.** An adapter's own key for a client
   * — Legistar's `pima` — belongs in that adapter's registry, not here, because
   * the link ladder renders this field and a slug in an `href` is a dead link.
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
