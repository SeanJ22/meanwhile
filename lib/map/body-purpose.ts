import {
  bodyKindDefinitionFor,
  definitionsForBody,
} from "@/lib/officials/body-definitions";
import type { BodyBlurb } from "@/lib/officials/body-description";
import type { CoveredBody } from "@/lib/registry/coverage";
import dependency from "@/data/derived/school-district-dependency.json" with { type: "json" };

type SchoolDependency = "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED";
const SCHOOL_DEPENDENCY = (
  dependency as { stamp: Record<string, SchoolDependency> }
).stamp;

/** A short label is only an excerpt of a definition the product can cite. */
export interface BodyPurpose {
  label: string;
  description: string;
  basis: string;
  basisUrl: string;
  readOn: string;
}

/*
 * These are literal phrases already present in the sourced definition corpus.
 * The first affirmative matching phrase wins, so a label is never inferred
 * from a body name or from a generic idea of what a government "usually" does.
 */
const PURPOSE_PHRASES = [
  "flood control",
  "public libraries",
  "water conservation",
  "public infrastructure",
  "zoning appeals",
  "community colleges",
  "school budget",
  "district policy",
  "local ordinances",
  "town meeting",
  "county roads",
  "federal law",
  "public housing",
  "historic preservation",
  "public art",
  "transportation",
  "stadium",
  "sewer",
  "parks",
] as const;

function labelFromDefinition(definition: BodyBlurb): BodyPurpose | null {
  if (!definition.basisUrl || !definition.readOn) return null;
  const text = definition.text.toLocaleLowerCase("en-US");
  const sentences = text.split(/(?<=[.!?])\s+/);
  const phrase = PURPOSE_PHRASES.find((candidate) =>
    sentences.some((sentence) => {
      const index = sentence.indexOf(candidate);
      if (index < 0) return false;
      /* Exact text is not enough when the source is explicitly denying that
         power (for example, New Hampshire cities have "no town meeting"). */
      const lead = sentence.slice(Math.max(0, index - 56), index);
      return !/\b(?:no|not|never|cannot|without|does not|do not)\b/.test(lead);
    }),
  );
  if (!phrase) return null;
  return {
    label: phrase.replace(/^./, (letter) => letter.toUpperCase()),
    description: definition.text,
    basis: definition.basis,
    basisUrl: definition.basisUrl,
    readOn: definition.readOn,
  };
}

/**
 * Returns a purpose only when this exact body resolves to an authoritative,
 * cited description. Unknown bodies deliberately render no purpose label.
 */
export function bodyPurposeFor(body: CoveredBody): BodyPurpose | null {
  /* A small number of curated, source-proven bodies have no division. Their
     exact body-kind definition is still valid; only division-derived class
     descriptions are unavailable. */
  if (body.divisionType === null) {
    const definition = bodyKindDefinitionFor(body.bodyId, body.ocdId);
    return definition ? labelFromDefinition(definition) : null;
  }
  const definitions = definitionsForBody({
    bodyId: body.bodyId,
    ocdId: body.ocdId,
    divisionType: body.divisionType,
    lsad: body.lsad,
    schoolDependency:
      body.divisionType === "school_district" && body.ocdId
        ? (SCHOOL_DEPENDENCY[body.ocdId] ?? "UNCLASSIFIED")
        : undefined,
  });

  /* A form-specific definition can narrow or contradict its broader class.
     Once one exists, never fall back to a phrase from that broader layer. */
  const definition =
    definitions.formDefinition ?? definitions.classDefinition;
  return definition ? labelFromDefinition(definition) : null;
}

export function bodyPurposeIndex(
  bodies: readonly CoveredBody[],
): ReadonlyMap<string, BodyPurpose> {
  const purposes = new Map<string, BodyPurpose>();
  for (const body of bodies) {
    const purpose = bodyPurposeFor(body);
    if (purpose) purposes.set(body.bodyId, purpose);
  }
  return purposes;
}
