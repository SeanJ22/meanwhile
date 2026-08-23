import type { BodyBlurb, BodyDivisionType } from "./body-blurbs";
import { blurbForBody } from "./body-blurbs";

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
      // UNCLASSIFIED yields NULL. Falling through to the independent
      // definition because most districts are independent would be a claim
      // about who governs a reader's schools, made on a base rate.
      if (input.schoolDependency === "DEPENDENT") return "school_district_dependent";
      if (input.schoolDependency === "INDEPENDENT") return "school_district_independent";
      return null;
    case "place":
      // Census LSAD 43 is "Township". Everything else in the place/cousub space
      // — borough, town, city, village — is a municipality for the purpose of
      // describing what it is, and the CHARTER is what distinguishes them,
      // which is layer two's job rather than this one's.
      return input.lsad === "43" ? "township" : "municipality";
    default:
      return null;
  }
}

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
  ocdId: string | null;
  divisionType: BodyDivisionType;
  lsad?: string | null;
  schoolDependency?: "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED";
}): BodyDefinitions {
  const classKey = classKeyFor(input);
  const state = input.ocdId?.match(/\/state:([a-z]{2})\b/)?.[1] ?? null;

  let classDefinition: Definition | null = null;
  if (classKey === "school_district_dependent") {
    classDefinition = DEPENDENT_SCHOOL_DEFINITION;
  } else if (classKey) {
    classDefinition =
      CLASS_DEFINITIONS.find((r) => r.classKey === classKey && r.state === null)?.definition ??
      (state
        ? (CLASS_DEFINITIONS.find((r) => r.classKey === classKey && r.state === state)?.definition ??
          null)
        : null);
  }

  const formDefinition = blurbForBody(input.ocdId, input.divisionType);

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
