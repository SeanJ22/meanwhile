import {
  bindNamedEntity,
  type BindableEntity,
  type NamedEntityBinding,
} from "../routing/named-entity.ts";

import type { AskInterpretation } from "./intent.ts";

/**
 * **CANONICAL RESOLUTION — where a model's reading becomes an identity, or
 * fails to (2026-08-27).**
 *
 * The interpretation rung may propose that *"Vail school district"* means Vail
 * Unified School District. That proposition is worth a great deal — it is the
 * alias interpretation no keyword list could ever hold — and it is worth
 * exactly nothing as an identity claim. A model that can expand an alias can
 * also expand one that does not exist.
 *
 * So this module is the boundary:
 *
 * ```
 *   CLAUDE INTERPRETATION      →   HYPOTHESIS
 *   bindNamedEntity(registry)  →   VERIFIED IDENTITY
 * ```
 *
 * Every candidate string — the model's expansion, the reader's own words, and
 * the raw question — is run through the SAME deterministic binder the product
 * already trusted before any model was involved. Nothing resolves except by
 * matching a registry entity's identifying tokens. A mention the model
 * invented matches nothing and comes back `UNRESOLVED`, which is a sentence
 * the reader sees rather than a government they get handed.
 *
 * ## The order, and why it is the order
 *
 * 1. **The model's expansion.** Most likely to bind, because it is closest to
 *    the registry's own wording.
 * 2. **The reader's verbatim words.** Binds where the expansion overreached.
 * 3. **The whole question.** The behaviour that shipped before this pipeline
 *    existed, kept as the floor so this module can only ever resolve MORE than
 *    the guardrail did, never less.
 *
 * ## The one thing this module may never do
 *
 * If the reader named a government and none of the three candidates resolves,
 * the answer is `UNRESOLVED` — **never `NONE`**. `NONE` means "no government
 * was named", which licenses the reader's own ZIP to decide the answer. Using
 * it for "a government was named and we could not find it" is precisely the
 * silent substitution that put Sunnyside under a question about Vail, and it
 * would put it back with a model's blessing on top.
 */

export interface ResolutionResult {
  binding: NamedEntityBinding;
  /**
   * Which candidate actually produced the binding — operator diagnostics, and
   * the answer to "did the model's reading do any work here?".
   */
  basis: "MODEL_EXPANSION" | "READER_WORDS" | "WHOLE_QUESTION" | "NONE";
  /** The exact string that bound. Null when nothing did. */
  boundOn: string | null;
}

/**
 * Reconcile one interpretation against the entities this product actually
 * holds.
 *
 * `question` is required and is not optional flavour: it is the floor
 * candidate, and it is what keeps this function's behaviour a superset of the
 * binder that shipped without a model.
 */
export function resolveInterpretation(
  interpretation: AskInterpretation,
  question: string,
  entities: readonly BindableEntity[],
): ResolutionResult {
  const candidates: { text: string; basis: ResolutionResult["basis"] }[] = [];

  for (const mention of interpretation.normalizedMentions) {
    candidates.push({ text: mention, basis: "MODEL_EXPANSION" });
  }
  for (const mention of interpretation.entityMentions) {
    candidates.push({ text: mention, basis: "READER_WORDS" });
  }
  candidates.push({ text: question, basis: "WHOLE_QUESTION" });

  /*
   * A non-NONE verdict from ANY candidate is remembered even while later
   * candidates are still being tried, because the three verdicts are not
   * equally informative. `BOUND` ends the search. `AMBIGUOUS` and `UNRESOLVED`
   * are real answers the reader must see, but a later candidate may still bind
   * outright — the model's expansion can be ambiguous where the reader's own
   * words are not — so they are held rather than returned.
   */
  let held: ResolutionResult | null = null;

  for (const candidate of candidates) {
    const binding = bindNamedEntity(candidate.text, entities);
    if (binding.kind === "BOUND") {
      return { binding, basis: candidate.basis, boundOn: candidate.text };
    }
    if (binding.kind !== "NONE" && !held) {
      held = { binding, basis: candidate.basis, boundOn: candidate.text };
    }
  }

  if (held) return held;

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
