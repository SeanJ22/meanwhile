import { normalizeName } from "../routing/exact-name.ts";
import {
  bindNamedEntity,
  type BindableEntity,
  type NamedEntityBinding,
} from "../routing/named-entity.ts";

import type { AskInterpretation } from "./intent.ts";
import { resolveSubjectRefs, type AskSubjectRef } from "./subject.ts";

/**
 * **CANONICAL RESOLUTION — where a model's reading becomes an identity, or
 * fails to (2026-08-27, precedence corrected 2026-08-28).**
 *
 * The interpretation rung may propose that *"Vail school district"* means Vail
 * Unified School District. That proposition is worth a great deal — it is the
 * alias interpretation no keyword list could ever hold — and it is worth
 * exactly nothing as an identity claim. A model that can expand an alias can
 * also expand one that does not exist, and it can expand a correct name into a
 * DIFFERENT correct name.
 *
 * So this module is the boundary:
 *
 * ```
 *   CLAUDE INTERPRETATION      →   HYPOTHESIS
 *   bindNamedEntity(registry)  →   VERIFIED IDENTITY
 * ```
 *
 * ## The precedence, and the defect that fixed it
 *
 * The first version tried the model's expansion FIRST and returned the first
 * `BOUND`. That is unsafe in a way no amount of binder correctness repairs:
 * both candidates go through the same trustworthy binder, so if a reader names
 * Katie Hobbs and the model normalizes it to Adrian Fontes, BOTH bind — and
 * the model's hypothesis wins a race against the reader's own words. The
 * binder is not wrong in that scenario. The ORDER is.
 *
 * ```
 *   EXPLICIT NAMED ENTITY  >  MODEL NORMALIZATION  >  SOFT PAGE CONTEXT
 * ```
 *
 * | tier | candidates | what it is |
 * |------|------------|------------|
 * | 1 | `entityMentions`, then the whole question | the reader's own words, verbatim |
 * | 2 | `normalizedMentions` | the model's expansion of them |
 * | 3 | `referent`, then what is on screen | context the reader did not type |
 *
 * A `BOUND` at any tier ends the search, so a lower tier can never overrule a
 * higher one. That single property is the fix.
 *
 * ## What a lower tier may and may not repair
 *
 * **AMBIGUOUS may be narrowed, and only from inside.** If the reader's own
 * words fit two governments, the model's expansion is allowed to say which —
 * that is the alias job, and *"Vail"* fitting both the town and the district
 * is the ordinary case. But the entity it picks must be **one of the ones the
 * reader's words actually fit**. A model that answers an ambiguity with a
 * third government is not disambiguating, it is substituting, and this is the
 * one place that distinction can still be enforced mechanically.
 *
 * **UNRESOLVED stands.** When the reader names a government by class —
 * *"the Cienega school district"* — and we hold no such thing, the answer is
 * that we hold no such thing. A model expansion to a different district we DO
 * hold would answer a question about Cienega with records about Vail, which is
 * the Sunnyside defect with an alias table in front of it.
 *
 * **NONE falls through.** A reader who typed no government at all has blocked
 * nothing, so tier 2 and then tier 3 get their turn. This is what keeps
 * *"VUSD"* working (verbatim binds nothing, the expansion binds) and what
 * makes *"what has she done?"* answerable at all.
 *
 * ## The one thing this module may never do
 *
 * If the reader named a government and nothing resolves, the answer is
 * `UNRESOLVED` — **never `NONE`**. `NONE` means "no government was named",
 * which licenses the reader's own ZIP to decide the answer. Using it for "a
 * government was named and we could not find it" is precisely the silent
 * substitution that put Sunnyside under a question about Vail.
 */

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
  /** A supplied canonical context failed; this is not a holdings absence. */
  unresolvedCanonicalId?: string;
  /**
   * Which candidate actually produced the binding — operator diagnostics, and
   * the answer to "did the model's reading do any work here?".
   */
  basis: ResolutionBasis;
  /** The exact string that bound. Null when nothing did. */
  boundOn: string | null;
}

/**
 * What the surface can contribute that the reader did not type.
 *
 * Optional in full: a caller with none of it gets exactly the tier-1/tier-2
 * behaviour, which is what the map surface had before follow-ups existed.
 */
export interface ResolutionContext {
  /** Contests, candidates, bodies and people the reader has in front of them. */
  activeSubjects?: readonly AskSubjectRef[];
  /** What earlier turns in this bounded conversation resolved to, oldest first. */
  priorSubjects?: readonly AskSubjectRef[];
}

/**
 * Pronouns that make a question DEPEND on something outside it.
 *
 * Split by what they can point at, because that is the difference between a
 * defensible referent and a coin toss. *"What has she done?"* on a page
 * carrying four contests and one open candidate card points at the person —
 * a contest is not a "she". Treating every on-screen thing as a candidate
 * referent would turn a resolvable follow-up into a permanent clarification.
 */
const PERSONAL_PRONOUNS = /\b(?:she|her|hers|he|him|his|they|them|their|theirs)\b/i;
const IMPERSONAL_PRONOUNS = /\b(?:it|its|this|that|these|those|there)\b/i;

/** Does this question depend on something the reader did not type? */
export function isReferential(question: string): boolean {
  return PERSONAL_PRONOUNS.test(question) || IMPERSONAL_PRONOUNS.test(question);
}

/** Kinds a personal pronoun can honestly point at. */
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
 * Reconcile one interpretation against the entities this product actually
 * holds.
 *
 * `question` is required and is not optional flavour: it is the second tier-1
 * candidate, and it is what keeps this function's behaviour a superset of the
 * binder that shipped without a model.
 */
export function resolveInterpretation(
  interpretation: AskInterpretation,
  question: string,
  entities: readonly BindableEntity[],
  context: ResolutionContext = {},
): ResolutionResult {
  /* ── TIER 1 — THE READER'S OWN WORDS ──────────────────────────────────
     Verbatim spans first, then the whole question. Both are things the
     reader typed; neither is anything a model proposed. */
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

  // A pronoun depends on the supplied canonical context. An unresolved ID
  // cannot be discarded before a model expansion or an older context chooses
  // a same-name record. Explicit names in the reader's own question still win.
  if (!held && interpretation.entityMentions.length === 0 && isReferential(question)) {
    const eligible = (context.activeSubjects ?? []).filter((ref) => !pointsAtPeopleOnly(question) || ref.kind === "PERSON" || !ref.kind);
    const focused = eligible.filter((ref) => ref.focused);
    const active = focused.length ? focused : eligible;
    const last = context.priorSubjects?.[context.priorSubjects.length - 1];
    const pool = active.length ? active : last ? [last] : [];
    const unresolved = pool.find((ref) => ref.id && !entities.some((entity) => entity.id === ref.id));
    if (unresolved) return { binding: { kind: "UNRESOLVED", mention: unresolved.name }, basis: active.length ? "PAGE_CONTEXT" : "PRIOR_TURN", boundOn: unresolved.id!, unresolvedCanonicalId: unresolved.id! };
  }

  // An explicit focused canonical ID can distinguish two records whose names
  // matched the reader's words. It selects within that set; it never merges
  // them or replaces an explicit naming with an unrelated open card.
  if (held?.binding.kind === "AMBIGUOUS") {
    const focused = (context.activeSubjects ?? []).filter((ref) => ref.focused && ref.id);
    if (focused.length === 1) {
      const entity = held.binding.candidates.find((candidate) => candidate.id === focused[0].id);
      if (entity) return { binding: { kind: "BOUND", entity, matchedOn: entity.name }, basis: "PAGE_CONTEXT", boundOn: focused[0].id! };
    }
  }

  /* ── TIER 2 — THE MODEL'S EXPANSION ───────────────────────────────────
     Reached only when the reader's own words bound nothing. */
  for (const mention of interpretation.normalizedMentions) {
    const binding = bindNamedEntity(mention, entities);
    if (binding.kind !== "BOUND") continue;

    if (!held) {
      return { binding, basis: "MODEL_EXPANSION", boundOn: mention };
    }
    /*
     * The reader's words produced a verdict and it is not being discarded.
     * The expansion may NARROW an ambiguity — from inside the set the
     * reader's own words fit — and may not replace it with a third thing.
     */
    if (
      held.binding.kind === "AMBIGUOUS" &&
      held.binding.candidates.some((c) => c.id === binding.entity.id)
    ) {
      return { binding, basis: "MODEL_EXPANSION_NARROWED", boundOn: mention };
    }
    /* UNRESOLVED stands, and an out-of-set narrowing is refused. Both keep
       the reader's own naming above the model's. */
    break;
  }

  if (held) return held;

  /* ── TIER 3 — SOFT PAGE CONTEXT ───────────────────────────────────────
     Reached only when the reader named nothing at all, which is exactly the
     case a pronoun creates. Nothing here is chosen: one defensible referent
     binds, more than one asks.

     **A reader who named something explicitly never reaches this tier**, even
     when their question also carries a pronoun. "What has Katie Hobbs done for
     her state?" is a question about Hobbs; if we hold no Hobbs, the honest
     answer is that we hold no Hobbs — answering it about whichever card
     happened to be open would be the substitution defect arriving through the
     follow-up feature. */
  if (interpretation.entityMentions.length === 0) {
    const contextual = resolveFromContext(interpretation, question, entities, context);
    if (contextual) return contextual;
  }

  /*
   * **A NAMED GOVERNMENT THAT MATCHED NOTHING IS `UNRESOLVED`, NOT `NONE`.**
   *
   * The binder returns `NONE` for "no entity's identifying tokens appear in
   * this text", which is the right answer to the question IT was asked and the
   * wrong answer to the one the reader asked. When the interpretation rung saw
   * a government being named and no candidate bound, we hold a name and no
   * entity — and saying `NONE` here would hand the question to ZIP-default
   * routing, which is the substitution defect with a model's endorsement on
   * top of it.
   */
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

/**
 * **THE REFERENT, ACTUALLY CONSUMED.**
 *
 * `interpretQuestion` has reported a `referent` since the pipeline shipped and
 * nothing read it: the field existed, the comment claimed *"what has she
 * done?"* resolved through page context, and the implementation never looked.
 * A comment stronger than its code is the same class of defect as a test that
 * re-implements the rule it guards — it reads as covered and is not.
 *
 * The rules, in order of how much they refuse:
 *
 * 1. **A model referent must be CORROBORATED.** Claude may say the pronoun
 *    means Katie Hobbs; that becomes true only if Katie Hobbs is something the
 *    surface said was on screen or a prior turn resolved to. An uncorroborated
 *    referent is the model naming a subject out of its own memory, which is
 *    the one thing this pipeline exists to prevent.
 * 2. **Focused beats merely present.** The card the reader opened is a fact
 *    about what they are looking at; the other twelve cards on the page are
 *    not.
 * 3. **More than one defensible referent ASKS.** It never picks.
 * 4. **A prior turn resolves a follow-up** when the page offers nothing —
 *    which is what makes the map surface's *"and what did they decide?"* work
 *    without persisting anybody's political conversation.
 */
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

  /* 1. A corroborated model referent. */
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
    /* Uncorroborated. Fall through to the page's own evidence rather than
       trusting a name the surface never said was there. */
  }

  /* 2/3. What the surface says is in front of the reader. */
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

  /* 4. The bounded follow-up: the most recent thing this conversation was
     already about. Most recent wins outright — a follow-up refers back to the
     last exchange, not to an average of the last four. */
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
