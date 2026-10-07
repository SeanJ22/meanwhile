/**
 * Named kill switches for features whose legal or policy question is open while the build itself is
 * sound. Every ripcord names its open question and who closes it. Pulling one is a filter over
 * provenance-tagged records, never a migration, and ripcorded data never enters an export or a licensed
 * aggregate until its question closes. Server-side only, so a pull is effective at the data layer.
 *
 * Each ripcord has an environment override (`pulled` / `live`); the committed default is the state of
 * record.
 */

import { registerFeature, readFeature } from "./control-plane/features.ts";

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
   * The tunable intake protections: per-device burst limits, the soft velocity-quarantine threshold, the
   * per-device daily ceiling, per-IP windows, and same-origin enforcement on /api/reactions and /api/log.
   * Pulling this switches the family off; every threshold is separately tunable via its own WTP_LIMIT_* env
   * var (lib/signal/intake-limits.ts). Validity checks are not in this family and never switch off. Ships
   * LIVE.
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
   * The ask box's Level 1 classifier. Pulled, the ask box is keyword-only, a complete product. It may only
   * pick one id out of the curated topic list, or `NONE`; it writes no sentence a reader sees. Ships LIVE.
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
   * The grounded Ask pipeline: unlike the classifier, it writes the sentence a reader reads, from records
   * it was handed, so it has its own flag.
   */
  "ripcord.askGrounded": {
    pulled: false,
    envVar: "WTP_RIPCORD_ASK_GROUNDED",
    question:
      "Doctrine: may a model write the reader-facing sentence at all, given that it is shown only records the app retrieved, is given no corpus, tools or network, and has every source URL in its answer checked against the evidence pack it was handed?",
    /**
     * Ask writes the reader-facing sentence only from records the app retrieved; `lib/ask/validate.ts`
     * rejects anything the records do not support.
     */
    closer:
      "Engineering: whoever is on call. An emergency off switch if a generated sentence is found to state something its records do not support; pulled, Ask degrades to the structured sourced answer.",
    trackerRows: "ASK01, ASK02",
    filters:
      "Both model rungs of the grounded pipeline: Ask falls back to deterministic interpretation and the structured evidence answer, with no generated prose",
  },
  /**
   * The master ripcord: closes reaction and search/ask intake entirely. The server refuses every write
   * with a 503 while the app renders normally and a tapping reader sees the not-counted line. For
   * live-attack response without a code change. Ships LIVE.
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
} as const satisfies Record<string, Ripcord>;

export type RipcordName = keyof typeof RIPCORDS;

export const RIPCORD_NAMES = Object.keys(RIPCORDS) as RipcordName[];

const FEATURE_LABELS: Record<RipcordName, string> = {
  "ripcord.fecContributorDisplay": "Campaign funding display",
  "ripcord.rateLimits": "Request limits",
  "ripcord.askClassifier": "Question topic matching",
  "ripcord.askGrounded": "Answers from saved facts",
  "ripcord.reactionIntake": "Reader responses",
};
for (const name of RIPCORD_NAMES) registerFeature(name.slice("ripcord.".length), FEATURE_LABELS[name], !RIPCORDS[name].pulled, true);

/** Is this ripcord pulled? Env override first, committed state otherwise. */
export function ripcordPulled(name: RipcordName): boolean {
  const ripcord = RIPCORDS[name];
  const env = process.env[ripcord.envVar];
  if (env === "pulled") return true;
  if (env === "live") return false;
  return !readFeature(name.slice("ripcord.".length), !ripcord.pulled);
}
