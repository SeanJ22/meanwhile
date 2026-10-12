/**
 * The form stamp: what kind of government a division is, from committed Census and TIGER data alone, so a statute is
 * read once per form rather than once per body. State-scoped always.
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

/** The reader-facing name of a form; asserts no power. */
const FORM_LABELS: Readonly<Record<FormKey, string>> = {
  "nj:county": "a New Jersey county",
  "nh:county": "a New Hampshire county",
  "az:county": "an Arizona county",

  "nh:town": "a New Hampshire town",
  "nh:city": "a New Hampshire city",

  "nj:borough": "a New Jersey borough",
  "nj:city": "a New Jersey city",
  "nj:town": "a New Jersey Town",
  "nj:township": "a New Jersey township",
  "nj:village": "a New Jersey village",

  "az:city": "an Arizona city",
  "az:town": "an Arizona town",

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

/** Stamp one body's form, from the division it sits on. */
export function formFor(input: {
  ocdId: string | null;
  divisionType: BodyDivisionType;
  lsad?: string | null;
  /** The Census classification, passed in so this module needs no JSON import. Omitted, it is unclassified: never a guess. */
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
