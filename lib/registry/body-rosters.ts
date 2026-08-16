/**
 * Tier-3 rosters (5a/5b): who actually sits on the wired bodies, curated
 * from each body's OWN page with the citation on every roster.
 *
 * Officeholder discipline throughout: every name, role, and term note was
 * read off the cited page on the date recorded — sourced, dated, never
 * inferred. A body with no roster here renders the honest absence, and
 * that absence names which half is missing. School boards, councils, and
 * select boards are elected offices; a wrong name here is the failure
 * CLAUDE.md line 17 exists to prevent, which is why this is a curated
 * register and not a scrape.
 *
 * `tests/body-rosters.test.ts` holds: every roster cites the body's own
 * page (never a vendor), every bodyId resolves against the source wiring,
 * every member has a name and title, and the surfaces actually render
 * these rows.
 */

import ROSTER_PHOTOS from "./roster-photos.json" with { type: "json" };

export interface RosterMember {
  /** Stable within the roster: `roster:<bodyId>#<n>`. */
  id: string;
  name: string;
  /** The published role — "Mayor", "Ward 3 Council Member", "Chair". */
  officeTitle: string;
  /** The body's own wording for the term, where it states one. */
  termNote: string | null;
  email: string | null;
  phone: string | null;
  /** The member's own official page, where the body publishes one. */
  websiteUrl: string | null;
  /**
   * The member's party, EXACTLY as a government record states it (M61,
   * 2026-08-15). Null is the normal case here today and means one of two
   * different things, which the roster's `partisanship` below distinguishes:
   * the office is nonpartisan and there is no party to state, or this is a
   * partisan office whose party we have not sourced yet. Never inferred —
   * not from a body's own page styling, not from a neighbour, not from a
   * name.
   */
  partyLabel?: string | null;
  /** The government record the party was read from. Required with it. */
  partySourceUrl?: string;
  /** Who published that record — an election authority, never a party. */
  partySourceOrg?: string;
  /** The day the record was read. Distinct from the roster's `collectedAt`. */
  partyCollectedAt?: string;
}

/**
 * Whether a body's seats are contested on party lines, and how we know.
 *
 * Recorded per body rather than assumed per state (M61): "no party rendered"
 * has to be a stated fact, or an unsourced partisan office is indistinguishable
 * from a genuinely nonpartisan one, and the reader can't tell which silence
 * they are looking at.
 */
export type Partisanship =
  /** Elected on party lines; party is a fact about the seat. */
  | "PARTISAN"
  /** No party appears on the ballot for this office. Nothing renders. */
  | "NONPARTISAN"
  /** Not yet established. Nothing renders, and it stays a work item. */
  | "UNDETERMINED";

export interface BodyRoster {
  /** Matches `BodySourceWiring.bodyId` exactly. */
  bodyId: string;
  bodyName: string;
  members: RosterMember[];
  /** The body's own page the roster was read from. */
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
  /**
   * Whether these seats carry a party, and the record that says so (M61).
   *
   * Rung 1 was walked for every body here on 2026-08-15 and came back empty
   * in the same way each time: **not one of these bodies publishes party on
   * its own roster page** — Pima's supervisors, Tucson's mayor and council,
   * Morris County's commissioners, Merrimack County's commissioners and
   * Rockaway Township's council all list names, wards and terms and no
   * affiliation. That is a finding about the pages, not about the offices,
   * and several of these offices are unambiguously partisan.
   *
   * **M62 closed it on 2026-08-15 from the election authorities' own
   * certified records, and no roster here is UNDETERMINED any more:** five
   * are PARTISAN (Pima's board, Tucson's mayor and council, Rockaway
   * Township's council, Morris County's and Merrimack County's commissioners)
   * and seven are NONPARTISAN (all six school boards, plus the Newbury
   * Selectboard). Every one cites the document that settled it. The value
   * still means what it says: it describes the SEATS, not the people, and a
   * NONPARTISAN body renders no party because there is none to render, while
   * a PARTISAN body may still hold a member with no party — two here do,
   * both appointed to fill a vacancy, so no certified result exists to read.
   */
  partisanship: Partisanship;
  /** What established `partisanship`. Absent while UNDETERMINED. */
  partisanshipSourceUrl?: string;
}

const COLLECTED = "2026-08-13";

/**
 * M62 — the certified-results rung, walked 2026-08-15.
 *
 * The rule the author set: a local office is partisan or nonpartisan by law or
 * charter FIRST, and only a partisan office gets a party, read from the
 * certified result of the election that put the person in the seat. Never from
 * an endorsement, a news report, or a party's own site. Where no certification
 * can be located the member's party stays null and the card renders nothing —
 * silence, not a guess.
 *
 * Two findings worth stating plainly, because both were surprises:
 *
 * 1. **A general-election canvass usually does not print party.** Pima's and
 *    Morris's summary reports carry names and totals and nothing else. The
 *    record that states party is the PARTISAN PRIMARY canvass (Arizona: races
 *    are headed `DEM`/`REP`/`GRN`/`LBT`) or the county clerk's certified
 *    winners list (New Jersey: a Party column). Reading only the general
 *    canvass would have produced "no party found" for offices that are
 *    unambiguously partisan.
 *
 * 2. **The same documents prove the negative.** Arizona school district
 *    governing board races appear in Pima's general canvass with no party
 *    beside any candidate and appear in the partisan primary canvass under no
 *    party heading at all — they are not in that election. That is the election
 *    authority's own record saying these seats carry no party, which is a far
 *    better answer than "the district's page doesn't mention one."
 */
const PARTY_READ = "2026-08-15";

/**
 * Arizona's certified primary canvass for Pima County, filed with the
 * Secretary of State. Races are organised by party, so a nominee's party is
 * stated by the document rather than inferred from it.
 */
const PIMA_PRIMARY_CANVASS =
  "https://apps.azsos.gov/election/2024/pe/canvass/Official_2024_Primary_Canvass_Pima_County.pdf";

/** Pima's certified general canvass — the document that prints no party. */
const PIMA_GENERAL_CANVASS =
  "https://apps.azsos.gov/election/2024/ge/canvass/202411GeneralElectionCanvass-Pima.pdf";

/** City of Tucson, official primary results. Contests are headed by party. */
const TUCSON_2023_PRIMARY =
  "https://www.tucsonaz.gov/files/sharedassets/public/v/1/clerks/documents/elections/results/2023/primary/23paztuc_officialresults_080723.pdf";
const TUCSON_2025_PRIMARY =
  "https://www.tucsonaz.gov/files/sharedassets/public/v/1/clerks/documents/elections/results/25paz_officialresults_08112025.pdf";

/** Morris County Clerk, "Winners of the General Election" — has a Party column. */
const MORRIS_2023_WINNERS =
  "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/1/elections/past-results/2023-general-winners.pdf";
const MORRIS_2024_WINNERS =
  "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/1/elections/past-results/2024-general-winners.pdf";
const MORRIS_2025_WINNERS =
  "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/2/elections/past-results/2025-general-winners.pdf";

/**
 * New Hampshire's certified county-office results, reached through the
 * Internet Archive's dated mirror. `sos.nh.gov` returns 403 to every
 * datacenter client — the page AND the document path, both tried — so the
 * source recorded here is the archive snapshot that was actually read, with
 * its date in the URL, rather than a live URL nobody could open. The ladder is
 * written up in `docs/source-ladder.md`.
 */
const NH_2024_MERRIMACK_COUNTY =
  "https://web.archive.org/web/20260130123951/https://www.sos.nh.gov/sites/g/files/ehbemt561/files/inline-documents/sonh/2024-ge-county-offices-merrimack_1.xls";
const NH_2022_MERRIMACK_COUNTY =
  "https://web.archive.org/web/20250728184156/https://www.sos.nh.gov/sites/g/files/ehbemt561/files/inline-documents/sonh/2022-ge-merrimack-county.xls";

/** The org strings, so a typo cannot make two records look like two sources. */
const AZ_SOS = "Arizona Secretary of State (official county canvass)";
const TUCSON_CLERK = "City of Tucson City Clerk (official election results)";
const MORRIS_CLERK = "Morris County Clerk (certified general election winners)";
const NH_SOS = "New Hampshire Secretary of State (official general election results)";

export const BODY_ROSTERS: BodyRoster[] = [
  {
    // The author's named example (5a): the members are front-and-center at
    // govboard.tusd1.org — five seats, roles and term expirations stated.
    bodyId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
    bodyName: "Tucson Unified School District Governing Board",
    sourceUrl: "https://govboard.tusd1.org/",
    sourceOrg: "Tucson Unified School District Governing Board",
    collectedAt: COLLECTED,
    // M62, 2026-08-15: NONPARTISAN, established from the election authority's
    // own records rather than from the district's silence. Pima's certified
    // GENERAL canvass carries these races — "Governing Board - Tucson Unified
    // School District (TUSD) No. 1" — with no party beside any candidate,
    // and the certified PARTISAN PRIMARY canvass, which heads every race with
    // DEM/REP/GRN/LBT, contains no governing-board race at all. These seats
    // are not contested on party lines, so nothing renders and nothing is
    // missing. Pima County's School Superintendent, who runs the filing,
    // issues a "Nonpartisan Nomination Paper".
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl: PIMA_GENERAL_CANVASS,
    members: [
      {
        id: "roster:tusd#1",
        name: "Dr. Ravi Shah",
        officeTitle: "Governing Board President",
        termNote: "Term expires December 31, 2028",
        email: null,
        phone: "(520) 225-6070",
        websiteUrl: "https://govboard.tusd1.org/",
      },
      {
        id: "roster:tusd#2",
        name: "Natalie Luna Rose",
        officeTitle: "Governing Board Clerk",
        termNote: "Term expires December 31, 2028",
        email: null,
        phone: "(520) 225-6070",
        websiteUrl: "https://govboard.tusd1.org/",
      },
      {
        id: "roster:tusd#3",
        name: "Jennifer Eckstrom",
        officeTitle: "Governing Board Member",
        termNote: "Term expires December 31, 2026",
        email: null,
        phone: "(520) 225-6070",
        websiteUrl: "https://govboard.tusd1.org/",
      },
      {
        id: "roster:tusd#4",
        name: "Val Romero",
        officeTitle: "Governing Board Member",
        termNote: "Term expires December 31, 2026",
        email: null,
        phone: "(520) 225-6070",
        websiteUrl: "https://govboard.tusd1.org/",
      },
      {
        id: "roster:tusd#5",
        name: "Sadie Shaw",
        officeTitle: "Governing Board Member",
        termNote: "Term expires December 31, 2028",
        email: null,
        phone: "(520) 225-6070",
        websiteUrl: "https://govboard.tusd1.org/",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#governing",
    bodyName: "Pima County Board of Supervisors",
    sourceUrl: "https://www.pima.gov/government/board_of_supervisors/",
    sourceOrg: "Pima County",
    collectedAt: COLLECTED,
    // M62, 2026-08-15: PARTISAN, and the certified primary canvass says so —
    // "DEM Board of Supervisors District 1", "REP Board of Supervisors
    // District 4" and so on are the document's own race headings.
    partisanship: "PARTISAN",
    partisanshipSourceUrl: PIMA_PRIMARY_CANVASS,
    members: [
      {
        id: "roster:pima#1",
        name: "Rex Scott",
        officeTitle: "County Supervisor, District 1",
        termNote: "Elected November 2024 to a four-year term",
        email: null,
        phone: "520-724-2738",
        websiteUrl: "https://www.pima.gov/District1",
        partyLabel: "Democratic",
        partySourceUrl: PIMA_PRIMARY_CANVASS,
        partySourceOrg: AZ_SOS,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:pima#2",
        name: "Dr. Matt Heinz",
        officeTitle: "County Supervisor, District 2 (Vice Chair)",
        termNote: "Elected November 2024 to a four-year term",
        email: null,
        phone: "520-724-2702",
        websiteUrl: "https://www.pima.gov/District2",
        partyLabel: "Democratic",
        partySourceUrl: PIMA_PRIMARY_CANVASS,
        partySourceOrg: AZ_SOS,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:pima#3",
        name: "Jennifer Allen",
        officeTitle: "County Supervisor, District 3 (Chair)",
        termNote: "Elected November 2024 to a four-year term",
        email: null,
        phone: "520-724-8051",
        websiteUrl: "https://www.pima.gov/District3",
        partyLabel: "Democratic",
        partySourceUrl: PIMA_PRIMARY_CANVASS,
        partySourceOrg: AZ_SOS,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:pima#4",
        name: "Steve Christy",
        officeTitle: "County Supervisor, District 4",
        termNote: "Elected November 2024 to a four-year term",
        email: null,
        phone: "520-724-8094",
        websiteUrl: "https://www.pima.gov/District4",
        partyLabel: "Republican",
        partySourceUrl: PIMA_PRIMARY_CANVASS,
        partySourceOrg: AZ_SOS,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:pima#5",
        name: "Andrés Cano",
        // M62: the one seat on this board with no certified result behind it,
        // and the hunt is what found the wrong term note. District 5 was won
        // in November 2024 by Adelita Grijalva (Pima's certified general
        // canvass); she left for the CD7 special, and the Board appointed
        // Cano on 2025-04-15 — an appointment, not an election. So he holds a
        // seat on a partisan board with no certified result naming his party,
        // and the card renders no party. Arizona requires a county-supervisor
        // appointee to share the vacating member's registration, and the
        // county's own call for applications said so; that would be a sound
        // inference and it is still not a certified result, which is what this
        // rule asks for. Silence, recorded, with the rungs in
        // docs/source-ladder.md.
        officeTitle: "County Supervisor, District 5",
        termNote: "Appointed April 15, 2025 to serve through December 31, 2026",
        email: null,
        phone: "(520) 724-8126",
        websiteUrl: "https://www.pima.gov/District5",
      },
    ],
  },
  {
    // 5b: the mayor joins the model as a member of the governing body she
    // presides over — Tucson is council-manager, and the office blurb says
    // so honestly.
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    bodyName: "Tucson Mayor & Council",
    sourceUrl: "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
    sourceOrg: "City of Tucson",
    collectedAt: COLLECTED,
    // M62, 2026-08-15: PARTISAN, and the City Clerk says it in one sentence —
    // "The City of Tucson conducts regularly scheduled partisan elections."
    // Wards nominate by party in the primary and the city votes at-large in
    // the general, so the certified PRIMARY results are the record that names
    // each member's party. Mayor and Wards 1, 2 and 4 stand in one cycle
    // (2023, next 2027); Wards 3, 5 and 6 in the other (2025).
    partisanship: "PARTISAN",
    partisanshipSourceUrl:
      "https://www.tucsonaz.gov/Departments/Clerks/Elections/About-City-of-Tucson-Elections",
    members: [
      {
        id: "roster:tucson-mc#1",
        name: "Regina Romero",
        officeTitle: "Mayor",
        termNote: null,
        email: "mayor.romero@tucsonaz.gov",
        phone: "520-791-4201",
        websiteUrl:
          "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
        partyLabel: "Democratic",
        partySourceUrl: TUCSON_2023_PRIMARY,
        partySourceOrg: TUCSON_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:tucson-mc#2",
        name: "Lane Santa Cruz",
        officeTitle: "Ward 1 Council Member",
        termNote: null,
        email: "ward1@tucsonaz.gov",
        phone: "(520) 791-4040",
        websiteUrl:
          "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
        partyLabel: "Democratic",
        partySourceUrl: TUCSON_2023_PRIMARY,
        partySourceOrg: TUCSON_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:tucson-mc#3",
        name: "Paul Cunningham",
        officeTitle: "Ward 2 Council Member",
        termNote: null,
        email: "ward2@tucsonaz.gov",
        phone: "(520) 791-4687",
        websiteUrl:
          "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
        partyLabel: "Democratic",
        partySourceUrl: TUCSON_2023_PRIMARY,
        partySourceOrg: TUCSON_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:tucson-mc#4",
        name: "Kevin Dahl",
        officeTitle: "Ward 3 Council Member",
        termNote: null,
        email: "ward3@tucsonaz.gov",
        phone: "(520) 791-4711",
        websiteUrl:
          "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
        partyLabel: "Democratic",
        partySourceUrl: TUCSON_2025_PRIMARY,
        partySourceOrg: TUCSON_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:tucson-mc#5",
        name: "Nikki Lee",
        officeTitle: "Ward 4 Council Member",
        termNote: null,
        email: "ward4@tucsonaz.gov",
        phone: "(520) 791-3199",
        websiteUrl:
          "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
        partyLabel: "Democratic",
        partySourceUrl: TUCSON_2023_PRIMARY,
        partySourceOrg: TUCSON_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:tucson-mc#6",
        name: "Selina Barajas",
        officeTitle: "Ward 5 Council Member",
        termNote: null,
        email: "ward5@tucsonaz.gov",
        phone: "(520) 791-4231",
        websiteUrl:
          "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
        partyLabel: "Democratic",
        partySourceUrl: TUCSON_2025_PRIMARY,
        partySourceOrg: TUCSON_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:tucson-mc#7",
        name: "Miranda Schubert",
        officeTitle: "Ward 6 Council Member",
        termNote: null,
        email: "ward6@tucsonaz.gov",
        phone: "(520) 791-4601",
        websiteUrl:
          "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
        partyLabel: "Democratic",
        partySourceUrl: TUCSON_2025_PRIMARY,
        partySourceOrg: TUCSON_CLERK,
        partyCollectedAt: PARTY_READ,
      },
    ],
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/school_district:vail_unified_district#board",
    bodyName: "Vail Unified School District Governing Board",
    sourceUrl: "https://www.vailschooldistrict.org/o/vsd/page/governing-board",
    sourceOrg: "Vail Unified School District",
    collectedAt: COLLECTED,
    // M62, 2026-08-15: NONPARTISAN — same two certified Pima County records
    // as the other Arizona school boards here. No party in the general
    // canvass, no governing-board race in the partisan primary canvass.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl: PIMA_GENERAL_CANVASS,
    members: [
      {
        id: "roster:vail#1",
        name: "Allison Pratt",
        officeTitle: "Governing Board President",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.vailschooldistrict.org/o/vsd/page/governing-board",
      },
      {
        id: "roster:vail#2",
        name: "Callie Tippett",
        officeTitle: "Governing Board Clerk",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.vailschooldistrict.org/o/vsd/page/governing-board",
      },
      {
        id: "roster:vail#3",
        name: "Jen Anderson",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.vailschooldistrict.org/o/vsd/page/governing-board",
      },
      {
        id: "roster:vail#4",
        name: "Ed Buster",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.vailschooldistrict.org/o/vsd/page/governing-board",
      },
      {
        id: "roster:vail#5",
        name: "Chris King",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.vailschooldistrict.org/o/vsd/page/governing-board",
      },
    ],
  },
  {
    bodyId:
      "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    bodyName: "Newbury Selectboard",
    sourceUrl: "https://www.newbury.nh.gov/selectboard",
    sourceOrg: "Town of Newbury",
    collectedAt: COLLECTED,
    // M62, 2026-08-15: NONPARTISAN. New Hampshire town elections run on a
    // ballot system the town itself adopts (RSA 669), so this could not be
    // settled from the statute alone — it had to be settled from Newbury's
    // ballot. The town's own 2025 Annual Report prints the moderator's
    // certified count from the March 2025 town election: "Selectboard 3
    // Years — Sandra Warde 326, Joanne Lord 157", no party beside either
    // name, and none beside any other town office on the same page.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury#1",
        name: "Kristen Schultz",
        officeTitle: "Selectboard Chair",
        termNote: "Term ends March 2026",
        email: null,
        phone: "(603) 763-4940",
        websiteUrl: "https://www.newbury.nh.gov/selectboard",
      },
      {
        id: "roster:newbury#2",
        name: "Scott Wheeler",
        officeTitle: "Selectboard Member",
        termNote: "Term ends March 2027",
        email: null,
        phone: "(603) 763-4940",
        websiteUrl: "https://www.newbury.nh.gov/selectboard",
      },
      {
        id: "roster:newbury#3",
        name: "Sandra Warde",
        officeTitle: "Selectboard Member",
        termNote: "Term ends March 2028",
        email: null,
        phone: "(603) 763-4940",
        websiteUrl: "https://www.newbury.nh.gov/selectboard",
      },
    ],
  },
  {
    // 3d/6e (2026-08-17): the wall came down. kearsarge.org 403'd every
    // client recorded in earlier hunts; a browser-UA fetch from this
    // machine returned the full members page (200, 73 KB) — nine members,
    // towns, term expirations, committees, all stated by the district
    // itself. Newbury's representative is Kristen Schultz, who also chairs
    // the Newbury Selectboard. The district publishes no per-member phone
    // or email on this page — the absences are honest, not unhunted.
    bodyId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district#board",
    bodyName: "Kearsarge Regional School Board",
    sourceUrl:
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
    sourceOrg: "Kearsarge Regional School District (SAU #65)",
    collectedAt: "2026-08-14",
    // M62, 2026-08-15: NONPARTISAN by statute. RSA 671:20 has the school
    // district clerk prepare ballots "in the same manner as town clerks for
    // non-partisan town elections" — the school ballot is a non-partisan
    // ballot as a matter of law, in every New Hampshire district, so no
    // per-district record is needed and none exists to find.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl: "https://gc.nh.gov/rsa/html/LXIII/671/671-20.htm",
    members: [
      {
        id: "roster:kearsarge#1",
        name: "Alison Mastin",
        officeTitle: "School Board Chair",
        termNote: "Represents Wilmot · term expires 2028",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#2",
        name: "Kristen Schultz",
        officeTitle: "School Board Vice Chair",
        termNote: "Represents Newbury · term expires 2027",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#3",
        name: "James MacKenna",
        officeTitle: "School Board Member",
        termNote: "Represents New London · term expires 2028",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#4",
        name: "David Keith",
        officeTitle: "School Board Member",
        termNote: "Represents New London · term expires 2029",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#5",
        name: "Art Bobruff",
        officeTitle: "School Board Member",
        termNote: "Represents Springfield · term expires 2027",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#6",
        name: "Patrick McGowan",
        officeTitle: "School Board Member",
        termNote: "Represents Warner · term expires 2027",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#7",
        name: "Paul Lakevicius",
        officeTitle: "School Board Member",
        termNote: "Represents Warner · term expires 2027",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#8",
        name: "Nancy Glynn",
        officeTitle: "School Board Member",
        termNote: "Represents Sutton · term expires 2028",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#9",
        name: "Eric Gregoire",
        officeTitle: "School Board Member",
        termNote: "Represents Bradford · term expires 2029",
        email: null,
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
    ],
  },
  {
    // 6e (2026-08-17): the NJ rosters open at last. The township's own
    // council page publishes per-member phone extensions AND emails — the
    // Kelly standard straight from the source. Mayor rides on the roster so
    // the 3e who-governs mayor line works for 07866 exactly as for 85701.
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing",
    bodyName: "Rockaway Township Council",
    sourceUrl: "https://www.rockawaytownship.org/157/Township-Council",
    sourceOrg: "Rockaway Township",
    collectedAt: "2026-08-14",
    // M62, 2026-08-15: PARTISAN. The Morris County Clerk's certified
    // "Winners of the General Election" carries a Party column, and every
    // Rockaway Township seat in it is filled under a party label. This is
    // also the roster where the certified record disagreed with the sitting
    // membership twice, and both are recorded below rather than smoothed.
    partisanship: "PARTISAN",
    partisanshipSourceUrl: MORRIS_2025_WINNERS,
    members: [
      {
        id: "roster:rockaway#0",
        name: "Joseph Jackson",
        officeTitle: "Mayor",
        // Was "Unexpired term ends December 31, 2027". The certified winners
        // say otherwise: Jackson won a ONE-YEAR unexpired mayoral term in
        // November 2022 and then a full FOUR-YEAR term in November 2023. The
        // end date was right and the word "unexpired" was two years stale.
        termNote: "Elected November 2023 to a four-year term ending December 31, 2027",
        email: null,
        phone: "973-627-7200",
        websiteUrl: "https://www.rockawaytownship.org/464/About-the-Mayor",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2023_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:rockaway#1",
        name: "Howard Morrison",
        // No party, and the reason is a finding. The at-large seat with this
        // term was won in November 2023 by Howard KRITZ; Morrison holds it
        // now per the township's own council page. He appears in no certified
        // winners list for 2023, 2024 (Rockaway Township: "NO LOCAL
        // ELECTION") or 2025 — an absence checked in all three documents, not
        // assumed — so he reached the seat by appointment and no certified
        // result names his party. Nothing renders.
        officeTitle: "Council President, At-Large",
        termNote: "Term expires December 31, 2027",
        email: "hmorrison@rockawaytownship.org",
        phone: "973-627-7200 x2081",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
      },
      {
        id: "roster:rockaway#2",
        name: "Jonathan Sackett",
        officeTitle: "Council Vice President, Ward 4",
        termNote: "Term expires December 31, 2029",
        email: "jsackett@rockawaytownship.org",
        phone: "973-627-7200 x2088",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
        partyLabel: "Democratic",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:rockaway#3",
        name: "Adam Salberg",
        officeTitle: "Council Member, At-Large",
        termNote: "Term expires December 31, 2027",
        email: "asalberg@rockawaytownship.org",
        phone: "973-627-7200 x2083",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2023_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:rockaway#4",
        name: "Pawel Wojtowicz",
        officeTitle: "Council Member, At-Large",
        termNote: "Term expires December 31, 2027",
        email: "pwojtowicz@rockawaytownship.org",
        phone: "973-627-7200 x2084",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2023_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:rockaway#5",
        name: "Susan Fahrman Royek",
        officeTitle: "Council Member, Ward 1",
        termNote: "Term expires December 31, 2029",
        email: "sroyek@rockawaytownship.org",
        phone: "973-627-7200 x2085",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
        partyLabel: "Democratic",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:rockaway#6",
        name: "John J. Quinn",
        officeTitle: "Council Member, Ward 2",
        termNote: "Term expires December 31, 2029",
        email: "jquinn@rockawaytownship.org",
        phone: "973-627-7200 x2086",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:rockaway#7",
        name: "Sophia Freire",
        officeTitle: "Council Member, Ward 3",
        termNote: "Term expires December 31, 2029",
        email: "sfreire@rockawaytownship.org",
        phone: "973-627-7200 x2087",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
        partyLabel: "Democratic",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:rockaway#8",
        name: "Emanuel Friedlander",
        officeTitle: "Council Member, Ward 5",
        termNote: "Term expires December 31, 2029",
        email: "efriedlander@rockawaytownship.org",
        phone: "973-627-7200 x2089",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
        partyLabel: "Democratic",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:rockaway#9",
        name: "Tucker Kelley",
        officeTitle: "Council Member, Ward 6",
        termNote: "Term expires December 31, 2029",
        email: "tkelley@rockawaytownship.org",
        phone: "973-627-7200 x2082",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
    ],
  },
  {
    // 6e (2026-08-17): read from the county's own page — the same page
    // carries the meeting cadence and the clerk's phone (973-285-6010).
    bodyId: "ocd-division/country:us/state:nj/county:morris#governing",
    bodyName: "Morris County Board of County Commissioners",
    sourceUrl:
      "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
    sourceOrg: "Morris County",
    collectedAt: "2026-08-14",
    // M62, 2026-08-15: PARTISAN — the Morris County Clerk's certified winners
    // lists carry a Party column, and all seven seats were filled through it.
    // Three-year terms, staggered three-three-one across 2023, 2024 and 2025,
    // so three certified documents were needed to cover one board.
    partisanship: "PARTISAN",
    partisanshipSourceUrl: MORRIS_2024_WINNERS,
    members: [
      {
        id: "roster:morris#1",
        name: "Stephen H. Shaw",
        officeTitle: "Commissioner Director",
        termNote: null,
        email: null,
        phone: "973-285-6010",
        websiteUrl:
          "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2024_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:morris#2",
        name: "John Krickus",
        officeTitle: "Commissioner Deputy Director",
        termNote: null,
        email: null,
        phone: "973-285-6010",
        websiteUrl:
          "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2024_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:morris#3",
        name: "Douglas R. Cabana",
        officeTitle: "County Commissioner",
        termNote: null,
        email: null,
        phone: "973-285-6010",
        websiteUrl:
          "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:morris#4",
        name: "Thomas J. Mastrangelo",
        officeTitle: "County Commissioner",
        termNote: null,
        email: null,
        phone: "973-285-6010",
        websiteUrl:
          "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:morris#5",
        name: "Christine Myers",
        officeTitle: "County Commissioner",
        termNote: null,
        email: null,
        phone: "973-285-6010",
        websiteUrl:
          "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2025_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:morris#6",
        name: "Tayfun Selen",
        officeTitle: "County Commissioner",
        termNote: null,
        email: null,
        phone: "973-285-6010",
        websiteUrl:
          "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners/Tayfun-Selen",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2023_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:morris#7",
        name: "Deborah Smith",
        officeTitle: "County Commissioner",
        termNote: null,
        email: null,
        phone: "973-285-6010",
        websiteUrl:
          "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
        partyLabel: "Republican",
        partySourceUrl: MORRIS_2024_WINNERS,
        partySourceOrg: MORRIS_CLERK,
        partyCollectedAt: PARTY_READ,
      },
    ],
  },
  {
    // 6e (2026-08-17): the county's FY2025 annual report directory (marked
    // "Current") is the roster's source — the county site's commissioners
    // index page still names a FORMER District 1 commissioner, and the
    // county's own May 2026 meeting minutes confirm the annual report's
    // three names. The stale page is recorded in the audit, not trusted.
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#governing",
    bodyName: "Merrimack County Board of Commissioners",
    sourceUrl:
      "https://chichesternh.org/DocumentCenter/View/1817/Merrimack-County-Annual-Report-2025",
    sourceOrg: "Merrimack County (FY2025 Annual Report, County Directory)",
    collectedAt: "2026-08-14",
    // M62, 2026-08-15: PARTISAN. New Hampshire county commissioners are
    // elected by district at the state general election, and the Secretary of
    // State's certified county-office results print the party as a letter
    // beside each candidate — "Steve Shurtleff, d", "David Lovlien Jr., r".
    // Two elections were needed: District 2 reads "No Election" in 2024
    // because it is a four-year seat last contested in 2022.
    partisanship: "PARTISAN",
    partisanshipSourceUrl: NH_2024_MERRIMACK_COUNTY,
    members: [
      {
        id: "roster:merrimack#1",
        name: "Stuart D. Trachy",
        officeTitle: "County Commissioner, Chair",
        termNote: "Of Franklin",
        email: null,
        phone: "(603) 796-6800",
        websiteUrl:
          "https://www.merrimackcounty.net/board_of_commissioners_/index.php",
        partyLabel: "Republican",
        partySourceUrl: NH_2022_MERRIMACK_COUNTY,
        partySourceOrg: NH_SOS,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:merrimack#2",
        name: "David M. Lovlien",
        officeTitle: "County Commissioner, Vice Chair",
        termNote: "Of Pembroke",
        email: null,
        phone: "(603) 796-6800",
        websiteUrl:
          "https://www.merrimackcounty.net/board_of_commissioners_/index.php",
        partyLabel: "Republican",
        partySourceUrl: NH_2024_MERRIMACK_COUNTY,
        partySourceOrg: NH_SOS,
        partyCollectedAt: PARTY_READ,
      },
      {
        id: "roster:merrimack#3",
        name: "Stephen Shurtleff",
        officeTitle: "County Commissioner, Clerk",
        termNote: null,
        email: null,
        phone: "(603) 796-6800",
        websiteUrl:
          "https://www.merrimackcounty.net/board_of_commissioners_/index.php",
        partyLabel: "Democratic",
        partySourceUrl: NH_2024_MERRIMACK_COUNTY,
        partySourceOrg: NH_SOS,
        partyCollectedAt: PARTY_READ,
      },
    ],
  },

  {
    // 4a (2026-08-18): the surnames-only defect closed. The district's own
    // Apptegy CMS page publishes full names, roles, terms, and per-member
    // emails — reachable by plain GET at /page/board-members (the content
    // rides in the page's embedded JSON; the tester-pass note that the
    // site "defeated the pipeline" was about the events API, not this
    // page). Seven members as published; trivera@/mmaasin@ on the same
    // page are district-office contacts, not members.
    bodyId:
      "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district#board",
    bodyName: "Rockaway Township Board of Education",
    sourceUrl: "https://www.rocktwp.net/page/board-members",
    sourceOrg: "Rockaway Township School District",
    collectedAt: "2026-08-14",
    // M62, 2026-08-15: NONPARTISAN by statute, and New Jersey says it in one
    // line — N.J.S.A. 19:60-1: "No party designation shall appear on any
    // ballot to be used in a school election." Note what this does NOT mean:
    // the township council two entries up is squarely partisan. Same town,
    // same voters, different ballot, and the app now says so on each.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl: "https://nj.gov/state/dos-statutes-elections-19-60-63.shtml",
    members: [
      {
        id: "roster:rocktwp-boe#1",
        name: "Alison McGeary",
        officeTitle: "Board President",
        termNote: "2024–2026, as published",
        email: "amcgeary@rocktwp.net",
        phone: null,
        websiteUrl: "https://www.rocktwp.net/page/board-members",
      },
      {
        id: "roster:rocktwp-boe#2",
        name: "Noël Anderson",
        officeTitle: "Board Vice President",
        termNote: "2026–2028, as published",
        email: "nanderson@rocktwp.net",
        phone: null,
        websiteUrl: "https://www.rocktwp.net/page/board-members",
      },
      {
        id: "roster:rocktwp-boe#3",
        name: "Lisa Mezik",
        officeTitle: "Board Member",
        termNote: "2024–2026, as published",
        email: "lmezik@rocktwp.net",
        phone: null,
        websiteUrl: "https://www.rocktwp.net/page/board-members",
      },
      {
        id: "roster:rocktwp-boe#4",
        name: "Jacalyn Richardson",
        officeTitle: "Board Member",
        termNote: "2025–2027, as published",
        email: "jrichardson@rocktwp.net",
        phone: null,
        websiteUrl: "https://www.rocktwp.net/page/board-members",
      },
      {
        id: "roster:rocktwp-boe#5",
        name: "Jemila Ann Tourne",
        officeTitle: "Board Member",
        termNote: "2025–2027, as published",
        email: "jtourne@rocktwp.net",
        phone: null,
        websiteUrl: "https://www.rocktwp.net/page/board-members",
      },
      {
        id: "roster:rocktwp-boe#6",
        name: "Jamie Gorman",
        officeTitle: "Board Member",
        termNote: "2026–2028, as published",
        email: "jgorman@rocktwp.net",
        phone: null,
        websiteUrl: "https://www.rocktwp.net/page/board-members",
      },
      {
        id: "roster:rocktwp-boe#7",
        name: "Rachael Brookes",
        officeTitle: "Board Member",
        termNote: "2026, as published",
        email: "rbrookes@rocktwp.net",
        phone: null,
        websiteUrl: "https://www.rocktwp.net/page/board-members",
      },
    ],
  },

  {
    // Item 2, 2026-08-18 session: the Sunnyside catch closed with people,
    // not just pins. Five members with roles as the board's own page states
    // them; the phone is the district line the same page publishes.
    bodyId:
      "ocd-division/country:us/state:az/school_district:sunnyside_unified_district#board",
    bodyName: "Sunnyside Unified School District Governing Board",
    sourceUrl: "https://www.susd12.org/governing-board-home",
    sourceOrg: "Sunnyside Unified School District",
    collectedAt: "2026-08-14",
    // M62, 2026-08-15: NONPARTISAN — same two certified Pima County records
    // as the other Arizona school boards here. No party in the general
    // canvass, no governing-board race in the partisan primary canvass.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl: PIMA_GENERAL_CANVASS,
    members: [
      {
        id: "roster:susd12#1",
        name: "Beki Quintero",
        officeTitle: "Governing Board President",
        termNote: null,
        email: null,
        phone: "(520) 545-2000",
        websiteUrl: "https://www.susd12.org/governing-board-home",
      },
      {
        id: "roster:susd12#2",
        name: "Ted Rodriquez",
        officeTitle: "Governing Board Clerk",
        termNote: null,
        email: null,
        phone: "(520) 545-2000",
        websiteUrl: "https://www.susd12.org/governing-board-home",
      },
      {
        id: "roster:susd12#3",
        name: "Edgar Bustamante",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: "(520) 545-2000",
        websiteUrl: "https://www.susd12.org/governing-board-home",
      },
      {
        id: "roster:susd12#4",
        name: "Consuelo Hernandez",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: "(520) 545-2000",
        websiteUrl: "https://www.susd12.org/governing-board-home",
      },
      {
        id: "roster:susd12#5",
        name: "Roberto Jaramillo",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: "(520) 545-2000",
        websiteUrl: "https://www.susd12.org/governing-board-home",
      },
    ],
  },

  {
    // The other half of the catch. Roles as the district's board-contact
    // page states them; the phone is the board-business line the district's
    // agenda-information page publishes for meeting questions.
    bodyId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district#board",
    bodyName: "Amphitheater Unified School District Governing Board",
    sourceUrl: "https://www.amphi.com/348925_2",
    sourceOrg: "Amphitheater Unified School District",
    collectedAt: "2026-08-14",
    // M62, 2026-08-15: NONPARTISAN — same two certified Pima County records
    // as the other Arizona school boards here. No party in the general
    // canvass, no governing-board race in the partisan primary canvass.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl: PIMA_GENERAL_CANVASS,
    members: [
      {
        id: "roster:amphi#1",
        name: "Vicki Cox Golder",
        officeTitle: "Governing Board President",
        termNote: null,
        email: null,
        phone: "(520) 696-5205",
        websiteUrl: "https://www.amphi.com/348925_2",
      },
      {
        id: "roster:amphi#2",
        name: "Matt Kopec",
        officeTitle: "Governing Board Vice President",
        termNote: null,
        email: null,
        phone: "(520) 696-5205",
        websiteUrl: "https://www.amphi.com/348925_2",
      },
      {
        id: "roster:amphi#3",
        name: "Deanna Day",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: "(520) 696-5205",
        websiteUrl: "https://www.amphi.com/348925_2",
      },
      {
        id: "roster:amphi#4",
        name: "Michael Gemma",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: "(520) 696-5205",
        websiteUrl: "https://www.amphi.com/348925_2",
      },
      {
        id: "roster:amphi#5",
        name: "Susan Zibrat",
        officeTitle: "Governing Board Member",
        termNote: null,
        email: null,
        phone: "(520) 696-5205",
        websiteUrl: "https://www.amphi.com/348925_2",
      },
    ],
  },
];

export function rosterForBody(bodyId: string | null): BodyRoster | null {
  if (!bodyId) return null;
  return BODY_ROSTERS.find((r) => r.bodyId === bodyId) ?? null;
}

/** A roster member in the shape every officeholder surface renders. */
export interface RosterHolder {
  id: string;
  name: string;
  officeTitle: string;
  /** M61: widened from `null`. The type used to forbid a party outright. */
  partyLabel: string | null;
  websiteUrl: string | null;
  sourceUrl: string;
  email: string | null;
  phone: string | null;
  contactFormUrl: null;
  photoUrl: string | null;
  campaignUrl: null;
  /**
   * 6d (2026-08-15): curated local rosters publish no term end and no birth
   * date — the pages they are read from state a name, an office and often a
   * phone number, and nothing else. Both are null here BY SOURCE rather than
   * by omission, and both render as nothing at all. Computing a term from an
   * election cycle, or an age from anywhere, is the guess the whole
   * provenance discipline exists to refuse.
   */
  termEnd: null;
  birthDate: null;
}

/**
 * The roster as `SeatHolder`-shaped rows, so the popup family renders local
 * members with the same machinery as federal and state ones.
 *
 * `partyLabel` used to be null for every curated local, and the reason given
 * for it was wrong (M61, 2026-08-15). It said "these are nonpartisan offices
 * as published" — but none of these bodies publishes party on its own page,
 * and several of the offices are elected on party lines, so a silence about
 * the PAGES was being read as a fact about the OFFICES.
 *
 * **M62 (2026-08-15) filled it in from certified election results**: 30 of
 * the 71 curated local members now carry a party, each with the canvass or
 * certified winners list it was read from. The other 41 carry none, and the
 * roster's `partisanship` says which kind of nothing that is — 39 sit on
 * bodies recorded NONPARTISAN, where no party exists to state, and two sit on
 * partisan bodies having been appointed to a vacancy, where a party exists
 * and no certified result states it. Those two are the honest gap, named on
 * the member rather than left as an anonymous blank.
 *
 * Photos resolve through `roster-photos.json` — a tiny derivative of the
 * licensed manifest (lib/registry/official-photos.json), regenerated by
 * scripts/ship-staged-portraits.mts and pinned in sync by test, because
 * this module is client-bundled and the full manifest is not. A member
 * absent from it renders initials; the bodies' own pages carry portraits
 * of unknown license, and unknown is not clearable (D20).
 */
export function rosterHoldersForBody(bodyId: string | null): RosterHolder[] {
  const roster = rosterForBody(bodyId);
  if (!roster) return [];
  const photos = ROSTER_PHOTOS as Record<string, string>;
  return roster.members.map((member) => ({
    id: member.id,
    name: member.name,
    officeTitle: member.officeTitle,
    // M61: carried through where a roster holds it. Null today for every
    // curated local — see the roster's `partisanship`, which says whether
    // that null means "no party to state" or "not sourced yet".
    partyLabel: member.partyLabel ?? null,
    websiteUrl: member.websiteUrl,
    sourceUrl: roster.sourceUrl,
    email: member.email,
    phone: member.phone,
    contactFormUrl: null,
    photoUrl: photos[member.id] ?? null,
    campaignUrl: null,
    termEnd: null,
    birthDate: null,
  }));
}

/**
 * The division a curated roster holder belongs to, read mechanically off
 * the roster that carries them (item 1, 2026-08-14 second session). The
 * roster's `bodyId` is `<division ocd-id>#<suffix>`; the division part is
 * the jurisdiction the member actually serves. Used to pick
 * jurisdiction-specific office blurbs — the Rockaway mayor rendered
 * Tucson's charter copy because nothing tied the blurb to the holder's own
 * place. Returns null for non-roster holders (federal, state), whose
 * blurbs are jurisdiction-neutral by construction.
 */
export function divisionOcdIdForRosterHolder(
  holderId: string,
): string | null {
  for (const roster of BODY_ROSTERS) {
    if (roster.members.some((member) => member.id === holderId)) {
      return roster.bodyId.split("#")[0];
    }
  }
  return null;
}

/**
 * The governing body's roster for a DIVISION — the registry suffixes a
 * county or municipal governing body `#governing` and a school board
 * `#board`, and the district popup's `#governing`-only lookup meant every
 * school district rendered "no sourced officeholder" over a curated roster
 * (caught 2026-08-18 wiring Sunnyside). Exact keys, both suffixes, never a
 * loose prefix — a division with an advisory-body roster must not have it
 * mistaken for the government.
 */
export function governingRosterHoldersForDivision(
  ocdId: string | null,
): RosterHolder[] {
  if (!ocdId) return [];
  const governing = rosterHoldersForBody(`${ocdId}#governing`);
  return governing.length > 0
    ? governing
    : rosterHoldersForBody(`${ocdId}#board`);
}
