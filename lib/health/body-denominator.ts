/**
 * **THE INDEPENDENT GOVERNING-BODY DENOMINATOR.** (A.1 WI2, 2026-08-30.)
 *
 * ## The defect this exists to close
 *
 * `checkInstanceUniverse` has been correct since Session A and was never
 * called. Worse, the only denominator vocabulary that could reach it for the
 * governing-body layer was `PROJECT_REGISTRY` — and `lib/registry/registry.json`
 * is the exact store the reader-question instances are GENERATED from.
 *
 * A denominator read from the generator's own output cannot detect the one
 * thing a denominator exists to detect. If the registry omits a body, no
 * instance is generated about it, the denominator does not enumerate it
 * either, the two agree perfectly, and the corpus reports 100% coverage over
 * an incorrectly small universe. **Registry checking registry is a mirror,
 * not a measurement.**
 *
 * ## What is independent here, and why it satisfies RULING 9
 *
 * RULING 9 says Census and NCES establish the GOVERNMENT universe and may
 * never establish Tier-2 BODY enumeration — only the project's own
 * enumeration evidence may. That rule is about the SOURCE CLASS, and it is
 * satisfied by the project's own evidence. It does not say the denominator
 * must be the generated artifact, and reading it that way is what produced
 * the mirror.
 *
 * `registry.json` is a GENERATED OUTPUT with exactly one writer
 * (`scripts/build-registry.ts`). Its canonical INPUTS are two stores, and
 * every row in each carries evidence a person or a fetch actually produced:
 *
 * ```
 *   lib/registry/curated-bodies.ts      hand-curated, each row cited
 *   lib/registry/promoted-bodies.json   promoted only after a FETCHED source
 *                                       and a verification timestamp
 * ```
 *
 * Those inputs are the Tier-2 body-enumeration evidence. They are independent
 * of the generated registry in the only sense that matters: **the registry is
 * derived from them, so they can disagree with it, and a disagreement is
 * exactly the coverage defect the check is for.** This repository has already
 * had that disagreement in the dangerous direction — NH232, where a
 * regeneration silently dropped 731 promoted bodies and nothing failed.
 *
 * ## What this deliberately does NOT do
 *
 * It does not fall back to the registry when the evidence stores cannot be
 * read. A denominator that degrades to the thing it is checking is worse than
 * no denominator, because it reports the same green with none of the meaning.
 * An unreadable store produces `null` and the level's instances go
 * NOT_EVALUABLE with the missing evidence NAMED.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CURATED_BODIES } from "../registry/curated-bodies.ts";
import { loadPromotedBodies } from "../registry/promoted-bodies.ts";
import type { Body } from "../registry/types.ts";

import {
  bodiesForDivisions,
  type DenominatorLayer,
  type DenominatorSource,
  type EnumerationDenominator,
} from "./reader-question.ts";

/**
 * The evidence, loaded — or the reason it could not be, NAMED.
 *
 * Two fields and never one: "we could not read it" and "there is nothing
 * there" are different sentences, and a check that cannot tell them apart
 * will eventually report the first as the second.
 */
export interface BodyEnumerationEvidence {
  /** Every body the canonical INPUT stores enumerate. Null when unreadable. */
  readonly bodies: readonly Body[] | null;
  /** The stores actually read, for the run record. */
  readonly sources: readonly string[];
  /** Why there is no evidence, when there is none. Null on success. */
  readonly missing: string | null;
}

/**
 * Load the Tier-2 body-enumeration evidence from the canonical input stores.
 *
 * Both stores are load-bearing and a failure in either is named rather than
 * swallowed: reading one of two and calling the result the denominator would
 * manufacture a coverage defect for every body the unread store holds.
 */
export function loadBodyEnumerationEvidence(root: string = process.cwd()): BodyEnumerationEvidence {
  const sources: string[] = [];
  const bodies: Body[] = [];

  try {
    bodies.push(...CURATED_BODIES);
    sources.push("lib/registry/curated-bodies.ts");
  } catch (error) {
    return {
      bodies: null,
      sources,
      missing: `lib/registry/curated-bodies.ts could not be read: ${String(error)}`,
    };
  }

  const promotedPath = join(root, "lib", "registry", "promoted-bodies.json");
  try {
    /* Read through the store's own loader so the "corrupt store, not an empty
       one" refusal applies here too, rather than being re-implemented. */
    const store = loadPromotedBodies(promotedPath);
    bodies.push(...store.bodies);
    sources.push("lib/registry/promoted-bodies.json");
  } catch (error) {
    return {
      bodies: null,
      sources,
      missing: `lib/registry/promoted-bodies.json could not be read: ${String(error)}`,
    };
  }

  return { bodies, sources, missing: null };
}

/**
 * The per-ZIP governing-body denominator, from the evidence.
 *
 * The ZIP join is the SAME join the instance generator uses
 * (`bodiesForDivisions` over the TIGER-derived division index), applied to a
 * different body population. That is deliberate: holding the join constant is
 * what makes a disagreement a claim about the BODY POPULATION rather than an
 * artefact of two different territory readings.
 */
export function bodyDenominatorFor(
  zip: string,
  divisionIds: readonly string[],
  evidence: BodyEnumerationEvidence,
): EnumerationDenominator | null {
  if (evidence.bodies === null) return null;
  return {
    zip,
    layer: "GOVERNING_BODY" satisfies DenominatorLayer,
    source: "PROJECT_BODY_ENUMERATION_EVIDENCE" satisfies DenominatorSource,
    memberIds: bodiesForDivisions(divisionIds, evidence.bodies)
      .map((body) => body.id)
      .sort(),
  };
}

/**
 * Read the generated registry's own division index labels for a ZIP.
 *
 * Split out so the caller can hold the division index in one place and this
 * module never reaches for `registry.json`'s BODIES — which is the whole
 * point of the file.
 */
export function divisionIndexFor(root: string = process.cwd()): Record<string, string[]> {
  const indexPath = join(root, "data", "derived", "zip-division-ids.json");
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as { zips: Record<string, string[]> };
  return index.zips;
}
