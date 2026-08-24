/**
 * **LAYER TWO — WHAT THIS PARTICULAR FORM OF GOVERNMENT DOES.**
 * (Item 6 of the overnight depth hunt, 2026-08-24.)
 *
 * ## The gap this fills, and why the class layer could not
 *
 * `body-forms.json` stamps 1,034 of 1,037 bodies with the FORM of their
 * government and reports that they collapse to **15 distinct forms**. That is
 * the whole point of the stamp: the charter or statute read happens once per
 * form, not once per body.
 *
 * The class layer already tells a reader that a New Jersey borough and a New
 * Jersey township are both municipalities. **It cannot tell them that those are
 * two different governments under two different statutes**, because that is
 * exactly the specificity a class definition is written to avoid asserting.
 *
 * The difference is not academic. A New Jersey **borough** has a mayor elected
 * separately from a six-member council and the mayor votes only to break ties.
 * A **township** under the Township Act has a committee that picks its own
 * mayor from among itself, so the person called mayor was elected by three or
 * four colleagues rather than by the town. A reader who wants to know who to
 * call, and whether that person was chosen by them, is asking a question only
 * the form can answer.
 *
 * ## Keyed on the FORM, and the form comes from committed data
 *
 * `lib/officials/body-form.ts` derives the form key from TIGER's legal type
 * code and the Census school classification — not from a name. `Morristown` is
 * a TOWN, `Morris Township` is a TOWNSHIP, and they are eleven miles and one
 * statute apart. RULING 114 was adopted over LSAD 43 and 44 being reversed, so
 * the derivation is asserted against a second authority; nothing here re-derives
 * it.
 *
 * ## It ADDS to the class layer and supersedes nothing
 *
 * Layer one always renders. This renders beneath it when the statute for that
 * form has been read, and a form with no entry simply does not add a second
 * paragraph. There is no path here that can blank a class definition.
 *
 * ## Every citation is fetched and control-checked
 *
 * `pnpm definitions:verify` fetches each `basisUrl` and requires a control
 * string from the document's own text. A 200 whose content is not about the
 * thing asked for is not a source, and this project has been caught by both a
 * styled "Page not found" answering 200 and by a chapter index that merely
 * listed a section number.
 *
 * **The New Jersey chapter numbers were read, not assumed.** Title 40A's
 * chapters 60 to 64 are not labelled by form on the section pages, so each was
 * opened and identified from its own first sentence — *"the inhabitants of each
 * of the several boroughs"*, *"…of the several cities"*, *"…of the several
 * towns"*. 40A:64 turned out NOT to be the village chapter at all; its section
 * 1 is about Sunday sales. New Jersey's one village therefore has no entry
 * here rather than a guessed one.
 *
 * ## WHERE THIS STOPS, AND WHY — 8 of the 15 forms, 641 of the 1,037 bodies
 *
 * Stated rather than left to be inferred from what is missing.
 *
 * The eight here are the MUNICIPAL forms, and they are the ones where the form
 * carries information the class cannot. The other seven are:
 *
 * | Form | Bodies | Why no entry |
 * | --- | ---: | --- |
 * | `nj:school_district_independent` | 209 | one statutory form in the state |
 * | `nh:school_district_independent` | 147 | one statutory form in the state |
 * | `nh:county` | 12 | one statutory form in the state |
 * | `nh:school_district_dependent` | 9 | not a government; the national definition covers it |
 * | `nj:county` | 8 | one statutory form in the state |
 * | `nj:school_district_dependent` | 7 | not a government; the national definition covers it |
 * | `nj:village` | 1 | **genuinely unread — the chapter has not been found** |
 *
 * **For six of those seven the FORM and the CLASS coincide**: New Jersey has
 * one statutory form of county, New Hampshire one form of school district, and
 * the class definition for each already cites that same statute. A form entry
 * there would restate the paragraph directly above it, which is worse for a
 * reader than no second paragraph — the layer exists to ADD specificity, not to
 * fill a slot.
 *
 * **The seventh is a real gap and is recorded as one.** New Jersey's village
 * form is not in Title 40A chapters 60–64, and it has not been located. One
 * body is affected. It is a gap, not a decision.
 */
import type { BodyBlurb as Definition } from "./body-blurbs.ts";

export interface FormDefinitionRow {
  /** `<state>:<form>`, exactly as `lib/officials/body-form.ts` stamps it. */
  formKey: string;
  definition: Definition;
}

export const FORM_DEFINITIONS: ReadonlyArray<FormDefinitionRow> = [
  /* ---------------------------------------------------------- New Jersey --- */
  {
    formKey: "nj:borough",
    definition: {
      text:
        "A borough is New Jersey's most common form of town government, and the thing to know about it is that the mayor and the council are elected separately. The mayor is chosen by the whole borough and normally votes only to break a tie on the six-member council, but can veto what the council passes — which the council can override. Councillors serve three years, staggered so roughly a third of the seats are up each year, which is why there is a borough election almost every November.",
      basis: "New Jersey Revised Statutes 40A:60-1 et seq. (the Borough Act)",
      basisUrl: "https://law.justia.com/codes/new-jersey/title-40a/section-40a-60-1/",
      readOn: "2026-08-24",
    },
  },
  {
    formKey: "nj:township",
    definition: {
      text:
        "In a township under the Township Act, the people elect a township committee — usually three or five members — and the committee picks one of its own to serve as mayor, normally for a year at a time. So the mayor here was chosen by a handful of colleagues rather than by the township, and the job is to chair the committee rather than to run the place. The committee holds both the law-making and the executive side: it passes ordinances, adopts the budget, and supervises the departments directly.",
      basis: "New Jersey Revised Statutes 40A:63-1 et seq. (the Township Act)",
      basisUrl: "https://law.justia.com/codes/new-jersey/title-40a/section-40a-63-1/",
      readOn: "2026-08-24",
    },
  },
  {
    formKey: "nj:city",
    definition: {
      text:
        "A city under New Jersey's City Act elects a mayor directly and separately from the council, and the mayor here is a full executive rather than a chairperson: they run the departments day to day and can veto what the council passes. The council writes the ordinances and adopts the budget. Most of New Jersey's larger municipalities have since moved to a charter under the Faulkner Act instead, so a city still on this form is running on the older statute.",
      basis: "New Jersey Revised Statutes 40A:61-1 et seq. (the City Act)",
      basisUrl: "https://law.justia.com/codes/new-jersey/title-40a/section-40a-61-1/",
      readOn: "2026-08-24",
    },
  },
  {
    formKey: "nj:town",
    definition: {
      text:
        "A town in New Jersey is its own statutory form, not a loose word for a municipality — and it is one of the rarest. The people elect a mayor directly and a council, and the mayor sits ON the council and votes as a member of it, which is the difference from a borough, where the mayor normally votes only to break a tie. The council passes ordinances and adopts the budget.",
      basis: "New Jersey Revised Statutes 40A:62-1 et seq. (the Town Act)",
      basisUrl: "https://law.justia.com/codes/new-jersey/title-40a/section-40a-62-1/",
      readOn: "2026-08-24",
    },
  },

  /* ------------------------------------------------------- New Hampshire --- */
  {
    formKey: "nh:town",
    definition: {
      text:
        "A New Hampshire town is governed by TOWN MEETING, and that is the part with no equivalent in most of the country: the voters themselves are the legislative body. Once a year the town meets, debates the warrant article by article, and votes the budget and the by-laws directly. The elected select board runs the town between meetings and carries out what the meeting decided — it does not get to set the budget itself. If you want a say in what your town spends, the meeting is where that happens, not an election.",
      basis: "New Hampshire RSA 39:1 (Town Meetings — Meetings, When Held)",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/III/39/39-1.htm",
      readOn: "2026-08-24",
    },
  },
  {
    formKey: "nh:city",
    definition: {
      text:
        "A New Hampshire city has a mayor and a city council, and unlike a New Hampshire town it has NO town meeting: the council passes the ordinances and adopts the budget on the voters' behalf. That is the practical difference — in a town you vote the budget yourself once a year, and in a city you elect the people who do. Only a small number of New Hampshire municipalities are cities; the rest are towns.",
      basis: "New Hampshire RSA 47:17 (City Councils — Bylaws and Ordinances)",
      basisUrl: "https://www.gencourt.state.nh.us/rsa/html/III/47/47-17.htm",
      readOn: "2026-08-24",
    },
  },

  /* ------------------------------------------------------------- Arizona --- */
  {
    formKey: "az:city",
    definition: {
      text:
        "In Arizona the difference between a city and a town is population: a community of more than 3,000 people may incorporate as a city. A city's common council passes ordinances, adopts the budget, sets local taxes and fees, and decides zoning — what can be built where. Arizona cities over 3,500 people may also write their own charter, and a charter city sets its own form of government rather than taking the one the statute supplies.",
      basis: "Arizona Revised Statutes 9-101 (Incorporation; definitions) and 9-240 (General powers of common council)",
      basisUrl: "https://www.azleg.gov/ars/9/00240.htm",
      readOn: "2026-08-24",
    },
  },
  {
    formKey: "az:town",
    definition: {
      text:
        "In Arizona a town is a community that incorporated with fewer than 3,000 people — the label is about size at incorporation, not about powers. A town's council has substantially the same authority a city council does: it passes ordinances, adopts the budget, sets local taxes and fees, and decides zoning. A town that grows past the threshold does not automatically become a city; changing the label takes its own vote.",
      basis: "Arizona Revised Statutes 9-101 (Incorporation; definitions) and 9-240 (General powers of common council)",
      basisUrl: "https://www.azleg.gov/ars/9/00101.htm",
      readOn: "2026-08-24",
    },
  },
];

/** The form-specific definition for a form key, or `null` where none is read. */
export function formDefinitionFor(formKey: string | null): Definition | null {
  if (!formKey) return null;
  return FORM_DEFINITIONS.find((r) => r.formKey === formKey)?.definition ?? null;
}
