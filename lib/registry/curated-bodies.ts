import type { Body, BodyClass } from "./types.ts";

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
 *    the wiring path the author decided for these; the body's `id` is minted
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

/** Newbury's own site — the source for every board row below. */
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
const LIVE_BOARD_IDS = new Set([
  // Wired before g18.
  38, 8, 23, 63, 19,
  // g18: an "Nth weekday of each month" rule the parser already handles.
  9, 12, 3, 131, 39, 42, 57, 50, 49, 40, 58, 41, 59, 133, 61, 65,
  // g18: enumerated dates.
  26, 25,
  // g18: enumerated dates, all of them past. See the note above.
  43,
  // g19: the two the g18 pass named as parser gaps, plus one it did not see.
  // 128 quarterly (grammar C), 15 month-name dates (grammar D), 130 an
  // ordinary Nth-weekday rule written "of THE month" (grammar B, widened).
  128, 15, 130,
]);

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

function tucsonBoardRow(entry: [string, number, BodyClass?]): Body {
  const [name, boardId] = entry;
  const pageUrl = `${CLERKSBOARDS}${boardId}`;
  return {
    id: `${TUCSON_OCD}#${slugOf(name)}`,
    ocdId: TUCSON_OCD,
    // Sourced: the name is the Clerk's own directory text, cited below.
    name,
    bodyClass: classOf(entry),
    bodyOrigin: "CURATED",
    coverageStatus: LIVE_BOARD_IDS.has(boardId) ? "LIVE" : "KNOWN_UNCOVERED",
    agendaSourceType: LIVE_BOARD_IDS.has(boardId) ? "CLERKSBOARDS" : "HTML",
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

/**
 * The board id behind every clerksboards body that is LIVE, keyed by body id.
 *
 * EXPORTED SO THE SOURCE WIRING CAN DERIVE ITSELF (g18). `source-wiring.ts`
 * held five hand-written `CLERKSBOARDS` entries beside this file's five-entry
 * `LIVE_BOARD_IDS`, and the two had to agree for a board to actually be read.
 * Widening `LIVE_BOARD_IDS` alone would have marked nineteen bodies LIVE with
 * nothing fetching them — a coverage status that claims a calendar we never
 * asked for, which is green standing in for verified.
 *
 * That was caught by asking the adapter what it returned rather than trusting
 * the status field, and the fix is the one AUD-06 makes everywhere else this
 * session: one list, derived, instead of two lists that must be kept in step.
 */
export const TUCSON_CLERKSBOARDS: { bodyId: string; boardId: string }[] =
  TUCSON_BOARDS.filter(([, boardId]) => LIVE_BOARD_IDS.has(boardId)).map(
    ([name, boardId]) => ({
      bodyId: `${TUCSON_OCD}#${slugOf(name)}`,
      boardId: String(boardId),
    }),
  );

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
  ...TUCSON_BOARDS.map(tucsonBoardRow),

  // ── 3c (2026-08-17): special districts serving the four zips, from the
  // 2022 Census of Governments individual-units listing (the official
  // universe — the Layer 1 audit's denominator, docs/coverage-audit-by-
  // county.md). Every homepage below was fetch-verified 2026-08-17; the
  // recorded URL is the redirect-followed effective URL. Coverage is
  // NOT_ATTEMPTED — the existence claim is Census's, the agenda hunt is
  // still owed, and there is deliberately no way to record "gave up". ──────
  ...specialDistrictRows(),

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
      // missed it — the address lives in the map link, not in the prose. The
      // author found it in his own browser and ruled it the meeting address
      // for this board and the Planning Board alike; the Planning Board's own
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
    // Merrimack — the conservation district is county-wide and so serves
    // 03255; no village district's boundary reaches Newbury (audit note).
    {
      slug: "merrimack-county-conservation-district",
      state: "nh",
      name: "Merrimack County Conservation District Board of Supervisors",
      homepage: "https://merrimackccd.org/",
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
  const rows: Array<{ slug: string; name: string; path: string }> = [
    { slug: "selectboard", name: "Selectboard", path: "/board/board-of-selectmen/" },
    { slug: "planning-board", name: "Planning Board", path: "/board/planning-board/" },
    {
      slug: "cemetery-trustees",
      name: "Cemetery Trustees",
      path: "/board/cemetery-trustees/",
    },
  ];
  return rows.map((row) => ({
    id: `${WILMOT_OCD}#${row.slug}`,
    ocdId: WILMOT_OCD,
    name: row.name,
    bodyClass: "COMMISSION" as const,
    bodyOrigin: "CURATED" as const,
    coverageStatus: "LIVE" as const,
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
  const rows: Array<{ slug: string; name: string; path: string }> = [
    { slug: "board-of-selectmen", name: "Board of Selectmen", path: "/selectmen" },
    { slug: "planning-board", name: "Planning Board", path: "/planningboard" },
    { slug: "zoning-board", name: "Zoning Board", path: "/zoningboard" },
    {
      slug: "conservation-commission",
      name: "Conservation Commission",
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
