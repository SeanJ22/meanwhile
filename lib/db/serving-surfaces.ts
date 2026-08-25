/**
 * **WHICH READER SURFACE NEEDS WHICH TABLE.**
 * (The final pass, 2026-08-25, item 11 — `NS15`'s mechanical half.)
 *
 * ## The failure this exists to end
 *
 * Speak Your Mind shipped live on production with its table missing. Two
 * committed migrations — `0019_next_scarlet_witch` and `0020_dazzling_deathbird`
 * — were merged with the feature and never applied. The surface rendered, the
 * route answered, **every insert failed, the route caught the error, and the
 * page carried on as though the words had been kept.** A reader typed something
 * they meant and this product dropped it silently.
 *
 * `pnpm db:check` would have caught it and nobody ran it after the merge. That
 * is worth saying plainly, because the instinct is to build a new instrument
 * when the old one was simply never fired.
 *
 * **But the old one answers a different question, and the difference is this
 * file.** `db:check` compares MIGRATION TAGS — bookkeeping about which files an
 * applier recorded. It cannot say *the Speak Your Mind box has nowhere to
 * write*, because nothing anywhere connected a surface a reader can see to the
 * storage it depends on. A tag list is not a promise about a table, and neither
 * one is a promise about a FEATURE.
 *
 * ## A SURFACE WHOSE STORE IS MISSING MUST REFUSE LOUDLY
 *
 * That is the rule this serves. The declaration below is what makes it
 * checkable: each entry names a surface a reader touches, the tables it cannot
 * work without, and what a reader experiences when they are gone. The last field
 * is not decoration — a surface that degrades honestly (a list renders empty and
 * says so) is a different severity from one that ACCEPTS AND DROPS, and only the
 * second one lies to somebody.
 *
 * **Adding a table to the schema does not add it here, deliberately.** A store
 * nothing serves needs no entry; what needs an entry is a store a reader's
 * action depends on. `tests/serving-surfaces.test.ts` asserts every table named
 * here exists in the schema, so this cannot drift into naming something that is
 * not real — the direction that would make the check pass by mistake.
 */

/** What a reader gets when the store is gone. The severity, not the mechanism. */
export type MissingStoreEffect =
  /**
   * The reader's input is accepted and then silently lost. **The worst state
   * this product has**, and the one `NS15` was.
   */
  | "ACCEPTS_AND_DROPS"
  /** The surface renders empty. Honest if it says so, and never a lie. */
  | "RENDERS_EMPTY"
  /** The request errors visibly. Bad, and not deceptive. */
  | "VISIBLE_ERROR";

export interface ServingSurface {
  /** The id used in reports and in the failure message. */
  id: string;
  /** Where a reader meets it, in words a reader would recognise. */
  reader: string;
  /** The code that serves it, so a failure points somewhere. */
  servedBy: readonly string[];
  /** Tables it cannot work without. */
  tables: readonly string[];
  effect: MissingStoreEffect;
}

export const SERVING_SURFACES: readonly ServingSurface[] = [
  {
    id: "speak-your-mind",
    reader: "the Speak Your Mind box on an official's card and in the entity modal",
    servedBy: ["components/speak/speak-your-mind.tsx", "app/api/speak/route.ts"],
    tables: ["speak_your_mind"],
    effect: "ACCEPTS_AND_DROPS",
  },
  {
    id: "reactions",
    reader: "the one-tap reaction under a sourced position or a measure provision",
    servedBy: ["app/api/reactions/route.ts"],
    tables: ["reactions"],
    effect: "ACCEPTS_AND_DROPS",
  },
  {
    id: "feedback",
    reader: "the ask box and the feedback form",
    servedBy: ["app/api/feedback/route.ts"],
    tables: ["feedback", "feedback_contact"],
    effect: "ACCEPTS_AND_DROPS",
  },
  {
    id: "intake-limiter",
    reader:
      "no reader touches it directly — it is the rate limiter every intake write passes through, and without it the protections are off",
    servedBy: ["lib/db/intake-limiter.ts"],
    tables: ["intake_limiter"],
    effect: "VISIBLE_ERROR",
  },
  {
    id: "meetings",
    reader: "the pins on the entry map and the meeting list",
    servedBy: ["app/api/meetings/route.ts"],
    tables: ["meetings", "search_log"],
    effect: "RENDERS_EMPTY",
  },
  {
    id: "questionnaire",
    reader: "a candidate answering the questionnaire from the link emailed to them",
    servedBy: ["lib/questionnaire/"],
    tables: ["questionnaire_invitations", "questionnaire_responses", "questionnaire_tokens"],
    effect: "VISIBLE_ERROR",
  },
];

/** Every table any serving surface depends on, deduped. */
export function servingTables(): string[] {
  return [...new Set(SERVING_SURFACES.flatMap((s) => s.tables))].sort();
}

/**
 * Which surfaces are broken, given the tables a database actually holds.
 *
 * Pure, so the decision is testable without a database — the check that failed
 * to exist for `NS15` must not itself be a thing only a live connection can
 * exercise. Ordered worst-first, because a run that prints six lines should put
 * the one that loses a reader's words at the top.
 */
export function brokenSurfaces(
  tablesPresent: readonly string[],
): { surface: ServingSurface; missing: string[] }[] {
  const have = new Set(tablesPresent);
  const severity: Record<MissingStoreEffect, number> = {
    ACCEPTS_AND_DROPS: 0,
    VISIBLE_ERROR: 1,
    RENDERS_EMPTY: 2,
  };
  return SERVING_SURFACES.map((surface) => ({
    surface,
    missing: surface.tables.filter((t) => !have.has(t)),
  }))
    .filter((r) => r.missing.length > 0)
    .sort((a, b) => severity[a.surface.effect] - severity[b.surface.effect]);
}
