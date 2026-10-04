import type { Body, BodyClass } from "./types.ts";
import { activeWiring, type BodySourceWiring } from "./source-wiring.ts";

/**
 * Bodies the boundary-file derivation cannot produce, curated from the
 * publishing government's own pages — trackers **D28** and **D29**.
 *
 * Two shapes live here, and they are the two the derivation structurally
 * cannot reach:
 *
 * 1. **Bodies with no Census division** (`ocdId: null`) — Pima Community
 *    College's district. Census enumerates no boundary for community college
 *    districts, and minting an OCD-ID is a national-scale convention decision
 *    (tracker D31) that must not happen ad hoc. The nullable `Body.ocdId` is
 *    the wiring path chosen for these; the body's `id` is minted
 *    under the documented `curated:` scheme below instead, and carries no
 *    claim of being a division.
 *
 * 2. **Additional bodies on a division that already has one** — the City of
 *    Tucson's boards, committees and commissions, enumerated verbatim from
 *    the City Clerk's own directory. One division, many bodies is the normal
 *    case nationally; the registry shape must never assume one body per
 *    division.
 *
 * Unlike derived rows, a curated row **may carry a name** — the name is read
 * off the publishing government's page cited in `provenance.sourceUrl`, which
 * makes it a sourced claim rather than a minted one. `bodyOrigin: "CURATED"`
 * is what distinguishes these rows, and `tests/registry-oracle.test.ts` holds
 * different invariants for each origin.
 *
 * **Id scheme:** rows attached to a division use `<ocdId>#<slot>` like every
 * derived row. Division-less rows use `curated:<state>/<slug>#<slot>` — the
 * `curated:` prefix says explicitly that the identifier is internal and is
 * not an OCD division. D31 owns reconciling these to a real convention.
 */

/** The Tucson City Clerk's directory — the page every board row cites. */
const TUCSON_BCC_DIRECTORY =
  "https://www.tucsonaz.gov/Departments/Clerks/Boards-Committees-Commissions/Boards-Commissions";

/** Per-board page host, server-rendered; found as the directory's embedded frame. */
const CLERKSBOARDS = "https://clerksboards.tucsonaz.gov/boards/?board=";

const TUCSON_OCD = "ocd-division/country:us/state:az/place:tucson";

/** Rockaway Township's own archive page — every board row below cites it. */
const ROCKAWAY_AGENDA_CENTER = "https://www.rockawaytownship.org/AgendaCenter";
const ROCKAWAY_OCD =
  "ocd-division/country:us/state:nj/county:morris/place:rockaway_township";

/** Wilmot's and New London's own sites — the source for their board rows. */
const WILMOT_OCD =
  "ocd-division/country:us/state:nh/county:merrimack/place:wilmot_town";
const NEW_LONDON_OCD =
  "ocd-division/country:us/state:nh/county:merrimack/place:new_london_town";

/** Springfield, NH — Sullivan County. Confirmed against registry.json. */
const SPRINGFIELD_OCD =
  "ocd-division/country:us/state:nh/county:sullivan/place:springfield_town";

/** Newbury's own site — the source for every board row below. */
/**
 * **THE THREE KEARSARGE MEMBER TOWNS THAT WERE COMPLETELY DARK** (NH Hunt 4,
 * 2026-08-21, item 3).
 *
 * Kearsarge Regional School District has seven member towns. Four of them had
 * bodies in this registry; Bradford, Sutton and Warner had NONE — not one
 * board, not one committee, not the select board. A reader at 03255 whose
 * district reaches into those towns could learn nothing about who governs
 * there, and it was not because the towns publish nothing. All three publish a
 * full boards index AND a live iCalendar feed, and the feeds carry 643, 1,312
 * and 439 events respectively. Nothing had ever asked them.
 */
const BRADFORD_OCD =
  "ocd-division/country:us/state:nh/county:merrimack/place:bradford_town";
const SUTTON_OCD =
  "ocd-division/country:us/state:nh/county:merrimack/place:sutton_town";
const WARNER_OCD =
  "ocd-division/country:us/state:nh/county:merrimack/place:warner_town";

/**
 * One row of a town's own boards index, plus what its calendar says about that
 * board. "sittings" and "upcoming" are COUNTS READ FROM THE FEED on
 * "collected", kept because a body wired with zero sittings and a body wired
 * with thirty are different facts and the row should not be able to hide which
 * it is. "status" follows from "sittings": a board the town's own calendar
 * files sittings under is LIVE; a board the index names and the calendar never
 * mentions is KNOWN_UNCOVERED — named and rendered, with its meeting source
 * still owed. It is never dropped for being quiet.
 */
interface TownBoardRow {
  slug: string;
  name: string;
  sittings: number;
  upcoming: number;
  status: "LIVE" | "KNOWN_UNCOVERED";
}

const NEWBURY_OCD =
  "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";

const COLLECTED = "2026-08-14";

/**
 * Every board, committee and commission the Clerk's directory lists, verbatim,
 * with its board id in the Clerk's own application. Read 2026-08-14; 56 rows.
 *
 * The third field marks joint city/county (or wider) bodies `REGIONAL`;
 * otherwise names containing "Commission" are `COMMISSION` and the rest are
 * `ADVISORY` — the directory's own framing is that these bodies "typically
 * serve in an advisory capacity to the Mayor and Council". The class is this
 * app's coarse UI bucket, not a legal characterization.
 */
const TUCSON_BOARDS: Array<[name: string, boardId: number, cls?: BodyClass]> = [
  ["1st Avenue Citizens' Corridor Planning Task Force (1ACCPTF)", 134],
  ["2017 Public Safety Tax Oversight Commission (PSTOC)", 125, "COMMISSION"],
  ["2018 Parks + Connections Bond Oversight Commission (PCBOC)", 128, "COMMISSION"],
  ["Agenda Committee", 136],
  ["Armory Park Historic Zone Advisory Board (APHZAB)", 9],
  ["Barrio Historico Historic Zone Advisory Board (BHHZAB)", 12],
  ["Board of Adjustment (BAJ)", 8, "COMMISSION"],
  ["Citizen's Commission on Public Service and Compensation (CCPSC)", 76, "COMMISSION"],
  ["Citizens' Water Advisory Committee (CWAC)", 23],
  ["City Magistrates Merit Selection Commission (CMMSC)", 18, "COMMISSION"],
  ["City of Tucson Deferred Compensation Plan Management Board (CEDCMB)", 25],
  ["Civil Service Commission (CSC)", 20, "COMMISSION"],
  ["Commission on Climate, Energy, and Sustainability (CCES)", 126, "COMMISSION"],
  ["Commission on Disability Issues (CODI)", 3, "COMMISSION"],
  ["Commission on Equitable Housing and Development (CEHD)", 131, "COMMISSION"],
  ["Commission on Food Security, Heritage, and Economy (CFSHE)", 122, "COMMISSION"],
  ["Community Police Advisory Review Board (CPARB)", 19],
  ["Complete Streets Coordinating Council (CSCC)", 130],
  ["Design Review Board (DRB)", 26],
  ["Economic and Workforce Development Selection Committee (EWDSC)", 108],
  ["El Presidio Historic Zone Advisory Board (EPHZAB)", 36],
  ["El Pueblo Housing Development", 135],
  ["Environmental Services Advisory Committee (ESAC)", 37],
  ["Fire Code Review Committee (FCRC)", 31],
  ["Fort Lowell Historic Zone Advisory Board (FLHZAB)", 39],
  ["Human Relations Commission (HRC)", 42, "COMMISSION"],
  ["Independent Audit and Performance Commission (IAPC)", 96, "COMMISSION"],
  ["Independent Oversight and Accountability Commission (IOAC)", 114, "COMMISSION"],
  ["Industrial Development Authority (IDA)", 43],
  ["Landscape Advisory Committee (LAC)", 44],
  ["Outdoor Lighting Code Committee (OLCC)", 32],
  ["Park Tucson Commission (PTC)", 57, "COMMISSION"],
  ["PARS 115 Trust Board (115 TRUST)", 132],
  ["Pima County/Tucson Women's Commission (PCTWC)", 50, "REGIONAL"],
  ["Planning Commission (PC)", 38, "COMMISSION"],
  ["Public Art and Community Design Committee (PACDC)", 49],
  ["Redistricting Advisory Committee (RAC)", 51],
  ["Self-Insured Health Benefits Trust (SHBT)", 129],
  ["Self-Insured Risk Trust Fund (TRUST)", 118],
  ["Small, Minority, and Women-Owned Business Commission (SMWBC)", 101, "COMMISSION"],
  ["Southern Arizona Education Council (SAEC)", 46, "REGIONAL"],
  [
    "Tucson Commission on Lesbian, Gay, Bisexual, Transgender, and Queer Issues (LGBTQ+)",
    40,
    "COMMISSION",
  ],
  ["Tucson Convention Center Commission (TCCC)", 15, "COMMISSION"],
  ["Tucson Fire Public Safety Personnel Retirement System Board (TFPSPRSB)", 58],
  ["Tucson Greens Committee (TGC)", 41],
  ["Tucson Parks and Recreation Commission (TPRC)", 63, "COMMISSION"],
  ["Tucson Police Public Safety Personnel Retirement System Board (TPPSPRSB)", 59],
  ["Tucson Supplemental Retirement System Board of Trustees (TSRS)", 28],
  ["Tucson Transit Advisory Committee (TTAC)", 133],
  ["Tucson-Pima County Bicycle Advisory Committee (TPCBAC)", 60, "REGIONAL"],
  ["Tucson-Pima County Historical Commission (TPCHC)", 61, "REGIONAL"],
  ["Tucson-Pima County Joint Consolidated Code Committee (TPCJCC)", 112, "REGIONAL"],
  ["Veterans' Affairs Committee (VAC)", 65],
  ["Water Service Area Review Board (WSARB)", 119],
  ["West University Historic Zone Advisory Board (WUHZAB)", 66],
  ["Zoning Examiner Hearings", 113],
];

/**
 * Boards a live adapter reads today (the clerksboards source).
 *
 * D29, WIDENED 2026-08-18 (g18) FROM 5 TO 24, and the widening needed no new
 * adapter code at all — which is the finding.
 *
 * ## What was actually measured
 *
 * All 51 `KNOWN_UNCOVERED` clerksboards bodies were fetched and their
 * published "5) Meeting Time" text run through the parser this repo already
 * ships (`expandSchedule`). Denominators, stated:
 *
 *   51 surveyed
 *   19 the existing parser understands  ← wired here
 *   32 it does not, and 30 of those are not a parser problem at all
 *
 * ## The 32, classified, because "unwired" is not one thing
 *
 * **30 publish no fixed schedule.** Their Meeting Time reads "Meets as
 * required" (28 of them), "Meets as required." or "To be provided." That is a
 * FINDING about the body, not a gap in our retrieval: a board that meets when
 * called has no calendar to wire, and its meetings are noticed individually.
 * They stay `KNOWN_UNCOVERED` because that is exactly what they are — we know
 * the body exists and we have no calendar for it — and nothing here may render
 * as "this board never meets".
 *
 * ## Re-measured 2026-08-18 (g19), and every one of the 56 is now accounted for
 *
 * All 56 board pages were fetched again and every published Meeting Time was
 * run through the grammars the parser ships TODAY, rather than carrying a
 * previous session's classification forward. **27 PARSEABLE, 29 DECLINED,
 * 27 + 29 = 56.** Three moved, and one of the three is the reason a count is
 * re-measured rather than inherited:
 *
 *  - **board 128**, "Quarterly basis: every 3 months on the 3rd Monday (Jan,
 *    Apr, Jul, and Oct) @ 5:30 p.m." — grammar C, months read from the
 *    parenthetical. Named as a gap by g18 and closed here.
 *  - **board 15**, "January 22, April 16, 2026 and July and October 2026 TBD
 *    @ 9:30 a.m." — grammar D. Its two dated sittings are behind us, so it
 *    expands to nothing in the serving window; the two TBD months yield no
 *    date at all, because a month the body has not scheduled is not a date.
 *  - **board 130**, "4th Wednesday of THE month @ 5:30 p.m." — this one was
 *    NOT a gap anybody had named. It is an ordinary Nth-weekday rule that the
 *    recurrence regex declined because it required the word "each", so it sat
 *    inside the "publishes no fixed schedule" bucket looking like a finding
 *    about the body when it was a finding about our own regex. One word.
 *
 * **So the earlier "30 publish no fixed schedule" was wrong by one, and the
 * true figure is 29** — 28 publishing "Meets as required" and 1 publishing
 * "To be provided." That IS a finding about those bodies: they have no
 * calendar to wire and their meetings are noticed individually. They stay
 * `KNOWN_UNCOVERED`, and nothing here may render as "this board never meets".
 *
 * ## Two of the 27 expand to nothing, and that is correct
 *
 * Board 43's enumerated dates (1/22 through 6/18/2026) and board 15's two
 * dated sittings are all behind us. Both are wired anyway: the schedule is
 * published and parseable, so "we have their calendar and it lists nothing
 * ahead" is a true statement we can now make, where `KNOWN_UNCOVERED` said
 * "we have not looked". An empty answer we can stand behind beats a shrug.
 *
 * ## Known and NOT fixed here — see the tracker
 *
 * Three of the 27 publish a restriction the parser reads past: board 40's
 * "September through May", and boards 58 and 59's "(except January it will be
 * 01/08/26 and July will be 07/09/26)". Neither produces a wrong date in
 * today's serving window, and both could. Recorded as a tracker row rather
 * than folded in here, and named so it is not rediscovered as a surprise.
  */
function liveBoardIds(wirings: readonly BodySourceWiring[]): ReadonlySet<number> {
  return new Set(
    wirings
      .filter((row) => row.ocdId === TUCSON_OCD && row.agendaSourceType === "CLERKSBOARDS")
      .map((row) => Number(row.config.boardId)),
  );
}

function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function classOf(entry: [string, number, BodyClass?]): BodyClass {
  if (entry[2]) return entry[2];
  return "ADVISORY";
}

function tucsonBoardRow(entry: [string, number, BodyClass?], live: ReadonlySet<number> = liveBoardIds(activeWiring())): Body {
  const [name, boardId] = entry;
  const pageUrl = `${CLERKSBOARDS}${boardId}`;
  return {
    id: `${TUCSON_OCD}#${slugOf(name)}`,
    ocdId: TUCSON_OCD,
    // Sourced: the name is the Clerk's own directory text, cited below.
    name,
    bodyClass: classOf(entry),
    bodyOrigin: "CURATED",
    coverageStatus: live.has(boardId) ? "LIVE" : "KNOWN_UNCOVERED",
    agendaSourceType: live.has(boardId) ? "CLERKSBOARDS" : "HTML",
    agendaSourceRef: pageUrl,
    meetingCadence: null,
    homepageUrl: pageUrl,
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY",
    provenance: {
      sourceUrl: TUCSON_BCC_DIRECTORY,
      sourceOrg: "City of Tucson Clerk",
      collectedAt: COLLECTED,
      verifiedAt: COLLECTED,
    },
  };
}

export const CURATED_BODIES: Body[] = [
  // ── D28: Pima Community College Governing Board ─────────────────────────
  // A real government with no Census division. Verified live Diligent tenant
  // (pima.community.highbond.com); the board's own pages publish the meeting
  // calendar, the District Office address, and the public-comment procedure.
  {
    id: "curated:az/pima-community-college#governing",
    ocdId: null,
    name: "Pima Community College Governing Board",
    bodyClass: "GOVERNING",
    bodyOrigin: "CURATED",
    coverageStatus: "LIVE",
    agendaSourceType: "DILIGENT",
    agendaSourceRef:
      "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/documents.html",
    meetingCadence: null,
    homepageUrl:
      "https://www.pima.edu/about-pima/leadership-policies/governing-board/index.html",
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY",
    provenance: {
      sourceUrl:
        "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/index.html",
      sourceOrg: "Pima Community College",
      collectedAt: COLLECTED,
      verifiedAt: COLLECTED,
    },
  },

  // ── D29: the Public Housing Authority of the City of Tucson ─────────────
  // Not in the Clerk's BCC directory — its meetings publish through the same
  // OnBase tenant as Mayor & Council, and its own agenda states the Mayor and
  // Council sit as the PHA Board of Commissioners in the M&C Chambers.
  {
    id: `${TUCSON_OCD}#public-housing-authority`,
    ocdId: TUCSON_OCD,
    name: "Public Housing Authority Board of Commissioners",
    bodyClass: "GOVERNING",
    bodyOrigin: "CURATED",
    coverageStatus: "LIVE",
    agendaSourceType: "ONBASE",
    agendaSourceRef: "https://tucsonaz.hylandcloud.com/221agendaonline",
    meetingCadence: null,
    homepageUrl: "https://tucsonaz.hylandcloud.com/221agendaonline",
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY",
    provenance: {
      // The 2026-08-18 PHA agenda, published by the Clerk on the tenant.
      sourceUrl:
        "https://tucsonaz.hylandcloud.com/221agendaonline/Documents/ViewDocument/agenda.pdf?meetingId=1981&documentType=1",
      sourceOrg: "City of Tucson Clerk",
      collectedAt: COLLECTED,
      verifiedAt: COLLECTED,
    },
  },

  // ── D29: every body in the Clerk's directory, verbatim ──────────────────
  ...TUCSON_BOARDS.map((entry) => tucsonBoardRow(entry)),

  // ── 3c (2026-08-17): special districts serving the four zips, from the
  // 2022 Census of Governments individual-units listing (the official
  // universe — the Layer 1 audit's denominator, docs/coverage-audit-by-
  // county.md). Every homepage below was fetch-verified 2026-08-17; the
  // recorded URL is the redirect-followed effective URL. Coverage is
  // NOT_ATTEMPTED — the existence claim is Census's, the agenda hunt is
  // still owed, and there is deliberately no way to record "gave up". ──────
  ...specialDistrictRows(),

  // ── The 85641 detective session (2026-08-27): the districts the county
  // BOARD IS. Four Pima County governments that a boundary-layer hunt could
  // never find, because three of them publish no boundary and the fourth
  // publishes its boundary as a subdivision plat. Each is a separate political
  // taxing subdivision with its own budget, its own resolution series and its
  // own District Board — and in every case that board is the Board of
  // Supervisors sitting as it. See `pima85641DistrictRows` below. ───────────
  ...pima85641DistrictRows(),

  // ── The 85641 detective session (2026-08-27): the board that rules on a
  // variance next door. Pima County has FIVE District Boards of Adjustment,
  // one per Supervisor district, each with five members appointed by that
  // Supervisor under A.R.S. 11-807. District 4 is 85641's, and its roster is
  // in `lib/registry/body-rosters.ts`, read off its own agenda because the
  // county's Boards of Adjustment page publishes a Members heading with
  // nothing under it. ───────────────────────────────────────────────────────
  pimaBoardOfAdjustmentDistrict4(),

  // ── The depth session (2026-08-15): Rockaway Township's other boards ────
  // One division, many bodies — the same shape as Tucson's, and the reason
  // 07866 read thin. The township's AgendaCenter enumerates exactly five
  // bodies as `<div class="listing" id="cat<N>">` blocks; the Township
  // Council was already a row, and these are the other four, named from the
  // page's own headings with the id bound to its heading in the DOM rather
  // than by document order.
  ...rockawayBoardRows(),

  // ── The truth session (2026-08-15): Newbury's land-use boards ───────────
  // One division, many bodies again — and the reason 03255 read as a town
  // with a single government. The CivicWeb portal the town buys carries only
  // the Selectboard; these three are on the town's own site, behind the host
  // that refuses this pipeline's ordinary client. The browser rung reached
  // them (M79).
  /**
   * **THE COUNTY DELEGATION** — Merrimack County's legislative body (NH Hunt,
   * 2026-08-20).
   *
   * Every member of the New Hampshire House elected from the county, sitting
   * together to appropriate the county budget. It is a real governing body
   * with its own chair, clerk, executive committee, published meeting notices
   * and Zoom link, and it is NOT the Board of Commissioners — a reader at
   * 03255 who wants to know who votes on the county budget is asking about
   * this body and would have found nothing here.
   *
   * The derivation cannot produce it: Census enumerates Merrimack County as
   * one government, and a county's legislative body is a state-law creature
   * with no boundary of its own. So it is curated, on the county's own page.
   */
  {
    id: "ocd-division/country:us/state:nh/county:merrimack#delegation",
    ocdId: "ocd-division/country:us/state:nh/county:merrimack",
    name: "Merrimack County Delegation",
    bodyClass: "GOVERNING" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: "KNOWN_UNCOVERED" as const,
    agendaSourceType: "HTML" as const,
    agendaSourceRef:
      "https://www.merrimackcounty.net/elected_officials/delegation/index.php",
    meetingCadence: null,
    homepageUrl:
      "https://www.merrimackcounty.net/elected_officials/delegation/index.php",
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl:
        "https://www.merrimackcounty.net/elected_officials/delegation/index.php",
      sourceOrg: "Merrimack County",
      collectedAt: "2026-08-20",
      verifiedAt: "2026-08-20",
    },
  },
  ...newburyBoardRows(),
  ...wilmotBoardRows(),
  ...newLondonBoardRows(),
  ...springfieldBoardRows(),
  ...bradfordBoardRows(),
  ...suttonBoardRows(),
  ...warnerBoardRows(),
  ...twigRows(),
  ...nhHunt5TwigRows(),
];

function newburyBoardRows(): Body[] {
  const collected = "2026-08-15";
  const rows: Array<{
    slug: string;
    name: string;
    path: string;
    live: boolean;
    /** Why not, in the reader's own terms. LIVE rows leave this null. */
    gap: string | null;
    /**
     * Where the body ACTUALLY publishes, when the town's menu entry is a
     * redirect off the town's own domain (NH Hunt, 2026-08-20). Absent means
     * the town's own path is the body's page, which is the normal case.
     */
    homepage?: string;
    /**
     * The day THIS row was read. The three original rows were read
     * 2026-08-15; the fourteen added by the NH Hunt were read 2026-08-20, and
     * stamping them all with one date would misdate provenance on eleven of
     * them (`CLAUDE.md`: a plausible date is not a date).
     */
    collectedAt?: string;
    /**
     * How this body's meetings are retrieved. The three land-use boards each
     * publish their own schedule page; the ten added by the NH Hunt come off
     * the TOWN'S OWN iCalendar feed, which carries all fourteen boards'
     * sittings in one document and had never been wired.
     */
    sourceType?: "SCHEDULEPAGE" | "ICAL";
  }> = [
    {
      slug: "planning-board",
      name: "Planning Board",
      path: "/planning-board",
      live: true,
      gap: null,
    },
    {
      slug: "conservation-commission",
      name: "Conservation Commission",
      path: "/conservation-commission",
      live: true,
      gap: null,
    },
    {
      // LIVE 2026-08-15 (the mobile round-two session). The venue hunt this
      // row was parked on closed, and not on a rung the last session had
      // walked: the board's own page carries a "Contact Info" pane whose
      // address block reads `937 Route 103, Newbury, NH 03255` behind a
      // Google-map link, under the town's own label "Newbury Offices". The
      // page TEXT never says it, which is why three reads of the agendas
      // missed it — the address lives in the map link, not in the prose. A
      // browser read confirmed it, and it is the meeting address for this
      // board and the Planning Board alike; the Planning Board's own
      // agendas say "Newbury Town Office" independently, which agrees.
      slug: "zoning-board-of-adjustment",
      name: "Zoning Board of Adjustment",
      path: "/zoning-board-adjustment",
      live: true,
      gap: null,
    },

    /*
     * ── THE TEN THE MENU HAD AND THE REGISTRY DID NOT (NH Hunt, 2026-08-20) ──
     *
     * `docs/zip-playbook.md` recorded fourteen Newbury boards on 2026-08-15,
     * read off the town's hover menu, with four wired and ten `NOT_ATTEMPTED`.
     * This is the session that walked them. The names and paths below are read
     * off the town's own `/boards` page and its `/sitemap.xml`, both retrieved
     * 2026-08-20, and the roster on each is in `lib/registry/body-rosters.ts`
     * with the page it came from.
     *
     * **The menu was an UNDERCOUNT, and that is the finding.** The sitemap
     * carries three more bodies the hover menu never shows — Parks &
     * Recreation, the Housing Committee and the Transfer Station Committee —
     * so the town's own denominator is at least seventeen, not fourteen. Two
     * of those three are behind the site's own login and are recorded below as
     * exactly that.
     *
     * **Five of these are not on newbury.nh.gov at all.** The menu entry is a
     * redirect: the Energy Committee and the Beautification Committee run
     * their own domains, the Fire Department runs a subdomain, the Library
     * Trustees are on the library's own site, and the Joint Assessing Board is
     * hosted by the Town of SUNAPEE, because it is a joint board of three
     * towns and Sunapee is the one that publishes it. `homepageUrl` names
     * where the body actually publishes; the town's own path is what a reader
     * following the town's menu would click, and both are recorded.
     */
    {
      slug: "advisory-budget-committee",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "2026 Advisory Budget Committee",
      path: "/selectboard/2026-advisory-budget-committee",
      live: true,
      gap: null,
    },
    {
      slug: "blodgett-sewer-user-advisory-committee",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Blodgett Sewer User Advisory Committee",
      path: "/blodgett-sewer-user-advisory-committee",
      live: true,
      gap: null,
    },
    {
      slug: "cemetery-trustees",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Cemetery Trustees",
      path: "/cemetery-trustees",
      live: true,
      gap: null,
    },
    {
      slug: "joint-loss-management-committee",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Joint Loss Management Committee",
      path: "/joint-loss-management-committee",
      live: true,
      gap: null,
    },
    {
      slug: "septic-committee",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Newbury Septic Committee",
      path: "/newbury-septic-committee",
      live: true,
      gap: null,
    },
    {
      slug: "trustees-of-the-trust-funds",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Trustees of the Trust Funds",
      path: "/trustees-trust-funds",
      live: true,
      gap: null,
    },
    {
      // The town's menu entry 301s to the committee's OWN domain. Read
      // 2026-08-20 at rung 4 (curl followed the hop that every fetch client
      // in this repo could only report as a refusal).
      slug: "energy-committee",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Newbury Energy Committee",
      path: "/newbury-energy-committee",
      live: true,
      gap: null,
      homepage: "https://www.newburyenergynh.org/",
    },
    {
      slug: "beautification-committee",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Newbury Beautification Committee",
      path: "/newbury-beautification-committee",
      live: true,
      gap: null,
      homepage: "https://www.newburybeautification.org/",
    },
    {
      // A JOINT board of Newbury, Sunapee and New London, published by
      // Sunapee. Newbury's own menu links straight there.
      slug: "joint-assessing-board",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Joint Assessing Board (Newbury, Sunapee & New London)",
      path: "/joint-assessing-board-newbury-sunapee-new-london",
      live: true,
      gap: null,
      homepage: "https://www.sunapeenh.gov/joint-assessing-board",
    },
    {
      slug: "library-trustees",
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
      name: "Newbury Public Library Trustees",
      path: "/newbury-public-library-trustees",
      live: true,
      gap: null,
      homepage: "http://newburynhlibrary.net/",
    },
    /*
     * The two the sitemap names and the town does not publish. Both 302 to
     * `/user/login?destination=node/…` — the site's OWN access control, which
     * this product never authenticates past. That is a wall recorded on its
     * rung, not a body that does not exist: the town lists them in its own
     * sitemap, so they are real and they are unpublished.
     *
     * Rungs owed and not yet walked: 11 (the Internet Archive) and 9 (the
     * annual town report, which prints every committee's membership).
     */
    {
      /*
       * An ELECTED town body (RSA 654:22, RSA 669:17) that the town's own
       * boards menu does not list. Newbury publishes twenty-three of their
       * statutory checklist sessions on its calendar and names them nowhere
       * else, so the calendar IS the page — a constructed /supervisors-… path
       * would 404, and pointing at one would be a fabricated citation.
       */
      slug: "supervisors-of-the-checklist",
      name: "Supervisors of the Checklist",
      path: "/calendar/month",
      live: true,
      gap: null,
      collectedAt: "2026-08-20",
      sourceType: "ICAL",
    },
    {
      slug: "parks-recreation-committee",
      collectedAt: "2026-08-20",
      name: "Parks & Recreation Committee",
      path: "/parks-recreation-committee",
      live: false,
      gap: "The town's own site keeps this committee's page behind its login.",
    },
    {
      slug: "housing-committee",
      collectedAt: "2026-08-20",
      name: "Housing Committee",
      path: "/housing-committee",
      live: false,
      gap: "The town's own site keeps this committee's page behind its login.",
    },
  ];

  return rows.map((row) => ({
    id: `${NEWBURY_OCD}#${row.slug}`,
    ocdId: NEWBURY_OCD,
    // Sourced: the town's own page heading for `row.path`, read 2026-08-15
    // through the browser rung.
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: row.live ? ("LIVE" as const) : ("KNOWN_UNCOVERED" as const),
    agendaSourceType: row.live ? row.sourceType ?? "SCHEDULEPAGE" : "HTML",
    agendaSourceRef: row.homepage ?? `https://www.newbury.nh.gov${row.path}`,
    meetingCadence: null,
    homepageUrl: row.homepage ?? `https://www.newbury.nh.gov${row.path}`,
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: row.homepage ?? `https://www.newbury.nh.gov${row.path}`,
      sourceOrg: "Town of Newbury",
      collectedAt: row.collectedAt ?? collected,
      verifiedAt: row.collectedAt ?? collected,
    },
  }));
}

function rockawayBoardRows(): Body[] {
  const collected = "2026-08-15";
  const rows: Array<{
    slug: string;
    name: string;
    categoryId: string;
    /** LIVE rows are wired in SOURCE_WIRING; the others say why not. */
    live: boolean;
    homepage: string;
  }> = [
    {
      slug: "planning-board",
      name: "Planning Board",
      categoryId: "4",
      live: true,
      // Fetched 2026-08-15: 200, <h1>Planning Board</h1>.
      homepage: "https://www.rockawaytownship.org/212/Planning-Board",
    },
    {
      slug: "board-of-adjustment",
      name: "Board of Adjustment",
      categoryId: "3",
      live: true,
      // Fetched 2026-08-15: 200, <h1>Board of Adjustment</h1>.
      homepage: "https://www.rockawaytownship.org/211/Board-of-Adjustment",
    },
    {
      // The archive holds four 2019 sittings and nothing since; no calendar
      // feed in any probed category carries this body, and the township's
      // sitemap and staff directory carry no page for it at all (checked
      // 2026-08-15 — the only "Environmental" hit is a health-specialist
      // job title). KNOWN_UNCOVERED, not NO_SOURCE_FOUND: the archive IS a
      // located source, it is simply not one the served 90-day window can
      // render anything from. Its homepage is the archive, because that is
      // the only page the township publishes about this body.
      slug: "environmental-commission",
      name: "Environmental Commission",
      categoryId: "5",
      live: false,
      homepage: "https://www.rockawaytownship.org/AgendaCenter",
    },
    {
      // One archived sitting, 2022-03-30. Same reasoning as above, except
      // this one does have its own page.
      slug: "board-of-assessment-commissioners",
      name: "Board of Assessment Commissioners",
      categoryId: "7",
      live: false,
      // Fetched 2026-08-15: 200, <h1>Board of Assessment Commissioners</h1>.
      homepage:
        "https://www.rockawaytownship.org/505/Board-of-Assessment-Commissioners",
    },
  ];

  return rows.map((row) => ({
    id: `${ROCKAWAY_OCD}#${row.slug}`,
    ocdId: ROCKAWAY_OCD,
    // Sourced: the township's own AgendaCenter heading for category
    // `row.categoryId`, read 2026-08-15.
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: row.live ? ("LIVE" as const) : ("KNOWN_UNCOVERED" as const),
    agendaSourceType: row.live ? ("CIVICPLUS" as const) : ("HTML" as const),
    agendaSourceRef: ROCKAWAY_AGENDA_CENTER,
    meetingCadence: null,
    homepageUrl: row.homepage,
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: ROCKAWAY_AGENDA_CENTER,
      sourceOrg: "Rockaway Township",
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}

function specialDistrictRows(): Body[] {
  const GUS = "2022 Census of Governments government-units listing";
  const rows: Array<{
    slug: string;
    state: string;
    name: string;
    homepage: string;
    note?: string;
  }> = [
    // Pima — serve 85701 (RTA county-wide, Rio Nuevo downtown) and 85641
    // (the two fire districts covering the Vail area; JTED county-wide).
    {
      slug: "pima-regional-transportation-authority",
      state: "az",
      name: "Pima County Regional Transportation Authority Board",
      homepage: "https://rtamobility.com/",
    },
    {
      slug: "rio-nuevo-multipurpose-facilities-district",
      state: "az",
      name: "Rio Nuevo District Board of Directors",
      homepage: "https://rionuevo.org/",
    },
    {
      slug: "rincon-valley-fire-district",
      state: "az",
      name: "Rincon Valley Fire District Governing Board",
      homepage: "https://rinconvalleyfdaz.gov/",
    },
    {
      slug: "corona-de-tucson-fire-district",
      state: "az",
      name: "Corona de Tucson Fire District Governing Board",
      homepage: "https://www.coronafire.org/",
    },
    {
      slug: "pima-county-jted",
      state: "az",
      name: "Pima County Joint Technological Education District Governing Board",
      homepage: "https://pimajted.org/",
    },
    // Morris — serve 07866 (RVRSA's member municipalities include Rockaway
    // Township; the college, vocational district, and conservation district
    // are county-wide).
    {
      slug: "rockaway-valley-regional-sewerage-authority",
      state: "nj",
      name: "Rockaway Valley Regional Sewerage Authority Board",
      homepage: "https://rvrsa.org/",
    },
    {
      slug: "county-college-of-morris",
      state: "nj",
      name: "County College of Morris Board of Trustees",
      homepage: "https://www.ccm.edu/",
    },
    {
      slug: "morris-county-vocational-school-district",
      state: "nj",
      name: "Morris County Vocational School District Board of Education",
      homepage: "https://www.mcvts.org/",
    },
    {
      slug: "morris-county-soil-conservation-district",
      state: "nj",
      name: "Morris County Soil Conservation District Board",
      homepage: "https://mcscd.org/",
    },

  ];
  const collected = "2026-08-14";
  return rows.map((row) => ({
    id: `curated:${row.state}/${row.slug}#governing`,
    ocdId: null,
    name: row.name,
    bodyClass: "GOVERNING" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: "NOT_ATTEMPTED" as const,
    agendaSourceType: "NONE" as const,
    agendaSourceRef: null,
    meetingCadence: null,
    homepageUrl: row.homepage,
    demandCount: 0,
    sourceDataset: "COG_2022" as const,
    provenance: {
      sourceUrl: row.homepage,
      sourceOrg: `${GUS}; the body's own site`,
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}

/**
 * **THE DISTRICTS THE COUNTY BOARD IS** — Pima County governments serving
 * 85641 that no boundary layer names. (2026-08-27, the 85641 detective
 * session.)
 *
 * ## Why these were invisible
 *
 * `states/az/85641.md` recorded the Flood Control District, the Library
 * District and the two community facilities districts as LEADS, with the
 * reason: "county-wide or near-county-wide taxing districts whose boundaries
 * were not among the layers walked". Pima County's ArcGIS holds 34 services
 * and 281 layers and publishes a boundary for NONE of them.
 *
 * Three of the four never will, and that is not a gap in the county's
 * publishing — **their boundary is the county**, established by statute rather
 * than by a polygon:
 *
 * - **Library District** — A.R.S. 48-3901(A) establishes it "for the county
 *   and for all cities and towns within the county"; 48-3901(C): "The board of
 *   supervisors shall be the board of directors". 48-3903 levies its tax "upon
 *   all property in the county and upon all property within incorporated
 *   cities and towns in the county".
 * - **Stadium District** — A.R.S. 48-4202(A) authorises "a countywide district
 *   to include both the incorporated and unincorporated areas of the county";
 *   48-4202(D) makes the board of supervisors its board of directors in a
 *   county under 1.5 million; 48-4202(K) makes it "a tax levying public
 *   improvement district and a political taxing subdivision of this state".
 *   **The project did not know this class of government existed.**
 * - **Regional Flood Control District** — A.R.S. 48-3603(A): "a political
 *   taxing subdivision of this state". The district's own formation page says
 *   the 1978 legislation mandated one in every Arizona county, that they "were
 *   set up to be aligned with county boundaries", and that they levy secondary
 *   property taxes "on all parcels within their jurisdiction — not just
 *   properties with identified flood risks". The 1984 amendments let
 *   incorporated jurisdictions opt out of FLOODPLAIN REGULATION, which Tucson,
 *   Marana, Oro Valley and Sahuarita did; that is a regulatory opt-out and not
 *   a withdrawal from the district.
 *
 * The fourth, **Rocking K South CFD**, does have a boundary, and it is
 * published as a recorded subdivision plat rather than as a district: its
 * formation resolution recites "Blocks 1 through 14 of Rocking K South ...
 * Book 64 of Maps and Plats, Page 85", and all 25 recorded Rocking K South
 * plats in the county's own Subdivisions layer point-test inside ZCTA 85641.
 * `pnpm cfd:territory --zip 85641` re-runs that check. **Wildflower CFD is
 * deliberately NOT here**: the same route places its plat in ZCTA 85757, so a
 * lead this project had carried as "a strong lead" for 85641 is a false
 * positive, recorded as one.
 *
 * ## Why each has a District Board and no separate calendar
 *
 * Each is governed by the Board of Supervisors sitting as its board, so its
 * business appears on the county's Legistar calendar as its own hearings under
 * its own resolution series — RESOLUTION NO. 2026-RK1 "of the District Board
 * of Rocking K South Community Facilities District", the Library District,
 * Stadium District and Flood Control District final budgets each adopted as
 * separate hearings on 2026-06-04. That is why `agendaSourceRef` is the county
 * calendar for all four: it is not a placeholder, it is where these bodies
 * actually meet.
 */
function pima85641DistrictRows(): Body[] {
  const collected = "2026-08-27";
  const PIMA_LEGISTAR = "https://pima.legistar.com/Calendar.aspx";
  const PIMA_COUNTY = "ocd-division/country:us/state:az/county:pima" as Body["ocdId"];
  const rows: Array<{
    slug: string;
    name: string;
    homepage: string;
    authority: string;
    territory: string;
    /**
     * The division a reader is matched against (`resolveAt` joins on `ocdId`
     * and nothing else). `null` is not a shrug — it says this body's territory
     * has no division in this registry, and the row below says which.
     */
    ocdId: Body["ocdId"];
    wiring: string;
    /**
     * WHERE THIS BODY ACTUALLY MEETS — per row, not per function.
     *
     * The four districts the Board of Supervisors sits as have no calendar of
     * their own and their business is on the county's Legistar calendar, which
     * is a finding rather than a fallback. The Central Arizona Water
     * Conservation District is the opposite: it is directly elected, it holds
     * its own board meetings, and putting it on the county's calendar would
     * send a reader to the wrong room.
     */
    agenda:
      | { type: "LEGISTAR"; ref: string; status: "LIVE" }
      | { type: "CIVICCLERK"; ref: string; status: "LIVE" };
  }> = [
    {
      slug: "pima-rocking-k-south-cfd",
      name: "Rocking K South Community Facilities District Board",
      homepage: "https://www.pima.gov/1864/Rocking-K-South-Community-Facilities-Dis",
      authority:
        "A.R.S. 48-701 et seq.; formed by Pima County Resolution 2017-2 (2017-01-17), recorded as sequence 20170450755. The resolution makes the members of the Board of Supervisors the district's governing board ex officio.",
      territory:
        "Blocks 1 through 14 of Rocking K South, Book 64 of Maps and Plats, Page 85 — approximately 2,047 acres, wholly within unincorporated Pima County. All 25 recorded Rocking K South plats point-test inside ZCTA 85641. It LEVIES: Pima County Resolution 2026-43 (adopted 2026-08-17) sets its FY2026/27 secondary tax on a $38,682,735 valuation at 0.5000 for maintenance and operation and 1.8800 for bond indebtedness — $920,649 at a combined 2.3800.",
      ocdId: null,
      wiring:
        "NOT MATCHED AT A POINT, and that is a stated gap rather than a silent one. This district is 2,047 acres of platted subdivision inside unincorporated Pima County, and the registry holds no division that small. Attaching it to county:pima would show a district that taxes 2,047 acres to every reader in a 9,200-square-mile county — a false claim about their government, in the direction that looks like coverage. What closes it is a division carrying the plat geometry the cfd:territory instrument already resolves.",
      agenda: { type: "LEGISTAR" as const, ref: PIMA_LEGISTAR, status: "LIVE" as const },
    },
    {
      slug: "regional-flood-control-district",
      name: "Pima County Regional Flood Control District Board of Directors",
      homepage: "https://www.pima.gov/1427/Flood-Control",
      authority:
        "A.R.S. 48-3603; mandated in every Arizona county by 1978 legislation, with the county Board of Supervisors designated as the governing body.",
      territory:
        "aligned with the county boundary; levies a secondary property tax on all parcels within its jurisdiction. Tucson, Marana, Oro Valley and Sahuarita administer their own floodplain regulation under the 1984 amendments, which is a regulatory opt-out rather than a withdrawal from the district.",
      ocdId: PIMA_COUNTY,
      wiring:
        "county:pima is not an approximation. The district's own formation page says the 1978 legislation mandated one in every Arizona county and that the districts were set up to be aligned with county boundaries.",
      agenda: { type: "LEGISTAR" as const, ref: PIMA_LEGISTAR, status: "LIVE" as const },
    },
    {
      slug: "free-library-district",
      name: "Pima County Free Library District Board of Directors",
      homepage: "https://www.library.pima.gov/",
      authority:
        "A.R.S. 48-3901(C): the board of supervisors shall be the board of directors of the county free library district.",
      territory:
        "A.R.S. 48-3903 levies the district tax upon all property in the county and upon all property within incorporated cities and towns in the county.",
      ocdId: PIMA_COUNTY,
      wiring:
        "county:pima IS the statutory boundary — A.R.S. 48-3903 levies the tax upon all property in the county.",
      agenda: { type: "LEGISTAR" as const, ref: PIMA_LEGISTAR, status: "LIVE" as const },
    },
    {
      slug: "stadium-district",
      name: "Pima County Stadium District Board of Directors",
      homepage: "https://www.pima.gov/965/Stadium-District---Kino-Sports-Complex",
      authority:
        "A.R.S. 48-4202(A) and (D): a countywide district whose board of directors, in a county under 1,500,000 people, is the county board of supervisors. 48-4202(K) makes it a tax levying public improvement district and a political taxing subdivision of the state.",
      territory:
        "countywide, including both the incorporated and unincorporated areas of the county (A.R.S. 48-4202(A)).",
      ocdId: PIMA_COUNTY,
      wiring:
        "county:pima IS the statutory boundary — A.R.S. 48-4202(A) authorises a COUNTYWIDE district including both the incorporated and unincorporated areas of the county.",
      agenda: { type: "LEGISTAR" as const, ref: PIMA_LEGISTAR, status: "LIVE" as const },
    },
    {
      slug: "central-arizona-water-conservation-district",
      name: "Central Arizona Water Conservation District Board of Directors",
      homepage: "https://www.cap-az.com/board/board-members/",
      authority:
        "a multi-county water conservation district, and the only body here whose board is DIRECTLY ELECTED rather than the Board of Supervisors sitting as it. Fifteen members, elected by county — Maricopa 10, Pima 4, Pinal 1, which is the board's statutory composition. All fifteen members' own pages state a county, read 2026-08-27: the Pima four are Karen Cesare, Pat Jacobs, Justin Manuel and Mark Taylor. (An earlier read recorded only three confirmed Pima members and four pages stating no county; re-reading the pages corrected both. The roster is wired in data/states/az/officials/cawcd-rosters.json.)",
      territory:
        "it taxes every parcel in Pima County: Pima County Resolution 2026-43 levies its ad valorem secondary at 0.1000 and its water storage secondary at 0.0400 on the county's full $12,350,762,412 valuation, plus groundwater replenishment charged per acre-foot and per lot. That is how this district was found at all — it appears in no Pima County directory and on no boundary layer this project has walked.",
      ocdId: PIMA_COUNTY,
      wiring:
        "county:pima UNDER-serves rather than over-serves, deliberately. The district also covers Maricopa and Pinal, so a reader there is governed by it and will not see it — but this product covers neither county, and the alternative (no division at all) would hide it from the readers it does cover. When Maricopa or Pinal is added, this row takes alsoServesOcdIds.",
      agenda: {
        type: "CIVICCLERK" as const,
        ref: "https://capaz.portal.civicclerk.com",
        status: "LIVE" as const,
      },
    },
  ];

  /*
   * THE ID FORM FOLLOWS WHETHER THE BODY HAS A DIVISION.
   *
   * `Body` documents its id as `<ocdId>#<slot>`, and `tests/source-adapters`
   * holds the same invariant against every wiring row: an ocdId that is not
   * null must be the body id with the slot removed. A body that HAS a division
   * therefore takes the division form — the same shape Tucson's 56 boards use
   * under `place:tucson` — and only a division-less body falls back to
   * `curated:`, which is D28's case and Rocking K South's.
   */
  return rows.map((row) => ({
    id: row.ocdId ? `${row.ocdId}#${row.slug}` : `curated:az/${row.slug}#governing`,
    ocdId: row.ocdId,
    name: row.name,
    bodyClass: "GOVERNING" as const,
    bodyOrigin: "CURATED" as const,
    /*
     * The status is the ROW's, because the answer differs by row and averaging
     * them would be a claim about all five.
     *
     * LIVE for the four the Board of Supervisors sits as: the agenda hunt is
     * done for them. The county's Legistar tenant is already wired and each
     * district's own budget hearings and resolutions are in it — searched and
     * found, not assumed.
     *
     * LIVE for the Central Arizona Water Conservation District too, but by a
     * different route: it is directly elected and holds its own meetings, and
     * its CivicClerk tenant answers its own OData API. Sending its readers to
     * the county calendar would have sent them to the wrong room.
     */
    coverageStatus: row.agenda.status,
    agendaSourceType: row.agenda.type,
    agendaSourceRef: row.agenda.ref,
    meetingCadence: null,
    homepageUrl: row.homepage,
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: row.homepage,
      sourceOrg: `Pima County; ${row.authority} Territory: ${row.territory} Wiring: ${row.wiring}`,
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}

/**
 * **PIMA COUNTY BOARD OF ADJUSTMENT, DISTRICT 4** — 85641's variance board.
 * (2026-08-27.)
 *
 * COMMISSION rather than GOVERNING, and the distinction matters to the reader
 * rather than to a taxonomy: this board is APPOINTED by one Supervisor under
 * A.R.S. § 11-807, it rules on variances and interpretations of the zoning
 * code and issues temporary use permits, and it does not govern. The coverage
 * state deliberately does not turn on an unwired COMMISSION, because an
 * advisory or quasi-judicial board with no calendar must not read as a
 * government whose calendar is missing.
 *
 * KNOWN_UNCOVERED and not LIVE: its agendas are a list of CivicPlus documents
 * on `pima.gov/2792` rather than a calendar any adapter here reads. The
 * September 2026 agenda was read by hand for the roster, which is exactly why
 * this is recorded as uncovered rather than as done — one agenda read is not a
 * meeting source, and there is deliberately no way to record "gave up".
 */
function pimaBoardOfAdjustmentDistrict4(): Body {
  const PIMA = "ocd-division/country:us/state:az/county:pima";
  return {
    id: `${PIMA}#board-of-adjustment-district-4`,
    ocdId: PIMA as Body["ocdId"],
    name: "Pima County Board of Adjustment, District 4",
    bodyClass: "COMMISSION",
    bodyOrigin: "CURATED",
    coverageStatus: "KNOWN_UNCOVERED",
    agendaSourceType: "NONE",
    agendaSourceRef: "https://www.pima.gov/2792",
    // From the county's own page: "Second Tuesday of Each Month at 1:30 pm
    // (See Note)", the note being "Except as Noted".
    meetingCadence: "Second Tuesday of each month at 1:30 pm, except as noted",
    homepageUrl: "https://www.pima.gov/1027/Boards-of-Adjustment",
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY",
    provenance: {
      sourceUrl: "https://www.pima.gov/1027/Boards-of-Adjustment",
      sourceOrg:
        "Pima County Development Services. The county's page: 'There are five District Boards of Adjustment, one from each Board of Supervisors District. Each Supervisorial District appoints five members from their District. The Boards of Adjustment rule on variance and interpretation requests of the Pima County Zoning Code and approve the issuance of temporary use permits in accordance with the ARS Sec. 11-807 and Chapter 18.93, Section 18.101.050 of the Zoning Code.' Staff Planner for District 4: Matthew Bacal.",
      collectedAt: "2026-08-27",
      verifiedAt: "2026-08-27",
    },
  };
}

/**
 * Wilmot NH's three wired boards (M123, 2026-08-19).
 *
 * The Census derivation produces the TOWN and no board inside it, which is
 * D28's shape: a real government body with no division of its own. Each row's
 * name is the town's own — the board pages at `/board/<slug>/` head with these
 * exact words — and each `coverageStatus` is LIVE because the town's own
 * iCalendar feed files sittings under that board's name today.
 */
function wilmotBoardRows(): Body[] {
  const collected = "2026-08-19";
  /*
   * **NINE MORE, AND TWO OF THEM ARE ON NO MENU AT ALL** (NH Hunt 4,
   * 2026-08-21, item 3).
   *
   * Three boards were wired here on 2026-08-19 because three boards had
   * categories in the town's calendar feed. The town has twelve. Its own
   * /boards/ index names nine, and the feed's PAST view names two more that no
   * index in this town lists anywhere: a **Wilmot Safety Services Facility
   * Committee** and a **Transfer Station Advisory Group**, both meeting in
   * 2026. Neither would ever have been found by reading a menu.
   *
   * `coverage` says how each is reached. LIVE means the feed files sittings
   * under it today. KNOWN_UNCOVERED means the town's index names it and the
   * feed does not mention it — the body is named and rendered, and a meeting
   * source for it is still owed. It is never dropped for being quiet.
   */
  const rows: Array<{ slug: string; name: string; path: string; status: "LIVE" | "KNOWN_UNCOVERED" }> = [
    { slug: "selectboard", name: "Selectboard", path: "/board/board-of-selectmen/", status: "LIVE" },
    { slug: "planning-board", name: "Planning Board", path: "/board/planning-board/", status: "LIVE" },
    {
      slug: "cemetery-trustees",
      name: "Cemetery Trustees",
      path: "/board/cemetery-trustees/",
      status: "LIVE",
    },
    {
      slug: "conservation-commission",
      name: "Conservation Commission",
      path: "/board/conservation-commission/",
      status: "LIVE",
    },
    {
      slug: "master-plan-committee",
      name: "Master Plan Committee",
      path: "/boards/",
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "safety-services-facility-committee",
      name: "Wilmot Safety Services Facility Committee",
      path: "/boards/",
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "transfer-station-advisory-group",
      name: "Transfer Station Advisory Group",
      path: "/boards/",
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "zoning-board",
      name: "Zoning Board of Adjustment",
      path: "/board/zoning-board/",
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "supervisors-of-the-checklist",
      name: "Supervisors of the Checklist",
      path: "/board/supervisors-of-the-checklist/",
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "trustees-of-the-trust-funds",
      name: "Trustees of the Trust Funds",
      path: "/board/trustees-of-the-trust-funds/",
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "parks-and-recreation",
      name: "Parks and Recreation",
      path: "/community/parks-and-recreation/",
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "waste-reduction-advisory-committee",
      name: "Wilmot Waste Reduction Advisory Committee",
      path: "/community/wilmot-waste-reduction-committee/",
      status: "KNOWN_UNCOVERED",
    },
  ];
  return rows.map((row) => ({
    id: `${WILMOT_OCD}#${row.slug}`,
    ocdId: WILMOT_OCD,
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: row.status,
    agendaSourceType: "ICAL" as const,
    agendaSourceRef: "https://www.wilmotnh.org/events/list/?ical=1",
    meetingCadence: null,
    homepageUrl: `https://www.wilmotnh.org${row.path}`,
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: `https://www.wilmotnh.org${row.path}`,
      sourceOrg: "Town of Wilmot",
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}

/**
 * New London NH's four wired boards (M123, 2026-08-19).
 *
 * Named as the town's own calendar names them, because that calendar is the
 * source: "Board of Selectmen", "Planning Board", "Zoning Board",
 * "Conservation Commission" are the strings the town writes into its own
 * event titles, and the wiring matches on exactly those. Using a tidier name
 * here than the town uses there would put two vocabularies on one body.
 */
function newLondonBoardRows(): Body[] {
  const collected = "2026-08-19";
  /*
   * **TWELVE MORE OFF THE SAME CALENDAR** (NH Hunt 4, 2026-08-21, item 3).
   *
   * Four were wired on 2026-08-19. The town's own BOARDS & COMMITTEES menu and
   * its own calendar between them name sixteen, including an Archives
   * Committee that appears on the calendar and nowhere else, and a **Tri-Town
   * Assessing Board** that New London shares with Sunapee and Newbury and that
   * meets in the Sunapee town offices — a body whose meetings are held in a
   * different town from the one whose site publishes them.
   */
  const rows: Array<{ slug: string; name: string; path: string }> = [
    { slug: "board-of-selectmen", name: "Board of Selectmen", path: "/selectmen" },
    { slug: "planning-board", name: "Planning Board", path: "/planningboard" },
    { slug: "zoning-board", name: "Zoning Board", path: "/zoningboard" },
    {
      slug: "conservation-commission",
      name: "Conservation Commission",
      path: "/calendar",
    },
    { slug: "budget-committee", name: "Budget Committee", path: "/budget" },
    { slug: "energy-committee", name: "Energy Committee", path: "/energy" },
    { slug: "housing-commission", name: "Housing Commission", path: "/calendar" },
    { slug: "recreation-commission", name: "Recreation Commission", path: "/reccommission" },
    { slug: "board-of-firewards", name: "Board of Firewards", path: "/firewards" },
    { slug: "archives-committee", name: "Archives Committee", path: "/calendar" },
    {
      slug: "bicycle-pedestrian-advisory-committee",
      name: "Bicycle & Pedestrian Advisory Committee",
      path: "/calendar",
    },
    { slug: "citizens-committee", name: "Citizens' Committee", path: "/cac" },
    {
      slug: "trustees-of-the-trust-funds",
      name: "Trustees of the Trust Funds",
      path: "/calendar",
    },
    {
      slug: "tri-town-assessing-board",
      name: "Tri-Town Assessing Board (New London, Sunapee & Newbury)",
      path: "/calendar",
    },
    {
      slug: "supervisors-of-the-checklist",
      name: "Supervisors of the Checklist",
      path: "/calendar",
    },
    {
      slug: "capital-improvement-program",
      name: "Capital Improvement Program Committee",
      path: "/calendar",
    },
  ];
  return rows.map((row) => ({
    id: `${NEW_LONDON_OCD}#${row.slug}`,
    ocdId: NEW_LONDON_OCD,
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: "LIVE" as const,
    agendaSourceType: "SCHEDULEPAGE" as const,
    agendaSourceRef: "https://newlondon.nh.gov/calendar",
    meetingCadence: null,
    homepageUrl: `https://newlondon.nh.gov${row.path}`,
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: "https://newlondon.nh.gov/calendar",
      sourceOrg: "Town of New London",
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}

/**
 * **SPRINGFIELD, NH — a town that had NO bodies in this registry at all**
 * (NH Hunt 3, 2026-08-21, item 7).
 *
 * One of Kearsarge Regional School District's seven member towns, and one of
 * the six of those seven that were completely dark here. The town publishes
 * `springfieldnh.org/events/list/?ical=1`: 50 events naming these eight
 * governing bodies, read 2026-08-21 at rung 2, HTTP 200.
 *
 * **The branch was one request away.** Nothing had ever asked this town for a
 * calendar, and until something did, "we have no source for Springfield" was
 * our gap wearing the town's name. That is RULING 52's whole point applied to
 * a place rather than to a fact.
 *
 * ## Why these are KNOWN_UNCOVERED and not LIVE, which is the honest half
 *
 * **The iCal export is capped at the OLDEST 50 events and stops at
 * 2024-11-07.** Every view was tried on 2026-08-21 — `/events/list/`,
 * `/events/`, `/events/month/`, `/events/upcoming/`, `eventDisplay=list`
 * and `tribe-bar-date=2026-08-01` — and all six return the identical 50
 * events ending in November 2024. The plugin's REST API
 * (`/wp-json/tribe/events/v1/events`) answers 404.
 *
 * The town has NOT stopped meeting, and this may never be recorded as though it
 * had: its own front page links
 * `events/cemetery-trustees-meeting-2026-08-11/` and
 * `events/conservation-commission-meeting-2026-09-03/`. The current meetings
 * are in the HTML and no adapter here reads that shape for this town yet.
 *
 * So the bodies are enumerated and real — which IS coverage progress, because
 * the gap ledger can now see them — and the status says exactly what is true:
 * a usable source was located, and no adapter reads it. Wiring them to the
 * stale feed would have shipped eight bodies rendering as having no meetings
 * while the town publishes them, which is the empty-success shape this whole
 * session exists to end.
 *
 * Names are the town's OWN, taken from the feed's `SUMMARY` values, because
 * the wiring matches on exactly those — a tidier name here than the town uses
 * there would put two vocabularies on one body. "Town Meeting" and "Town
 * Elections" appear in the same feed and are deliberately absent: they are
 * events, not bodies.
 */
function springfieldBoardRows(): Body[] {
  const collected = "2026-08-21";
  const feed = "https://springfieldnh.org/events/list/?ical=1";
  const rows: Array<{ slug: string; name: string; sittings: number }> = [
    { slug: "select-board", name: "Select Board", sittings: 8 },
    { slug: "planning-board", name: "Planning Board", sittings: 8 },
    { slug: "zoning-board", name: "Zoning Board of Adjustment", sittings: 9 },
    { slug: "conservation-commission", name: "Conservation Commission", sittings: 4 },
    { slug: "library-trustees", name: "Library Trustees", sittings: 5 },
    { slug: "cemetery-trustees", name: "Cemetery Trustees", sittings: 5 },
    { slug: "trustees-of-the-trust-funds", name: "Trustees of the Trust Funds", sittings: 1 },
    { slug: "website-committee", name: "Website Committee", sittings: 6 },
  ];
  return rows.map((row) => ({
    id: `${SPRINGFIELD_OCD}#${row.slug}`,
    ocdId: SPRINGFIELD_OCD,
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: "KNOWN_UNCOVERED" as const,
    agendaSourceType: "SCHEDULEPAGE" as const,
    agendaSourceRef: "https://springfieldnh.org/events/",
    meetingCadence: null,
    homepageUrl: "https://springfieldnh.org/events/",
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: feed,
      sourceOrg: "Town of Springfield",
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}


/**
 * **BRADFORD, SUTTON AND WARNER, NH** (NH Hunt 4, 2026-08-21, item 3).
 *
 * Three of Kearsarge Regional School District's seven member towns, and the
 * three that had no bodies in this registry at all. Each town's list is its
 * OWN — read from the town's own boards index, then cross-read against the
 * town's own calendar feed, which in every case named bodies the index had
 * not: Bradford's index lists eight boards and its calendar files sittings for
 * a CIP Committee, a Hazard Mitigation Committee, a Facilities Use Committee
 * and an Independence Day Committee besides. **The menu is an undercount, and
 * it was an undercount at Newbury too.**
 *
 * Names are the town's own, as the feed writes them, because the wiring
 * matches on exactly those strings.
 *
 * **Warner's list includes the Warner Village Water District**, which is a
 * separate governing body with its own elected commissioners and its own
 * budget, and it is exactly the kind of twig this product exists to name.
 */
function bradfordBoardRows(): Body[] {
  const collected = "2026-08-21";
  const rows: TownBoardRow[] = [
    {
      slug: "select-board",
      name: "Select Board",
      sittings: 73,
      upcoming: 2,
      status: "LIVE",
    },
    {
      slug: "budget-committee",
      name: "Budget Committee",
      sittings: 35,
      upcoming: 1,
      status: "LIVE",
    },
    {
      slug: "cemetery-trustees",
      name: "Cemetery Trustees",
      sittings: 20,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "community-power-committee",
      name: "Community Power Committee",
      sittings: 2,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "conservation-commission",
      name: "Conservation Commission",
      sittings: 33,
      upcoming: 4,
      status: "LIVE",
    },
    {
      slug: "economic-development-committee",
      name: "Economic Development Committee",
      sittings: 19,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "energy-committee",
      name: "Energy Committee",
      sittings: 11,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "parks-and-recreation",
      name: "Parks and Recreation Committee",
      sittings: 9,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "planning-board",
      name: "Planning Board",
      sittings: 25,
      upcoming: 2,
      status: "LIVE",
    },
    {
      slug: "zoning-board",
      name: "Zoning Board of Adjustment",
      sittings: 10,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "cip-committee",
      name: "Capital Improvement Program Committee",
      sittings: 9,
      upcoming: 5,
      status: "LIVE",
    },
    {
      slug: "hazard-mitigation-committee",
      name: "Hazard Mitigation Committee",
      sittings: 19,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "facilities-use-committee",
      name: "Facilities Use Committee",
      sittings: 18,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "independence-day-committee",
      name: "Independence Day Committee",
      sittings: 6,
      upcoming: 5,
      status: "LIVE",
    },
    {
      slug: "supervisors-of-the-checklist",
      name: "Supervisors of the Checklist",
      sittings: 17,
      upcoming: 3,
      status: "LIVE",
    },
  ];
  return rows.map((row) => ({
    id: `${BRADFORD_OCD}#${row.slug}`,
    ocdId: BRADFORD_OCD,
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: row.status,
    agendaSourceType: "ICAL" as const,
    agendaSourceRef: "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
    meetingCadence: null,
    homepageUrl: "https://bradfordnh.gov/pages/boards-and-committees",
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: "https://bradfordnh.gov/pages/boards-and-committees",
      sourceOrg: "Town of Bradford",
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}

function suttonBoardRows(): Body[] {
  const collected = "2026-08-21";
  const rows: TownBoardRow[] = [
    {
      slug: "select-board",
      name: "Select Board",
      sittings: 548,
      upcoming: 9,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "planning-board",
      name: "Planning Board",
      sittings: 171,
      upcoming: 4,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "conservation-commission",
      name: "Conservation Commission",
      sittings: 152,
      upcoming: 4,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "zoning-board",
      name: "Zoning Board of Adjustment",
      sittings: 89,
      upcoming: 4,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "cemetery-commission",
      name: "Cemetery Commission",
      sittings: 9,
      upcoming: 2,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "budget-committee",
      name: "Municipal Budget Committee",
      sittings: 89,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "supervisors-of-the-checklist",
      name: "Supervisors of the Checklist",
      sittings: 5,
      upcoming: 1,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "trustees-of-the-trust-funds",
      name: "Trustees of the Trust Funds",
      sittings: 1,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "warner-river-local-advisory-committee",
      name: "Warner River Local Advisory Committee",
      sittings: 23,
      upcoming: 2,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "hazard-mitigation-committee",
      name: "Hazard Mitigation Committee",
      sittings: 3,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "website-committee",
      name: "Website Committee",
      sittings: 6,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "library-trustees",
      name: "Sutton Free Library Board of Trustees",
      sittings: 96,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "ad-hoc-waste-reduction-advisory-committee",
      name: "Ad Hoc Waste Reduction Advisory Committee",
      sittings: 8,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "ad-hoc-grist-mill-bridge-committee",
      name: "Ad Hoc Grist Mill Bridge Committee",
      sittings: 6,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "ad-hoc-fire-safety-municipal-building-committee",
      name: "Ad Hoc Fire Safety Municipal Building Committee",
      sittings: 12,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "ad-hoc-sutton-connects-committee",
      name: "Ad Hoc Sutton Connects! Committee",
      sittings: 13,
      upcoming: 5,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "ad-hoc-speed-sign-committee",
      name: "Ad Hoc Speed Sign Committee",
      sittings: 7,
      upcoming: 4,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "grist-mill-street-committee",
      name: "26 Grist Mill Street Committee",
      sittings: 20,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
  ];
  return rows.map((row) => ({
    id: `${SUTTON_OCD}#${row.slug}`,
    ocdId: SUTTON_OCD,
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: row.status,
    agendaSourceType: "ICAL" as const,
    agendaSourceRef: "https://www.suttonnh.gov/calendar/ical/calendar.ics",
    meetingCadence: null,
    homepageUrl: "https://www.suttonnh.gov/boards-committees",
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: "https://www.suttonnh.gov/boards-committees",
      sourceOrg: "Town of Sutton",
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}

function warnerBoardRows(): Body[] {
  const collected = "2026-08-21";
  const rows: TownBoardRow[] = [
    {
      slug: "select-board",
      name: "Select Board",
      sittings: 77,
      upcoming: 3,
      status: "LIVE",
    },
    {
      slug: "agricultural-commission",
      name: "Agricultural Commission",
      sittings: 3,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "auditor-search-committee",
      name: "Auditor Search Committee",
      sittings: 3,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "budget-committee",
      name: "Budget Committee",
      sittings: 44,
      upcoming: 15,
      status: "LIVE",
    },
    {
      slug: "cemetery-trustees",
      name: "Cemetery Trustees",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "chandler-reservation-committee",
      name: "Chandler Reservation Committee",
      sittings: 1,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "community-power-committee",
      name: "Community Power Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "conservation-commission",
      name: "Conservation Commission",
      sittings: 8,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "corridor-committee",
      name: "Corridor Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "economic-development-advisory-committee",
      name: "Economic Development Advisory Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "energy-solar-committee",
      name: "Energy/Solar Committee",
      sittings: 3,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "groundwater-protection-committee",
      name: "Groundwater Protection Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "highway-safety-committee",
      name: "Highway Safety Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "housing-advisory-committee",
      name: "Housing Advisory Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "housing-committee",
      name: "Housing Committee",
      sittings: 17,
      upcoming: 1,
      status: "LIVE",
    },
    {
      slug: "joint-loss-management-committee",
      name: "Joint Loss Management Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "mink-hills-recreation-committee",
      name: "Mink Hills Recreation Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "parks-and-recreation",
      name: "Parks and Recreation Commission",
      sittings: 14,
      upcoming: 4,
      status: "LIVE",
    },
    {
      slug: "planning-board",
      name: "Planning Board",
      sittings: 9,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "record-preservation-committee",
      name: "Record Preservation Committee",
      sittings: 0,
      upcoming: 0,
      status: "KNOWN_UNCOVERED",
    },
    {
      slug: "road-committee",
      name: "Road Committee",
      sittings: 4,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "supervisors-of-the-checklist",
      name: "Supervisors of the Checklist",
      sittings: 6,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "trustees-of-the-trust-funds",
      name: "Trustees of the Trust Funds",
      sittings: 3,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "warner-river-local-advisory-committee",
      name: "Warner River Local Advisory Committee",
      sittings: 2,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "warner-village-water-district",
      name: "Warner Village Water District",
      sittings: 2,
      upcoming: 0,
      status: "LIVE",
    },
    {
      slug: "zoning-board",
      name: "Zoning Board of Adjustment",
      sittings: 19,
      upcoming: 1,
      status: "LIVE",
    },
  ];
  return rows.map((row) => ({
    id: `${WARNER_OCD}#${row.slug}`,
    ocdId: WARNER_OCD,
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: row.status,
    agendaSourceType: "ICAL" as const,
    agendaSourceRef: "https://calendar.google.com/calendar/ical/4550fa96f9a1e211bad70b5ea77be1c4e926eeeb164d25bd76571e7de8251fcd%40group.calendar.google.com/public/basic.ics",
    meetingCadence: null,
    homepageUrl: "https://warnernh.gov/boards/",
    demandCount: 0,
    sourceDataset: "GOV_DIRECTORY" as const,
    provenance: {
      sourceUrl: "https://warnernh.gov/boards/",
      sourceOrg: "Town of Warner",
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}


/**
 * **THE TWIGS AT 03255** (NH Hunt 4, 2026-08-21, item 4; RULING 57).
 *
 * The trunk is the country, the branches are the states, and these are the
 * twigs: a village district that governs the shoreline of one lake, a water
 * precinct two towns share, a conservation district whose boundary is a
 * statute. Each one governs something for somebody, and if this product does
 * not name it, nobody else will.
 *
 * ## Two corrections this block makes to our own record
 *
 * **"No village district's boundary reaches Newbury" was WRONG**, and it was
 * written in this file as a settled audit note. The New Hampshire Office of
 * Business and Economic Affairs publishes a register of all ninety-one village
 * districts with their host municipalities, and it lists **Lake Todd Village
 * District twice — once under Bradford and once under NEWBURY**. The district's
 * own archived history page says the same in its own words. It governs part of
 * 03255 and it was not in this registry at all.
 *
 * **The Merrimack County Conservation District is NOT divisionless.** It shipped
 * with `ocdId: null` under the D28 shape, which meant `bodiesAt` — which filters
 * on `b.ocdId && ids.has(b.ocdId)` — could never return it for any point on
 * earth. RSA 432:12 says each county "is hereby incorporated into a conservation
 * district" whose "boundaries conform" to the county. That is a division, and it
 * is the county's. HUNT05 resolved this district to 03255 on 2026-08-21 and it
 * still did not render, because a resolution recorded in a derived file that
 * only the gap ledger reads is not a resolution a reader can see.
 *
 * ## One body, two divisions — the shape this registry cannot yet express
 *
 * Lake Todd's territory is Bradford AND Newbury; the New London-Springfield
 * Water System Precinct's is New London AND Springfield. A body id here is
 * `<division>#<slot>`, so each ships as one row per division it serves. They
 * are ONE body wearing two ids, not two districts, and the comment on each row
 * says so. A tracker row carries the shape question.
 */
function twigRows(): Body[] {
  const collected = "2026-08-21";
  const NH = "ocd-division/country:us/state:nh";
  const REGISTER =
    "https://www.nheconomy.com/getmedia/f087979c-98b8-41b5-a2e0-1808faaa8ffe/village-districts-locations-addresses.csv";
  const rows: Array<{
    division: string;
    /**
     * The OTHER divisions this one body also governs (RULING 121, 2026-08-24).
     * One body, one id, rendered under every town it covers.
     */
    alsoServes?: string[];
    slug: string;
    name: string;
    status: "LIVE" | "KNOWN_UNCOVERED";
    sourceType: "ICAL" | "NONE";
    sourceRef: string | null;
    homepage: string;
    sourceUrl: string;
    org: string;
  }> = [
    // Lake Todd Village District — formed 2004 by the littoral owners of Lake
    // Todd, territory in Bradford and Newbury. Its own site answers HTTP 404 at
    // rungs 2, 3, 4, 5 and 6, so the branch that reaches it is the Town of
    // Bradford, whose public calendar files its sittings: an Annual Meeting at
    // the Bradford Area Community Center and two at the Town Hall meeting room.
    {
      division: `${NH}/county:merrimack/place:newbury_town`,
      // RULING 121: ONE body, governing territory in Bradford AND Newbury. The
      // state register lists it twice — once under each town — and the
      // district's own archived history page says the same in its own words.
      // It shipped as two rows until 2026-08-24 and every registry count
      // counted it twice.
      alsoServes: [`${NH}/county:merrimack/place:bradford_town`],
      slug: "lake-todd-village-district",
      name: "Lake Todd Village District",
      status: "LIVE",
      sourceType: "ICAL",
      sourceRef:
        "https://calendar.google.com/calendar/ical/bradfordnewhampshire%40gmail.com/public/basic.ics",
      homepage: "https://bradfordnh.gov/pages/calendar",
      sourceUrl: REGISTER,
      org: "Lake Todd Village District",
    },
    // The Merrimack County Conservation District, on the division RSA 432:12
    // gives it. Its board has no published calendar this session reached, so it
    // is named and KNOWN_UNCOVERED rather than wired to nothing.
    {
      division: `${NH}/county:merrimack`,
      slug: "conservation-district",
      name: "Merrimack County Conservation District Board of Supervisors",
      status: "KNOWN_UNCOVERED",
      sourceType: "NONE",
      sourceRef: null,
      homepage: "https://merrimackccd.org/",
      sourceUrl: "https://www.gencourt.state.nh.us/rsa/html/XL/432/432-12.htm",
      org: "Merrimack County Conservation District",
    },
    // The New London-Springfield Water System Precinct. Its own site publishes
    // its Board of Commissioners — Rip Cross as chairman, Ken Jacques and Peter
    // Hoglund — meeting the first Monday of each month at 4:00pm at 73 Old Dump
    // Road, and a phone. It publishes no calendar feed, so it is named and
    // KNOWN_UNCOVERED.
    {
      division: `${NH}/county:merrimack/place:new_london_town`,
      // RULING 121: ONE body. Its own name carries both towns, and its
      // territory crosses a COUNTY line as well as a municipal one —
      // Merrimack and Sullivan — which is why the pair rule cannot be a
      // same-county shortcut.
      alsoServes: [`${NH}/county:sullivan/place:springfield_town`],
      slug: "water-system-precinct",
      name: "New London-Springfield Water System Precinct Board of Commissioners",
      status: "KNOWN_UNCOVERED",
      sourceType: "NONE",
      sourceRef: null,
      homepage: "https://www.nlswp.com/board-of-commissioners",
      sourceUrl: "https://www.nlswp.com/board-of-commissioners",
      org: "New London-Springfield Water System Precinct",
    },
    // Highland Haven, in Washington. The state register gives its address and
    // phone; no web presence of its own was reached on 2026-08-21.
    {
      division: `${NH}/county:sullivan/place:washington_town`,
      slug: "highland-haven",
      name: "Highland Haven Special District",
      status: "KNOWN_UNCOVERED",
      sourceType: "NONE",
      sourceRef: null,
      homepage: "https://www.washingtonnh.org/",
      sourceUrl: REGISTER,
      org: "Highland Haven Special District",
    },
    // Ashuelot Pond Dam Precinct, in Washington. It is in the Census of
    // Governments and it is NOT in the state's village-district register — two
    // official enumerations that disagree, which is a finding rather than an
    // error, and the reason it is named here rather than dropped.
    {
      division: `${NH}/county:sullivan/place:washington_town`,
      slug: "ashuelot-pond-dam-precinct",
      name: "Ashuelot Pond Dam Precinct",
      status: "KNOWN_UNCOVERED",
      sourceType: "NONE",
      sourceRef: null,
      homepage: "https://www.washingtonnh.org/",
      sourceUrl:
        "2022 Census of Governments, Government Units Listing; absent from the NH village-district register read the same day",
      org: "Ashuelot Pond Dam Precinct",
    },
    // Emerald Lake Village District, in Hillsborough.
    {
      division: `${NH}/county:hillsborough/place:hillsborough_town`,
      slug: "emerald-lake-village-district",
      name: "Emerald Lake Village District",
      status: "KNOWN_UNCOVERED",
      sourceType: "NONE",
      sourceRef: null,
      homepage: "https://www.town.hillsborough.nh.us/",
      sourceUrl: REGISTER,
      org: "Emerald Lake Village District",
    },
    // Andover's three, all in the state register or the Census or both.
    {
      division: `${NH}/county:merrimack/place:andover_town`,
      slug: "andover-village-district",
      name: "Andover Village District",
      status: "KNOWN_UNCOVERED",
      sourceType: "NONE",
      sourceRef: null,
      homepage: "https://www.andovernh.us.com/",
      sourceUrl: REGISTER,
      org: "Andover Village District",
    },
    {
      division: `${NH}/county:merrimack/place:andover_town`,
      slug: "andover-fire-district",
      name: "Andover Fire District",
      status: "KNOWN_UNCOVERED",
      sourceType: "NONE",
      sourceRef: null,
      homepage: "https://www.andovernh.us.com/",
      sourceUrl:
        "2022 Census of Governments, Government Units Listing; the NH village-district register lists East Andover Fire District and not this one",
      org: "Andover Fire District",
    },
    {
      division: `${NH}/county:merrimack/place:andover_town`,
      slug: "east-andover-fire-precinct",
      name: "East Andover Fire Precinct",
      status: "KNOWN_UNCOVERED",
      sourceType: "NONE",
      sourceRef: null,
      homepage: "https://www.andovernh.us.com/",
      sourceUrl: REGISTER,
      org: "East Andover Fire District",
    },
  ];
  return rows.map((row) => ({
    id: `${row.division}#${row.slug}`,
    ocdId: row.division as Body["ocdId"],
    // RULING 121 — one body, one id, rendered under every town it governs.
    ...(row.alsoServes
      ? { alsoServesOcdIds: row.alsoServes as unknown as Body["alsoServesOcdIds"] }
      : {}),
    name: row.name,
    bodyClass: "GOVERNING" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: row.status,
    agendaSourceType: row.sourceType,
    agendaSourceRef: row.sourceRef,
    meetingCadence: null,
    homepageUrl: row.homepage,
    demandCount: 0,
    sourceDataset: "COG_2022" as const,
    provenance: {
      sourceUrl: row.sourceUrl,
      sourceOrg: row.org,
      collectedAt: collected,
      verifiedAt: collected,
    },
  }));
}

/**
 * **THE TWENTY UN-HELD UNITS AT 03255** (NH Hunt 5, 2026-08-21, item 5;
 * RULING 57 and RULING 60).
 *
 * `pnpm twig:pair` reconciled 48 Census units against 28 held, and NAMED the
 * twenty that were not. This block is those twenty, hand-worked. Not one of
 * them was reachable by an automated route on the day it was tried, and the
 * reason is worth writing down because it is the finding: **the Census of
 * Governments' recorded URL was wrong or dead for six of the seven towns.**
 *
 * | Unit | Census said | What was actually there |
 * |---|---|---|
 * | Acworth | `acworth.cc` | DNS does not resolve; no Wayback snapshot ever |
 * | Croydon | (none) | `townofcroydon.com` is a Squarespace parking page |
 * | Newport | `newportnh.net` | a parked domain with Cyrillic categories |
 * | Windsor | (none) | `windsornh.gov` is a GoDaddy parking lander |
 * | Lempster | (none) | — |
 * | Grantham | `granthamnh.net` | redirects to `granthamnh.gov` |
 *
 * A hunt that trusted the denominator's own URLs would have recorded five of
 * these towns as publishing nothing. Every one of them publishes a full boards
 * index. That is the whole argument for RULING 52: the front door being locked
 * is one measurement on one route, and there were five other routes.
 *
 * ## The routes that worked, each of which became a branch
 *
 * 1. **The `.gov` sibling.** Newport, Grantham and Windsor's real sites are on
 *    `.gov` or a different TLD; the Census row is simply old.
 * 2. **The Drupal-7 `/boards` index.** Newport, Croydon and Windsor all run
 *    the same Virtual Town Hall Drupal 7 install — `<Town>, NH |` in the
 *    title, `/sites/all/...` assets, a `/boards` index and `/<body-slug>`
 *    pages. Windsor's front page renders zero links to a plain client and its
 *    `/boards` index renders ten. Guessing the path beat crawling the site.
 * 3. **The Internet Archive, rung 11.** Croydon's site is DOWN today — "Web
 *    Site Not Found" to a plain client AND to a real browser. Its boards are
 *    read from the 2026-05-21 snapshot, and that provenance is recorded as an
 *    archive read rather than dressed up as a live one.
 * 4. **The state register.** The Eastman Village District appears in no town
 *    menu anywhere; New Hampshire's Office of Business and Economic Affairs
 *    register names it, its host municipality, its mailing address and its
 *    phone. It is filed there as *Eastman Village WATER District*, which is
 *    the second naming disagreement between two official enumerations this zip
 *    has produced — recorded, not resolved.
 * 5. **The SAU page that names every member district's board.** One read of
 *    SAU 34's school-boards page named the Hillsboro-Deering Cooperative,
 *    Washington and Windsor school boards — three separate Census units from
 *    one document.
 * 6. **The trade association's directory.** The Sullivan County Conservation
 *    District has no page of its own; the NH Association of Conservation
 *    Districts publishes its address, its board's meeting cadence and its
 *    manager's email.
 */

interface Hunt5Row {
  division: string;
  slug: string;
  name: string;
  status: "LIVE" | "KNOWN_UNCOVERED";
  homepage: string;
  sourceUrl: string;
  org: string;
  cadence?: string | null;
  cls?: BodyClass;
}

function nhHunt5TwigRows(): Body[] {
  // Declared INSIDE, not above: CURATED_BODIES calls this at module
  // initialisation, which is before any const later in the file exists.
  const NH5 = "ocd-division/country:us/state:nh";
  const NH5_COLLECTED = "2026-08-21";
  const VD_REGISTER =
    "https://www.nheconomy.com/getmedia/f087979c-98b8-41b5-a2e0-1808faaa8ffe/village-districts-locations-addresses.csv";
  const CROYDON_ARCHIVE =
    "http://web.archive.org/web/20260521053506/http://www.croydon-nh.com/";

  const rows: Hunt5Row[] = [];

  /* ---------------------------------------------------------------- towns -- */

  /**
   * ACWORTH. The Census records `acworth.cc`, which does not resolve and has
   * never been captured by the Internet Archive. `acworthnh.net` answers rung
   * 2 and its title is "Government | Town of Acworth, New Hampshire | United
   * States" — an identity check, because a town-shaped domain is not a town.
   */
  const ACWORTH = `${NH5}/county:sullivan/place:acworth_town`;
  for (const [slug, name] of [
    ["board-of-selectmen", "Board of Selectmen"],
    ["budget-committee", "Budget Committee"],
    ["cemetery-trustees", "Cemetery Trustees"],
    ["conservation-commission", "Conservation Commission"],
    ["library-trustees", "Library Trustees"],
    ["planning-board", "Planning Board"],
    ["trustees-of-trust-funds", "Trustees of Trust Funds"],
    ["zoning-board", "Zoning Board"],
  ] as const) {
    rows.push({
      division: ACWORTH,
      slug,
      name,
      status: "KNOWN_UNCOVERED",
      homepage: `https://www.acworthnh.net/${slug}`,
      sourceUrl: "https://www.acworthnh.net/boards-committees",
      org: "Town of Acworth",
    });
  }

  /**
   * CROYDON, read from the Internet Archive at rung 11 because the town's site
   * is OFFLINE — `croydon-nh.com` answers "Web Site Not Found" to a plain
   * client and to a real browser alike, on 2026-08-21. The snapshot is
   * 2026-05-21 and every row here says so.
   *
   * This is the case the render-default rule exists for. A town whose website
   * went down is not a town without boards, and recording these as absent
   * because the front door is dark would be asserting an absence we know to be
   * false. They ship KNOWN_UNCOVERED with an archive provenance, which is
   * exactly what they are.
   */
  const CROYDON = `${NH5}/county:sullivan/place:croydon_town`;
  for (const [slug, name] of [
    ["select-board", "Select Board"],
    ["planning-board", "Planning Board"],
    ["zoning-board", "Zoning Board"],
    ["conservation-committee", "Conservation Committee"],
    ["record-retention-committee", "Record Retention Committee"],
    ["trustees-of-the-trust-fund-and-cemeteries", "Trustees of the Trust Fund and Cemeteries"],
  ] as const) {
    rows.push({
      division: CROYDON,
      slug,
      name,
      status: "KNOWN_UNCOVERED",
      homepage: CROYDON_ARCHIVE,
      sourceUrl: CROYDON_ARCHIVE,
      org: "Town of Croydon (read from the Internet Archive, snapshot 2026-05-21; the town's own site was offline when checked)",
    });
  }

  /** NEWPORT. Census says `newportnh.net`, which is a parked domain. */
  const NEWPORT = `${NH5}/county:sullivan/place:newport_town`;
  for (const [slug, name] of [
    ["board-selectmen", "Board of Selectmen"],
    ["budget-advisory-committee", "Budget Advisory Committee"],
    ["conservation-commission", "Conservation Commission"],
    ["heritage-and-monuments-memorials-commission", "Heritage and Monuments & Memorials Commission"],
    ["nri-action-plan-subcommittee-conservation-commission", "NRI Action Plan Subcommittee of the Conservation Commission"],
    ["parlin-field-airport-advisory-board", "Parlin Field Airport Advisory Board"],
    ["planning-board", "Planning Board"],
    ["zoning-board-adjustment", "Zoning Board of Adjustment"],
  ] as const) {
    rows.push({
      division: NEWPORT,
      slug,
      name,
      status: "KNOWN_UNCOVERED",
      homepage: `https://www.newportnh.gov/${slug}`,
      sourceUrl: "https://www.newportnh.gov/boards",
      org: "Town of Newport",
    });
  }

  /**
   * WINDSOR. `windsornh.gov` is a GoDaddy parking lander — a `.gov` that is
   * not the town, which is worth knowing about as a class. The real site is
   * `windsornh.org`, whose front page renders ZERO links to a plain client and
   * whose `/boards` index renders ten. The path was guessed from the CMS
   * family rather than crawled.
   */
  const WINDSOR = `${NH5}/county:hillsborough/place:windsor_town`;
  for (const [slug, name] of [
    ["board-selectmen", "Board of Selectmen"],
    ["planning-board", "Planning Board"],
    ["supervisors-checklist", "Supervisors of the Checklist"],
    ["zoning-board-adjustments", "Zoning Board of Adjustments"],
    ["welfare", "Welfare"],
  ] as const) {
    rows.push({
      division: WINDSOR,
      slug,
      name,
      status: "KNOWN_UNCOVERED",
      homepage: `https://www.windsornh.org/${slug}`,
      sourceUrl: "https://www.windsornh.org/boards",
      org: "Town of Windsor",
    });
  }

  /** LEMPSTER. No URL in the Census row at all; `lempsternh.org` answers rung 2. */
  const LEMPSTER = `${NH5}/county:sullivan/place:lempster_town`;
  for (const [slug, name, path] of [
    ["board-of-selectmen", "Board of Selectmen", "boards-committees/board-of-selectmen/"],
    ["planning-board", "Planning Board", "boards-committees/planning-board/"],
    ["cemetery-trustees", "Cemetery Trustees", "boards-committees/cemetery-trustees/"],
    ["conservation-commission", "Conservation Commission", "boards-committees/conservation-commission/"],
    ["trustees-of-trust-funds", "Trustees of Trust Funds", "boards-committees/trustees-of-trust-fund/"],
    ["library-trustees", "Library Trustees", "departments/miner-memorial-library/library-trustees/"],
  ] as const) {
    rows.push({
      division: LEMPSTER,
      slug,
      name,
      status: "KNOWN_UNCOVERED",
      homepage: `https://lempsternh.org/${path}`,
      sourceUrl: "https://lempsternh.org/boards-committees/",
      org: "Town of Lempster",
    });
  }

  /** GRANTHAM. The Census URL redirects to the town's live `.gov`. */
  const GRANTHAM = `${NH5}/county:sullivan/place:grantham_town`;
  for (const [slug, name] of [
    ["board-of-selectmen", "Board of Selectmen"],
    ["capital-improvement", "Capital Improvement Committee"],
    ["cemetery-trustees", "Cemetery Trustees"],
    ["conservation-commission", "Conservation Commission"],
    ["energy-committee", "Energy Committee"],
    ["technology-committee", "Technology Committee"],
    ["building-needs-committee", "Building Needs Committee"],
    ["master-plan-committee", "Master Plan Committee"],
    ["planning-board", "Planning Board"],
    ["supervisors-of-the-checklist", "Supervisors of the Checklist"],
    ["trustees-of-the-trust-funds", "Trustees of the Trust Funds"],
    ["zoning-board-of-adjustment", "Zoning Board of Adjustment"],
    ["recreation-park-committee", "Recreation Park Committee"],
    ["transfer-station-rolloff-truck-committee", "Transfer Station Rolloff Truck Committee"],
    ["open-space-committee", "Open Space Committee"],
  ] as const) {
    rows.push({
      division: GRANTHAM,
      slug,
      name,
      status: "KNOWN_UNCOVERED",
      homepage: "https://granthamnh.gov/government",
      sourceUrl: "https://granthamnh.gov/government",
      org: "Town of Grantham",
    });
  }

  /* ------------------------------------------------------------- county --- */

  /**
   * SULLIVAN COUNTY. Two bodies, and they are different in kind: the elected
   * Board of Commissioners, and the County Delegation — which in New Hampshire
   * is every state representative whose district lies in the county, sitting
   * as the county's budget authority. A reader who has never heard of a county
   * delegation is exactly the reader the stranger test is about.
   */
  const SULLIVAN = `${NH5}/county:sullivan`;
  rows.push(
    {
      division: SULLIVAN,
      slug: "commissioners",
      name: "Sullivan County Board of Commissioners",
      status: "KNOWN_UNCOVERED",
      homepage: "https://sullivancountynh.gov/166/Commissioners",
      sourceUrl: "https://sullivancountynh.gov/166/Commissioners",
      org: "Sullivan County",
    },
    {
      division: SULLIVAN,
      slug: "delegation",
      name: "Sullivan County Delegation",
      status: "KNOWN_UNCOVERED",
      homepage: "https://sullivancountynh.gov/207/Delegation",
      sourceUrl: "https://sullivancountynh.gov/207/Delegation",
      org: "Sullivan County",
    },
    /**
     * The conservation district has no page of its own anywhere. The NH
     * Association of Conservation Districts publishes its address, its
     * manager, and — the part a reader actually needs — WHEN ITS BOARD MEETS.
     */
    {
      division: SULLIVAN,
      slug: "conservation-district",
      name: "Sullivan County Conservation District Board of Supervisors",
      status: "KNOWN_UNCOVERED",
      homepage: "https://www.nhacd.net/conservation-districts-1",
      sourceUrl: "https://www.nhacd.net/conservation-districts-1",
      org: "New Hampshire Association of Conservation Districts",
      cadence: "First Friday of each month, 2pm-4pm",
      cls: "COMMISSION",
    },
  );

  /* ------------------------------------------------- village district ----- */

  /**
   * EASTMAN VILLAGE DISTRICT, in Grantham.
   *
   * TWO OFFICIAL ENUMERATIONS DISAGREE ABOUT ITS NAME, and RULING 57 says that
   * is a finding rather than an error. The 2022 Census of Governments calls it
   * EASTMAN VILLAGE DISTRICT; New Hampshire's own village-district register
   * calls it Eastman Village WATER District. Both read 2026-08-21. It ships
   * under the Census name with the register's name recorded beside it.
   *
   * A NEAR MISS WORTH RECORDING. `eastmannh.org` answers rung 2 and looks
   * exactly like the district's site. It is not: it is the Eastman Community
   * Association, a private homeowners' club running on ClubEssential, whose
   * navigation is golf tee times and amenities. Filing it as this district's
   * page would have attached a private club to a unit of government on a
   * reader's screen. The register's address — 31 Draper Road, Grantham — is
   * what actually identifies the district.
   */
  rows.push({
    division: GRANTHAM,
    slug: "eastman-village-district",
    name: "Eastman Village District",
    status: "KNOWN_UNCOVERED",
    homepage: "https://granthamnh.gov/",
    sourceUrl: VD_REGISTER,
    org: "New Hampshire Office of Business and Economic Affairs village-district register (filed there as Eastman Village Water District; 31 Draper Road, Grantham NH 03753)",
  });

  /* ----------------------------------------------- school districts ------- */

  /**
   * THE SAU BRANCH, and it is the highest-yield thing in this block.
   *
   * New Hampshire school districts are administered in School Administrative
   * Units, and an SAU's school-boards page names the board of EVERY member
   * district. One read of SAU 34 produced three Census units. One read of SAU
   * 24 produced two more.
   *
   * Each row is filed under the school district's own division where this
   * registry ships one, because the district is the government and the SAU is
   * the administrator.
   */
  const SD = (slug: string) => `${NH5}/school_district:${slug}`;
  for (const [division, slug, name, homepage, sourceUrl, org] of [
    [
      SD("hillsboro_deering_cooperative_school_district"),
      "school-board",
      "Hillsboro-Deering Cooperative School Board",
      "https://sau34.org/pages/5ccce93c-763f-4a94-8ee8-6d6bcd36e7b9",
      "https://sau34.org/en-US/sau-34-school-board-6d1f6cbb",
      "SAU 34",
    ],
    [
      SD("washington_school_district"),
      "school-board",
      "Washington School Board",
      "https://sau34.org/pages/8e101559-f359-460c-8cc9-89708be04b8f",
      "https://sau34.org/en-US/sau-34-school-board-6d1f6cbb",
      "SAU 34",
    ],
    [
      SD("windsor_school_district"),
      "school-board",
      "Windsor School Board",
      "https://sau34.org/pages/c139e8d8-546d-42ed-8de1-1c6107980ebd",
      "https://sau34.org/en-US/sau-34-school-board-6d1f6cbb",
      "SAU 34",
    ],
    [
      SD("henniker_school_district"),
      "school-board",
      "Henniker School Board",
      "https://www.sau24.org/school-boards/index",
      "https://www.sau24.org/school-boards/index",
      "SAU 24",
    ],
    [
      SD("john_stark_regional_school_district"),
      "school-board",
      "John Stark Regional School Board",
      "https://www.sau24.org/school-boards/index",
      "https://www.sau24.org/school-boards/index",
      "SAU 24",
    ],
    [
      SD("sunapee_school_district"),
      "school-board",
      "Sunapee School Board",
      "https://www.sau85.org/schoolboard",
      "https://www.sau85.org/schoolboard",
      "SAU 85",
    ],
    [
      SD("newport_school_district"),
      "school-board",
      "Newport School Board",
      "https://www.sau43.nh.gov/school-board",
      "https://www.sau43.nh.gov/school-board",
      "SAU 43",
    ],
    [
      SD("lempster_school_district"),
      "school-board",
      "Goshen-Lempster Cooperative School Board",
      "https://www.sau71.org/",
      "https://www.sau71.org/documents/resources/for-school-board/school-board-policies/836391",
      "SAU 71",
    ],
    [
      SD("nashua_school_district"),
      "board-of-education",
      "Nashua Board of Education",
      "https://www.nashua.edu/our-district/board-of-education",
      "https://www.nashua.edu/our-district/board-of-education",
      "Nashua School District",
    ],
  ] as const) {
    rows.push({
      division,
      slug,
      name,
      status: "KNOWN_UNCOVERED",
      homepage,
      sourceUrl,
      org,
    });
  }

  return rows.map((row) => ({
    id: `${row.division}#${row.slug}`,
    ocdId: row.division as Body["ocdId"],
    name: row.name,
    bodyClass: (row.cls ?? "GOVERNING") as BodyClass,
    bodyOrigin: "CURATED" as const,
    coverageStatus: row.status,
    agendaSourceType: "NONE" as const,
    agendaSourceRef: null,
    meetingCadence: row.cadence ?? null,
    homepageUrl: row.homepage,
    demandCount: 0,
    sourceDataset: "COG_2022" as const,
    provenance: {
      sourceUrl: row.sourceUrl,
      sourceOrg: row.org,
      collectedAt: NH5_COLLECTED,
      verifiedAt: NH5_COLLECTED,
    },
  }));
}

/**
 * DB-15: a curated board is LIVE when a door in use names it. The rows keep
 * their identity; only the status and source type follow the doors, so a door
 * added or shut in the registry changes what the registry's readers say with
 * no edit to this file. Returns how many rows changed.
 */
export function refreshCuratedBodyStatus(wirings: readonly BodySourceWiring[] = activeWiring()): number {
  const live = liveBoardIds(wirings);
  let changed = 0;
  for (const entry of TUCSON_BOARDS) {
    const fresh = tucsonBoardRow(entry, live);
    const row = CURATED_BODIES.find((body) => body.id === fresh.id);
    if (!row || (row.coverageStatus === fresh.coverageStatus && row.agendaSourceType === fresh.agendaSourceType)) continue;
    row.coverageStatus = fresh.coverageStatus;
    row.agendaSourceType = fresh.agendaSourceType;
    changed += 1;
  }
  return changed;
}
