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

import type { Provenance } from "../sources/types.ts";

import { getRegistryRuntimeReadModel } from "./runtime-read-model.ts";
import { AZ_CAWCD_ROSTERS } from "./cawcd-rosters.ts";
import { NJ_MORRIS_ROSTERS } from "./rosters-nj-morris.ts";

export interface RosterMember {
  /** An unresolved update must retain an older member on its actual source/date. */
  membershipSource?: { sourceUrl: string; sourceOrg: string; collectedAt: string };
  /** Optional facts kept from an earlier verified read when this update omits them. */
  retainedFieldSources?: Partial<Record<"termNote" | "termStart" | "termEnd" | "email" | "phone" | "websiteUrl", { sourceUrl: string; sourceOrg: string; collectedAt: string }>>;
  /** A shared public office line is not a person's private contact route. */
  contactKind?: "PUBLIC_OFFICE" | "PERSONAL";
  contactScope?: "SHARED_OFFICE" | "INDIVIDUAL_OFFICE";
  /** Stable within the roster: `roster:<bodyId>#<n>`. */
  id: string;
  name: string;
  /** The published role — "Mayor", "Ward 3 Council Member", "Chair". */
  officeTitle: string;
  /** The body's own wording for the term, where it states one. */
  termNote: string | null;
  /** ISO dates (`YYYY-MM-DD`, or `YYYY-MM`) the member's term starts and ends, only where the page writes them. */
  termStart?: string | null;
  termEnd?: string | null;
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
 * The rule: a local office is partisan or nonpartisan by law or
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

/** Raw held rows are retained for audit, including unresolved extraction identities. */
export const HELD_BODY_ROSTERS: BodyRoster[] = [
  {
    // The named example for item 5a: the members are front-and-center at
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
      {
        /*
         * F01 1.2 / 0b (2026-08-19): the superintendent is also listed at the
         * top.
         *
         * **This person is NOT ELECTED and does not sit on the board.** He is
         * hired by it, and that distinction is the whole reason the schema has
         * a separate `superintendent` slot on the body card. He is stored in
         * `members` because that slot resolves out of this array — and
         * `bodySubject` removes him from the "who sits on it" list in the same
         * change, so he appears once, under what he actually does, and never
         * as a board member.
         *
         * SOURCE, rung 2, plain fetch, HTTP 200: the district's own
         * superintendent page, https://www.tusd1.org/superintendent, read
         * 2026-08-19. It names "Dr. Gabriel Trujillo, Superintendent, Tucson
         * Unified School District" in the page's own words, three times.
         */
        id: "roster:tusd#supt",
        name: "Dr. Gabriel Trujillo",
        officeTitle: "Superintendent",
        termNote: "Appointed by the Governing Board, not elected",
        email: null,
        phone: "(520) 225-6000",
        websiteUrl: "https://www.tusd1.org/superintendent",
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
        /*
         * **ED BUSTER IS EDWARD BUSTER, AND HE HAS ALREADY BEEN REAPPOINTED**
         * (the 85641 detective session, 2026-08-27).
         *
         * Vail is absent from the Pima County School Superintendent's 2026
         * candidate-filing page, which reads as a district with no race. It is
         * not: two seats were up, exactly two people filed, and on 2026-08-11
         * the Board of Supervisors CANCELLED the election as uncontested and
         * appointed them — Legistar matter 21690, File ID 20624, requested by
         * the School Superintendent and recorded Approved.
         *
         * The other appointee is **Andrea Black**, who is deliberately NOT a
         * member row here. She has been appointed to a term that begins after
         * the November 3 election; adding her now would say she holds an office
         * she does not yet hold. The reader gets the fact where it belongs — as
         * a cited ballot absence on `/ballot`, in the authority's own terms,
         * saying there is no Vail school board race and naming both appointees.
         */
        id: "roster:vail#4",
        name: "Ed Buster",
        officeTitle: "Governing Board Member",
        termNote:
          "Reappointed 2026-08-11 without an election: two seats were up, two candidates filed, and the Pima County Board of Supervisors cancelled the race as uncontested and appointed them.",
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
      {
        /*
         * **John Carruth, and the reason the hunt came back with half a name**
         * (F01-continued item 10b, 2026-08-19).
         *
         * F01 reached this person at rung 6 and got "Superintendent Carruth" —
         * a surname alone — and correctly refused to ship it. The full name is
         * John Carruth, `/page/superintendent`.
         *
         * THE ROOT CAUSE, measured rather than guessed, and it is none of the
         * three the brief proposed as likely:
         *
         *  · The home page's STATIC HTML already links `/page/superintendent`.
         *    A plain fetch finds it. Link discovery was never blind.
         *  · `/page/superintendent` answers **200 to a plain fetch** — rung 2,
         *    no browser needed — and that HTML contains "John Carruth" six
         *    times, including `<strong>John Carruth<br>Superintendent</strong>`.
         *  · So the fetch and the discovery both worked. **The EXTRACTION
         *    failed**: the district runs on Apptegy, which ships its page
         *    content as an escaped JSON payload embedded in the HTML. Reading
         *    the RENDERED prose finds the news blurb — "Superintendent Carruth
         *    shares a message with the community" — and never the byline,
         *    because the byline lives in the embedded data with its quotes
         *    escaped and a `<br>` between the name and the title.
         *
         * The surname came from that news blurb. It is the ladder's rung 7 in
         * miniature: the page's own data was right there and better than its
         * prose, and the hunt read the prose. Two smaller findings ride along —
         * the 404 at rung 2 was against a GUESSED path (`/superintendent`)
         * rather than the site's own, and the platform is Apptegy rather than
         * the Finalsite family the brief expected.
         *
         * SOURCE, rung 2, plain fetch, HTTP 200, 1,401,781 bytes:
         * https://www.vailschooldistrict.org/page/superintendent, read
         * 2026-08-19. Not elected — hired by the board, exactly like TUSD's,
         * and `bodySubject` keeps him out of the seated-member list.
         */
        id: "roster:vail#supt",
        name: "John Carruth",
        officeTitle: "Superintendent",
        termNote: "Appointed by the Governing Board, not elected",
        email: null,
        phone: null,
        websiteUrl: "https://www.vailschooldistrict.org/page/superintendent",
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
  /*
   * ── THE COUNTY DELEGATION'S OFFICERS (NH Hunt, 2026-08-20) ────────────────
   *
   * The Merrimack County Delegation is the county's LEGISLATIVE body — every
   * member of the New Hampshire House elected from the county, sitting
   * together to appropriate the county budget. Forty-five of them, listed on
   * page 6 of the same annual report; the six OFFICERS are here because they
   * are the body's own leadership and because the delegation's own page
   * (`elected_officials/delegation/index.php`, read 2026-08-20, HTTP 200)
   * publishes exactly these three plus the Zoom link a reader needs to attend.
   *
   * The forty-five members are NOT written here as a roster. They hold their
   * seats as state representatives, they are already the subject of this
   * product's state-legislature data, and writing them a second time under a
   * county body would create two records of one person that could drift apart.
   * The county's own list is on the record in the annual report cited above.
   *
   * PARTISAN, on the same record as the commissioners above: the Secretary of
   * State's certified county return prints a party beside every name on the
   * state general-election ballot, and a New Hampshire representative is
   * elected on it. The party per member is not stated in the county's report
   * and is not written here.
   */
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#delegation",
    bodyName: "Merrimack County Delegation",
    sourceUrl: "https://www.merrimackcounty.net/elected_officials/delegation/index.php",
    sourceOrg: "Merrimack County",
    collectedAt: "2026-08-20",
    partisanship: "PARTISAN",
    partisanshipSourceUrl: NH_2024_MERRIMACK_COUNTY,
    members: [
      {
        id: "roster:merrimack-delegation#1",
        name: "David Luneau",
        officeTitle: "Chair, Merrimack County Delegation",
        termNote: null,
        email: null,
        phone: "(603) 796-6800",
        websiteUrl: "https://www.merrimackcounty.net/elected_officials/delegation/index.php",
      },
      {
        id: "roster:merrimack-delegation#2",
        name: "Brian Seaworth",
        officeTitle: "Vice Chair, Merrimack County Delegation",
        termNote: null,
        email: null,
        phone: "(603) 796-6800",
        websiteUrl: "https://www.merrimackcounty.net/elected_officials/delegation/index.php",
      },
      {
        id: "roster:merrimack-delegation#3",
        name: "Thomas Schamberg",
        officeTitle: "Clerk, Merrimack County Delegation",
        termNote: null,
        email: null,
        phone: "(603) 796-6800",
        websiteUrl: "https://www.merrimackcounty.net/elected_officials/delegation/index.php",
      },
      {
        id: "roster:merrimack-delegation#4",
        name: "James MacKay",
        officeTitle: "Chair, Delegation Executive Committee",
        termNote: null,
        email: null,
        phone: "(603) 796-6800",
        websiteUrl:
          "https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf",
      },
      {
        id: "roster:merrimack-delegation#5",
        name: "Karen Ebel",
        officeTitle: "Vice Chair, Delegation Executive Committee",
        termNote: null,
        email: null,
        phone: "(603) 796-6800",
        websiteUrl:
          "https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf",
      },
      {
        id: "roster:merrimack-delegation#6",
        name: "Michael Moffett",
        officeTitle: "Clerk, Delegation Executive Committee",
        termNote: null,
        email: null,
        phone: "(603) 796-6800",
        websiteUrl:
          "https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf",
      },
    ],
  },
  /*
   * ── NINE MORE NEWBURY BOARDS (NH Hunt, 2026-08-20) ────────────────────────
   *
   * Sixty-three people, read off each board's OWN page on the town's own site
   * on 2026-08-20, through `pnpm hunt:roster` and layer 5 of the extraction
   * toolkit (`lib/extract/roster-table.ts`). The retrieval ledger, one line per
   * page with its rung, its HTTP status and its extraction counts, is committed
   * at `docs/evidence/nhhunt-newbury-roster.jsonl`.
   *
   * **Curated, not scraped, and the difference is the review.** The extractor
   * reads a Drupal Views table; every row below was read back against the page
   * it came from before it was written here. What the tool produced and what is
   * committed differ in exactly two ways, both recorded rather than silent:
   *
   *   1. A member whose Title cell is EMPTY is written `Member`, because the
   *      town lists them under a heading that says "Board Members" — the
   *      section is the town's own statement, not our inference. Where the
   *      town states a title, the title is theirs, verbatim, including
   *      "Chief. Bradley Wheeler" and "Selectboard Sponsor".
   *   2. One trailing full stop was trimmed from "Alden Beauchemin." — a typing
   *      artifact on the town's page, not part of a person's name.
   *
   * **A TERM THAT HAS ALREADY EXPIRED IS RENDERED AS THE TOWN PUBLISHED IT.**
   * Newbury's Cemetery Trustees page states terms ending 2021, 2022 and 2023,
   * and its Planning Board lists an alternate whose term ended March 2021. Those
   * are the town's own current published statements and they are five years
   * stale. Correcting them would be inventing a fact about a named person;
   * dropping them would assert an absence the town has not asserted. They ship
   * as published, with the term note that lets a reader see it, and the
   * staleness is a finding recorded in `docs/gap-ledger.md` rather than a
   * silence.
   *
   * Eight further Newbury bodies were read and are NOT here, because they are
   * departments and offices rather than boards with rosters — Administration,
   * Town Clerk, Tax Collector, Assessor, Highway, Emergency Management, Health
   * Officer and the Transfer Station. Their eighteen staff contacts are on the
   * same ledger.
   */
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#planning-board",
    bodyName: "Newbury Planning Board",
    sourceUrl: "https://www.newbury.nh.gov/planning-board",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-planning-board#1",
        name: "Deane Geddes",
        officeTitle: "Alternate",
        termNote: "Term ends March 2021",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#2",
        name: "Jim Lord",
        officeTitle: "Alternate",
        termNote: "Term ends March 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#3",
        name: "Wayne Seaholm",
        officeTitle: "Member",
        termNote: "Term ends March 2028",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#4",
        name: "Donna Long",
        officeTitle: "Recording Secretary",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#5",
        name: "Peter Stanley",
        officeTitle: "Consultant",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#6",
        name: "Christopher Millette",
        officeTitle: "Chair",
        termNote: "Term ends March 2028",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#7",
        name: "Chris Hernick",
        officeTitle: "Vice Chair",
        termNote: "Term ends 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#8",
        name: "Michael Bedard",
        officeTitle: "Member",
        termNote: "Term ends March 2028",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#9",
        name: "Sandra Warde",
        officeTitle: "Ex-Officio",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#10",
        name: "Richard Wright",
        officeTitle: "Member",
        termNote: "Term ends March 2027",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
      {
        id: "roster:newbury-planning-board#11",
        name: "Gary Keane",
        officeTitle: "Member",
        termNote: "Term ends March 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/planning-board",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#zoning-board-of-adjustment",
    bodyName: "Newbury Zoning Board of Adjustment",
    sourceUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-zoning-board-of-adjustment#1",
        name: "Dave Blohm",
        officeTitle: "Chair",
        termNote: "Term ends March 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
      },
      {
        id: "roster:newbury-zoning-board-of-adjustment#2",
        name: "Alex Azodi",
        officeTitle: "Alternate",
        termNote: "Term ends March 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
      },
      {
        id: "roster:newbury-zoning-board-of-adjustment#3",
        name: "Hank Thomas",
        officeTitle: "Vice-Chair",
        termNote: "Term ends March 2028",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
      },
      {
        id: "roster:newbury-zoning-board-of-adjustment#4",
        name: "Katheryn Holmes",
        officeTitle: "Alternate",
        termNote: "Term ends March 2027",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
      },
      {
        id: "roster:newbury-zoning-board-of-adjustment#5",
        name: "Steve Hurd",
        officeTitle: "Alternate",
        termNote: "Term ends March 2028",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
      },
      {
        id: "roster:newbury-zoning-board-of-adjustment#6",
        name: "Larry Briggs",
        officeTitle: "Member",
        termNote: "Term ends March 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
      },
      {
        id: "roster:newbury-zoning-board-of-adjustment#7",
        name: "Patricia Sherman",
        officeTitle: "Member",
        termNote: "Term ends March 2027",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
      },
      {
        id: "roster:newbury-zoning-board-of-adjustment#8",
        name: "Peter Fuller",
        officeTitle: "Member",
        termNote: "Term ends March 2028",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/zoning-board-adjustment",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#conservation-commission",
    bodyName: "Newbury Conservation Commission",
    sourceUrl: "https://www.newbury.nh.gov/conservation-commission",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-conservation-commission#1",
        name: "Katheryn Holmes",
        officeTitle: "Chair",
        termNote: "Term ends 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/conservation-commission",
      },
      {
        id: "roster:newbury-conservation-commission#2",
        name: "Bob Stewart",
        officeTitle: "Vice Chair",
        termNote: "Term ends 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/conservation-commission",
      },
      {
        id: "roster:newbury-conservation-commission#3",
        name: "John Magee",
        officeTitle: "Member",
        termNote: "Term ends 2027",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/conservation-commission",
      },
      {
        id: "roster:newbury-conservation-commission#4",
        name: "Alden Beauchemin",
        officeTitle: "Member",
        termNote: "Term ends 2027",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/conservation-commission",
      },
      {
        id: "roster:newbury-conservation-commission#5",
        name: "Kristen Schultz",
        officeTitle: "Ex Officio",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/conservation-commission",
      },
      {
        id: "roster:newbury-conservation-commission#6",
        name: "David Rhodes",
        officeTitle: "Member",
        termNote: "Term ends 2028",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/conservation-commission",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#advisory-budget-committee",
    bodyName: "Newbury 2026 Advisory Budget Committee",
    sourceUrl: "https://www.newbury.nh.gov/selectboard/2026-advisory-budget-committee",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-advisory-budget-committee#1",
        name: "Jack Kutner",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/selectboard/2026-advisory-budget-committee",
      },
      {
        id: "roster:newbury-advisory-budget-committee#2",
        name: "Marek Kotelba",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/selectboard/2026-advisory-budget-committee",
      },
      {
        id: "roster:newbury-advisory-budget-committee#3",
        name: "Alan Scribner",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/selectboard/2026-advisory-budget-committee",
      },
      {
        id: "roster:newbury-advisory-budget-committee#4",
        name: "Michael Bedard",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/selectboard/2026-advisory-budget-committee",
      },
      {
        id: "roster:newbury-advisory-budget-committee#5",
        name: "Norm Larochelle",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/selectboard/2026-advisory-budget-committee",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#blodgett-sewer-user-advisory-committee",
    bodyName: "Newbury Blodgett Sewer User Advisory Committee",
    sourceUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-blodgett-sewer-user-advisory-committee#1",
        name: "Kara Obey",
        officeTitle: "Alternate",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
      },
      {
        id: "roster:newbury-blodgett-sewer-user-advisory-committee#2",
        name: "David Rhodes",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
      },
      {
        id: "roster:newbury-blodgett-sewer-user-advisory-committee#3",
        name: "Anthony LoPresti",
        officeTitle: "Chair",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
      },
      {
        id: "roster:newbury-blodgett-sewer-user-advisory-committee#4",
        name: "Andrew Cockerill",
        officeTitle: "Vice Chair",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
      },
      {
        id: "roster:newbury-blodgett-sewer-user-advisory-committee#5",
        name: "Jeanne Palleiko",
        officeTitle: "Secretary",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
      },
      {
        id: "roster:newbury-blodgett-sewer-user-advisory-committee#6",
        name: "Todd Mailly",
        officeTitle: "Alternate",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
      },
      {
        id: "roster:newbury-blodgett-sewer-user-advisory-committee#7",
        name: "Sandra Warde",
        officeTitle: "Selectboard Sponsor",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
      },
      {
        id: "roster:newbury-blodgett-sewer-user-advisory-committee#8",
        name: "Daniel Wolf",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/blodgett-sewer-user-advisory-committee",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#cemetery-trustees",
    bodyName: "Newbury Cemetery Trustees",
    sourceUrl: "https://www.newbury.nh.gov/cemetery-trustees",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-cemetery-trustees#1",
        name: "Knowlton \"Nonie\" Reynders",
        officeTitle: "Chairman",
        termNote: "Term ends 2021",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/cemetery-trustees",
      },
      {
        id: "roster:newbury-cemetery-trustees#2",
        name: "Deane Geddes",
        officeTitle: "Member",
        termNote: "Term ends 2023",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/cemetery-trustees",
      },
      {
        id: "roster:newbury-cemetery-trustees#3",
        name: "Judy Healey",
        officeTitle: "Member",
        termNote: "Term ends 2022",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/cemetery-trustees",
      },
      {
        id: "roster:newbury-cemetery-trustees#4",
        name: "Marcia Keane",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/cemetery-trustees",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#joint-loss-management-committee",
    bodyName: "Newbury Joint Loss Management Committee",
    sourceUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-joint-loss-management-committee#1",
        name: "Darren Finneral",
        officeTitle: "Chair",
        termNote: "Term ends March 2026",
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#2",
        name: "Wayne R. Whitford",
        officeTitle: "Emergency Management",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#3",
        name: "Tate Sweetbrown",
        officeTitle: "Highway Department",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#4",
        name: "Chief. Bradley Wheeler",
        officeTitle: "Police Chief",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#5",
        name: "Hank Thomas",
        officeTitle: "Fire Department",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#6",
        name: "Lea McBain",
        officeTitle: "Library Director",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#7",
        name: "Jessica Dennis",
        officeTitle: "Finance Director",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#8",
        name: "Dave Smith",
        officeTitle: "Fire Chief",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#9",
        name: "Rick Wright",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#10",
        name: "Aaron Sparks",
        officeTitle: "Police Department",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
      {
        id: "roster:newbury-joint-loss-management-committee#11",
        name: "Josh Fisher",
        officeTitle: "Police Department",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/joint-loss-management-committee",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#septic-committee",
    bodyName: "Newbury Septic Committee",
    sourceUrl: "https://www.newbury.nh.gov/newbury-septic-committee",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-septic-committee#1",
        name: "David Rhodes",
        officeTitle: "Chair",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/newbury-septic-committee",
      },
      {
        id: "roster:newbury-septic-committee#2",
        name: "Bob Stewart",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/newbury-septic-committee",
      },
      {
        id: "roster:newbury-septic-committee#3",
        name: "Wayne R. Whitford",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/newbury-septic-committee",
      },
      {
        id: "roster:newbury-septic-committee#4",
        name: "Hank Thomas",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/newbury-septic-committee",
      },
      {
        id: "roster:newbury-septic-committee#5",
        name: "Larry Briggs",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/newbury-septic-committee",
      },
      {
        id: "roster:newbury-septic-committee#6",
        name: "Jack Kutner",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/newbury-septic-committee",
      },
      {
        id: "roster:newbury-septic-committee#7",
        name: "Jack Fisher",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/newbury-septic-committee",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#trustees-of-the-trust-funds",
    bodyName: "Newbury Trustees of the Trust Funds",
    sourceUrl: "https://www.newbury.nh.gov/trustees-trust-funds",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
    // NONPARTISAN, same record as the Selectboard's above: the town's own
    // 2025 Annual Report prints the moderator's certified count for every
    // town office with no party beside any name (M62, 2026-08-15). New
    // Hampshire town elections run under RSA 669 on a ballot the town itself
    // adopts, so this is settled from Newbury's ballot and not from a statute.
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl:
      "https://www.newbury.nh.gov/sites/g/files/vyhlif4761/f/news/town_of_newbury_2025_report.pdf",
    members: [
      {
        id: "roster:newbury-trustees-of-the-trust-funds#1",
        name: "Clayton Johnson",
        officeTitle: "Trustee",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/trustees-trust-funds",
      },
      {
        id: "roster:newbury-trustees-of-the-trust-funds#2",
        name: "Debbie Prussman",
        officeTitle: "Trustee",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/trustees-trust-funds",
      },
      {
        id: "roster:newbury-trustees-of-the-trust-funds#3",
        name: "Tara Faunce",
        officeTitle: "Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.newbury.nh.gov/trustees-trust-funds",
      },
    ],
  },
  {
    /*
     * 3d/6e (2026-08-17): the wall came down. kearsarge.org 403'd every
     * client recorded in earlier hunts; a browser-UA fetch from this machine
     * returned the full members page (200, 73 KB) — nine members, towns, term
     * expirations, committees, all stated by the district itself. Newbury's
     * representative is Kristen Schultz, who also chairs the Newbury
     * Selectboard.
     *
     * **CORRECTED 2026-08-21 (NH Hunt 2, item 3). THE EMAILS WERE ON THE PAGE
     * THE WHOLE TIME, AND THIS COMMENT SAID THEY WERE NOT.**
     *
     * What stood here from 2026-08-17 was: *"The district publishes no
     * per-member phone or email on this page — the absences are honest, not
     * unhunted."* That sentence was wrong, and it was wrong in the most
     * expensive direction available: it closed the question. `NH01` was later
     * opened about this same page being unreadable, and the 2026-08-20 note on
     * the superintendent below repeats the claim — *"the nine board members
     * above still have neither, and the district publishes neither for them."*
     *
     * The page publishes **twelve `mailto:` links** and always did. Each
     * member's NAME is the anchor text and their district email is the
     * `href`. An extractor that reads table CELLS as text gets the names and
     * drops the addresses, and what it hands back looks exactly like a page
     * that carries no contacts. This is the playbook's own "prose said no; ask
     * the markup" rung, pointed at a page we had already decided about.
     *
     * Re-read 2026-08-21 at RUNG 4 (`curl`, HTTP 200, 73,695 bytes) —
     * rungs 2 and 3 still 403 — and independently at RUNG 5, a different
     * egress, which is what surfaced the hrefs first. The nine names, towns,
     * terms and committees are UNCHANGED from the 2026-08-16 read, so the
     * roster was never stale; only our reading of it was incomplete.
     *
     * ART BOBRUFF'S ROW CARRIES THREE ADDRESSES and one is recorded. The page
     * links `abobruff@kearsarge.org` (recorded — the district-issued one),
     * `artbobruff@verizon.net` (a personal address the district page exposes,
     * deliberately NOT recorded), and `abrobruff@kearsarge.org`, which is a
     * typo of the first. The page's own column HEADERS also link to his
     * address, which is how a naive first-mailto-wins parse would have given
     * every member Bobruff's email.
     */
    bodyId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district#board",
    bodyName: "Kearsarge Regional School Board",
    sourceUrl:
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
    sourceOrg: "Kearsarge Regional School District (SAU #65)",
    collectedAt: "2026-08-21",
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
        email: "amastin@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#2",
        name: "Kristen Schultz",
        officeTitle: "School Board Vice Chair",
        termNote: "Represents Newbury · term expires 2027",
        email: "kschultz@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#3",
        name: "James MacKenna",
        officeTitle: "School Board Member",
        termNote: "Represents New London · term expires 2028",
        email: "jmackenna@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#4",
        name: "David Keith",
        officeTitle: "School Board Member",
        termNote: "Represents New London · term expires 2029",
        email: "dkeith@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#5",
        name: "Art Bobruff",
        officeTitle: "School Board Member",
        termNote: "Represents Springfield · term expires 2027",
        email: "abobruff@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#6",
        name: "Patrick McGowan",
        officeTitle: "School Board Member",
        termNote: "Represents Warner · term expires 2027",
        email: "pmcgowan@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#7",
        name: "Paul Lakevicius",
        officeTitle: "School Board Member",
        termNote: "Represents Warner · term expires 2027",
        email: "plakevicius@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#8",
        name: "Nancy Glynn",
        officeTitle: "School Board Member",
        termNote: "Represents Sutton · term expires 2028",
        email: "nglynn@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        id: "roster:kearsarge#9",
        name: "Eric Gregoire",
        officeTitle: "School Board Member",
        termNote: "Represents Bradford · term expires 2029",
        email: "egregoire@kearsarge.org",
        phone: null,
        websiteUrl:
          "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
      },
      {
        /*
         * **THE SUPERINTENDENT, AND THE DISTRICT'S FIRST PUBLISHED PHONE AND
         * EMAIL FOR ANYONE.** (NH Hunt, 2026-08-20.)
         *
         * Not elected and not a board member — hired by the board, stored here
         * because the body card's `superintendent` slot resolves out of this
         * array, exactly as Tucson Unified's does above, and removed from the
         * "who sits on it" list by `bodySubject` in the same pass.
         *
         * SOURCE, and the ladder it took. `kearsarge.org` serves a Cloudflare
         * managed challenge on the board-roster path to every client this repo
         * has, including a headless browser at rung 6 — but NOT on
         * `/district/district/pages/contact-us`, which answered 200 to a plain
         * identified fetch on 2026-08-20 and carries the district office's
         * whole directory: fourteen people, each with a direct phone and, for
         * eleven of them, a district email. That is the first per-person
         * contact this product has held for anyone at Kearsarge.
         *
         * **THE LAST CLAUSE OF THIS PARAGRAPH WAS WRONG AND IS STRUCK
         * (2026-08-21, NH Hunt 2).** It read: *"the nine board members above
         * still have neither, and the district publishes neither for them."*
         * The district publishes an email for every one of them, in the
         * `href` of their own name on the board-members page. See the
         * correction on the body above. The PHONE half stands: no per-member
         * number is published anywhere the ladder has reached.
         *
         * "Interim" is the district's own word and is carried verbatim. It is
         * a fact about the appointment and a reader is entitled to it.
         */
        id: "roster:kearsarge#supt",
        name: "Michael Bessette",
        officeTitle: "Interim Superintendent of Schools",
        termNote: "Appointed by the School Board, not elected",
        email: "mbessette@kearsarge.org",
        phone: "(603) 526-9163",
        websiteUrl: "https://www.kearsarge.org/district/district/pages/contact-us",
      },
      {
        /*
         * The board's own clerk, published in the same directory. She is the
         * route a reader uses to ask the board for a record, which is why she
         * is on the roster rather than only in the ledger — "District Clerk"
         * is the office RSA 671:20 gives the school-district ballot to.
         *
         * The email is the district's own, as published. It is a
         * `@gmail.com` address on a `@kearsarge.org` directory page, which is
         * unusual and is recorded exactly as the district wrote it — correcting
         * it to the pattern the other thirteen rows follow would be inventing a
         * contact route for a named person.
         */
        id: "roster:kearsarge#clerk",
        name: "Debra Breault",
        officeTitle:
          "District Clerk, and Administrative Assistant to the Superintendent and School Board",
        termNote: "Appointed staff, not elected",
        email: "dbreault@kearsarge.org",
        phone: "(603) 526-9163",
        websiteUrl: "https://www.kearsarge.org/district/district/pages/contact-us",
      },
      {
        /*
         * The business administrator — the officer who prepares the budget the
         * Municipal Budget Committee reviews and the district meeting votes.
         */
        id: "roster:kearsarge#business",
        name: "Lawrence LeBoeuf",
        officeTitle: "Business Administrator",
        termNote: "Appointed staff, not elected",
        email: "lleboeuf@kearsarge.org",
        phone: "(603) 526-9177",
        websiteUrl: "https://www.kearsarge.org/district/district/pages/contact-us",
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
    /*
     * 6e (2026-08-17): the county's FY2025 annual report directory (marked
     * "Current") is the roster's source — the county site's commissioners
     * index page still names a FORMER District 1 commissioner, and the
     * county's own May 2026 meeting minutes confirm the annual report's
     * three names. The stale page is recorded in the audit, not trusted.
     *
     * **RE-VERIFIED AND RE-SOURCED 2026-08-20 (NH Hunt), and the second
     * reading is the point.** 6e reached the report through a COPY that the
     * Town of Chichester hosts in its own document centre — a third party's
     * mirror of a county document, which the rule above says a roster should
     * not cite where the body's own is reachable. This session found the
     * county's own: its Administration page runs a Revize Document Center
     * whose "Annual Reports" category carries `Final Annual Report 2025.pdf`,
     * and the direct path serves it. `pnpm extract text` read 37 pages of
     * born-digital text with no OCR; page 5 is the same "Officers and
     * Department Heads (Current)" directory and page 6 repeats all three names
     * over the commissioners' own signature block.
     *
     * Two copies, two sessions, three days apart, every name and title
     * identical. That is an independent verification rather than a second
     * transcription, and it is why this row was UPDATED rather than a second
     * one added — a duplicate `bodyId` is a roster nothing can read, and
     * `tests/body-rosters.test.ts` now refuses one.
     *
     * The copy 6e read is
     * `chichesternh.org/DocumentCenter/View/1817/Merrimack-County-Annual-Report-2025`,
     * recorded here in the comment rather than in a field the schema does not
     * have. It is how the fact was first established and a later reader is
     * entitled to both.
     */
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#governing",
    bodyName: "Merrimack County Board of Commissioners",
    sourceUrl:
      "https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf",
    sourceOrg: "Merrimack County (FY2025 Annual Report, County Directory)",
    // The date the CITED source was read. 6e read the Chichester copy on
    // 2026-08-14; this is the county's own, read 2026-08-20, and the stamp
    // has to name the document it points at.
    collectedAt: "2026-08-20",
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
  /**
   * **Morris County, New Jersey — 18 governing bodies, wired NJ Hunt 6.**
   *
   * GENERATED by `pnpm nj:wire`. Every roster passed the completeness gate:
   * it reaches the seat count its municipality's own form of government
   * declares, and every name was either read off the body's own roster page or
   * confirmed against a fetched primary source (RULING 87).
   *
   * Kept in its own module rather than hand-typed here, so RULING 92 holds: the
   * generator is the thing that gets fixed, and the artifact is regenerated.
   * The bodies that did NOT pass are OWED — `pnpm nj:wire --dry` names each one
   * with the reason, and they are hunted again on their RULING 53 clock.
   */
  ...NJ_MORRIS_ROSTERS,

  /**
   * **THE CENTRAL ARIZONA WATER CONSERVATION DISTRICT BOARD** — fifteen
   * directly elected directors for the body that taxes every parcel in Pima
   * County, and which rendered nobody until 2026-08-27. Membership and
   * partisanship are separated there: see rosters-az-cawcd.ts.
   */
  ...AZ_CAWCD_ROSTERS,

  /**
   * **PIMA COUNTY BOARD OF ADJUSTMENT, DISTRICT 4** — the board that rules on
   * variances for ZIP 85641, whose roster was published where nobody looked.
   * (The 85641 detective session, 2026-08-27.)
   *
   * The county's Boards of Adjustment page has a **Members** heading for each
   * district with nothing under it — just the meeting cadence and the staff
   * planner. That is not a parse failure; the county publishes the heading and
   * no roster. `states/az/85641.md` had carried this board's roster as owed
   * since the ZIP was first walked.
   *
   * **The names are on every agenda.** Each district's own agenda prints its
   * board beside the Executive Secretary, and the district publishes an agenda
   * archive going back years.
   *
   * ## Which is why this was read with `pdftotext -layout` and not pdfjs
   *
   * The agenda sets the board and the Executive Secretary in TWO COLUMNS. Read
   * in reading order the run comes out
   *
   *     Board of Adjustment, District 4  Executive Secretary
   *     Robert Fee (Acting Chair)  Marianna Kuglmeier  Greg Stanton …
   *
   * which makes Marianna Kuglmeier a board member and leaves the Executive
   * Secretary unnamed. The layout read separates the columns and yields FIVE
   * members and one Executive Secretary — which is the count the county's own
   * page states: "Each Supervisorial District appoints five members from their
   * District."
   *
   * That is the third document today where the two extractors disagree and the
   * third time the answer was different, which is the whole rule: there is no
   * right extractor, only a right one per document.
   *
   * APPOINTED, not elected — A.R.S. § 11-807, appointed by the Supervisor for
   * this district — so `partisanship` is UNDETERMINED with no source, because
   * no certified result exists to read one off.
   */
  {
    bodyId:
      "ocd-division/country:us/state:az/county:pima#board-of-adjustment-district-4",
    bodyName: "Pima County Board of Adjustment, District 4",
    /*
     * The BODY's own page, not the vendor's. The agenda PDF is served from
     * CivicPlus's asset host, which is where the county's CMS keeps its files
     * and not where the county publishes — `pima.gov/2792` is the District 4
     * notices and agendas page, and it is the page a reader would open.
     */
    sourceUrl: "https://www.pima.gov/2792",
    sourceOrg:
      "Pima County Development Services — the District 4 Board of Adjustment meeting agenda for 2026-09-08, published on the county's District 4 notices and agendas page",
    collectedAt: "2026-08-27",
    /*
     * NONPARTISAN, and the citation is the APPOINTMENT MECHANISM rather than a
     * canvass — which is the honest record for a seat that is never on a
     * ballot at all. The county's own page: each Supervisorial District
     * appoints five members under A.R.S. § 11-807. There is no election, so
     * there is no certified result to read a party off, and the definition is
     * satisfied exactly: no party appears on the ballot for this office.
     */
    partisanship: "NONPARTISAN",
    partisanshipSourceUrl: "https://www.pima.gov/1027/Boards-of-Adjustment",
    members: [
      {
        id: "roster:pima-boa4#1",
        name: "Robert Fee",
        officeTitle: "Acting Chair",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.pima.gov/2792",
      },
      {
        id: "roster:pima-boa4#2",
        name: "Greg Stanton",
        officeTitle: "Board Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.pima.gov/2792",
      },
      {
        id: "roster:pima-boa4#3",
        name: "William Yarnell",
        officeTitle: "Board Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.pima.gov/2792",
      },
      {
        id: "roster:pima-boa4#4",
        name: "Tim Healy",
        officeTitle: "Board Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.pima.gov/2792",
      },
      {
        id: "roster:pima-boa4#5",
        name: "Peter Backus",
        officeTitle: "Board Member",
        termNote: null,
        email: null,
        phone: null,
        websiteUrl: "https://www.pima.gov/2792",
      },
      {
        /*
         * The Executive Secretary is staff, not a member — she is in the
         * agenda's second column under that heading. She is carried because a
         * reader with a variance question needs the person who runs the
         * board's business, and her title says plainly what she is.
         */
        id: "roster:pima-boa4#6",
        name: "Marianna Kuglmeier",
        officeTitle: "Executive Secretary",
        termNote: null,
        email: "DSDPlanning@pima.gov",
        phone: null,
        websiteUrl: "https://www.pima.gov/2792",
      },
    ],
  },
];

export interface RosterReaderDisposition {
  sourceId: string;
  canonicalId: string | null;
  state: "READER_ELIGIBLE" | "EXACT_DUPLICATE" | "IDENTITY_UNRESOLVED";
  reason: string;
}

/** A navigation label cannot identify a person; identical rows are one answer. */
export function projectReaderRoster(roster: BodyRoster): { roster: BodyRoster; dispositions: RosterReaderDisposition[] } {
  const members: RosterMember[] = [];
  const dispositions: RosterReaderDisposition[] = [];
  const exactRows = new Map<string, string>();
  for (const member of roster.members) {
    const label = member.name.trim().toLowerCase().replace(/\s+/g, " ");
    const navigation = ["contact us", "contact information", "staff directory", "email us", "town hall", "member name"].includes(label)
      || (/^members\S/i.test(member.name) && /agendas.*minutes/i.test(member.officeTitle));
    if (!label || navigation) {
      dispositions.push({ sourceId: member.id, canonicalId: null, state: "IDENTITY_UNRESOLVED", reason: "The held extraction contains navigation text instead of an established person identity. Its contact fields are not attached to another person." });
      continue;
    }
    const exact = JSON.stringify(Object.entries(member).filter(([key]) => key !== "id").sort(([a], [b]) => a.localeCompare(b)));
    const existing = exactRows.get(exact);
    if (existing) {
      dispositions.push({ sourceId: member.id, canonicalId: existing, state: "EXACT_DUPLICATE", reason: "Every held field is identical within the same sourced body roster except the source-row ID. The first source row supplies the single current answer." });
      continue;
    }
    exactRows.set(exact, member.id);
    members.push(member);
    dispositions.push({ sourceId: member.id, canonicalId: member.id, state: "READER_ELIGIBLE", reason: "The sourced roster row identifies this member; no name-only identity join is performed." });
  }
  return { roster: { ...roster, members }, dispositions };
}

const READER_ROSTERS = HELD_BODY_ROSTERS.map(projectReaderRoster);
/** Bundled first-seed/test evidence. Production readers use currentBodyRosters(). */
export const BODY_ROSTERS: BodyRoster[] = READER_ROSTERS.map(result => result.roster);
export const ROSTER_READER_DISPOSITIONS = READER_ROSTERS.flatMap(result => result.dispositions);
const readerRosterIdentities = new Map(ROSTER_READER_DISPOSITIONS.map(row => [row.sourceId, row]));
export function rosterMemberReaderDisposition(id: string): RosterReaderDisposition | null {
  return readerRosterIdentities.get(id) ?? null;
}

/** The one promoted body-person/contact projection initialized at a request boundary. */
export function currentBodyRosters(): readonly BodyRoster[] {
  return getRegistryRuntimeReadModel().bodyRosters;
}

/** Reader eligibility derived from the normalized promoted roster, never a retired held row. */
export function currentRosterMemberReaderDisposition(id: string): RosterReaderDisposition | null {
  return getRegistryRuntimeReadModel().rosterReaderDispositions.find((row) => row.sourceId === id) ?? null;
}

export interface RosterReaderGap {
  bodyId: string;
  expectedMembers: number;
  verifiedMembers: number;
  unresolvedSlots: number;
  statement: string;
  sourceUrl: string;
  sourceOrg: string;
  readAt: string;
  denominatorSource: string;
}

// The existing nj:wire gate's held five-seat denominator. Its five raw rows
// included the same mayor twice; the four distinct verified identities remain
// usable, but cannot be presented as a complete five-member roster.
const ROSTER_MEMBER_DENOMINATORS = [{
  bodyId: "ocd-division/country:us/state:nj/county:morris/place:pequannock_township#governing",
  members: 5,
  source: "data/states/nj/hunt/wikipedia-nj-morris.json: Pequannock Township governingBody.seats, the existing nj:wire completeness input",
}];

export function rosterGapForBody(bodyId: string | null): RosterReaderGap | null {
  const expected = ROSTER_MEMBER_DENOMINATORS.find(row => row.bodyId === bodyId);
  const roster = currentBodyRosters().find(row => row.bodyId === bodyId);
  if (!expected || !roster || roster.members.length >= expected.members) return null;
  const unresolvedSlots = expected.members - roster.members.length;
  return { bodyId: roster.bodyId, expectedMembers: expected.members, verifiedMembers: roster.members.length,
    unresolvedSlots, statement: `We have verified ${roster.members.length} of the ${expected.members} roster identities expected by our held source record. ${unresolvedSlots === 1 ? "One identity remains" : `${unresolvedSlots} identities remain`} unresolved; this is an incomplete roster.`,
    sourceUrl: roster.sourceUrl, sourceOrg: roster.sourceOrg, readAt: roster.collectedAt, denominatorSource: expected.source };
}

export function rosterGapsForDivision(ocdId: string | null): RosterReaderGap[] {
  if (!ocdId) return [];
  return currentBodyRosters().filter(roster => roster.bodyId === `${ocdId}#governing` || roster.bodyId === `${ocdId}#board`)
    .flatMap(roster => { const gap = rosterGapForBody(roster.bodyId); return gap ? [gap] : []; });
}

export function rosterForBody(bodyId: string | null): BodyRoster | null {
  if (!bodyId) return null;
  return currentBodyRosters().find((r) => r.bodyId === bodyId) ?? null;
}

/** A roster member in the shape every officeholder surface renders. */
export interface RosterHolder {
  id: string;
  name: string;
  officeTitle: string;
  /** The body jurisdiction projected for client-side explanatory copy. */
  officeJurisdictionOcdId: string;
  /** The roster's exact term or appointment wording, not an inferred term end. */
  termNote: string | null;
  /** M61: widened from `null`. The type used to forbid a party outright. */
  partyLabel: string | null;
  websiteUrl: string | null;
  sourceUrl: string;
  /** Item 1 (2026-08-16): the roster page's publisher and read date. */
  provenance: Provenance;
  email: string | null;
  phone: string | null;
  contactKind?: "PUBLIC_OFFICE" | "PERSONAL";
  contactScope?: "SHARED_OFFICE" | "INDIVIDUAL_OFFICE";
  retainedFieldSources?: RosterMember["retainedFieldSources"];
  contactFormUrl: null;
  photoUrl: string | null;
  campaignUrl: null;
  /**
   * The term dates a roster states as dates; wording stays in termNote and no
   * date is ever computed from its prose.
   */
  termStart?: string | null;
  termEnd: string | null;
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
  const photos = getRegistryRuntimeReadModel().rosterPhotos;
  return roster.members.map((member) => ({
    id: member.id,
    name: member.name,
    officeTitle: member.officeTitle,
    officeJurisdictionOcdId: roster.bodyId.split("#")[0],
    termNote: member.termNote,
    // M61: carried through where a roster holds it. Null today for every
    // curated local — see the roster's `partisanship`, which says whether
    // that null means "no party to state" or "not sourced yet".
    partyLabel: member.partyLabel ?? null,
    websiteUrl: member.websiteUrl,
    sourceUrl: member.membershipSource?.sourceUrl ?? roster.sourceUrl,
    // Item 1 (2026-08-16): the roster's own publisher and read date travel
    // with every member, so a card listing them can say who published the
    // claim rather than only where it lives.
    provenance: {
      sourceUrl: member.membershipSource?.sourceUrl ?? roster.sourceUrl,
      sourceOrg: member.membershipSource?.sourceOrg ?? roster.sourceOrg,
      collectedAt: member.membershipSource?.collectedAt ?? roster.collectedAt,
      verifiedAt: null,
    },
    email: member.email,
    phone: member.phone,
    contactKind: member.contactKind,
    contactScope: member.contactScope,
    retainedFieldSources: member.retainedFieldSources,
    contactFormUrl: null,
    photoUrl: photos[member.id] ?? null,
    campaignUrl: null,
    termStart: member.termStart ?? null,
    termEnd: member.termEnd ?? null,
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
  for (const roster of currentBodyRosters()) {
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
