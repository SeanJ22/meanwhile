/**
 * **What members SAY** — tracker **D62**, the Polarization Research Lab at
 * Dartmouth, "America's Political Pulse".
 *
 * The card's third leg, in the author's framing: votes show what they DO,
 * money shows who FUNDS them, this shows what they SAY. It is a third
 * evidence tier beside RECORD and FUNDING, and it never merges with either.
 *
 * ## Everything below was read off the source itself on 2026-08-19 (g20)
 *
 * The data pages are a JavaScript-rendered SPA: a plain fetch of
 * `americaspoliticalpulse.com/data/` returns 2,977 bytes of shell with an
 * empty `<div id="root">`, and reading that as "nothing there" would be a
 * FALSE MISS, not a wall. The licence, the citation and the file list were
 * read from the page's own bundle — ladder rung 7, the JSON/JS the widget is
 * built from. The full rung record is in `docs/source-ladder.md`.
 *
 * ## Attribution — and the correction that made checking worth it
 *
 * PRL publishes under a **Creative Commons Attribution** licence, which
 * means attribution is a CONDITION of use rather than a courtesy.
 *
 * D62's tracker row recorded ONE citation string, taken from the survey
 * page: *"Westwood, S. J., & Lelkes, Y. (2024). America's Political Pulse
 * [Data set]"*. That string is real and it is on `/data`. **It is not the
 * citation for the files this build uses.** The congressional-rhetoric page,
 * `/elites/data`, carries its own, and the profiles and statements files are
 * that page's. Shipping the survey citation beside rhetoric rows would be an
 * attribution error under the very licence that lets us use them — a small,
 * invisible, entirely avoidable one, avoided only because the page was read
 * rather than the row.
 *
 * Both strings are recorded below so a later session can see there are two
 * and pick by dataset rather than by memory.
 */

/**
 * The attribution the rhetoric datasets require, rendered wherever a PRL
 * number appears. One string, one place — the `LEGISCAN_ATTRIBUTION`
 * pattern, for the same reason: a new surface must not be able to ship a
 * variant of it or forget it.
 */
export const PRL_RHETORIC_ATTRIBUTION = {
  /** Verbatim from https://americaspoliticalpulse.com/elites/data, read 2026-08-19. */
  citation:
    "America's Political Pulse. (2024). Congressional Rhetoric Dataset. Available at: https://americaspoliticalpulse.com/elites/data",
  /** How the lab is named on a reader-facing panel. */
  text: "the Polarization Research Lab (Dartmouth)",
  url: "https://americaspoliticalpulse.com/elites/data",
  licence: "CC BY",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  /**
   * The elites page states "a Creative Commons Attribution license" without
   * naming a version; the Open Data page states "Creative Commons
   * Attribution 4.0" and links `/by/4.0/`. Both were read the same day. The
   * version is recorded as the site's own link rather than asserted for the
   * rhetoric files from the survey page's wording.
   */
  licenceReadAt: "2026-08-19",
} as const;

/**
 * The SURVEY datasets' citation. Not used by this adapter — recorded so the
 * difference between the two is a fact in the code rather than something a
 * later session rediscovers by shipping the wrong one.
 */
export const PRL_SURVEY_ATTRIBUTION = {
  citation:
    "Westwood, S. J., & Lelkes, Y. (2024). America's Political Pulse [Data set]. https://americaspoliticalpulse.com/data",
  url: "https://americaspoliticalpulse.com/data",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  licenceReadAt: "2026-08-19",
} as const;

/**
 * **The five categories PRL classifies a statement into**, in its own words.
 *
 * These are PRL's measurement of WHAT a statement does, never our reading of
 * what a person believes. The labels below are the reader-facing plain
 * words; the keys are PRL's own column names, so the mapping is checkable
 * against the file rather than remembered.
 */
export const PRL_CATEGORIES = [
  {
    key: "policy",
    column: "communication_policy",
    label: "about policy",
    explainer:
      "The statement is about a policy question — a bill, a programme, a rule — rather than about a person or a party.",
  },
  {
    key: "bipartisanship",
    column: "communication_outcome_bipartisanship",
    label: "working across parties",
    explainer:
      "The statement describes working with, or crediting, members of the other party.",
  },
  {
    key: "creditclaiming",
    column: "communication_outcome_creditclaiming",
    label: "claiming credit",
    explainer:
      "The statement takes credit for something delivered — funding, a project, a service.",
  },
  {
    key: "attack-policy",
    column: "communication_attack_policy",
    label: "attacking a policy",
    explainer:
      "The statement criticises a policy or a position, rather than a person.",
  },
  {
    key: "attack-personal",
    column: "communication_attack_personal",
    label: "attacking a person",
    explainer:
      "The statement criticises a person rather than their position. PRL counts these; we never name who was attacked.",
  },
] as const;

export type PrlCategoryKey = (typeof PRL_CATEGORIES)[number]["key"];

/**
 * **The columns that may NEVER cross this boundary**, matched against the
 * file's own header rather than assumed.
 *
 * The profiles file carries 17 of them, including `ideology_ideology` — a
 * single number placing a person on a left-right line — plus a rank and a
 * percentile for every category, for money raised, and for ideology in both
 * directions.
 *
 * Every one of those is exactly what `CLAUDE.md` forbids a candidate or
 * measure record to grow: a `score`, `rank`, `rating`, `match`, `fit`,
 * `grade`, `alignment` or `recommendation`. A rank is a ranking of named
 * politicians against each other, which the product does not do at any
 * remove and does not do because an academic computed it. The filter is
 * therefore an ALLOWLIST on the way in — a denylist would let PRL add a
 * column and have it arrive silently.
 */
export const PRL_FORBIDDEN_COLUMN_PATTERN =
  /rank|percentile|ideology|score|rating|grade|nominate/i;

/**
 * One member's aggregate rhetoric, as PRL measured it. Counts and shares
 * only — never a rank, never an ideology number, never a statement's text,
 * and never who a statement was about.
 */
export interface PrlMemberProfile {
  /** The join key. Bioguide, because it is what both sides carry. */
  bioguideId: string;
  /** PRL's own spelling of the name, for a mismatch check — never rendered. */
  prlName: string;
  /**
   * How many statements PRL has classified for this member. It renders
   * beside every share, because PRL's own pages print "Posts tracked: N" and
   * a share with no base is a naked percentage.
   *
   * **It is NOT asserted to be the share's denominator**, and that is a
   * correction from reading the file rather than assuming it: Maria
   * Cantwell's `communication_policy_mean` is 84.56 while
   * `policy_sum / communication_count` is 84.37. PRL computes the mean over
   * a base slightly different from this count, and we do not know which. So
   * the surface states both as PRL's own numbers and never multiplies one by
   * the other — the arithmetic would be ours, and it would be wrong.
   */
  statementCount: number;
  /**
   * Share of statements in each category, **as a percentage 0-100**, exactly
   * as PRL computed it.
   *
   * The units were read off the file, not assumed: across the 536 rows with
   * statements these run 6.67 to 86.89, and the first draft of the sentence
   * builder treated them as 0-1 fractions and would have rendered Mark
   * Kelly's policy share as "7099%". A number this wrong is obvious; the
   * same mistake at 0.7 would have rendered "1%" and looked plausible.
   */
  shares: Record<PrlCategoryKey, number | null>;
  /**
   * What PRL says it collects from. The file's `communication_source` reads
   * `all` for every row today rather than naming the four channels the
   * dataset description lists (floor, newsletter, press, twitter), so this
   * carries what the file says and nothing is inferred from the description.
   */
  sources: string[];
  /** PRL's own last-update stamp for the communication block. */
  measuredAt: string;
}

/** The canonical promoted snapshot. The tracked copy is bootstrap/test evidence only. */
export interface PrlSnapshot {
  formatVersion: 1;
  fetchedAt: string;
  /** The file this was built from, so a later run can tell them apart. */
  sourceFile: string;
  sourceUrl: string;
  /** Rows in the source file, before any filtering. The denominator. */
  rowsInFile: number;
  /** Rows carrying at least one classified statement. */
  rowsWithStatements: number;
  /** Every exact Bioguide profile with a positive PRL statement count. */
  profiles: PrlMemberProfile[];
  /** Exact source Bioguide rows with no positive measurement. Named, never implied. */
  rosterMisses: string[];
  attribution: typeof PRL_RHETORIC_ATTRIBUTION;
}
