import type { BodyBlurb, BodyDivisionType } from "./body-description.ts";
import { blurbForBody } from "./body-description.ts";
import { formFor } from "./body-form.ts";
import { formDefinitionFor } from "./form-definitions.ts";

/**
 * **WHAT THIS BODY DOES — TWO LAYERS, AND NO CARD SHIPS EMPTY.**
 * (DEF-1 through DEF-4, 2026-08-22, the author's 8/22 walkthrough, item 11.
 * The two-layer shape is his ruling in chat, 2026-08-22.)
 *
 * Rockaway Township rendered nothing. Rockaway Township School District
 * rendered nothing. Morris County rendered *"We haven't yet read the law that
 * defines what this body can decide, so we're not going to describe it."*
 * **That copy does not ship again.**
 *
 * ## The two layers
 *
 * **Layer one — the CLASS definition. It always renders.** It describes what
 * the class of body IS and what bodies of that class generally do, and it is
 * written so that it never asserts specific powers of the specific body.
 *
 * **Layer two — the FORM-SPECIFIC definition.** It renders when the charter or
 * statute for that body has been read. It supersedes nothing: it adds
 * specificity beneath the class line.
 *
 * ## Why a class definition is not the generated claim `CLAUDE.md` forbids
 *
 * This is the question that has to be answered head-on, because
 * `body-blurbs.ts` was explicitly built the other way: it refused to write "a
 * paraphrase of what bodies of that kind generally do", calling that "exactly
 * the shape of a generated claim wearing a reasonable face". That reasoning was
 * right about what it was aimed at and it produced a card that refused to
 * describe a county.
 *
 * The resolution is that **a class definition is a sourced claim about a
 * CLASS**, not an unsourced claim about a body. Every row here carries the same
 * evidence a form-specific row carries — the statute or constitutional
 * provision that CREATES the class, its URL, and the date it was read — and its
 * text is written about the class in so many words. *"In New Jersey a township
 * is a municipal type"* is a checkable statement about New Jersey law. *"This
 * township's council can rezone your street"* would not be, and nothing here
 * says anything of that kind.
 *
 * ## The classes are STATE-SCOPED wherever the class varies, which is nearly always
 *
 * This is hardcoded so it is not re-litigated, and it is the reason the library
 * is shaped this way rather than as one dictionary of nouns:
 *
 * - **"Township" and "county" are not state-agnostic**, and treating them as
 *   such is false in this project's own pilot states. In New Jersey a township
 *   is a municipal TYPE, not a form of government — it may operate under the
 *   Township Act with a committee, or under a Faulkner Act mayor-council
 *   charter, and those are different bodies with different powers. A New
 *   England town is different again, and 03255 is exactly where that matters.
 * - **Connecticut and Rhode Island have no county government at all.** New
 *   Hampshire counties are narrow. New Jersey counties run substantial services
 *   under a Board of County Commissioners. Arizona counties are creatures of
 *   state statute. **A single national county definition is false in some of
 *   the four pilot states before this scales anywhere.**
 * - **School districts split too.** `data/reference/` holds 19,711 INDEPENDENT
 *   LEAs and 1,313 DEPENDENT school systems, and the second kind are
 *   departments of a city or county rather than governments. They get different
 *   class definitions, or the card lies about who governs the schools.
 *
 * So `state: null` means the class genuinely does not vary — a congressional
 * district and a U.S. Senate seat are created by the federal constitution and
 * are the same thing in every state. Everything else is scoped, and a state
 * with no row gets no class definition rather than another state's.
 */

/** Reuses the evidence shape the sourced blurbs already ship under. */
export type Definition = BodyBlurb;

/**
 * What kind of thing this is, for the purpose of describing it.
 *
 * Finer than `DivisionType` on purpose: `school_district` is one division type
 * and two different kinds of institution, and `place` covers a New Jersey
 * township and an Arizona city, which are not the same claim.
 */
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

/**
 * The class definitions.
 *
 * Every `basisUrl` is verified by `pnpm definitions:verify`
 * (`scripts/definitions-verify.mts`), which fetches it and checks a control
 * string — a 200 whose content is not about the thing asked for is not a
 * source, and this project has already been caught by a styled "Page not
 * found" answering HTTP 200.
 */
export const CLASS_DEFINITIONS: ReadonlyArray<ClassRow> = [
  /* ------------------------------------------------------------- federal --- */
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

  /* ---------------------------------------------------------- New Jersey --- */
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

  /* ------------------------------------------------------- New Hampshire --- */
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
    /*
     * **A NEW HAMPSHIRE COUNTY IS GENUINELY NARROW, and the generic county
     * description this file already holds would be FALSE here.**
     * (Written 2026-08-23, item 2. It is the twelfth and last of the county
     * rows that carried no definition at all.)
     *
     * The New Jersey row above says a county runs roads, parks, social
     * services and a college. The Arizona row says a county decides what can
     * be built in unincorporated territory. **Neither sentence is true of a
     * New Hampshire county**, and importing either would be the exact failure
     * the state-scoping comment at the top of this file was written to
     * prevent — a national noun standing in for fifty different governments.
     *
     * The second half is the part a reader cannot guess and most county
     * descriptions get wrong: **the commissioners are not the legislative
     * body.** The county convention is, and it is made of the state
     * representatives elected from that county, sitting together. A reader
     * who wants to be heard on the county budget goes to their state rep.
     *
     * **The source, stated exactly, because it is weaker than the rows
     * around it and hiding that would be worse than the weakness.** The
     * substance is this project's own 03255 hunt, recorded in
     * `docs/zip-playbook.md` §1 on 2026-08-22 and read from the repo today.
     *
     * **`NH93` CLOSED 2026-08-23 — the statute was opened and it says what
     * the definition says.** The row existed only because the 2026-08-23
     * remote session could reach no host but `github.com`, and writing a URL
     * it had not opened would have been RULING 107's defect. This session has
     * egress, so the read happened:
     *
     * > **RSA 24:1 Members.** *The county convention consists of the state
     * > representatives of the representative districts of the county.*
     *
     * Read 2026-08-23 at rung 3 from
     * `gencourt.state.nh.us/rsa/html/II/24/24-1.htm`. That single sentence is
     * the definition's load-bearing and least-guessable claim — the
     * commissioners are NOT the legislative body — and it is now cited to the
     * statute rather than to our own hunt notes.
     *
     * **The path was found by reading, not by pattern-matching**, and the
     * difference cost three 404s: counties are **RSA Title II**, not Title
     * III, so the `III/<chapter>/` shape every other New Hampshire citation in
     * this file uses does not reach them. Recorded here so the next session
     * citing a New Hampshire county statute starts at `II/`.
     *
     * RSA 28 (county commissioners) and RSA 23 (powers as a corporate body)
     * were opened in the same pass and both answer; `basis` names all three
     * and `basisUrl` carries the one that proves the distinctive claim.
     */
    definition: {
      text:
        "A New Hampshire county does much less than a county does in most states. It runs the county jail, the county nursing home, the sheriff's office, the registry of deeds and the county attorney's office — and it does not run roads, schools, zoning or land use, all of which belong to the town. Its legislative body is not the county commissioners: it is the county convention, made up of every state representative elected from the county, sitting together to vote the county budget. The commissioners administer what the convention appropriates.",
      basis:
        "New Hampshire RSA 24:1 (the county convention consists of the state representatives of the county's representative districts), with RSA 28 (county commissioners) and RSA 23 (powers as a corporate body)",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/II/24/24-1.htm",
      readOn: "2026-08-23",
    },
  },

  /* ----------------------------------------------------------- Arizona ---- */
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

  /* -------------------------------------------------- school districts ---- */
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

  /* ---------------------------------------------------- Arizona county ---- */
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

  /* ------------------------------- the three state seats, DI04 (2026-08-24) --
   *
   * Governor, state house seat and state senate seat had no definition row, so
   * a reader looking at the most consequential names on their ballot got the
   * least explanation. Every citation below was fetched and control-checked on
   * 2026-08-24 (`pnpm definitions:verify`).
   *
   * **Per state, not national**, and that is the finding rather than a
   * formality: these offices are creatures of each state's own constitution and
   * they genuinely differ. A New Hampshire House seat represents about 3,400
   * people; a New Jersey Assembly seat represents about 120,000. Writing one
   * national definition would have been readable, wrong, and unsourceable.
   *
   * **New Hampshire is cited to its STATUTES rather than its constitution**,
   * and the reason is recorded so it does not read as a lower standard. The NH
   * constitution is published on `nh.gov` and `sos.nh.gov`, and both refuse
   * this client with HTTP 403 — measured 2026-08-24. `gencourt.state.nh.us`
   * answers, and RSA Title I is where the General Court's own composition and
   * the governor's powers are set out. An unverifiable citation is worse than a
   * verifiable one at a different rung, so the statute is what ships.
   */
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

/**
 * A DEPENDENT school system is not a government, and the card has to say so.
 *
 * 1,313 of them are in the 2022 Census of Governments, and they are departments
 * of a city or a county rather than districts with their own board and their
 * own budget. Rendering the independent definition on one of these would tell a
 * reader to go and vote for a school board that does not exist.
 *
 * National, because the DISTINCTION is the Census Bureau's own and it is drawn
 * the same way in every state — what varies is which side a given system falls
 * on, and that is answered from the committed reference data rather than here.
 */
export const DEPENDENT_SCHOOL_DEFINITION: Definition = {
  text:
    "This school system is run as part of a city, county or state government rather than as a separate district — it has no board of its own that you elect, and no separate budget you vote on. Decisions about it are made by the government it belongs to, so the people to go to about the schools here are that government's own elected officials.",
  basis:
    "2022 Census of Governments, Government Organization — dependent school systems are classified as agencies of another government rather than as governments",
  basisUrl: "https://www.census.gov/programs-surveys/cog.html",
  readOn: "2026-08-23",
};

/**
 * **A DISTRICT THE CENSUS COULD NOT BE MATCHED TO STILL GETS DESCRIBED.**
 * (Written 2026-08-23, item 2.)
 *
 * `lib/registry/census-school-systems.ts` reaches 510 of 514 rendered
 * districts across five one-to-one branches. The four it does not reach are
 * named in `pnpm schools:classify`'s output, and every one of them is a real
 * divergence rather than a lookup failure: the Census spells Baboquivari
 * `BABOQUIVARA`; it calls Tonto Basin Elementary `TONTO SCHOOL DISTRICT 33`;
 * Union Elementary District's whole distinctive name is the word *Union*,
 * which is a structural word in every district name in the country; and
 * Prospect Mountain High School Joint Maintenance Agreement District is not in
 * the 2022 Census of Governments at all.
 *
 * **The old behaviour was to render nothing**, which is the refusal by another
 * route: the reader asks what this district is and the app declines because a
 * name did not match a spreadsheet.
 *
 * So this describes what is TRUE OF EVERY school system in the country and
 * names the one thing that is still open, as an open question rather than as a
 * silence. It asserts nothing about who governs THIS district — which is
 * precisely the claim the classifier refuses to guess at, and refusing to
 * guess is not a reason to say nothing at all.
 */
export const UNCLASSIFIED_SCHOOL_DEFINITION: Definition = {
  text:
    "This school system runs public schools for the area it covers — the school buildings, the staff, the budget for them, and the superintendent who runs it day to day. School systems in the United States come in two kinds: most are governments in their own right with a board you elect, and a smaller number are run as a department of a city, a county or the state. We have not yet established which of the two this one is, so the people to go to about it are not stated here.",
  basis:
    "2022 Census of Governments, Government Organization — the two-way classification of school systems as independent governments or as agencies of another government",
  basisUrl: "https://www.census.gov/programs-surveys/cog.html",
  readOn: "2026-08-23",
};

/**
 * Which class a body belongs to, from what the registry already knows.
 *
 * `lsad` is the Census legal/statistical area description carried on place and
 * county-subdivision rows — `43` is "Township" and `44` is "town" in the
 * Census's own coding — which is how a New Jersey township is told from a
 * borough without a name-string match. Name strings are never the join key.
 */
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
      // UNCLASSIFIED still gets DESCRIBED — see UNCLASSIFIED_SCHOOL_DEFINITION.
      // What it never gets is the INDEPENDENT definition: falling through to
      // that because most districts are independent would be a claim about who
      // governs a reader's schools, made on a base rate.
      if (input.schoolDependency === "DEPENDENT") return "school_district_dependent";
      if (input.schoolDependency === "INDEPENDENT") return "school_district_independent";
      return "school_district_unclassified";
    case "place":
      /*
       * **LSAD 44 IS "township". LSAD 43 IS "town", AND THEY ARE NOT THE SAME
       * THING.** (Corrected 2026-08-23, the questionnaire-and-corpora brief
       * item 3, found while stamping forms.)
       *
       * This read `input.lsad === "43" ? "township" : "municipality"` on the
       * belief that 43 was Township. It is not: in TIGER, 43 is the `town`
       * suffix and 44 is the `township` suffix, and the registry's own labels
       * say so outright — *"Frankford township"* carries 44, *"Madbury town"*
       * carries 43, and New Jersey's Newton, Boonton, Morristown, Kearny and
       * seven more carry 43 because **they are Towns**, one of New Jersey's
       * five municipal types.
       *
       * So the swap put the New Jersey township definition — *"in New Jersey a
       * township is a TYPE of municipality"* — on the cards of **11 named
       * governments that are not townships**, and gave the 114 that ARE
       * townships the generic municipality line instead. A wrong claim about a
       * named government is the one failure this product cannot survive, and it
       * was live on every one of those cards.
       *
       * A `town` gets no class key of its own: in all three pilot states a Town
       * is a municipality by another name — New Jersey's is a municipal type,
       * Arizona incorporates as City or Town, and New Hampshire's town is
       * covered by the New Hampshire municipality row written about exactly
       * those towns. What distinguishes them is the CHARTER, which is layer
       * two's job. `township` stays a key because New Jersey's law genuinely
       * says something different about it.
       */
      return input.lsad === "44" ? "township" : "municipality";
    default:
      return null;
  }
}

/* ========================================================================== *
 * DATA-4 — A BODY IS DESCRIBED BY WHAT IT IS, NEVER BY WHAT SHARES ITS GROUND.
 * (2026-08-28. The definition half of the identity repair DATA-3 made on the
 * ROSTER half in PR #214.)
 *
 * ## The defect, exactly
 *
 * `definitionsForBody` was keyed on the DIVISION. Six bodies sit on
 * `ocd-division/country:us/state:az/county:pima`, and only one of them is Pima
 * County. The other five — the Central Arizona Water Conservation District, the
 * Regional Flood Control District, the Free Library District, the Stadium
 * District and Board of Adjustment District 4 — each resolved to `classKey:
 * "county"` and rendered **the county's powers as their own**: county roads,
 * the jail, the county hospital, zoning in the unincorporated areas, the county
 * budget and the property tax rate, cited to **A.R.S. § 11-251**, a statute
 * that does not govern any of them. `unreadNote` was null, so nothing hedged
 * it.
 *
 * It is #214's finding one layer over. That one said a body may never acquire
 * MEMBERS because it shares an `ocdId` with a government that has some. This
 * one says the same about POWERS, and it was live on **100 bodies with a
 * LIVE calendar** — the four Pima districts, 28 City of Tucson boards and
 * commissions, and Newbury, Wilmot, New London and Rockaway Township's boards
 * and committees — plus 148 more that are verified but not yet covered.
 *
 * ## The rule, and why it is mechanical rather than a judgement per body
 *
 * The registry already records why each body exists. `bodyOrigin ===
 * "DERIVED_FROM_DIVISION_TYPE"` means *this body exists BECAUSE this division
 * does* — it is the division's own government, by construction, and the
 * division's class is its class. Every other origin means somebody FOUND this
 * body and attached it to a division; nothing about that establishes it is that
 * division's government, and CAWCD is the proof that it often is not.
 *
 * `CoveredBody` does not carry `bodyOrigin`, so the test is written on the id
 * grammar the registry builds those ids under, and
 * `tests/body-definition-identity.test.ts` asserts the two agree on **all 1,998
 * bodies, with zero mismatches**. The day the registry derives a body under a
 * different suffix, that test names it rather than a reader finding out.
 *
 * ## What a body that is NOT its division's government gets instead
 *
 * Its own SOURCED definition where one has been written (below), and otherwise
 * the honest absence — `entity-modal.tsx` renders `NO_BODY_BLURB_LINE`, which
 * is a fact about US. A gap is never wrong. A neighbour's powers always are.
 * ========================================================================== */

/**
 * A kind of body that is NOT a division's own government, described once and
 * reused wherever that kind occurs.
 *
 * This is the class doctrine at the top of this file applied one level down: a
 * sourced claim about a CLASS of special district is checkable in the same way
 * *"in New Jersey a township is a municipal type"* is checkable, and it is what
 * keeps this from becoming a hand-written paragraph per body. Arizona declares
 * each of these districts in statute, so the read happens ONCE and serves every
 * county in the state — the same economics as `FORM_DEFINITIONS`.
 *
 * State-scoped for the reason the class layer is: a stadium district is an
 * Arizona statutory creature, and nothing here may be assumed to travel.
 */
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

/**
 * Every row read from the statute itself on the date it carries, and every
 * `basisUrl` fetched and control-checked by `pnpm definitions:verify`.
 */
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

/**
 * **WHICH BODY IS OF WHICH KIND — KEYED ON THE BODY ID, NEVER ON A DIVISION.**
 *
 * Absence from this table is not a defect. It means the body gets the honest
 * absence line, which is the correct answer for a body nobody has yet read the
 * law for. Adding a row is a CLAIM, and the claim it makes is *this body is one
 * of these*, so every row is a body somebody identified from a source rather
 * than from its name.
 */
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
  /*
   * The two bodies with NO DIVISION AT ALL that are LIVE and reader-reachable
   * today. They are the reason the body-specific layer is looked up BEFORE the
   * null-`ocdId` guard rather than after it: that guard exists to stop a
   * PLACEHOLDER `divisionType` becoming a class claim, and a definition keyed
   * on the body needs no division to be true.
   */
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

/**
 * The division-derivation predicate, RE-EXPORTED from its own leaf module.
 *
 * It moved to `lib/officials/division-government.ts` on 2026-08-29 because it
 * is a string comparison and this module is the definition CORPUS: every
 * consumer of the predicate was dragging `body-blurbs`, `body-form` and
 * `form-definitions` in behind it, which took `/api/meetings` one file over its
 * committed trace ceiling the moment the govern-verb repair started asking the
 * question. Re-exported so every existing importer is unchanged and there stays
 * exactly one implementation.
 */
export { DERIVED_BODY_SUFFIX, isDivisionsOwnGovernment } from "./division-government.ts";
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
  /**
   * One short line, rendered beneath a COMPLETE class definition when the
   * body's own charter has not been read.
   *
   * **This is what replaces the refusal.** The old line said we were not going
   * to describe the body; this says what we have not read, underneath a
   * description that has already been given.
   */
  unreadNote: string | null;
}

/** The line that replaces `NO_BODY_BLURB_LINE`. Never a refusal. */
export const CHARTER_UNREAD_LINE =
  "We haven't read this body's own charter yet, so the description above is what this kind of body does here.";

/**
 * The whole answer for one body.
 *
 * Layer two is `blurbForBody`, unchanged — the existing sourced entries and the
 * per-division overrides keep working exactly as they did. What is new is that
 * a body with no layer-two entry now gets a class definition and a short note
 * instead of a refusal.
 */
export function definitionsForBody(input: {
  /**
   * **REQUIRED, AND REQUIRED ON PURPOSE** (DATA-4, 2026-08-28). It is
   * `CoveredBody.bodyId` / `RegistryBody.id`.
   *
   * It is not optional and it does not default. An optional identity is an
   * identity a call site can forget to pass, and the thing it would silently
   * fall back to is the DIVISION — which is the defect. A compiler error at the
   * one call site is the cheapest possible way to be told.
   */
  bodyId: string;
  ocdId: string | null;
  divisionType: BodyDivisionType;
  lsad?: string | null;
  schoolDependency?: "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED";
}): BodyDefinitions {
  /*
   * **LAYER TWO-AND-A-HALF FIRST: THE DEFINITION KEYED ON THIS BODY.**
   *
   * Ahead of every guard below, because it depends on nothing else. A body with
   * no division, no LSAD and no Census classification still has an identity,
   * and where somebody has read the statute that creates that kind of body,
   * that reading is true of it. This is what reaches the two LIVE bodies with a
   * null `ocdId` — Pima Community College's Governing Board and the Rocking K
   * South Community Facilities District Board — which rendered nothing at all
   * before today.
   */
  const bodyDefinition = bodyKindDefinitionFor(input.bodyId, input.ocdId);

  /*
   * **THE DIVISION-DERIVED LAYERS ARE GATED ON IDENTITY.** (DATA-4.)
   *
   * All three of them: the class definition, `blurbForBody`'s by-division
   * entries, and the form stamp. Every one is keyed on the DIVISION, so every
   * one describes the division's government — and rendering any of them on a
   * body that merely shares the ground is the false claim this exists to end.
   * CAWCD is the named case; there were 248 of them.
   */
  if (!isDivisionsOwnGovernment(input.bodyId, input.ocdId, input.divisionType)) {
    return {
      classDefinition: null,
      formDefinition: bodyDefinition,
      classKey: null,
      // No class line above it, so no note about an unread charter beneath it.
      // A body with neither layer renders the honest absence line, which is a
      // fact about US.
      unreadNote: null,
    };
  }

  /*
   * **A BODY WITH NO DIVISION GETS NO CLASS DEFINITION** (2026-08-23, item 3).
   *
   * `lib/registry/coverage.ts` builds a `CoveredBody` for a body that has no
   * division at all — the Southeast Regional Council case — and fills
   * `divisionType` with `"place"` because the field cannot be null there. That
   * default is a PLACEHOLDER, and until this guard existed it read here as a
   * finding: the body would resolve to `municipality` and render *"This is a
   * New Jersey municipality — the layer of government closest to a
   * resident"* about a body nobody has established is a municipality.
   *
   * Closing the class layer to 0 of 1,253 is what made that live. It is the
   * render-default rule one layer up from a component: a placeholder chosen
   * for a type's convenience became a claim about a real government. The
   * upstream fix is `divisionType` becoming nullable on `CoveredBody`, which
   * is 39 call sites and is `DI06`.
   *
   * **KEPT, AND NOW SUBSUMED** (DATA-4, 2026-08-28). The identity gate above is
   * strictly tighter — a null `ocdId` cannot be a division's own government —
   * so control never reaches this line any more. It stays because it is the
   * FLOOR, and a floor is worth keeping precisely when something above it is
   * doing the work: the day somebody relaxes the gate, this is what stops a
   * placeholder `divisionType` becoming a claim again. It is asserted directly
   * in `tests/body-definition-identity.test.ts`, so it is not untested code.
   */
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
    /*
     * **A TOWNSHIP FALLS BACK TO ITS STATE'S MUNICIPALITY DEFINITION, and that
     * is the New Jersey definition's own point rather than a fudge.**
     * (Added 2026-08-23, from measuring the first version's coverage.)
     *
     * `township` is a REFINEMENT of `municipality`, not a sibling of it: the NJ
     * row says so in as many words — *in New Jersey a township is a TYPE of
     * municipality, not a form of government*. So a state that has not written
     * a township-specific row is not a state with nothing to say about its
     * townships; it is a state whose municipality definition is true of them.
     *
     * It was found by measurement, not by reading. Census LSAD 43 is
     * "Township", and **388 of the registry's 1,011 place divisions carry it —
     * including all of New Hampshire's towns.** The first version resolved
     * every one of them to `township`, found no `nh` township row, and returned
     * NOTHING for 364 New Hampshire bodies while a New Hampshire definition
     * written about exactly those towns sat one key away.
     */
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

  /*
   * LAYER TWO, in two steps and in this order.
   *
   * The FORM-specific definition first (item 6, 2026-08-24). 1,034 bodies carry
   * a form stamp and they collapse to 15 distinct forms, so the statute read
   * happens once per form rather than once per body — and the form is what
   * distinguishes a New Jersey borough, whose mayor the whole town elects, from
   * a township, whose mayor was picked by three colleagues. The class layer
   * cannot say that: it is written precisely to avoid asserting the specific
   * powers of a specific body.
   *
   * Then `blurbForBody`, unchanged, which carries the per-division overrides
   * (Tucson's charter) and the older by-division entries. It goes SECOND so a
   * hand-written override for one named division still wins over the general
   * statute for its form, which is the whole reason those overrides exist.
   */
  const stamp = formFor({
    ocdId: input.ocdId,
    divisionType: input.divisionType,
    lsad: input.lsad,
    schoolDependency: input.schoolDependency,
  });
  const formDefinition =
    // A definition written about THIS BODY outranks both, for the reason the
    // division override outranks the state row: it is the most specific thing
    // anybody has actually read about it.
    bodyDefinition ??
    blurbForBody(input.ocdId, input.divisionType) ??
    formDefinitionFor(stamp.formKey);

  return {
    classDefinition,
    formDefinition,
    classKey,
    // The note only makes sense underneath something. A body with neither layer
    // renders neither, and the surface says nothing rather than apologising —
    // an apology with no description above it is the refusal again.
    unreadNote: classDefinition !== null && formDefinition === null ? CHARTER_UNREAD_LINE : null,
  };
}

/* ========================================================================== *
 * DI04 — A SEAT IS NOT A BODY, AND IT NEEDS ITS OWN PATH.
 * (2026-08-23, the questionnaire-and-corpora brief item 4.)
 *
 * ## Why closing the class layer to 1,253 of 1,253 did not describe a governor
 *
 * `definitionsForBody` takes a `BodyDivisionType` and is reached only from the
 * BODIES list — and `lib/registry/coverage.ts` keeps SEATS in a separate array
 * on purpose, because *a legislative district is not a body that meets; it
 * elects a seat in a chamber sitting elsewhere.* That separation is correct and
 * it is why three class keys — `governor`, `state_house`, `state_senate` — have
 * been declared since the layer was built and have never had a row: **nothing
 * could ever have asked for one.** The coverage number was honest and complete
 * about bodies while a reader looking at their state senator saw nothing.
 *
 * So seats get their own entry point. It resolves the same `ClassKey` space, so
 * a definition written once serves both paths and neither can drift from the
 * other.
 *
 * ## What this closes today, and what it does not
 *
 * `cd` and a U.S. Senate seat resolve to rows that already exist and are
 * already citation-verified, so those two are closed by the path alone.
 * `governor`, `state_house` and `state_senate` still have NO ROW — they need a
 * state constitution read per state, which needs network, and this session's
 * environment is REMOTE-CAPABLE with no live network but `github.com`
 * (RULING 109). **An unverified citation is worse than a missing one**, which
 * is DI04's own finding, so nothing is written for them here. They are named,
 * dated and still owed.
 * ========================================================================== */

/** The division types that elect a seat rather than constituting a body. */
export type SeatDivisionType = "cd" | "sldu" | "sldl";

/**
 * A statewide elected executive is not a district at all — there is no
 * geography narrower than the state — so it is named rather than typed off a
 * division.
 */
export type SeatKind = SeatDivisionType | "us_senate" | "governor";

/**
 * Which class describes this seat.
 *
 * Total over `SeatKind`, so a new seat kind cannot be added without deciding
 * what it is — the same reason `classKeyFor` returns `null` rather than a
 * default.
 */
export function classKeyForSeat(kind: SeatKind): ClassKey {
  switch (kind) {
    case "cd":
      return "congressional_district";
    case "us_senate":
      return "us_senate_seat";
    case "sldu":
      return "state_senate";
    case "sldl":
      return "state_house";
    case "governor":
      return "governor";
  }
}

/**
 * The whole answer for one seat.
 *
 * Mirrors `definitionsForBody` deliberately, including returning a complete
 * shape with nulls rather than throwing: a seat whose class has no row yet is a
 * gap that renders as our gap, never a crash and never a substituted claim.
 */
export function definitionsForSeat(input: {
  kind: SeatKind;
  /** The seat's own division, or the state for a statewide office. */
  ocdId: string | null;
}): BodyDefinitions {
  const classKey = classKeyForSeat(input.kind);
  const state = input.ocdId?.match(/\/state:([a-z]{2})\b/)?.[1] ?? null;

  const classDefinition =
    CLASS_DEFINITIONS.find((r) => r.classKey === classKey && r.state === null)?.definition ??
    (state
      ? (CLASS_DEFINITIONS.find((r) => r.classKey === classKey && r.state === state)
          ?.definition ?? null)
      : null);

  /*
   * A seat has no charter to read. The unread note exists for a BODY whose own
   * governing document we have not seen, and printing it here would name a
   * document that does not exist for this kind of thing.
   */
  return {
    classDefinition,
    formDefinition: null,
    classKey,
    unreadNote: null,
  };
}

/**
 * The class keys that are DECLARED and have no definition row anywhere.
 *
 * Exported so the measurement is read off the library rather than maintained by
 * hand in a report — a hand-kept list of what is missing is a list that stops
 * being true the first time somebody fixes one.
 */
export function classKeysWithNoRow(): ClassKey[] {
  const declared: ClassKey[] = [
    "school_district_independent",
    "school_district_dependent",
    "school_district_unclassified",
    "county",
    "municipality",
    "township",
    "state_house",
    "state_senate",
    "congressional_district",
    "us_senate_seat",
    "governor",
  ];
  const special: ReadonlySet<ClassKey> = new Set<ClassKey>([
    // These two do not live in CLASS_DEFINITIONS — they are single constants.
    "school_district_dependent",
    "school_district_unclassified",
  ]);
  return declared.filter(
    (key) => !special.has(key) && !CLASS_DEFINITIONS.some((r) => r.classKey === key),
  );
}
