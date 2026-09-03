/**
 * **THE FORM STAMP — what KIND of government this is, from committed data
 * alone.** (Built 2026-08-23, the questionnaire-and-corpora brief, item 3.)
 *
 * ## The problem this collapses, and it is the Wikipedia finding again
 *
 * 1,037 of 1,253 bodies carry a class definition and no FORM-SPECIFIC one,
 * because a form-specific definition needs a charter or a statute read and
 * those need network. **The form itself does not.** The Census of Governments
 * carries a government type on every unit and TIGER carries a legal type code
 * on every division, and both are committed.
 *
 * So stamping the form turns *"read a charter for each of 1,037 bodies"* into
 * *"read a statute for each of a bounded list of distinct forms across three
 * states"* — the same shape as the Wikipedia finding, a linear problem turned
 * finite. **A New Jersey township under the Township Act is a different form
 * from one under a Faulkner Act mayor-council charter, and a New England town
 * is different again**; what this file does is name which of those a body is,
 * so the statute read is done once per form rather than once per body.
 *
 * ## The stamp is STATE-SCOPED, always
 *
 * `town` is not one thing. A New Hampshire town is a New England town — town
 * meeting, selectmen, a school administrative unit above the district. A New
 * Jersey Town is one of that state's five municipal types. An Arizona town is
 * simply the smaller of the two ways Arizona incorporates. **A national `town`
 * form would be false in all three pilot states before this scales anywhere**,
 * which is the same reason `body-definitions.ts` scopes its classes.
 *
 * ## The LSAD codes, written down because getting them backwards was live
 *
 * TIGER's legal/statistical area description is the structural key — never a
 * name string (`CLAUDE.md`: *never join on name strings*). The registry's own
 * labels confirm each one:
 *
 * | LSAD | suffix | example in the registry |
 * | --- | --- | --- |
 * | `21` | borough | Stockton, Flemington (NJ) |
 * | `25` | city | Paterson (NJ), Tucson (AZ), Nashua (NH) |
 * | `43` | town | Morristown (NJ), Madbury town (NH), Patagonia (AZ) |
 * | `44` | township | Frankford township, Springfield township (NJ) |
 * | `47` | village | Ridgewood (NJ) |
 *
 * **`43` is `town` and `44` is `township`.** `classKeyFor` had them the other
 * way round until 2026-08-23, which put New Jersey's township definition on the
 * cards of eleven named governments that are not townships.
 *
 * ## An unstampable body is NAMED, never counted
 *
 * `formFor` returns a reason rather than a guess, and the reason says which
 * input was missing. RULING 105: *what is rendering, what is out of scope with
 * the reason, and what is in scope and still dark* — and only naming the third
 * group keeps it apart from the second.
 */

import type { BodyDivisionType } from "./body-description.ts";

/** `nj:township`, `nh:town`, `az:county` — state-scoped, always. */
export type FormKey = string;

export interface FormStamp {
  /** `null` only where the body is genuinely unstampable. */
  formKey: FormKey | null;
  /** Reader-facing, plain language. `null` alongside a null `formKey`. */
  label: string | null;
  /** Which committed input decided it. Reported, never assumed. */
  basis: "tiger-lsad" | "division-type" | "census-school-dependency" | null;
  /** The literal value read, so a stamp can be checked rather than trusted. */
  basisDetail: string;
  /** Named, never a silent skip. `null` when stamped. */
  unstampableReason: string | null;
}

/** TIGER legal/statistical area descriptions, for the place layer. */
const LSAD_FORMS: Readonly<Record<string, string>> = {
  "21": "borough",
  "25": "city",
  "43": "town",
  "44": "township",
  "47": "village",
};

/**
 * The reader-facing name of a form.
 *
 * Written per state where the state's own law makes the word mean something
 * particular, and generically where it does not. Nothing here asserts a POWER —
 * that is what the form-specific definition, and its statute read, is for.
 */
const FORM_LABELS: Readonly<Record<FormKey, string>> = {
  /* ------------------------------------------------------------ counties --- */
  "nj:county": "a New Jersey county",
  "nh:county": "a New Hampshire county",
  "az:county": "an Arizona county",

  /* ------------------------------------------------------- New Hampshire --- */
  "nh:town": "a New Hampshire town",
  "nh:city": "a New Hampshire city",

  /* ---------------------------------------------------------- New Jersey --- */
  "nj:borough": "a New Jersey borough",
  "nj:city": "a New Jersey city",
  "nj:town": "a New Jersey Town",
  "nj:township": "a New Jersey township",
  "nj:village": "a New Jersey village",

  /* ------------------------------------------------------------- Arizona --- */
  "az:city": "an Arizona city",
  "az:town": "an Arizona town",

  /* ---------------------------------------------------- school districts --- */
  "nj:school_district_independent": "an independent New Jersey school district",
  "nj:school_district_dependent": "a New Jersey school system run by another government",
  "nh:school_district_independent": "an independent New Hampshire school district",
  "nh:school_district_dependent": "a New Hampshire school system run by another government",
  "az:school_district_independent": "an independent Arizona school district",
  "az:school_district_dependent": "an Arizona school system run by another government",
};

/** The two-letter state from an OCD-ID. Structural; never a name string. */
export function stateOf(ocdId: string): string | null {
  return ocdId.match(/\/state:([a-z]{2})\b/)?.[1] ?? null;
}

function unstampable(reason: string, basisDetail: string): FormStamp {
  return {
    formKey: null,
    label: null,
    basis: null,
    basisDetail,
    unstampableReason: reason,
  };
}

/**
 * Stamp one body's form.
 *
 * Takes the division rather than the body, because the form is a property of
 * the government the body sits on and two bodies on one division have the same
 * form by construction.
 */
export function formFor(input: {
  ocdId: string | null;
  divisionType: BodyDivisionType;
  lsad?: string | null;
  /**
   * The Census classification, passed IN rather than looked up here.
   *
   * Two reasons, and the second is the load-bearing one. It mirrors
   * `definitionsForBody`, so the two entry points take the same shape. And it
   * keeps this module free of a JSON import, which is what lets it be imported
   * by `node --test` at all — `lib/officials/school-dependency.ts` imports a
   * `.json` without an import attribute, which Next's bundler tolerates and
   * Node's ESM loader does not.
   *
   * **Omitting it yields UNCLASSIFIED, which is unstampable — never a guess.**
   * Defaulting to INDEPENDENT because most districts are would be a claim about
   * who governs a reader's schools, made on a base rate.
   */
  schoolDependency?: "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED";
}): FormStamp {
  if (input.ocdId === null) {
    return unstampable(
      "the body has no division, so there is no government whose form could be named",
      "ocdId=null",
    );
  }
  const state = stateOf(input.ocdId);
  if (state === null) {
    return unstampable(
      "the OCD-ID names no state, and every form in this file is state-scoped",
      input.ocdId,
    );
  }

  switch (input.divisionType) {
    case "county": {
      const formKey = `${state}:county`;
      return {
        formKey,
        label: FORM_LABELS[formKey] ?? null,
        basis: "division-type",
        basisDetail: "divisionType=county",
        unstampableReason: FORM_LABELS[formKey]
          ? null
          : `no label is written for ${formKey} — the state is outside the three this file covers`,
      };
    }

    case "place": {
      const lsad = input.lsad ?? null;
      if (lsad === null) {
        return unstampable(
          "the division carries no TIGER legal type code, and a municipal form is not guessable from a name",
          "lsad=null",
        );
      }
      const form = LSAD_FORMS[lsad];
      if (!form) {
        return unstampable(
          `TIGER legal type code ${lsad} states no legal municipal type — this is a place with no legal form of its own recorded`,
          `lsad=${lsad}`,
        );
      }
      const formKey = `${state}:${form}`;
      return {
        formKey,
        label: FORM_LABELS[formKey] ?? null,
        basis: "tiger-lsad",
        basisDetail: `lsad=${lsad} (${form})`,
        unstampableReason: FORM_LABELS[formKey]
          ? null
          : `no label is written for ${formKey} — the state is outside the three this file covers`,
      };
    }

    case "school_district": {
      const dependency = input.schoolDependency ?? "UNCLASSIFIED";
      if (dependency === "UNCLASSIFIED") {
        return unstampable(
          "the Census does not classify this district as independent or dependent, and the two are different governments",
          "schoolDependency=UNCLASSIFIED",
        );
      }
      const formKey = `${state}:school_district_${dependency.toLowerCase()}`;
      return {
        formKey,
        label: FORM_LABELS[formKey] ?? null,
        basis: "census-school-dependency",
        basisDetail: `schoolDependency=${dependency}`,
        unstampableReason: FORM_LABELS[formKey]
          ? null
          : `no label is written for ${formKey} — the state is outside the three this file covers`,
      };
    }

    default:
      return unstampable(
        `division type "${input.divisionType}" is a district or a seat rather than a government with a form`,
        `divisionType=${input.divisionType}`,
      );
  }
}

/** Every form this file can name. The bounded list the statute read walks. */
export function knownForms(): readonly FormKey[] {
  return Object.keys(FORM_LABELS);
}
