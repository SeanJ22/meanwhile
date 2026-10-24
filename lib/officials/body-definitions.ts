import type { BodyBlurb, BodyDivisionType } from "./body-description.ts";
import { blurbForBody } from "./body-description.ts";
import { formFor } from "./body-form.ts";
import { formDefinitionFor } from "./form-definitions.ts";

/**
 * What a body does, in two layers. The class definition always renders: a sourced description of what that class of
 * body is in that state, never the specific powers of the specific body. The form-specific definition adds beneath it
 * where the charter or statute has been read.
 */

/** Reuses the evidence shape the sourced blurbs already ship under. */
export type Definition = BodyBlurb;

/** What kind of thing this is, for describing it; finer than `DivisionType`. */
export type ClassKey =
  | "school_district_independent"
  | "school_district_dependent"
  | "school_district_unclassified"
  | "county"
  | "municipality"
  | "township"
  | "state_house"
  | "state_senate"
  | "congressional_district"
  | "us_senate_seat"
  | "governor";

interface ClassRow {
  /** Two-letter state, lowercased. `null` ONLY where the class truly is national. */
  state: string | null;
  classKey: ClassKey;
  definition: Definition;
}

/** The class definitions. Every `basisUrl` is fetched and control-checked by `pnpm definitions:verify`. */
export const CLASS_DEFINITIONS: ReadonlyArray<ClassRow> = [
  {
    state: null,
    classKey: "congressional_district",
    definition: {
      text:
        "A congressional district is one seat in the U.S. House of Representatives. Every district elects one person, for two years at a time, and each district holds roughly the same number of people — which is why the lines are redrawn after every census. Nobody runs a district: it is the area one member of Congress speaks for. That member votes on federal law, on federal spending and taxes, and on whether to confirm or reject federal actions the House has a say in.",
      basis: "U.S. Constitution, Article I, Section 2",
      basisUrl: "https://constitution.congress.gov/browse/article-1/section-2/",
      readOn: "2026-08-23",
    },
  },
  {
    state: null,
    classKey: "us_senate_seat",
    definition: {
      text:
        "A U.S. Senate seat is one of two each state gets, regardless of how many people live there. Senators serve six years and are elected by the whole state. Nobody runs a Senate seat: it is one voice in the Senate. That senator votes on federal law and spending, and the Senate alone confirms federal judges, cabinet officers and ambassadors, and ratifies treaties.",
      basis: "U.S. Constitution, Article I, Section 3, and the Seventeenth Amendment",
      basisUrl: "https://constitution.congress.gov/browse/amendment-17/",
      readOn: "2026-08-23",
    },
  },

  {
    state: "nj",
    classKey: "township",
    definition: {
      text:
        "In New Jersey a township is a TYPE of municipality, not a form of government — it is a full municipality the same way a borough, town, city or village is. How it is actually governed depends on the charter it operates under: some townships run under the Township Act with an elected township committee that both makes policy and administers it, and others have adopted a Faulkner Act charter with a separately elected mayor and council. Which one this township uses decides who does what, so it is stated separately below where we have read the charter.",
      basis: "N.J.S.A. 40A:63-1 (Township form of government)",
      basisUrl: "https://law.justia.com/codes/new-jersey/title-40a/section-40a-63-1/",
      readOn: "2026-08-23",
    },
  },
  {
    state: "nj",
    classKey: "municipality",
    definition: {
      text:
        "This is a New Jersey municipality — the layer of government closest to a resident. Municipalities pass local ordinances, adopt the municipal budget and set the local property tax levy, decide zoning and what can be built where, and run local police, streets, and local services. New Jersey lets a municipality choose among several charters, and the charter decides whether an elected mayor runs the administration or a hired manager does, so that is stated separately below where we have read it.",
      basis: "N.J.S.A. 40:69A-1 (Optional Municipal Charter Law, the Faulkner Act)",
      basisUrl: "https://law.justia.com/codes/new-jersey/title-40/section-40-69a-1/",
      readOn: "2026-08-23",
    },
  },
  {
    state: "nj",
    classKey: "county",
    definition: {
      text:
        "A New Jersey county is a substantial layer of government, not a formality. Counties here run county roads and bridges, the county jail and prosecutor's office, county parks, social services, a county college in most counties, and the elections machinery. The governing body is the Board of County Commissioners, elected countywide, which adopts the county budget and sets the county tax levy. Counties do not make the rules about what gets built inside a municipality — that is the municipality's.",
      basis: "N.J.S.A. 40:41A-26 (Optional County Charter Law; powers of county government)",
      basisUrl: "https://law.justia.com/codes/new-jersey/title-40/section-40-41a-26/",
      readOn: "2026-08-23",
    },
  },

  {
    state: "nh",
    classKey: "municipality",
    definition: {
      text:
        "A New Hampshire town is governed by its residents at town meeting, and by a small elected board — usually called the select board — between meetings. Town meeting is the town's legislature: voters there adopt the budget, approve spending, and vote on the town's warrant articles. The select board administers what the town voted, manages town property and staff, and signs the town's contracts. A town cannot spend money the town meeting did not appropriate.",
      basis: "RSA 31 (Towns: powers and duties)",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/III/31/31-1.htm",
      readOn: "2026-08-23",
    },
  },
  {
    state: "nh",
    classKey: "county",
    // The generic county description is false for a New Hampshire county, whose legislative body is the county convention.
    definition: {
      text:
        "A New Hampshire county does much less than a county does in most states. It runs the county jail, the county nursing home, the sheriff's office, the registry of deeds and the county attorney's office — and it does not run roads, schools, zoning or land use, all of which belong to the town. Its legislative body is not the county commissioners: it is the county convention, made up of every state representative elected from the county, sitting together to vote the county budget. The commissioners administer what the convention appropriates.",
      basis:
        "New Hampshire RSA 24:1 (the county convention consists of the state representatives of the county's representative districts), with RSA 28 (county commissioners) and RSA 23 (powers as a corporate body)",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/II/24/24-1.htm",
      readOn: "2026-08-23",
    },
  },

  {
    state: "az",
    classKey: "municipality",
    definition: {
      text:
        "An Arizona city or town is a municipal corporation. It passes local ordinances, adopts the city budget and sets local taxes and fees, decides zoning and what can be built where, and runs local police, streets and local services. Larger Arizona municipalities may adopt their own charter, which decides whether an elected mayor runs the administration day to day or a city manager the council hires does, so that is stated separately below where we have read the charter.",
      basis: "Arizona Revised Statutes § 9-499.15 (Municipal regulation; notice)",
      basisUrl: "https://www.azleg.gov/ars/9/00499-15.htm",
      readOn: "2026-08-23",
    },
  },

  {
    state: "nj",
    classKey: "school_district_independent",
    definition: {
      text:
        "This is an independent school district — a government in its own right, separate from the town it sits in, with its own elected board and its own budget. The board sets district policy, decides the school budget and how state and local school money is spent, manages school buildings, and hires the superintendent who runs the district day to day. It does not set New Jersey's education standards; those come from the state.",
      basis: "N.J.S.A. 40A:63-1 is the municipal form; a Type II district's board is a separate elected body",
      basisUrl: "https://law.justia.com/codes/new-jersey/title-40a/section-40a-63-1/",
      readOn: "2026-08-23",
    },
  },
  {
    state: "nh",
    classKey: "school_district_independent",
    definition: {
      text:
        "This is a New Hampshire school district — a separate body politic, distinct from the town, with its own school board and its own district meeting where voters adopt the school budget. The school board sets district policy, manages the schools and school property, and hires the superintendent. In most of the state the district also sits inside a school administrative unit that provides the superintendent's office to several districts at once.",
      basis: "RSA 189:1-a (Duty to provide schools)",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/XV/189/189-1-a.htm",
      readOn: "2026-08-23",
    },
  },
  {
    state: "az",
    classKey: "school_district_independent",
    definition: {
      text:
        "This is an independent school district — a government in its own right, with its own elected governing board and its own budget, separate from the city or county it sits in. The board sets the policies the district's schools run on, manages school buildings and property, decides how state and county school money is spent, and hires the superintendent. It does not set Arizona's education standards; those come from the State Board of Education.",
      basis: "Arizona Revised Statutes § 15-341 (Governing board; powers and duties)",
      basisUrl: "https://www.azleg.gov/ars/15/00341.htm",
      readOn: "2026-08-23",
    },
  },

  {
    state: "az",
    classKey: "county",
    definition: {
      text:
        "An Arizona county is a creature of state statute — it has the powers the legislature gives it and no others. Counties run county roads, the jail, the county hospital and health programs, and they decide what can be built in the unincorporated areas outside any city or town. The board of supervisors sets the county budget and the county property tax rate and supervises how the county's other elected officers handle public money. A county has no say over what happens inside a city's own limits.",
      basis: "Arizona Revised Statutes § 11-251 (Powers of board)",
      basisUrl: "https://www.azleg.gov/ars/11/00251.htm",
      readOn: "2026-08-23",
    },
  },

  // The state seats are defined per state, from each state's own constitution or statutes.
  {
    state: "nj",
    classKey: "governor",
    definition: {
      text:
        "The Governor of New Jersey is the only official the whole state elects, and the office is one of the strongest in the country: the governor appoints the attorney general, the secretary of state, every cabinet officer and every judge, subject to the Senate agreeing. The governor signs or vetoes every bill the Legislature passes, and can strike out single spending lines rather than having to reject a whole budget. Four years at a time, and no more than two terms in a row.",
      basis: "New Jersey Constitution, Article V (Executive)",
      basisUrl: "https://www.njleg.state.nj.us/constitution",
      readOn: "2026-08-24",
    },
  },
  {
    state: "nj",
    classKey: "state_house",
    definition: {
      text:
        "A New Jersey General Assembly seat is one of 80. The state is divided into 40 legislative districts and each one elects TWO Assembly members together, so your district has two of them and you vote for two. They serve two years. The Assembly writes state law and passes the state budget, which is where the money for schools, roads, courts and health programs is set — and it alone can start impeachment.",
      basis: "New Jersey Constitution, Article IV (Legislative)",
      basisUrl: "https://www.njleg.state.nj.us/constitution",
      readOn: "2026-08-24",
    },
  },
  {
    state: "nj",
    classKey: "state_senate",
    definition: {
      text:
        "A New Jersey Senate seat is one of 40 — one for each legislative district, the same districts that elect two Assembly members. Senators serve four years, except once a decade when they serve two so terms line up with new district lines after the census. The Senate passes state law and the state budget alongside the Assembly, and it alone confirms the governor's appointments: cabinet officers, judges and prosecutors.",
      basis: "New Jersey Constitution, Article IV (Legislative)",
      basisUrl: "https://www.njleg.state.nj.us/constitution",
      readOn: "2026-08-24",
    },
  },
  {
    state: "nh",
    classKey: "governor",
    definition: {
      text:
        "The Governor of New Hampshire is elected by the whole state for two years, and shares executive power with a five-member Executive Council elected by district. That sharing is the thing to know: contracts, most senior appointments and judicial nominations need the Council's agreement as well as the governor's, so a New Hampshire governor cannot appoint or spend alone. The governor signs or vetoes bills the General Court passes.",
      basis:
        "New Hampshire RSA Chapter 4, Powers of the Governor and Council in Certain Cases",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/I/4/4-mrg.htm",
      readOn: "2026-08-24",
    },
  },
  {
    state: "nh",
    classKey: "state_house",
    definition: {
      text:
        "A New Hampshire House seat is one of 400 — one of the largest legislatures in the English-speaking world, for one of the smaller states. Each member speaks for roughly 3,400 people, so the seat is unusually close to the people in it, and members are paid $100 a year. They serve two years. The House writes state law and starts every money bill, and New Hampshire has no general sales or income tax, so what it does about revenue is felt in local property tax bills.",
      basis: "New Hampshire RSA Chapter 14, Legislative Officers and Proceedings",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/I/14/14-mrg.htm",
      readOn: "2026-08-24",
    },
  },
  {
    state: "nh",
    classKey: "state_senate",
    definition: {
      text:
        "A New Hampshire Senate seat is one of 24, so each senator speaks for roughly 57,000 people — about seventeen times as many as a House member. Senators serve two years and are paid $100 a year, like the House. The Senate passes state law and the state budget with the House, and because there are so few of them, a New Hampshire senator has considerably more individual weight over a bill than a House member does.",
      basis: "New Hampshire RSA Chapter 14, Legislative Officers and Proceedings",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/I/14/14-mrg.htm",
      readOn: "2026-08-24",
    },
  },
  {
    state: "az",
    classKey: "governor",
    definition: {
      text:
        "The Governor of Arizona is elected by the whole state for four years, and no more than two terms in a row. The governor signs or vetoes every bill the Legislature passes and can strike single spending lines out of a budget. Arizona has no lieutenant governor on the ballot with the governor: if the office falls vacant the Secretary of State takes over, which is why that race matters more here than its name suggests.",
      basis: "Arizona Constitution, Article 5, Section 1 (Executive department)",
      basisUrl: "https://www.azleg.gov/const/5/1.htm",
      readOn: "2026-08-24",
    },
  },
  {
    state: "az",
    classKey: "state_house",
    definition: {
      text:
        "An Arizona House of Representatives seat is one of 60. The state is divided into 30 legislative districts and each one elects TWO House members and ONE senator, so your district has two representatives and you vote for two. They serve two years. The House writes state law and passes the state budget with the Senate, and it decides how much of the state's money goes to the school districts your local board then spends.",
      basis: "Arizona Constitution, Article 4, Part 2, Section 1 (Senate; house of representatives)",
      basisUrl: "https://www.azleg.gov/const/4/1.p2.htm",
      readOn: "2026-08-24",
    },
  },
  {
    state: "az",
    classKey: "state_senate",
    definition: {
      text:
        "An Arizona Senate seat is one of 30 — one for each legislative district, the same district that elects two House members. Senators serve two years. The Senate passes state law and the state budget alongside the House, and it alone confirms the governor's appointments to state boards and agencies.",
      basis: "Arizona Constitution, Article 4, Part 2, Section 1 (Senate; house of representatives)",
      basisUrl: "https://www.azleg.gov/const/4/1.p2.htm",
      readOn: "2026-08-24",
    },
  },
];

/** A dependent school system is a department of a city or county, not a government with its own board. */
export const DEPENDENT_SCHOOL_DEFINITION: Definition = {
  text:
    "This school system is run as part of a city, county or state government rather than as a separate district — it has no board of its own that you elect, and no separate budget you vote on. Decisions about it are made by the government it belongs to, so the people to go to about the schools here are that government's own elected officials.",
  basis:
    "2022 Census of Governments, Government Organization — dependent school systems are classified as agencies of another government rather than as governments",
  basisUrl: "https://www.census.gov/programs-surveys/cog.html",
  readOn: "2026-08-23",
};

/** A district the Census could not be matched to is still described, without asserting who governs it. */
export const UNCLASSIFIED_SCHOOL_DEFINITION: Definition = {
  text:
    "This school system runs public schools for the area it covers — the school buildings, the staff, the budget for them, and the superintendent who runs it day to day. School systems in the United States come in two kinds: most are governments in their own right with a board you elect, and a smaller number are run as a department of a city, a county or the state. We have not yet established which of the two this one is, so the people to go to about it are not stated here.",
  basis:
    "2022 Census of Governments, Government Organization — the two-way classification of school systems as independent governments or as agencies of another government",
  basisUrl: "https://www.census.gov/programs-surveys/cog.html",
  readOn: "2026-08-23",
};

/** Which class a body belongs to, from what the registry knows; LSAD tells a township from a borough, never a name. */
export function classKeyFor(input: {
  divisionType: BodyDivisionType;
  lsad?: string | null;
  /** The Census classification. UNCLASSIFIED yields NO class, never a guess. */
  schoolDependency?: "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED";
}): ClassKey | null {
  switch (input.divisionType) {
    case "cd":
      return "congressional_district";
    case "sldu":
      return "state_senate";
    case "sldl":
      return "state_house";
    case "county":
      return "county";
    case "school_district":
      // An unclassified district never falls through to the independent definition.
      if (input.schoolDependency === "DEPENDENT") return "school_district_dependent";
      if (input.schoolDependency === "INDEPENDENT") return "school_district_independent";
      return "school_district_unclassified";
    case "place":
      // LSAD 44 is "township" and LSAD 43 is "town". A town is a municipality by another name; `township` keeps its own
      // key because New Jersey law says something different about it.
      return input.lsad === "44" ? "township" : "municipality";
    default:
      return null;
  }
}

/* A body is described by what it is, never by what shares its division. */

/** A kind of body that is not a division's own government, described once per state from the statute that creates it. */
export type BodyKindKey =
  | "az_county_flood_control_district"
  | "az_county_free_library_district"
  | "az_county_stadium_district"
  | "az_multi_county_water_conservation_district"
  | "az_community_facilities_district"
  | "az_county_board_of_adjustment"
  | "az_community_college_district";

interface BodyKindRow {
  /** Two-letter state, lowercased. No row here is national. */
  state: string;
  kind: BodyKindKey;
  definition: Definition;
}

/** Every row read from the statute itself; every `basisUrl` checked by `pnpm definitions:verify`. */
export const BODY_KIND_DEFINITIONS: ReadonlyArray<BodyKindRow> = [
  {
    state: "az",
    kind: "az_county_flood_control_district",
    definition: {
      text:
        "This is a county flood control district — a separate taxing government that handles flooding, not the county itself. Its board can buy or condemn land for flood control works and storm drains, build them, run them and maintain them, regulate what may be built in a floodplain, allow a variance where a strict reading would work an unnecessary hardship, and appoint its own chief engineer, treasurer and attorney. It can join with the state, the federal government or a neighbouring district to do that work. It is not the county, and nothing else the county decides is its business.",
      basis:
        "Arizona Revised Statutes § 48-3603 (Powers, duties and immunities of district and board)",
      basisUrl: "https://www.azleg.gov/ars/48/03603.htm",
      readOn: "2026-08-28",
    },
  },
  {
    state: "az",
    kind: "az_county_free_library_district",
    definition: {
      text:
        "This is a county free library district — a separate taxing government that runs the county's public libraries, not the county itself. Its board of directors may make information, technology and resources available to every library patron, provide a place for studying, researching, reading and learning, and run educational, informational and literacy programmes for all ages, from early literacy and school readiness to adult literacy, digital literacy and workforce training. The county can also agree with a neighbouring county to let its residents use the library. The district decides nothing outside the library service.",
      basis:
        "Arizona Revised Statutes § 48-3902 (Powers and duties; contracts between counties for use of library)",
      basisUrl: "https://www.azleg.gov/ars/48/03902.htm",
      readOn: "2026-08-28",
    },
  },
  {
    state: "az",
    kind: "az_county_stadium_district",
    definition: {
      text:
        "This is a county stadium district — a separate government formed to build, own and run a stadium or a similar facility, not the county itself. Its board can make contracts and intergovernmental agreements, adopt the rules the district and its property run under, employ an executive director and staff or contract for management, acquire and dispose of property, hold property in trust for the district, and hire legal counsel and consultants. It appoints its own chairperson, secretary and treasurer. Its powers stop at the district's own business.",
      basis:
        "Arizona Revised Statutes § 48-4203 (Powers and duties of board of directors; reporting requirements; conflict of interest)",
      basisUrl: "https://www.azleg.gov/ars/48/04203.htm",
      readOn: "2026-08-28",
    },
  },
  {
    state: "az",
    kind: "az_multi_county_water_conservation_district",
    definition: {
      text:
        "This is a multi-county water conservation district — a public improvement district covering several counties at once, and not a county government. It exists to levy a small property tax across those counties and to contract with the United States for the delivery of Central Arizona Project water and for repaying what that project cost. Its directors are elected directly by the voters of each member county: one director from a county of under 600,000 people, four from a county between 600,000 and 2.1 million, and ten from a county larger than that, each serving six years and each casting a vote weighted by the population behind it. The board manages the district's affairs and business, makes its contracts, sets its own bylaws and rules, runs its bond programme, and employs its own engineers, lawyers and staff. It has no say over anything a county decides.",
      basis:
        "Arizona Revised Statutes §§ 48-3702, 48-3703, 48-3708 and 48-3712 (multi-county water conservation districts: status, purposes, elected board and the board's powers)",
      basisUrl: "https://www.azleg.gov/ars/48/03708.htm",
      readOn: "2026-08-28",
    },
  },
  {
    state: "az",
    kind: "az_community_facilities_district",
    definition: {
      text:
        "This is a community facilities district — a small separate taxing district drawn over one defined piece of land to pay for and look after the public infrastructure on it. Its board can contract and spend for that infrastructure, agree with the city or county that will plan, own or maintain it, operate and repair it, charge fees for using it, employ staff and consultants, take grants, borrow and repay for it, and assess the cost of the works on the land that benefits from them. Its business is that land and those works, and nothing else.",
      basis: "Arizona Revised Statutes § 48-709 (Powers of a community facilities district)",
      basisUrl: "https://www.azleg.gov/ars/48/00709.htm",
      readOn: "2026-08-28",
    },
  },
  {
    state: "az",
    kind: "az_county_board_of_adjustment",
    definition: {
      text:
        "This is a county board of adjustment. It hears zoning appeals from the parts of the county outside any city or town. It can say what a disputed word, phrase or section of the zoning ordinance means and where a district boundary lies, and it can allow a variance where unusual conditions about a property would make a strict reading an unnecessary hardship, provided the ordinance's general intent is preserved. Its members are appointed for staggered four-year terms. It does not write the zoning rules — the board of supervisors does — and anyone unhappy with its decision has thirty days to appeal to the superior court.",
      basis: "Arizona Revised Statutes § 11-816 (Boards of adjustment; powers; appeals)",
      basisUrl: "https://www.azleg.gov/ars/11/00816.htm",
      readOn: "2026-08-28",
    },
  },
  {
    state: "az",
    kind: "az_community_college_district",
    definition: {
      text:
        "This is a community college district's governing board. It keeps each of its community colleges open for at least eight months a year, adopts in a public forum the policies for what the colleges offer, enforces the courses of study it sets, examines how each college is managed, appoints the chancellor or president and the staff below them and sets their pay, awards the degrees, certificates and diplomas, and decides where in the district a college sits and what property it buys, leases, holds or sells. It is not a school district and it does not run the K-12 schools.",
      basis:
        "Arizona Revised Statutes § 15-1444 (General powers and duties of district boards)",
      basisUrl: "https://www.azleg.gov/ars/15/01444.htm",
      readOn: "2026-08-28",
    },
  },
];

/** Which body is of which kind, keyed on the body id. Absence means the honest absence line. */
export const BODY_KINDS: ReadonlyArray<{ bodyId: string; kind: BodyKindKey }> = [
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#regional-flood-control-district",
    kind: "az_county_flood_control_district",
  },
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#free-library-district",
    kind: "az_county_free_library_district",
  },
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#stadium-district",
    kind: "az_county_stadium_district",
  },
  {
    bodyId:
      "ocd-division/country:us/state:az/county:pima#central-arizona-water-conservation-district",
    kind: "az_multi_county_water_conservation_district",
  },
  {
    bodyId: "ocd-division/country:us/state:az/county:pima#board-of-adjustment-district-4",
    kind: "az_county_board_of_adjustment",
  },
  // Bodies with no division: the body-specific layer needs none, so it is looked up before the null-`ocdId` guard.
  { bodyId: "curated:az/pima-community-college#governing", kind: "az_community_college_district" },
  {
    bodyId: "curated:az/pima-rocking-k-south-cfd#governing",
    kind: "az_community_facilities_district",
  },
  {
    bodyId: "wtp-body/country:us/state:az/wildflower_community_facilities_district#governing",
    kind: "az_community_facilities_district",
  },
];

const BODY_KIND_BY_ID = new Map(BODY_KINDS.map((r) => [r.bodyId, r.kind]));

/** The state a body id names, from an OCD-ID or from a curated key. */
function stateOfBody(bodyId: string, ocdId: string | null): string | null {
  return (
    ocdId?.match(/\/state:([a-z]{2})\b/)?.[1] ??
    bodyId.match(/\/state:([a-z]{2})\b/)?.[1] ??
    bodyId.match(/^curated:([a-z]{2})\//)?.[1] ??
    null
  );
}

/** The sourced definition for THIS body, or null. Needs no division. */
export function bodyKindDefinitionFor(bodyId: string, ocdId: string | null): Definition | null {
  const kind = BODY_KIND_BY_ID.get(bodyId);
  if (kind === undefined) return null;
  const state = stateOfBody(bodyId, ocdId);
  return BODY_KIND_DEFINITIONS.find((r) => r.kind === kind && r.state === state)?.definition ?? null;
}

/** The division-derivation predicate, re-exported from its own leaf module. */
export {  isDivisionsOwnGovernment } from "./division-government.ts";
/* Re-exporting does not bring the name into THIS module's scope, and
   `definitionsForBody` gates all three division-derived layers on it. */
import { isDivisionsOwnGovernment } from "./division-government.ts";

export interface BodyDefinitions {
  /** Always present where a class row exists for this state and class. */
  classDefinition: Definition | null;
  /** The charter or statute for THIS body, where it has been read. */
  formDefinition: Definition | null;
  /** Which class was resolved, for reporting and for tests. */
  classKey: ClassKey | null;
  /** One line beneath a complete class definition when the body's own charter has not been read. */
  unreadNote: string | null;
}

/** Distinguishes a sourced class definition from the unread charter for this body. */
export const CHARTER_UNREAD_LINE =
  "We haven't read this body's own charter yet, so the description above is what this kind of body does here.";

/** The whole answer for one body. */
export function definitionsForBody(input: {
  /** Required: an optional identity would silently fall back to the division. */
  bodyId: string;
  ocdId: string | null;
  divisionType: BodyDivisionType;
  lsad?: string | null;
  schoolDependency?: "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED";
}): BodyDefinitions {
  // The definition keyed on this body first: it needs no division, LSAD or Census classification.
  const bodyDefinition = bodyKindDefinitionFor(input.bodyId, input.ocdId);

  // The division-derived layers describe the division's government, so they render only on that government.
  if (!isDivisionsOwnGovernment(input.bodyId, input.ocdId, input.divisionType)) {
    return {
      classDefinition: null,
      formDefinition: bodyDefinition,
      classKey: null,
      // No class line, so no unread-charter note; the honest absence line renders.
      unreadNote: null,
    };
  }

  // A body with no division gets no class definition: `divisionType` is a placeholder there. Subsumed by the identity
  // gate above and kept as the floor.
  if (input.ocdId === null) {
    return { classDefinition: null, formDefinition: bodyDefinition, classKey: null, unreadNote: null };
  }

  const classKey = classKeyFor(input);
  const state = input.ocdId?.match(/\/state:([a-z]{2})\b/)?.[1] ?? null;

  let classDefinition: Definition | null = null;
  if (classKey === "school_district_dependent") {
    classDefinition = DEPENDENT_SCHOOL_DEFINITION;
  } else if (classKey === "school_district_unclassified") {
    classDefinition = UNCLASSIFIED_SCHOOL_DEFINITION;
  } else if (classKey) {
    // A township falls back to its state's municipality definition: a township is a type of municipality.
    const chain: ClassKey[] = classKey === "township" ? ["township", "municipality"] : [classKey];
    for (const key of chain) {
      classDefinition =
        CLASS_DEFINITIONS.find((r) => r.classKey === key && r.state === null)?.definition ??
        (state
          ? (CLASS_DEFINITIONS.find((r) => r.classKey === key && r.state === state)?.definition ??
            null)
          : null);
      if (classDefinition) break;
    }
  }

  // Layer two: the form-specific definition, then `blurbForBody`, so a hand-written per-division override wins.
  const stamp = formFor({
    ocdId: input.ocdId,
    divisionType: input.divisionType,
    lsad: input.lsad,
    schoolDependency: input.schoolDependency,
  });
  const formDefinition =
    // A definition written about this body outranks both.
    bodyDefinition ??
    blurbForBody(input.ocdId, input.divisionType) ??
    formDefinitionFor(stamp.formKey);

  return {
    classDefinition,
    formDefinition,
    classKey,
    // The note only makes sense beneath a description.
    unreadNote: classDefinition !== null && formDefinition === null ? CHARTER_UNREAD_LINE : null,
  };
}
