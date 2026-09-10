import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Body, BodyOrigin } from "./types.ts";

/**
 * **The canonical input store for promoted bodies** — the repair for `NH232`.
 *
 * ## The defect this closes
 *
 * `lib/registry/registry.json` had FOUR writers. One of them
 * (`scripts/build-registry.ts`) regenerates the whole file from the boundary
 * polygons plus `CURATED_BODIES`; the other three appended rows to it in place:
 *
 * - `scripts/adjudicate-leads.mts` pushed a row per promoted discovery lead,
 * - `scripts/census-gap-walk.mts` pushed a row per Census-of-Governments unit
 *   the registry did not already hold,
 * - `scripts/normalize-census-placeholders.mts` rewrote labels inside it.
 *
 * So a generated output was simultaneously somebody else's canonical store, and
 * **running the generator deleted every promotion**. Measured on `main` at
 * `9e75bea` on 2026-08-27: the committed registry held 2,000 bodies and a
 * no-source-change `pnpm registry:build` wrote 1,269 — silently dropping 731
 * rows, all of them the promoted population that IS the coverage numerator the
 * governance snapshot reports. Nothing failed. The diff looked like a normal
 * regeneration.
 *
 * ## The ownership model, entire
 *
 * ```
 * INPUTS                                   OWNER (the only writer)
 *   public/geo/*.geojson                    the boundary fetchers
 *   lib/registry/curated-bodies.ts          hand-curated, cited
 *   lib/registry/promoted-bodies.json       appendPromotedBodies(), below
 *
 * OUTPUT                                   OWNER (the only writer)
 *   lib/registry/registry.json              scripts/build-registry.ts
 * ```
 *
 * A promotion no longer touches the generated artifact at all. It appends to
 * this store, and the next `pnpm registry:build` merges it. The normal path is
 * therefore the only path: **fix input → run generator → get complete
 * registry.**
 *
 * ## Why a JSON store and not a `.ts` module like `CURATED_BODIES`
 *
 * Curated rows are written by a human who is reading a government's page, so a
 * TypeScript module carrying a citation comment per row is exactly right.
 * Promoted rows are minted by a script, hundreds at a time, and a machine
 * appending to a hand-authored module is how a module stops being reviewable.
 * The validation a `.ts` file would get from the compiler is supplied here
 * instead, by {@link validatePromotedBodies}, and it is stricter: a promoted row
 * must carry a name AND a fetched source URL AND a verification timestamp,
 * because promotion is defined as the step that requires evidence that was
 * actually fetched (`promoteCandidate` in `lib/workstate/candidates.ts`).
 *
 * ## The manual merge that preceded this is NOT a write path
 *
 * The 2026-08-27 detective session hit the deletion while adding four Arizona
 * bodies and preserved its rows by hand-merging them into the committed
 * registry rather than shipping the regenerated file. That was a safety
 * maneuver taken to avoid destroying valid data, and it is recorded as one.
 * It is not architecture, it is not precedent, and after this repair no
 * promotion needs it: `tests/registry-ownership.test.ts` fails the build if any
 * path other than the generator writes `registry.json`.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** The canonical input store, repo-relative — the string the guard greps for. */
export const PROMOTED_BODIES_FILE = "lib/registry/promoted-bodies.json";

/** Absolute path to the store. */
export const PROMOTED_BODIES_PATH = join(HERE, "promoted-bodies.json");

/**
 * The generated artifact this store feeds, repo-relative.
 *
 * Exported so the ownership guard and the generator agree on one spelling of
 * the path rather than two string literals that can drift apart.
 */
export const REGISTRY_FILE = "lib/registry/registry.json";

/**
 * The body origins that live in this store rather than in the generator.
 *
 * **Both are promotions, and neither is re-derivable.** A descent promotion
 * exists because a session fetched a page and the page named the body; a census
 * gap promotion exists because a session reconciled the 2022 Census of
 * Governments against the registry and walked the unit's own page. Re-running
 * the derivation from polygons produces neither, which is precisely why losing
 * them was invisible: the generator was doing exactly what it says it does.
 */
export const PROMOTED_ORIGINS: readonly BodyOrigin[] = [
  "PROMOTED_FROM_DESCENT_CANDIDATE",
  "PROMOTED_FROM_CENSUS_OF_GOVERNMENTS",
];

export function isPromotedOrigin(origin: string): boolean {
  return (PROMOTED_ORIGINS as readonly string[]).includes(origin);
}

export interface PromotedBodyStore {
  /** Prose, for a reader who opens the file before opening this module. */
  note: string;
  bodies: Body[];
}

/** Read the store. Throws if it is absent — an empty store is written, never assumed. */
export function loadPromotedBodies(path: string = PROMOTED_BODIES_PATH): PromotedBodyStore {
  const store = JSON.parse(readFileSync(path, "utf8")) as PromotedBodyStore;
  if (!Array.isArray(store.bodies)) {
    throw new Error(`${path} has no bodies array — that is a corrupt store, not an empty one`);
  }
  return store;
}

/**
 * Every reason a promoted row is refused, as a list of complaints.
 *
 * Returns `[]` when the store is sound. The generator calls this and throws;
 * the ownership test calls this and asserts. **The same check, one
 * implementation** — a validator the generator runs and the test re-implements
 * is two validators that will disagree.
 *
 * `derivedIds` and `divisionIds`, when supplied, add the two cross-checks that
 * only the generator can make: a promoted id may not collide with a derived or
 * curated one, and a non-null `ocdId` must name a division that exists.
 */
export function validatePromotedBodies(
  bodies: readonly Body[],
  opts: { heldIds?: ReadonlySet<string>; divisionIds?: ReadonlySet<string> } = {},
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const b of bodies) {
    if (!b.id) {
      problems.push("a promoted row has no id");
      continue;
    }
    if (seen.has(b.id)) problems.push(`duplicate promoted id ${b.id}`);
    seen.add(b.id);

    if (!isPromotedOrigin(b.bodyOrigin)) {
      problems.push(
        `${b.id} carries bodyOrigin ${b.bodyOrigin}; only ${PROMOTED_ORIGINS.join(" or ")} belong in this store`,
      );
    }
    /*
     * The promoted bargain, and it is stricter than the curated one. A curated
     * row needs a name and a citation. A promoted row needs both of those AND a
     * `verifiedAt`, because `promoteCandidate` refuses to promote anything that
     * did not reach ENTITY_VERIFIED through a fetch. A promoted row with no
     * verification stamp is a detector's opinion wearing a body's clothes.
     */
    if (!b.name) problems.push(`${b.id} has no name; a promotion names the body its page named`);
    if (!b.provenance?.sourceUrl) problems.push(`${b.id} has no provenance.sourceUrl`);
    if (!b.provenance?.verifiedAt) {
      problems.push(`${b.id} has no provenance.verifiedAt; promotion requires evidence that was fetched`);
    }
    if (opts.heldIds?.has(b.id)) {
      problems.push(`promoted body ${b.id} collides with a derived or curated row`);
    }
    if (b.ocdId !== null && b.ocdId !== undefined && opts.divisionIds && !opts.divisionIds.has(b.ocdId)) {
      problems.push(`promoted body ${b.id} references unknown division ${b.ocdId}`);
    }
  }
  return problems;
}

/**
 * **The only write path into the store.**
 *
 * Appends rows, refusing any id the store already holds — a promotion script
 * that runs twice adds nothing the second time, which is what makes the whole
 * chain idempotent. Returns the number actually added.
 *
 * Writes with ONE space of indentation, matching what `registry.json` is
 * written with: two spaces re-indents 731 existing rows and turns a small
 * addition into a diff nobody can review.
 */
export function appendPromotedBodies(
  _rows: readonly Body[],
  _path: string = PROMOTED_BODIES_PATH,
): { added: number; skipped: string[] } {
  throw new Error(
    "TRACKED_REGISTRY_WRITER_RETIRED: promote a complete reviewed registry-runtime-bindings package with scripts/promote-registry-runtime.mts --promote.",
  );
}
