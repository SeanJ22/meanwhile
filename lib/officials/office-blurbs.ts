/**
 * What each office actually does, in plain words (3d).
 *
 * Written once per office *type*, never per person, and rendered wherever an
 * officeholder appears. The register is mandatory and benchmarked: common
 * spoken language, the way a neighbor would explain it, checked against
 * "would a 15-year-old understand this?" — the author's literal test. The
 * model sentence: "Your superintendent runs the district, but is bound by
 * the board." Second person, present tense; one or two sentences on power,
 * one on limits, one on when to call them.
 *
 * **Neutrality**: each blurb describes the office, never evaluates the
 * holder. Nothing here may praise, criticize, or rank. The `basis` names
 * where the office's powers are defined, so the plain words stay checkable
 * against the legal text they compress.
 *
 * This file is data, not JSX, on purpose: the routing knowledge base (Phase
 * 9) keys on the same office types, so the words and the routing can never
 * drift apart.
 */

export type OfficeType =
  | "us-senator"
  | "us-representative"
  | "state-senator"
  | "state-representative"
  | "county-commissioner"
  | "school-board"
  | "superintendent"
  | "mayor"
  | "city-council";

export interface OfficeBlurb {
  /** The plain-words explanation. The author's register, checked. */
  text: string;
  /** Where this office's powers are defined — the checkable source. */
  basis: string;
  basisUrl: string | null;
}

export const OFFICE_BLURBS: Readonly<Record<OfficeType, OfficeBlurb>> = {
  "us-senator": {
    text: "Your senator votes on national laws, the federal budget, and treaties, and votes yes or no on judges and cabinet officials the President picks. They can't fix a pothole or change a state law. Call them about federal issues — Social Security, veterans' benefits, immigration cases, or how they should vote on a bill.",
    basis: "U.S. Constitution, Article I",
    basisUrl: "https://constitution.congress.gov/constitution/article-1/",
  },
  "us-representative": {
    text: "Your representative votes on national laws and the federal budget, and is the member of Congress elected just for your district. They can't change state or city rules. Call them about federal issues, or when a federal agency — the VA, the IRS, immigration — isn't answering you; their office can push on your behalf.",
    basis: "U.S. Constitution, Article I",
    basisUrl: "https://constitution.congress.gov/constitution/article-1/",
  },
  "state-senator": {
    text: "Your state senator votes on state laws — schools funding, roads, healthcare rules, taxes — in the state capitol. They don't run your town or decide national issues. Call them when you want a state law changed, or a state agency isn't responding.",
    basis: "The state constitution's legislative article",
    basisUrl: null,
  },
  "state-representative": {
    text: "Your state representative votes on the same state laws as your state senator, in the larger chamber of the legislature, and usually represents a smaller area — so your voice weighs more with them. Call them when you want a state law changed, or need help with a state agency.",
    basis: "The state constitution's legislative article",
    basisUrl: null,
  },
  "county-commissioner": {
    text: "Your county board runs the county: sheriff's budget, county roads, health department, elections, and what gets built on land outside city limits. It can't change state law or run your city. Call them about county services, property issues outside a city, or how county money is spent.",
    basis: "State statutes on county government",
    basisUrl: null,
  },
  "school-board": {
    text: "Your school board sets the district's budget, hires and fires the superintendent, and decides policy — boundaries, curriculum choices, school openings and closings. It doesn't run schools day to day. Call them about district-wide decisions; they answer to you, not to the superintendent.",
    basis: "State education statutes",
    basisUrl: null,
  },
  superintendent: {
    text: "Your superintendent runs the district, but is bound by the board. They manage principals, staff, and daily operations. Contact them about how a school is actually being run — and the board when you think the rules themselves should change.",
    basis: "State education statutes",
    basisUrl: null,
  },
  mayor: {
    text: "Your mayor runs the city day to day and usually proposes the budget the council votes on. What a mayor can decide alone varies by city. Call them about city services — police, water, trash, streets — and big-picture city direction.",
    basis: "The city's charter and state municipal statutes",
    basisUrl: null,
  },
  "city-council": {
    text: "Your council members pass city laws, approve the budget, and vote on what gets built where — zoning is theirs. They can't change county or state rules. Call your council member about a local ordinance, a development, or city spending; you're exactly who they answer to.",
    basis: "The city's charter and state municipal statutes",
    basisUrl: null,
  },
};

/**
 * Map an officeholder's published title to a blurb key. Titles come from the
 * rosters ("U.S. Senator", "State Representative", "Assemblymember") — an
 * unmapped title gets no blurb rather than a guessed one.
 */
export function officeTypeForTitle(title: string): OfficeType | null {
  const t = title.toLowerCase();
  if (t === "u.s. senator") return "us-senator";
  if (t === "u.s. representative") return "us-representative";
  if (t === "state senator") return "state-senator";
  if (t === "state representative" || t === "assemblymember") {
    return "state-representative";
  }
  return null;
}

export function blurbForTitle(title: string): OfficeBlurb | null {
  const type = officeTypeForTitle(title);
  return type ? OFFICE_BLURBS[type] : null;
}
