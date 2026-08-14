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

/** Boards a live adapter reads today (the clerksboards source). */
const LIVE_BOARD_IDS = new Set([38, 8, 23, 63, 19]);

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
];

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
