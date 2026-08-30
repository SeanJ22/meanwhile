import type { BodyDivisionType } from "./body-blurbs.ts";

/**
 * **IS THIS BODY THE GOVERNMENT OF THE DIVISION IT SITS ON?**
 *
 * A string comparison and a three-row table. It reads no data, resolves
 * nothing, and reaches no corpus.
 *
 * ## Why it is its own module (2026-08-29)
 *
 * It used to live in `lib/officials/body-definitions.ts`, which is the right
 * home for its MEANING and the wrong one for its WEIGHT. That module imports
 * `body-blurbs.ts`, `body-form.ts` and `form-definitions.ts` — the definition
 * corpus — so every consumer of this six-line predicate dragged all of it in.
 *
 * That went unnoticed until the govern-verb repair made
 * `lib/meetings/jurisdiction-badge.ts` ask the question, and the badge is on
 * `/api/meetings`. The route's file trace went from 220 to 221, one over the
 * committed ceiling, and the build refused. **The refusal was right and the
 * ceiling was not the problem**: a badge module has no business depending on
 * the definition corpus, and raising the ceiling would have bought the space by
 * agreeing that it does.
 *
 * `import type` is erased at build, so the `BodyDivisionType` import above adds
 * nothing to any trace. This file is a leaf on purpose; keep it one.
 *
 * `body-definitions.ts` re-exports both symbols, so every existing importer is
 * unchanged and there is exactly one implementation.
 */

/**
 * **The suffix the registry gives a body it DERIVED from a division.**
 *
 * Not a naming convention this module invented — it is read off
 * `registry.json`, and the equivalence with `bodyOrigin ===
 * "DERIVED_FROM_DIVISION_TYPE"` is asserted over every body in the suite. A
 * division type absent from this table has no derived body, so nothing on it
 * can be a division's own government.
 */
export const DERIVED_BODY_SUFFIX: Partial<Record<BodyDivisionType, string>> = {
  place: "governing",
  county: "governing",
  school_district: "board",
};

/**
 * Whether this body IS the government of the division it sits on.
 *
 * Everything division-derived — the class definition, the form stamp, the
 * by-division blurb, and the govern verb itself — is gated on this and may
 * never be reached without it. A body that merely SITS in a division does not
 * govern it: the Tucson Design Review Board sits in Tucson and governs nobody,
 * and 248 bodies were saying otherwise until this became the gate.
 *
 * **Unknown division type returns FALSE**, which is the conservative
 * direction — a body whose class we cannot place does not get the verb.
 */
export function isDivisionsOwnGovernment(
  bodyId: string,
  ocdId: string | null,
  divisionType: BodyDivisionType,
): boolean {
  if (ocdId === null) return false;
  const suffix = DERIVED_BODY_SUFFIX[divisionType];
  if (suffix === undefined) return false;
  return bodyId === `${ocdId}#${suffix}`;
}
