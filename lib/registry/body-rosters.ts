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
