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
}

export interface BodyRoster {
  /** Matches `BodySourceWiring.bodyId` exactly. */
  bodyId: string;
  bodyName: string;
  members: RosterMember[];
  /** The body's own page the roster was read from. */
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
}

const COLLECTED = "2026-08-15";

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
    members: [
      {
        id: "roster:pima#1",
        name: "Rex Scott",
        officeTitle: "County Supervisor, District 1",
        termNote: "Elected November 2024 to a four-year term",
        email: null,
        phone: "520-724-2738",
        websiteUrl: "https://www.pima.gov/District1",
      },
      {
        id: "roster:pima#2",
        name: "Dr. Matt Heinz",
        officeTitle: "County Supervisor, District 2 (Vice Chair)",
        termNote: "Elected November 2024 to a four-year term",
        email: null,
        phone: "520-724-2702",
        websiteUrl: "https://www.pima.gov/District2",
      },
      {
        id: "roster:pima#3",
        name: "Jennifer Allen",
        officeTitle: "County Supervisor, District 3 (Chair)",
        termNote: "Elected November 2024 to a four-year term",
        email: null,
        phone: "520-724-8051",
        websiteUrl: "https://www.pima.gov/District3",
      },
      {
        id: "roster:pima#4",
        name: "Steve Christy",
        officeTitle: "County Supervisor, District 4",
        termNote: "Elected November 2024 to a four-year term",
        email: null,
        phone: "520-724-8094",
        websiteUrl: "https://www.pima.gov/District4",
      },
      {
        id: "roster:pima#5",
        name: "Andrés Cano",
        officeTitle: "County Supervisor, District 5",
        termNote: "Elected November 2024 to a four-year term",
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
    collectedAt: "2026-08-17",
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
    collectedAt: "2026-08-17",
    members: [
      {
        id: "roster:rockaway#0",
        name: "Joseph Jackson",
        officeTitle: "Mayor",
        termNote: "Unexpired term ends December 31, 2027",
        email: null,
        phone: "973-627-7200",
        websiteUrl: "https://www.rockawaytownship.org/464/About-the-Mayor",
      },
      {
        id: "roster:rockaway#1",
        name: "Howard Morrison",
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
      },
      {
        id: "roster:rockaway#3",
        name: "Adam Salberg",
        officeTitle: "Council Member, At-Large",
        termNote: "Term expires December 31, 2027",
        email: "asalberg@rockawaytownship.org",
        phone: "973-627-7200 x2083",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
      },
      {
        id: "roster:rockaway#4",
        name: "Pawel Wojtowicz",
        officeTitle: "Council Member, At-Large",
        termNote: "Term expires December 31, 2027",
        email: "pwojtowicz@rockawaytownship.org",
        phone: "973-627-7200 x2084",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
      },
      {
        id: "roster:rockaway#5",
        name: "Susan Fahrman Royek",
        officeTitle: "Council Member, Ward 1",
        termNote: "Term expires December 31, 2029",
        email: "sroyek@rockawaytownship.org",
        phone: "973-627-7200 x2085",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
      },
      {
        id: "roster:rockaway#6",
        name: "John J. Quinn",
        officeTitle: "Council Member, Ward 2",
        termNote: "Term expires December 31, 2029",
        email: "jquinn@rockawaytownship.org",
        phone: "973-627-7200 x2086",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
      },
      {
        id: "roster:rockaway#7",
        name: "Sophia Freire",
        officeTitle: "Council Member, Ward 3",
        termNote: "Term expires December 31, 2029",
        email: "sfreire@rockawaytownship.org",
        phone: "973-627-7200 x2087",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
      },
      {
        id: "roster:rockaway#8",
        name: "Emanuel Friedlander",
        officeTitle: "Council Member, Ward 5",
        termNote: "Term expires December 31, 2029",
        email: "efriedlander@rockawaytownship.org",
        phone: "973-627-7200 x2089",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
      },
      {
        id: "roster:rockaway#9",
        name: "Tucker Kelley",
        officeTitle: "Council Member, Ward 6",
        termNote: "Term expires December 31, 2029",
        email: "tkelley@rockawaytownship.org",
        phone: "973-627-7200 x2082",
        websiteUrl: "https://www.rockawaytownship.org/157/Township-Council",
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
    collectedAt: "2026-08-17",
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
    collectedAt: "2026-08-17",
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
  partyLabel: null;
  websiteUrl: string | null;
  sourceUrl: string;
  email: string | null;
  phone: string | null;
  contactFormUrl: null;
  photoUrl: null;
  campaignUrl: null;
}

/**
 * The roster as `SeatHolder`-shaped rows, so the popup family renders local
 * members with the same machinery as federal and state ones. `partyLabel`
 * stays null — these are nonpartisan offices as published, and the party of
 * a school-board member is not ours to assert. No photos: the bodies' pages
 * carry portraits of unknown license, and unknown is not clearable (D20).
 */
export function rosterHoldersForBody(bodyId: string | null): RosterHolder[] {
  const roster = rosterForBody(bodyId);
  if (!roster) return [];
  return roster.members.map((member) => ({
    id: member.id,
    name: member.name,
    officeTitle: member.officeTitle,
    partyLabel: null,
    websiteUrl: member.websiteUrl,
    sourceUrl: roster.sourceUrl,
    email: member.email,
    phone: member.phone,
    contactFormUrl: null,
    photoUrl: null,
    campaignUrl: null,
  }));
}
