/**
 * What members SAY: the Polarization Research Lab at Dartmouth, "America's
 * Political Pulse". A third evidence tier beside RECORD and FUNDING that never
 * merges with either.
 *
 * PRL publishes under a Creative Commons Attribution licence, so attribution is
 * a condition of use. The rhetoric files and the survey files carry different
 * citations; both are recorded below and must be picked by dataset.
 */

/** The attribution the rhetoric datasets require, rendered wherever a PRL number appears. */
export const PRL_RHETORIC_ATTRIBUTION = {
  /** Verbatim from https://americaspoliticalpulse.com/elites/data. */
  citation:
    "America's Political Pulse. (2024). Congressional Rhetoric Dataset. Available at: https://americaspoliticalpulse.com/elites/data",
  /** How the lab is named on a reader-facing panel. */
  text: "the Polarization Research Lab (Dartmouth)",
  url: "https://americaspoliticalpulse.com/elites/data",
  licence: "CC BY",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  /**
   * The elites page names no licence version; the Open Data page states
   * "Creative Commons Attribution 4.0", so the site's own link is recorded.
   */
  licenceReadAt: "2026-08-19",
} as const;

/** The SURVEY datasets' citation. Not used by this adapter. */
export const PRL_SURVEY_ATTRIBUTION = {
  citation:
    "Westwood, S. J., & Lelkes, Y. (2024). America's Political Pulse [Data set]. https://americaspoliticalpulse.com/data",
  url: "https://americaspoliticalpulse.com/data",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  licenceReadAt: "2026-08-19",
} as const;

/**
 * The five categories PRL classifies a statement into: PRL's measurement of
 * what a statement does, never our reading of what a person believes. Keys are
 * PRL's own column names; labels are the reader-facing words.
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
 * Columns that may never cross this boundary: ideology scores, ranks and
 * percentiles. The filter is an allowlist on the way in, so a column PRL adds
 * cannot arrive silently.
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
   * How many statements PRL classified for this member; rendered beside every
   * share. It is NOT the share's exact denominator (PRL's mean uses a slightly
   * different base), so the two are never multiplied together.
   */
  statementCount: number;
  /** Share of statements in each category, as a percentage 0-100, exactly as PRL computed it. */
  shares: Record<PrlCategoryKey, number | null>;
  /** The file's `communication_source` as written; nothing is inferred from the dataset description. */
  sources: string[];
  /** PRL's own last-update stamp for the communication block. */
  measuredAt: string;
}

/** The canonical promoted snapshot. */
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
  /** A completed immutable release; each person is read from their own profile object. */
  releases?: readonly {
    readonly kind: "prl-profiles";
    readonly objectRoot: string;
    readonly subjectCount: number;
    readonly sourceSha256: string;
  }[];
  attribution: typeof PRL_RHETORIC_ATTRIBUTION;
}
