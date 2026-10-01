/**
 * The ripcord registry — named kill switches for features whose legal or
 * policy question is open while the build itself is sound (CLAUDE.md, the
 * ripcord doctrine, adopted 2026-08-16).
 *
 * Every ripcord names its open question and WHO closes it. Pulling one is a
 * FILTER over provenance-tagged records — never a migration, never a hunt —
 * and ripcorded data never enters an export or a licensed aggregate until
 * its question closes. Server-side only: the modules that read this run in
 * routes, server components, scripts and tests, so a pull is effective at
 * the data layer, not just the pixels.
 *
 * Flipping without a deploy: each ripcord has an environment override
 * (`pulled` / `live`). The committed default is the state of record; the
 * env var exists so an emergency pull is a config change, and so tests can
 * demonstrate both positions of each flag (D34's gate).
 */

export interface Ripcord {
  /** Committed state. `true` = pulled (the feature's data is filtered). */
  pulled: boolean;
  /** Environment variable that overrides the committed state: "pulled" | "live". */
  envVar: string;
  /** The open question that put this behind a flag. */
  question: string;
  /** Who may close it. Nobody else. */
  closer: string;
  trackerRows: string;
  /** What a pull filters — the provenance tags this switch governs. */
  filters: string;
}

export const RIPCORDS = {
  /**
   * Kills the contributor-level display (FEC_CONTRIBUTOR rows) and its
   * reaction control. Committee-level totals are unaffected. Ships LIVE.
   */
  "ripcord.fecContributorDisplay": {
    pulled: false,
    envVar: "WTP_RIPCORD_FEC_CONTRIBUTOR_DISPLAY",
    question:
      "Does 52 U.S.C. § 30111(a)(4) (the commercial-use restriction on FEC contributor information) permit reader-facing display of itemized contributions in this product?",
    closer: "Counsel (the B05 hire) — nobody else may close it (D23)",
    trackerRows: "D23, D34",
    filters: "FEC_CONTRIBUTOR rows and the CONTRIBUTOR_REACTION control",
  },
  /**
   * The tunable intake protections (T08): the per-device burst limits, the
   * soft velocity-quarantine threshold, the per-device daily ceiling, the
   * per-IP windows, and same-origin enforcement on /api/reactions and
   * /api/log. Pulling this switches the FAMILY off — for the day a
   * protection turns out to be refusing real readers — while every
   * threshold inside it is separately tunable via its own WTP_LIMIT_* env
   * var (lib/signal/intake-limits.ts). Validity checks — real target ids,
   * closed enums, length caps — are NOT in this family and never switch
   * off. Ships LIVE.
   */
  "ripcord.rateLimits": {
    pulled: false,
    envVar: "WTP_RIPCORD_RATE_LIMITS",
    question:
      "Operational, not legal: are the thresholds and the origin check calibrated so no legitimate reader is ever refused?",
    closer: "Engineering: whoever is on call, when a protection is refusing real readers",
    trackerRows: "T08",
    filters:
      "The rate-limit family on the intake routes: in-memory windows, the authoritative per-device counters, the daily ceiling, velocity quarantine, and same-origin enforcement",
  },
  /**
   * The ask box's Level 1 classifier (6d, 2026-08-15). Pulled, the ask box
   * is keyword-only — which is the complete product it was on the day it
   * shipped, not a degraded one.
   *
   * Open because it is the first place a model touches a reader's path at
   * all. What it may do is deliberately tiny: pick one id out of the curated
   * topic list, or `NONE`. It writes no sentence a reader sees, and the
   * answer it leads to is the same curated route the keyword path produces.
   * Ships LIVE.
   */
  "ripcord.askClassifier": {
    pulled: false,
    envVar: "WTP_RIPCORD_ASK_CLASSIFIER",
    question:
      "Product, not legal: is a model choosing WHICH curated topic a question belongs to compatible with the no-generation rule, given that it writes none of the answer and its whole output is one identifier from a closed list?",
    closer:
      "Engineering: whoever is on call. An emergency off switch; pulled, the ask box falls back to keyword-only matching.",
    trackerRows: "A09, A12",
    filters:
      "The classifier call itself: the ask box falls back to keyword-only matching and the honest refusal",
  },
  /**
   * **The grounded Ask pipeline** (ASK01, 2026-08-27). The rung above picks a
   * topic id and writes nothing; this one WRITES THE SENTENCE A READER READS,
   * from records it was handed. That is a materially different question and it
   * gets its own flag rather than riding on the classifier's answered one.
   */
  "ripcord.askGrounded": {
    pulled: false,
    envVar: "WTP_RIPCORD_ASK_GROUNDED",
    question:
      "Doctrine: may a model write the reader-facing sentence at all, given that it is shown only records the app retrieved, is given no corpus, tools or network, and has every source URL in its answer checked against the evidence pack it was handed?",
    /**
     * Ask writes the reader-facing sentence only from records the app
     * retrieved; `lib/ask/validate.ts` rejects anything the records do not
     * support (rulings §0: Ask should answer as well as asking Claude directly).
     */
    closer:
      "Engineering: whoever is on call. An emergency off switch if a generated sentence is found to state something its records do not support; pulled, Ask degrades to the structured sourced answer.",
    trackerRows: "ASK01, ASK02",
    filters:
      "Both model rungs of the grounded pipeline: Ask falls back to deterministic interpretation and the structured evidence answer, with no generated prose",
  },
  /**
   * The master ripcord (T08): closes reaction and search/ask intake
   * ENTIRELY — the server refuses every write with a 503 while the app
   * renders normally and a tapping reader sees the honest not-counted line
   * (P11's rendering; no client change involved). For live-attack response
   * without a code change. The pull procedure anyone on call can follow at 2am
   * is docs/ripcords.md. Ships LIVE.
   */
  "ripcord.reactionIntake": {
    pulled: false,
    envVar: "WTP_RIPCORD_REACTION_INTAKE",
    question:
      "Operational, not legal: held open for live-attack response — is the store currently under an attack that per-device limits cannot absorb?",
    closer: "Engineering: whoever is on call — pulled during an attack, restored when it ends",
    trackerRows: "T08",
    filters:
      "Every write to the reaction store and the search/ask log (both POST routes refuse with 503); read paths and rendering are untouched",
  },
  /**
   * **ASK-12 (2026-08-25, Sean's ruling) — the unsourced general-answer
   * fallback.**
   *
   * His words: *"try it while it's in testing. Route out-of-scope questions —
   * the 'Why is it raining?' class — to the Claude API."*
   *
   * A ripcord rather than a plain feature flag, because the ripcord doctrine
   * already requires the three things this needs and a flag would require none
   * of them: a NAMED CLOSER, a PROVENANCE TAG on every record the feature
   * produces (`UNSOURCED_GENERAL`) so pulling it is a filter rather than a
   * hunt, and the transparency page changing in the same commit that ships it.
   *
   * The open question is not legal — nothing here is a claim about a
   * government. It is whether the separation HOLDS in front of a reader, which
   * is a thing only a reader can answer, and Sean is the one who looks.
   *
   * Ships LIVE, for the testing window, which is what he asked for.
   */
  "ripcord.unsourcedFallback": {
    pulled: false,
    envVar: "WTP_RIPCORD_UNSOURCED_FALLBACK",
    question:
      "Product, not legal: does an unsourced general answer stay unmistakable from a sourced civic one in front of a real reader? The whole trust posture of this product is that it does not answer what it cannot source, and an answer a reader mistakes for sourced spends that.",
    closer: "The author — he is the one who looks at it; pulled the moment the separation reads as thin",
    trackerRows: "ASK-12",
    filters:
      "Every UNSOURCED_GENERAL answer: pulled, the ask surface refuses exactly as it did before and renders the sourced refusal instead. Nothing downstream needs filtering — an unsourced answer is a generated string, never reader signal, and the aggregation input type has no field it could enter.",
  },
} as const satisfies Record<string, Ripcord>;

export type RipcordName = keyof typeof RIPCORDS;

export const RIPCORD_NAMES = Object.keys(RIPCORDS) as RipcordName[];

/** Is this ripcord pulled? Env override first, committed state otherwise. */
export function ripcordPulled(name: RipcordName): boolean {
  const ripcord = RIPCORDS[name];
  const env = process.env[ripcord.envVar];
  if (env === "pulled") return true;
  if (env === "live") return false;
  return ripcord.pulled;
}
