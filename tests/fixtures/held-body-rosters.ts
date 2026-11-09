import type { BodyRoster, RosterMember, RosterReaderDisposition } from "../../lib/registry/body-rosters.ts";
import { AZ_CAWCD_ROSTERS } from "./cawcd-rosters.ts";
import { NJ_MORRIS_ROSTERS } from "./rosters-nj-morris.ts";

const COLLECTED = "2026-08-13";

/** The date party records were read, only from the certified result of the election that seated the person. */
const PARTY_READ = "2026-08-15";

/** Certified primary canvass; races are headed by party. */
const PIMA_PRIMARY_CANVASS =
  "https://apps.azsos.gov/election/2024/pe/canvass/Official_2024_Primary_Canvass_Pima_County.pdf";

/** Certified general canvass; prints no party. */
const PIMA_GENERAL_CANVASS =
  "https://apps.azsos.gov/election/2024/ge/canvass/202411GeneralElectionCanvass-Pima.pdf";

/** Official city primary results; contests are headed by party. */
const TUCSON_2023_PRIMARY =
  "https://www.tucsonaz.gov/files/sharedassets/public/v/1/clerks/documents/elections/results/2023/primary/23paztuc_officialresults_080723.pdf";
const TUCSON_2025_PRIMARY =
  "https://www.tucsonaz.gov/files/sharedassets/public/v/1/clerks/documents/elections/results/25paz_officialresults_08112025.pdf";

/** County clerk's certified general-election winners, with a Party column. */
const MORRIS_2023_WINNERS =
  "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/1/elections/past-results/2023-general-winners.pdf";
const MORRIS_2024_WINNERS =
  "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/1/elections/past-results/2024-general-winners.pdf";
const MORRIS_2025_WINNERS =
  "https://www.morriscountyclerk.org/files/sharedassets/clerk/v/2/elections/past-results/2025-general-winners.pdf";

/**
 * Dated Internet Archive snapshots: sos.nh.gov returns 403 to datacenter
 * clients, so the archived copy that was actually read is cited.
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
    bodyId:
      "ocd-division/country:us/state:az/school_district:tucson_unified_district#board",
    bodyName: "Tucson Unified School District Governing Board",
    sourceUrl: "https://govboard.tusd1.org/",
    sourceOrg: "Tucson Unified School District Governing Board",
    collectedAt: COLLECTED,
    // NONPARTISAN: these races appear in the certified general canvass with no
    // party and are absent from the partisan primary canvass.
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
        // Not a board member: kept for the body card's superintendent slot; `bodySubject` removes him from seated members.
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
        // No party: appointed to a vacancy, so no certified result names one.
        officeTitle: "County Supervisor, District 5",
        termNote: "Appointed April 15, 2025 to serve through December 31, 2026",
        email: null,
        phone: "(520) 724-8126",
        websiteUrl: "https://www.pima.gov/District5",
      },
    ],
  },
  {
    bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    bodyName: "Tucson Mayor & Council",
    sourceUrl: "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager",
    sourceOrg: "City of Tucson",
    collectedAt: COLLECTED,
    // Wards nominate by party in the primary and the general is at-large, so
    // the certified primary results are the record of each member's party.
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
         * The other appointee, Andrea Black, is deliberately not a row: her
         * term begins after the November election.
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
         * Not elected; hired by the board. `bodySubject` keeps him out of the
         * seated-member list.
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
  // The delegation's officers only; its members are state representatives already held in state-legislature data.
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
  // An empty Title cell is written `Member`; expired terms stay as the town publishes them.
  {
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#planning-board",
    bodyName: "Newbury Planning Board",
    sourceUrl: "https://www.newbury.nh.gov/planning-board",
    sourceOrg: "Town of Newbury",
    collectedAt: "2026-08-20",
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
    // Emails come from each name's mailto link; only district-issued addresses are recorded.
    bodyId:
      "ocd-division/country:us/state:nh/school_district:kearsarge_regional_school_district#board",
    bodyName: "Kearsarge Regional School Board",
    sourceUrl:
      "https://www.kearsarge.org/district/school-board-mbc/pages/school-board-members",
    sourceOrg: "Kearsarge Regional School District (SAU #65)",
    collectedAt: "2026-08-21",
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
        // Not a board member: kept for the superintendent slot. "Interim" is the district's own word.
        id: "roster:kearsarge#supt",
        name: "Michael Bessette",
        officeTitle: "Interim Superintendent of Schools",
        termNote: "Appointed by the School Board, not elected",
        email: "mbessette@kearsarge.org",
        phone: "(603) 526-9163",
        websiteUrl: "https://www.kearsarge.org/district/district/pages/contact-us",
      },
      {
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
    bodyId:
      "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing",
    bodyName: "Rockaway Township Council",
    sourceUrl: "https://www.rockawaytownship.org/157/Township-Council",
    sourceOrg: "Rockaway Township",
    collectedAt: "2026-08-14",
    partisanship: "PARTISAN",
    partisanshipSourceUrl: MORRIS_2025_WINNERS,
    members: [
      {
        id: "roster:rockaway#0",
        name: "Joseph Jackson",
        officeTitle: "Mayor",
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
        // No party: reached the seat by appointment, so no certified result
        // names one.
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
    bodyId: "ocd-division/country:us/state:nj/county:morris#governing",
    bodyName: "Morris County Board of County Commissioners",
    sourceUrl:
      "https://www.morriscountynj.gov/Departments/Board-of-County-Commissioners",
    sourceOrg: "Morris County",
    collectedAt: "2026-08-14",
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
     * Sourced from the county's annual-report directory, not the
     * commissioners index page, which still names a former commissioner.
     */
    bodyId: "ocd-division/country:us/state:nh/county:merrimack#governing",
    bodyName: "Merrimack County Board of Commissioners",
    sourceUrl:
      "https://www.merrimackcounty.net/Departments/Administration/Annual%20Reports/Final%20Annual%20Report%202025.pdf",
    sourceOrg: "Merrimack County (FY2025 Annual Report, County Directory)",
    collectedAt: "2026-08-20",
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
    // trivera@/mmaasin@ on the same page are district-office contacts, not
    // members.
    bodyId:
      "ocd-division/country:us/state:nj/school_district:rockaway_township_school_district#board",
    bodyName: "Rockaway Township Board of Education",
    sourceUrl: "https://www.rocktwp.net/page/board-members",
    sourceOrg: "Rockaway Township School District",
    collectedAt: "2026-08-14",
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
    bodyId:
      "ocd-division/country:us/state:az/school_district:sunnyside_unified_district#board",
    bodyName: "Sunnyside Unified School District Governing Board",
    sourceUrl: "https://www.susd12.org/governing-board-home",
    sourceOrg: "Sunnyside Unified School District",
    collectedAt: "2026-08-14",
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
    // The phone is the board-business line from the district's
    // agenda-information page.
    bodyId:
      "ocd-division/country:us/state:az/school_district:amphitheater_unified_district#board",
    bodyName: "Amphitheater Unified School District Governing Board",
    sourceUrl: "https://www.amphi.com/348925_2",
    sourceOrg: "Amphitheater Unified School District",
    collectedAt: "2026-08-14",
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
   * Generated by `pnpm nj:wire`: fix the generator and regenerate rather than
   * editing the output.
   */
  ...NJ_MORRIS_ROSTERS,

  ...AZ_CAWCD_ROSTERS,

  // Read with `pdftotext -layout`: a reading-order extract assigns the two-column Executive Secretary to the board.
  {
    bodyId:
      "ocd-division/country:us/state:az/county:pima#board-of-adjustment-district-4",
    bodyName: "Pima County Board of Adjustment, District 4",
    /*
     * The body's own page, not the vendor asset host that serves the agenda
     * PDF.
     */
    sourceUrl: "https://www.pima.gov/2792",
    sourceOrg:
      "Pima County Development Services — the District 4 Board of Adjustment meeting agenda for 2026-09-08, published on the county's District 4 notices and agendas page",
    collectedAt: "2026-08-27",
    /*
     * Appointed under A.R.S. § 11-807 and never on a ballot, so no party
     * appears for this office.
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
         * Staff, not a member; carried as the contact for the board's
         * business.
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

/** A navigation label cannot identify a person; identical rows are one answer. */
export function projectReaderRoster(roster: BodyRoster): { roster: BodyRoster; dispositions: RosterReaderDisposition[] } {
  const members: RosterMember[] = [];
  const dispositions: RosterReaderDisposition[] = [];
  const exactRows = new Map<string, string>();
  for (const member of roster.members) {
    const label = member.name.trim().toLowerCase().replace(/\s+/g, " ");
    // A single word ("Actions", "Menu") is a page label, never a US officeholder's name.
    const navigation = !/\s/.test(label) || ["contact us", "contact information", "staff directory", "email us", "town hall", "member name"].includes(label)
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
/** Real roster records read from each body's own page, for tests. */
export const BODY_ROSTERS: BodyRoster[] = READER_ROSTERS.map(result => result.roster);
export const ROSTER_READER_DISPOSITIONS = READER_ROSTERS.flatMap(result => result.dispositions);


