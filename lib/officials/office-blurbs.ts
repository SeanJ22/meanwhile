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

/** Runtime kinds validate source-backed office records; legacy blurbs remain the way back. */
export type OfficeType = string;

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
    // Jurisdiction-neutral by construction (item 1, 2026-08-14 second
    // session): this text renders for EVERY mayor, so it may claim nothing
    // that is only true in one city. The Tucson-specific council-manager
    // sentence that used to live here rendered on Rockaway Township's
    // mayor — one jurisdiction's content bound to another jurisdiction's
    // key. City-specific truth lives in DIVISION_OFFICE_BLURBS below.
    text: "Your mayor is the city's elected leader — they speak for the city and lead its government. How much day-to-day power a mayor has depends on the city's own charter: in some cities the mayor runs city hall directly, and in others a hired manager runs the daily work while the mayor leads the council. Call them about city services and where the city is headed.",
    basis: "The city's charter and state municipal statutes",
    basisUrl: null,
  },
  "city-council": {
    text: "Your council members pass city laws, approve the budget, and vote on what gets built where — zoning is theirs. They can't change county or state rules. Call your council member about a local ordinance, a development, or city spending; you're exactly who they answer to.",
    basis: "The city's charter and state municipal statutes",
    basisUrl: null,
  },
  // 2e (2026-08-17): the substitute-for-a-mayor case, explained rather than
  // left as a gap. New England towns are run this way on purpose.
  /*
   * NEW JERSEY'S MUNICIPAL GOVERNING BODIES (NJ Hunt 2, 2026-08-22).
   *
   * Added when the Morris ballot stopped being six contests and became the
   * county clerk's whole filing — borough councils, township committees,
   * township councils and ward-based town councils, none of which any existing
   * explainer resolved for.
   *
   * It is NOT mapped to , and that is deliberate. New Jersey
   * municipalities run under several different forms of government, and a
   * township committee is not a city council: the committee members are the
   * governing body AND the heads of the town's departments, and the mayor is
   * chosen from among them rather than elected separately. An explainer that
   * described one form as though it were all of them would be a generated claim
   * about how a reader's own town works.
   *
   * So the text says what is true across the forms and says plainly that the
   * rest varies, which is the honest answer and is checkable against the town's
   * own charter.
   */
  "nj-municipal-governing-body": {
    text: "Your council or committee is the town's own elected lawmaking body. They pass local ordinances, adopt the municipal budget, set the local tax rate, decide zoning, and oversee the people who run town services. New Jersey towns use several different forms of government — borough, township committee, township council, town council — so how much sits with this body rather than with a mayor or an administrator depends on your town's charter. Call them about local roads, zoning, rubbish collection, the police budget, and anything else the town itself runs.",
    basis: "New Jersey Revised Statutes Title 40A, and the municipality's own charter",
    basisUrl: null,
  },
  "select-board": {
    text: "Your Select Board is the town's government — a few neighbors elected to run things between town meetings. They set the budget proposal, oversee town staff, and carry out what the annual town meeting votes. The biggest decisions — the budget itself, big purchases — are made by the voters at town meeting, not by the board. Call them about roads, town services, and anything the town runs.",
    basis: "New Hampshire RSA 41 (town officers)",
    basisUrl: "https://www.gencourt.state.nh.us/rsa/html/NHTOC/NHTOC-III-41.htm",
  },
  // 4b (2026-08-17): every office type on a covered ballot gets its
  // explainer. Same register, same neutrality: the office, never the holder.
  governor: {
    text: "Your governor runs the state government — they propose the state budget, sign or veto laws the legislature passes, appoint agency heads and judges, and command the National Guard in a state emergency. They can't pass laws alone or change what your town does. Call their office when a state agency has failed you and nothing else has worked.",
    basis: "The state constitution's executive article",
    basisUrl: null,
  },
  "executive-councilor": {
    text: "Your executive councilor is a New Hampshire oddity worth knowing: a five-member elected council that must approve the governor's big decisions — judges, agency heads, state contracts over $10,000, and pardons. The governor can't do those things without the Council's vote. Call them when a state contract, appointment, or pardon in your area is being decided.",
    basis: "New Hampshire Constitution, Part 2, Articles 60–66",
    basisUrl: "https://www.nh.gov/glance/executive-council.htm",
  },
  "secretary-of-state": {
    text: "Your secretary of state runs elections — voter registration, polling rules, counting and certifying results — and keeps the state's official records, including business filings. They don't make election law; the legislature does. Call their office about registering to vote, running for office, or a problem at the polls.",
    basis: "State statutes on elections and public records",
    basisUrl: null,
  },
  "attorney-general": {
    text: "Your attorney general is the state's lawyer — they prosecute major crimes, defend state agencies in court, enforce consumer-protection law, and issue legal opinions state agencies follow. They don't handle private disputes. Call their office to report a scam, fraud, or a business treating people unfairly.",
    basis: "State statutes on the department of justice / law",
    basisUrl: null,
  },
  "state-treasurer": {
    text: "Your state treasurer is the state's banker — they hold and invest the state's money, manage its debt, and return unclaimed property to the people it belongs to. They don't decide how money is spent; the budget does. Their office is also where you check whether the state is holding money in your name.",
    basis: "State statutes on the treasury",
    basisUrl: null,
  },
  "superintendent-public-instruction": {
    text: "Your state superintendent runs the state education department — distributing school funding by the legislature's formula, overseeing standards and testing, and certifying teachers. They don't run your local district; your school board does. Call the department about teacher certification or a dispute your district can't resolve.",
    basis: "State education statutes",
    basisUrl: null,
  },
  "mine-inspector": {
    text: "Your state mine inspector — an elected office only Arizona has — inspects active and abandoned mines for safety, and runs the program that fences off the state's roughly 100,000 abandoned mine openings. Call their office to report a dangerous open mine shaft.",
    basis: "Arizona Constitution, Article 19",
    basisUrl: null,
  },
  "corporation-commissioner": {
    text:
      "Your corporation commissioners set the rates your regulated electric, gas, water and telephone utilities may charge, decide where power lines and plants may be built, and register every business incorporated in the state. Arizona is one of the few states where this job is elected rather than appointed. Contact the commission to object to a proposed utility rate increase, or to look up who owns a company.",
    basis: "Arizona Constitution, Article 15",
    basisUrl: null,
  },
  "county-sheriff": {
    text: "Your sheriff runs the county jail, patrols areas outside city police departments, serves court papers, and provides courtroom security. Inside a city, the city's police handle most calls. Call the sheriff's office for law-enforcement matters outside city limits, or anything about the county jail.",
    basis: "State statutes on county officers",
    basisUrl: null,
  },
  "county-attorney": {
    text: "Your county attorney prosecutes crimes committed in the county and advises county government on the law. They decide which charges to bring — one of the most consequential local powers there is. They don't handle private lawsuits. Contact their office as a victim or witness in a county case.",
    basis: "State statutes on county officers",
    basisUrl: null,
  },
  "county-treasurer": {
    text: "Your county treasurer collects property taxes, holds the county's money, and invests it until it's spent. They don't set your tax rate — budgets voted by other bodies do. Call them about paying a property-tax bill, not about how big it is.",
    basis: "State statutes on county officers",
    basisUrl: null,
  },
  "register-of-deeds": {
    text: "Your register of deeds keeps the county's land records — every deed, mortgage, and lien on property in the county, on public file. Buying or selling property runs through this office. Call them to get a copy of a deed or check what's recorded against a property.",
    basis: "State statutes on county officers",
    basisUrl: null,
  },
  "register-of-probate": {
    text: "Your register of probate keeps the county's records of wills, estates, and guardianships — the paperwork of the probate court. In New Hampshire the office's day-to-day duties now sit with the state court system, but the elected office remains on the ballot. Call the probate court about a will or an estate.",
    basis: "New Hampshire RSA 548",
    basisUrl: null,
  },
  "county-surrogate": {
    text: "Your county surrogate — a New Jersey office — is the county's probate judge for uncontested matters: they admit wills, appoint executors and administrators of estates, and handle adoptions' court paperwork. Call their office when someone has died and you need authority to settle their affairs.",
    basis: "New Jersey statutes, Title 3B",
    basisUrl: null,
  },
  "county-clerk": {
    text: "Your county clerk runs the county's elections paperwork — ballots, mail voting, candidate filings — and records official documents like deeds (in some states) and passports. Call them about a mail ballot, an election deadline, or certified copies of records.",
    basis: "State statutes on county officers",
    basisUrl: null,
  },
};

/**
 * Jurisdiction-specific office blurbs (item 1, 2026-08-14 second session).
 *
 * A blurb here applies ONLY when the officeholder's own division matches
 * `divisionOcdId` exactly — verified content about how one named place's
 * charter actually works. The generic per-type blurb above is the fallback
 * for everyone else. This is the sibling of the uniqueness invariant: a
 * per-type key must never carry per-place content, because every holder of
 * the type wears it.
 */
export const DIVISION_OFFICE_BLURBS: ReadonlyArray<{
  officeType: OfficeType;
  divisionOcdId: string;
  blurb: OfficeBlurb;
}> = [
  {
    officeType: "mayor",
    divisionOcdId: "ocd-division/country:us/state:az/place:tucson",
    // Verified against the charter before writing (5b, 2026-08-15):
    // Tucson is council-manager, so "runs the city day to day" would be
    // false there.
    blurb: {
      text: "Your mayor is the city's elected leader — they lead the city council, speak for the city, and vote on the big decisions. In Tucson, the day-to-day work of city government is run by a city manager the council hires, so most big decisions need the council's vote, not the mayor's alone. Call them about city services and where the city is headed.",
      basis:
        "Tucson City Charter (council–manager form) and state municipal statutes",
      basisUrl:
        "https://codelibrary.amlegal.com/codes/tucson/latest/tucson_az_charter",
    },
  },
];

/**
 * STATE-scoped office blurbs — the layer between the per-type text everyone
 * wears and the per-place text only one charter earns.
 *
 * ## Why New Jersey's mayors needed one
 *
 * The generic `mayor` blurb opens *"Your mayor is the city's elected leader"*
 * and goes on to describe city hall and a hired manager. It was written for
 * Tucson's neighbours and it is not true of New Jersey, where the nine
 * municipalities electing a mayor in 2026 are eight boroughs and one Faulkner
 * Act township, none of them a city and none of them council-manager.
 *
 * That text was ALREADY rendering for New Jersey mayors before the mayoral
 * contests were recovered on 2026-08-25, because the committed rosters carry
 * `officeTitle: "Mayor"` — the mayor of Boonton was being described to readers
 * as a city's elected leader. Recovering nine mayoral CONTESTS would have put
 * the same sentence on nine more surfaces, which is RULING 114 exactly: closing
 * a layer converts every wrong entry in it from silence into a false claim.
 *
 * ## What the New Jersey text claims, and what it deliberately does not
 *
 * It names the variation rather than resolving it, the same way the New Jersey
 * municipal-body blurb beside it already does. Under the Borough form the mayor
 * presides over council and votes only to break a tie, and under a Faulkner Act
 * mayor-council charter the mayor runs the administration outright — those are
 * opposite answers to "does this person run the town", and this product does not
 * know which charter a reader's town uses at the point this renders. So the
 * blurb tells the reader that the answer depends on their town's charter, which
 * is true of every New Jersey mayor and is a fact a reader can act on, rather
 * than picking one and being wrong in the other places.
 *
 * A state entry applies only where the division's OCD id sits under that state.
 * The per-place list above still wins over it, and the per-type text below is
 * the fallback for everyone else.
 */
export const STATE_OFFICE_BLURBS: ReadonlyArray<{
  officeType: OfficeType;
  state: string;
  blurb: OfficeBlurb;
}> = [
  {
    officeType: "mayor",
    state: "nj",
    blurb: {
      text: "Your mayor is your town's elected leader — they speak for the town and sit at the head of its government. New Jersey towns use several different forms of government, and how much the mayor actually runs depends on which one your town uses: in a borough the mayor presides over the council and votes mainly to break a tie, while under a mayor-council charter the mayor runs the town's administration directly. Call them about town services and where the town is headed.",
      basis:
        "New Jersey municipal statutes — the Borough form (N.J.S.A. 40A:60) and the Optional Municipal Charter (Faulkner) Act (N.J.S.A. 40:69A)",
      basisUrl: null,
    },
  },
];

/** The state segment of an OCD id, or null where it carries none. */
function stateOf(divisionOcdId: string | null | undefined): string | null {
  return divisionOcdId ? (/\/state:([a-z]{2})\b/.exec(divisionOcdId)?.[1] ?? null) : null;
}

/**
 * The blurb for a type in a place — place first, then state, then the generic.
 *
 * ONE resolution order, called by both entry points, because two orders is the
 * thing that can disagree (RULING 103).
 */
function resolveBlurb(
  type: OfficeType,
  divisionOcdId?: string | null,
): OfficeBlurb {
  if (divisionOcdId) {
    const specific = DIVISION_OFFICE_BLURBS.find(
      (entry) => entry.officeType === type && entry.divisionOcdId === divisionOcdId,
    );
    if (specific) return specific.blurb;
    const state = stateOf(divisionOcdId);
    const statewide = state
      ? STATE_OFFICE_BLURBS.find((e) => e.officeType === type && e.state === state)
      : undefined;
    if (statewide) return statewide.blurb;
  }
  return OFFICE_BLURBS[type];
}

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
  // The tier-3 rosters (5a/5b): local elected offices, curated with
  // citations in lib/registry/body-rosters.ts. Matches are exact-shaped on
  // the titles those rosters use — a Selectboard member deliberately maps
  // to nothing rather than to a school-board blurb.
  if (t === "mayor") return "mayor";
  if (t.includes("council member") || t === "councilwoman" || t === "councilman") {
    return "city-council";
  }
  if (t.includes("supervisor")) return "county-commissioner";
  if (t.includes("governing board")) return "school-board";
  if (t.includes("school board")) return "school-board";
  // 2e: the Selectboard maps to its own explainer, never a borrowed one.
  if (t.includes("selectboard") || t.includes("select board")) {
    return "select-board";
  }
  if (t === "governor") return "governor";
  if (t.includes("executive council")) return "executive-councilor";
  if (t === "secretary of state") return "secretary-of-state";
  if (t === "attorney general") return "attorney-general";
  if (t === "state treasurer" || t === "treasurer") return "state-treasurer";
  if (t.includes("superintendent of public instruction")) {
    return "superintendent-public-instruction";
  }
  if (t.includes("mine inspector")) return "mine-inspector";
  if (t.includes("corporation commissioner")) return "corporation-commissioner";
  if (t.includes("sheriff")) return "county-sheriff";
  if (t.includes("county attorney")) return "county-attorney";
  if (t.includes("county treasurer")) return "county-treasurer";
  if (t.includes("register of deeds")) return "register-of-deeds";
  if (t.includes("register of probate")) return "register-of-probate";
  if (t.includes("surrogate")) return "county-surrogate";
  if (t.includes("county clerk")) return "county-clerk";
  if (t.includes("county commissioner")) return "county-commissioner";
  return null;
}

export function blurbForTitle(
  title: string,
  divisionOcdId?: string | null,
): OfficeBlurb | null {
  const type = officeTypeForTitle(title);
  return type ? resolveBlurb(type, divisionOcdId) : null;
}

/**
 * Map a ballot contest's title — the filing's phrasing, which differs from
 * roster titles ("Member of the United States Senate", "Representative in
 * Congress, District 2") — to an office type (4b). County-specific offices
 * check before their state-level cousins so "Merrimack County Treasurer"
 * never reads as the state treasurer. An unmatched title gets no blurb
 * rather than a guessed one.
 */
export function officeTypeForContestTitle(title: string): OfficeType | null {
  const t = title.toLowerCase();
  if (t.includes("united states senate") || t.includes("united states senator")) {
    return "us-senator";
  }
  if (
    t.includes("house of representatives") ||
    t.includes("representative in congress") ||
    t.includes("u.s. representative")
  ) {
    return "us-representative";
  }
  if (t.includes("county commissioner")) return "county-commissioner";
  if (t.includes("board of education")) return "school-board";
  if (
    t.includes("borough council") ||
    t.includes("township committee") ||
    t.includes("township council") ||
    t.includes("town council")
  ) {
    return "nj-municipal-governing-body";
  }
  if (t.includes("state senator")) return "state-senator";
  if (t.includes("state representative")) return "state-representative";
  if (t.includes("executive councilor")) return "executive-councilor";
  if (t === "governor") return "governor";
  if (t.includes("secretary of state")) return "secretary-of-state";
  if (t.includes("attorney general")) return "attorney-general";
  if (t.includes("county attorney")) return "county-attorney";
  if (t.includes("county treasurer")) return "county-treasurer";
  if (t.includes("state treasurer")) return "state-treasurer";
  if (t.includes("superintendent of public instruction")) {
    return "superintendent-public-instruction";
  }
  if (t.includes("mine inspector")) return "mine-inspector";
  if (t.includes("corporation commissioner")) return "corporation-commissioner";
  if (t.includes("sheriff")) return "county-sheriff";
  if (t.includes("register of deeds")) return "register-of-deeds";
  if (t.includes("register of probate")) return "register-of-probate";
  if (t.includes("surrogate")) return "county-surrogate";
  if (t.includes("county clerk")) return "county-clerk";
  if (t.includes("select board") || t.includes("selectboard")) {
    return "select-board";
  }
  /*
   * Last, and matched on the WHOLE title rather than as a substring.
   *
   * The clerk's heading for a mayoral race is the bare word, and it must not
   * catch the titles above it: "Mayor and Council" and "Member of the Borough
   * Council" both mention a mayor and neither is a mayoral contest. Placing it
   * after the council branches and requiring an exact match are two independent
   * reasons it cannot; either alone would be enough, and both are cheap.
   */
  if (t.trim() === "mayor") return "mayor";
  return null;
}

export function blurbForContestTitle(
  title: string,
  divisionOcdId?: string | null,
): OfficeBlurb | null {
  const type = officeTypeForContestTitle(title);
  return type ? resolveBlurb(type, divisionOcdId) : null;
}
