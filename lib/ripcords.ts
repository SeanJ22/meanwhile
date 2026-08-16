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
   * Excludes funding reactions (FUNDING_TOTAL_REACTION and
   * CONTRIBUTOR_REACTION rows) from aggregation and every export.
   *
   * **Shipped PULLED with D34; flipped LIVE 2026-08-15 on the author's
   * ruling.** The ruling, verbatim:
   *
   * > The author rules the exclusion wrong as product truth: what is
   * > licensed is reader-attention signal (anonymous reactions), never
   * > FEC-derived data — a buyer receives opinions about displays, not
   * > contributor records. This is the author's documented, settled
   * > position.
   *
   * The reasoning is a distinction the original framing collapsed. The
   * § 30111(a)(4) question is about the CONTRIBUTOR DATA — whose commercial
   * use is restricted — and it is still open, still governing
   * `ripcord.fecContributorDisplay`, and still counsel's to close. A
   * reader's anonymous feeling about a display is not that data and is not
   * derived from it: it is a fact about a reader, collected by us,
   * identifier-free, and it carries no contributor's name, amount or filing
   * into anything.
   *
   * **The switch stays, as a belt rather than a blocker.** The provenance
   * tags, the filter and the pull procedure are unchanged, so if counsel's
   * read differs the exclusion is one flag away and is still a filter, never
   * a migration or a hunt.
   */
  "ripcord.fundingReactionsInAggregates": {
    pulled: false,
    envVar: "WTP_RIPCORD_FUNDING_REACTIONS_IN_AGGREGATES",
    question:
      "RULED by the author 2026-08-15: what is licensed is reader-attention signal — anonymous reactions — and never FEC-derived data; a buyer receives opinions about displays, not contributor records. The separate § 30111(a)(4) question over the underlying contributor DATA is untouched by this ruling and still governs ripcord.fecContributorDisplay (D23).",
    closer:
      "Author-ruled 2026-08-15; counsel review welcome (the B05 hire) and may re-pull it",
    trackerRows: "D23, D34, D61",
    filters:
      "FUNDING_TOTAL_REACTION and CONTRIBUTOR_REACTION rows out of aggregateReactions and every export",
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
      "Operational, not legal: are the thresholds and the origin check calibrated so no legitimate reader is ever refused? (The author's standard: the fastest human thumb never hits a limit; a script hits one in its first second.)",
    closer: "The author — this is a product-safety tuning question, not a counsel question",
    trackerRows: "T08",
    filters:
      "The rate-limit family on the intake routes: in-memory windows, the authoritative per-device counters, the daily ceiling, velocity quarantine, and same-origin enforcement",
  },
  /**
   * The master ripcord (T08): closes reaction and search/ask intake
   * ENTIRELY — the server refuses every write with a 503 while the app
   * renders normally and a tapping reader sees the honest not-counted line
   * (P11's rendering; no client change involved). For live-attack response
   * without a code change. The pull procedure the author can follow at 2am
   * is docs/ripcords.md. Ships LIVE.
   */
  "ripcord.reactionIntake": {
    pulled: false,
    envVar: "WTP_RIPCORD_REACTION_INTAKE",
    question:
      "Operational, not legal: held open for live-attack response — is the store currently under an attack that per-device limits cannot absorb?",
    closer: "The author — pulled during an attack, restored when the attack ends",
    trackerRows: "T08",
    filters:
      "Every write to the reaction store and the search/ask log (both POST routes refuse with 503); read paths and rendering are untouched",
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
