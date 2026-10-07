import { normalizeName } from "../routing/exact-name.ts";
import {
  bindNamedEntity,
  type BindableEntity,
  type NamedEntityBinding,
} from "../routing/named-entity.ts";

import type { AskInterpretation } from "./intent.ts";
import { resolveSubjectRefs, type AskSubjectRef } from "./subject.ts";

export type ResolutionBasis =
  | "READER_CONFIRMATION"
  | "READER_WORDS"
  | "WHOLE_QUESTION"
  | "MODEL_EXPANSION"
  | "MODEL_EXPANSION_NARROWED"
  | "PAGE_CONTEXT"
  | "PRIOR_TURN"
  | "NONE";

export interface ResolutionResult {
  binding: NamedEntityBinding;
  unresolvedCanonicalId?: string;
  basis: ResolutionBasis;
  boundOn: string | null;
}

export interface ResolutionContext {
  activeSubjects?: readonly AskSubjectRef[];
  priorSubjects?: readonly AskSubjectRef[];
}

const PERSONAL_PRONOUNS = /\b(?:she|her|hers|he|him|his|they|them|their|theirs)\b/i;
const IMPERSONAL_PRONOUNS = /\b(?:it|its|this|that|these|those|there)\b/i;

export function isReferential(question: string): boolean {
  return PERSONAL_PRONOUNS.test(question) || IMPERSONAL_PRONOUNS.test(question);
}

function pointsAtPeopleOnly(question: string): boolean {
  return PERSONAL_PRONOUNS.test(question) && !IMPERSONAL_PRONOUNS.test(question);
}

function isPersonLike(entity: BindableEntity, ref: AskSubjectRef): boolean {
  return (
    ref.kind === "PERSON" ||
    entity.nameClass === "person" ||
    entity.divisionType === "person"
  );
}

/**
 * Precedence: the reader's own words, then the model's expansion, then page context.
 * A BOUND at any tier ends the search. A lower tier may narrow an ambiguity only to an
 * entity the reader's words already fit, and a named government that binds nothing is
 * UNRESOLVED, never NONE.
 */
export function resolveInterpretation(
  interpretation: AskInterpretation,
  question: string,
  entities: readonly BindableEntity[],
  context: ResolutionContext = {},
): ResolutionResult {
  const tierOne: { text: string; basis: ResolutionBasis }[] = [
    ...interpretation.entityMentions.map(
      (m) => ({ text: m, basis: "READER_WORDS" as const }),
    ),
    { text: question, basis: "WHOLE_QUESTION" as const },
  ];

  let held: ResolutionResult | null = null;
  for (const candidate of tierOne) {
    const binding = bindNamedEntity(candidate.text, entities);
    if (binding.kind === "BOUND") {
      return { binding, basis: candidate.basis, boundOn: candidate.text };
    }
    if (binding.kind !== "NONE" && !held) {
      held = { binding, basis: candidate.basis, boundOn: candidate.text };
    }
  }

  if (!held && interpretation.entityMentions.length === 0 && isReferential(question)) {
    const eligible = (context.activeSubjects ?? []).filter((ref) => !pointsAtPeopleOnly(question) || ref.kind === "PERSON" || !ref.kind);
    const focused = eligible.filter((ref) => ref.focused);
    const active = focused.length ? focused : eligible;
    const last = context.priorSubjects?.[context.priorSubjects.length - 1];
    const pool = active.length ? active : last ? [last] : [];
    const unresolved = pool.find((ref) => ref.id && !entities.some((entity) => entity.id === ref.id));
    if (unresolved) return { binding: { kind: "UNRESOLVED", mention: unresolved.name }, basis: active.length ? "PAGE_CONTEXT" : "PRIOR_TURN", boundOn: unresolved.id!, unresolvedCanonicalId: unresolved.id! };
  }

  if (held?.binding.kind === "AMBIGUOUS") {
    const focused = (context.activeSubjects ?? []).filter((ref) => ref.focused && ref.id);
    if (focused.length === 1) {
      const entity = held.binding.candidates.find((candidate) => candidate.id === focused[0].id);
      if (entity) return { binding: { kind: "BOUND", entity, matchedOn: entity.name }, basis: "PAGE_CONTEXT", boundOn: focused[0].id! };
    }
  }

  for (const mention of interpretation.normalizedMentions) {
    const binding = bindNamedEntity(mention, entities);
    if (binding.kind !== "BOUND") continue;

    if (!held) {
      return { binding, basis: "MODEL_EXPANSION", boundOn: mention };
    }
    if (
      held.binding.kind === "AMBIGUOUS" &&
      held.binding.candidates.some((c) => c.id === binding.entity.id)
    ) {
      return { binding, basis: "MODEL_EXPANSION_NARROWED", boundOn: mention };
    }
    break;
  }

  if (held) return held;

  if (interpretation.entityMentions.length === 0) {
    const contextual = resolveFromContext(interpretation, question, entities, context);
    if (contextual) return contextual;
  }

  const named = interpretation.entityMentions[0] ?? interpretation.normalizedMentions[0];
  if (named) {
    return {
      binding: { kind: "UNRESOLVED", mention: named },
      basis: "NONE",
      boundOn: null,
    };
  }

  return { binding: { kind: "NONE" }, basis: "NONE", boundOn: null };
}

function resolveFromContext(
  interpretation: AskInterpretation,
  question: string,
  entities: readonly BindableEntity[],
  context: ResolutionContext,
): ResolutionResult | null {
  const referential = isReferential(question) || Boolean(interpretation.referent);
  if (!referential) return null;

  const active = resolveSubjectRefs(context.activeSubjects ?? [], entities);
  const prior = resolveSubjectRefs(context.priorSubjects ?? [], entities);

  const referent = interpretation.referent?.trim();
  if (referent) {
    const wanted = normalizeName(referent);
    const corroborated = [...active, ...prior].filter(
      ({ entity, ref }) =>
        normalizeName(entity.name) === wanted ||
        normalizeName(ref.name) === wanted ||
        bindNamedEntity(referent, [entity]).kind === "BOUND",
    );
    const distinct = new Map(corroborated.map((c) => [c.entity.id, c]));
    if (distinct.size === 1) {
      const only = [...distinct.values()][0];
      return {
        binding: { kind: "BOUND", entity: only.entity, matchedOn: only.entity.name },
        basis: "PAGE_CONTEXT",
        boundOn: referent,
      };
    }
    if (distinct.size > 1) {
      return {
        binding: {
          kind: "AMBIGUOUS",
          mention: referent,
          candidates: [...distinct.values()].map((c) => c.entity),
        },
        basis: "PAGE_CONTEXT",
        boundOn: referent,
      };
    }
  }

  const peopleOnly = pointsAtPeopleOnly(question);
  const eligible = active.filter(
    ({ entity, ref }) => !peopleOnly || isPersonLike(entity, ref),
  );
  const focused = eligible.filter(({ ref }) => ref.focused);
  const pool = focused.length > 0 ? focused : eligible;

  if (pool.length === 1) {
    return {
      binding: { kind: "BOUND", entity: pool[0].entity, matchedOn: pool[0].entity.name },
      basis: "PAGE_CONTEXT",
      boundOn: pool[0].ref.name,
    };
  }
  if (pool.length > 1) {
    return {
      binding: {
        kind: "AMBIGUOUS",
        mention: referent ?? "that",
        candidates: pool.map((p) => p.entity),
      },
      basis: "PAGE_CONTEXT",
      boundOn: null,
    };
  }

  const last = prior[prior.length - 1];
  if (last && (!peopleOnly || isPersonLike(last.entity, last.ref))) {
    return {
      binding: { kind: "BOUND", entity: last.entity, matchedOn: last.entity.name },
      basis: "PRIOR_TURN",
      boundOn: last.ref.name,
    };
  }

  return null;
}
