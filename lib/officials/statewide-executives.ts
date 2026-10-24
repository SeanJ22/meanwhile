import type { SeatHolder } from "./lookup.ts";
import { stateOcdIdFrom } from "../ocd/state-division.ts";
import { currentStatewideExecutives } from "../registry/runtime-read-model.ts";
import { photoForPerson } from "../photos/person.ts";

/** Statewide elected executives, curated from each state's own site and attached by the state OCD prefix, since no district elects them. */

export type StatewideVerification = "PAGE_FETCHED" | "PENDING_BROWSER";

export interface StatewideExecutive {
  /** The state division this office serves — the attachment key. */
  stateOcdId: string;
  /** Everything about the person except provenance, which this entry states once and `statewideExecutivesFor` attaches. */
  holder: Omit<SeatHolder, "provenance">;
  /** The state's own page the row was read from. */
  sourceUrl: string;
  /** The election authority record the holder's party was read from; required whenever the holder carries a party. */
  partySourceUrl?: string;
  partySourceOrg?: string;
  /** Why this row carries no party; required whenever `partyLabel` is null. */
  partyAbsence?: string;
  sourceOrg: string;
  collectedAt: string;
  verification: StatewideVerification;
}

/** Bundled first-seed/test evidence. Production readers use currentStatewideExecutives(). */
export const STATEWIDE_EXECUTIVES: readonly StatewideExecutive[] = [
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/governor",
      name: "Katie Hobbs",
      officeTitle: "Governor",
      partyLabel: "Democratic",
      websiteUrl: "https://azgovernor.gov/",
      sourceUrl: "https://azgovernor.gov/",
      email: "engage@az.gov",
      phone: "(602) 542-4331",
      contactFormUrl: "https://azgovernor.gov/constituent-services",
      photoUrl: "/officials/statewide-az-governor.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://azgovernor.gov/",
    sourceOrg: "Office of the Arizona Governor",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:nj",
    holder: {
      id: "statewide:nj/governor",
      name: "Mikie Sherrill",
      officeTitle: "Governor",
      partyLabel: "Democratic",
      websiteUrl: "https://www.nj.gov/governor/",
      sourceUrl: "https://www.nj.gov/governor/",
      email: null,
      phone: null,
      contactFormUrl: "https://www.nj.gov/governor/contact/",
      photoUrl: "/officials/statewide-nj-governor.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.nj.gov/governor/",
    sourceOrg: "Office of the Governor of New Jersey",
    partySourceUrl:
      "https://nj.gov/state/elections/assets/pdf/election-results/2025/2025-official-general-results-governor.pdf",
    partySourceOrg: "New Jersey Division of Elections (official general election results)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:nh",
    holder: {
      id: "statewide:nh/governor",
      name: "Kelly Ayotte",
      officeTitle: "Governor",
      partyLabel: "Republican",
      websiteUrl: "https://www.governor.nh.gov/",
      sourceUrl: "https://www.governor.nh.gov/",
      email: null,
      phone: "(603) 271-2121",
      contactFormUrl: "https://www.governor.nh.gov/contact-governor-ayotte",
      photoUrl: "/officials/statewide-nh-governor.png",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.governor.nh.gov/",
    sourceOrg: "Office of the Governor of New Hampshire",
    partySourceUrl:
      "https://www.sos.nh.gov/sites/g/files/ehbemt561/files/docs/cumulative-filings-7.16.26.pdf",
    partySourceOrg: "New Hampshire Secretary of State (cumulative candidate filings)",
    collectedAt: "2026-08-14",
    verification: "PAGE_FETCHED",
  },

  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/secretary-of-state",
      name: "Adrian Fontes",
      officeTitle: "Secretary of State",
      partyLabel: "Democratic",
      websiteUrl: "https://azsos.gov/about/about-secretary",
      sourceUrl: "https://azsos.gov/about/about-secretary",
      email: null,
      phone: "(602) 542-4285",
      contactFormUrl: "https://azsos.gov/about/contact-us",
      photoUrl: "/officials/statewide-az-secretary-of-state.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://azsos.gov/about/about-secretary",
    sourceOrg: "Arizona Secretary of State",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/attorney-general",
      name: "Kris Mayes",
      officeTitle: "Attorney General",
      partyLabel: "Democratic",
      websiteUrl: "https://www.azag.gov/kris-mayes",
      sourceUrl: "https://www.azag.gov/kris-mayes",
      email: null,
      phone: "(602) 542-5025",
      contactFormUrl: null,
      photoUrl: "/officials/statewide-az-attorney-general.png",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azag.gov/kris-mayes",
    sourceOrg: "Arizona Attorney General's Office",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/state-treasurer",
      name: "Kimberly Yee",
      officeTitle: "State Treasurer",
      // This filing records her party as a candidate for a different office; the office join keeps that candidacy out of
      // this seat.
      partyLabel: "Republican",
      websiteUrl: "https://www.aztreasury.gov/treasurer-kimberly-yee",
      sourceUrl: "https://www.aztreasury.gov/treasurer-kimberly-yee",
      email: null,
      phone: "(602) 542-7800",
      contactFormUrl: "https://www.aztreasury.gov/contact",
      photoUrl: "/officials/statewide-az-state-treasurer.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.aztreasury.gov/treasurer-kimberly-yee",
    sourceOrg: "Office of the Arizona State Treasurer",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/superintendent-of-public-instruction",
      name: "Tom Horne",
      officeTitle: "Superintendent of Public Instruction",
      partyLabel: "Republican",
      websiteUrl: "https://www.azed.gov/adeinfo/about-state-superintendent",
      sourceUrl: "https://www.azed.gov/adeinfo/about-state-superintendent",
      email: null,
      phone: "(602) 542-5393",
      contactFormUrl: null,
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azed.gov/adeinfo/about-state-superintendent",
    sourceOrg: "Arizona Department of Education",
    partySourceUrl:
      "https://azsos.gov/sites/default/files/docs/2026-Candidate-Nominations-and-Petitions-Filed-0330.pdf",
    partySourceOrg: "Arizona Secretary of State (candidate nominations filed)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/state-mine-inspector",
      name: "Les Presmyk",
      officeTitle: "State Mine Inspector",
      partyLabel: "Republican",
      websiteUrl: "https://asmi.az.gov/about/team",
      sourceUrl: "https://asmi.az.gov/about/team",
      email: null,
      phone: "(602) 542-5971",
      contactFormUrl: "https://asmi.az.gov/contact-us",
      photoUrl: null,
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://asmi.az.gov/about/team",
    sourceOrg: "Arizona State Mine Inspector",
    partySourceUrl: "https://apps.azsos.gov/election/2026/canvass/2026_Primary_Canvass_Pima.pdf",
    partySourceOrg: "Arizona Secretary of State (2026 primary canvass, Pima County)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },

  /* Five people hold one office on one division. Chair and Vice Chair are roles inside the body, never written into
     `officeTitle`. */

  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/myers",
      name: "Nick Myers",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/nick-myers/biography",
      sourceUrl: "https://www.azcc.gov/nick-myers/biography",
      email: "Myers-Web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: "/officials/statewide-az-corporation-commissioner-myers.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/nick-myers/biography",
    sourceOrg: "Arizona Corporation Commission",
    partySourceUrl: "https://apps.azsos.gov/election/2026/canvass/2026_Primary_Canvass_Pima.pdf",
    partySourceOrg: "Arizona Secretary of State (2026 primary canvass, Pima County)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/walden",
      name: "Rachel Walden",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/Rachel-Walden/biography",
      sourceUrl: "https://www.azcc.gov/Rachel-Walden/biography",
      email: "Walden-Web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: "/officials/statewide-az-corporation-commissioner-walden.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/Rachel-Walden/biography",
    sourceOrg: "Arizona Corporation Commission",
    partySourceUrl: "https://apps.azsos.gov/election/2024/ge_cand/2024_General_Candidates_Web.pdf",
    partySourceOrg: "Arizona Secretary of State (2024 general election candidate listing)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/thompson",
      name: "Kevin Thompson",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/kevin-thompson/biography",
      sourceUrl: "https://www.azcc.gov/kevin-thompson/biography",
      email: "Thompson-Web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: "/officials/statewide-az-corporation-commissioner-thompson.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/kevin-thompson/biography",
    sourceOrg: "Arizona Corporation Commission",
    partySourceUrl: "https://apps.azsos.gov/election/2026/canvass/2026_Primary_Canvass_Pima.pdf",
    partySourceOrg: "Arizona Secretary of State (2026 primary canvass, Pima County)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/marquez-peterson",
      name: "Lea Márquez Peterson",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/lmarquezpeterson/biography",
      sourceUrl: "https://www.azcc.gov/lmarquezpeterson/biography",
      email: "lmarquezpeterson-web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: "/officials/statewide-az-corporation-commissioner-marquez-peterson.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/lmarquezpeterson/biography",
    sourceOrg: "Arizona Corporation Commission",
    partySourceUrl: "https://apps.azsos.gov/election/2024/ge_cand/2024_General_Candidates_Web.pdf",
    partySourceOrg: "Arizona Secretary of State (2024 general election candidate listing)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
  {
    stateOcdId: "ocd-division/country:us/state:az",
    holder: {
      id: "statewide:az/corporation-commissioner/lopez",
      name: "René Lopez",
      officeTitle: "Corporation Commissioner",
      partyLabel: "Republican",
      websiteUrl: "https://www.azcc.gov/Rene-Lopez/biography",
      sourceUrl: "https://www.azcc.gov/Rene-Lopez/biography",
      email: "Lopez-Web@azcc.gov",
      phone: null,
      contactFormUrl: null,
      photoUrl: "/officials/statewide-az-corporation-commissioner-lopez.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.azcc.gov/Rene-Lopez/biography",
    sourceOrg: "Arizona Corporation Commission",
    partySourceUrl: "https://apps.azsos.gov/election/2024/ge_cand/2024_General_Candidates_Web.pdf",
    partySourceOrg: "Arizona Secretary of State (2024 general election candidate listing)",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },

  {
    stateOcdId: "ocd-division/country:us/state:nj",
    holder: {
      id: "statewide:nj/lieutenant-governor",
      name: "Dale G. Caldwell",
      officeTitle: "Lieutenant Governor",
      partyLabel: null,
      websiteUrl: "https://www.nj.gov/governor/admin/ltgovernor/",
      sourceUrl: "https://www.nj.gov/governor/admin/ltgovernor/",
      email: null,
      phone: null,
      contactFormUrl: "https://www.nj.gov/governor/contact/",
      photoUrl: "/officials/statewide-nj-lieutenant-governor.jpg",
      campaignUrl: null,
      termEnd: null,
      birthDate: null,
    },
    sourceUrl: "https://www.nj.gov/governor/admin/ltgovernor/",
    sourceOrg: "Office of the Governor of New Jersey",
    partyAbsence:
      "New Jersey elects the Lieutenant Governor on the gubernatorial TICKET, so the Division " +
      "of Elections' certified record for the 2025 general election is titled 'Official List " +
      "Candidates for Governor' and names only Mikie Sherrill — read in full 2026-08-28, five " +
      "pages, no mention of a running mate. The office's own page states the officeholder and " +
      "no party. Inheriting the Governor's party would be inferring one person's affiliation " +
      "from another's, which is the exact inference this product forbids.",
    collectedAt: "2026-08-28",
    verification: "PAGE_FETCHED",
  },
];

/** The statewide executives for whichever state these divisions sit in, read off the OCD prefix. */
export function statewideExecutivesFor(ocdIds: string[]): SeatHolder[] {
  const states = new Set<string>();
  for (const ocdId of ocdIds) {
    const state = stateOcdIdFrom(ocdId);
    if (state) states.add(state);
  }

  const holders: SeatHolder[] = [];
  for (const executive of currentStatewideExecutives()) {
    if (!states.has(executive.stateOcdId)) continue;
    const photo=photoForPerson(executive.holder.personId ?? executive.holder.id,executive.stateOcdId.split(":").at(-1));
    // Provenance attached here once, from the entry's `sourceOrg` and `collectedAt`.
    holders.push({
      ...executive.holder,
      photoUrl:photo?.url ?? executive.holder.photoUrl,
      ...(photo?.provenance ? {fieldSources:{...executive.holder.fieldSources,photoUrl:photo.provenance}} : {}),
      officeJurisdictionOcdId: executive.stateOcdId,
      provenance: {
        sourceUrl: executive.sourceUrl,
        sourceOrg: executive.sourceOrg,
        collectedAt: executive.collectedAt,
        verifiedAt: null,
      },
    });
  }
  return holders;
}
