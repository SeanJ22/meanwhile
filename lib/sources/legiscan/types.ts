/**
 * The state-legislature voting record — tracker **D49**, LegiScan.
 *
 * The state-level sibling of `lib/votes/` (federal roll calls from the
 * chambers' own XML). Same doctrine, restated because it is the doctrine and
 * not an implementation detail:
 *
 * - **RECORD-tier evidence only.** How a member voted, as the chamber
 *   recorded it, mapped onto four states and nothing else. Never merged with
 *   the STATEMENT corpus.
 * - **Never characterized by us.** The title is the bill's official title or
 *   the chamber's own description. No record here may carry a `score`,
 *   `rank`, `rating`, `match`, `fit`, `grade`, `alignment` or
 *   `recommendation` key — `tests/neutrality-guards.test.ts` holds that.
 * - **Snapshot architecture.** A committed artifact refreshed on a schedule,
 *   never fetched per page load.
 *
 * ## Attribution
 *
 * LegiScan's data is published under **CC BY 4.0**, which requires
 * attribution wherever it appears. `LEGISCAN_ATTRIBUTION` below is the single
 * string every surface renders, and `tests/legiscan.test.ts` fails if a
 * surface renders a LegiScan vote without it.
 *
 * ## The retrieval discipline
 *
 * Bulk first: the weekly dataset ZIPs, one per state session, refreshed by
 * LegiScan on Sunday mornings. `dataset_hash` is stored in the committed
 * manifest and compared before every download — **an unchanged hash is never
 * re-downloaded**, which is both the polite thing and the condition of not
 * being suspended. The front end of legiscan.com is never scraped.
 */

/** The four states a chamber records. Nothing in between is invented. */
export type StateVotePosition = "YES" | "NO" | "PRESENT" | "NOT_VOTING";

/**
 * The attribution CC BY 4.0 requires, rendered wherever this data appears.
 *
 * One string, one place, so a new surface cannot ship a variant of it or
 * forget it. The licence is on LegiScan's own terms page.
 */
export const LEGISCAN_ATTRIBUTION = {
  text: "LegiScan",
  url: "https://legiscan.com/",
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
} as const;

/** Publisher label for an official promoted roll; legacy/missing ids are LegiScan. */
export function stateRollPublisher(roll: Pick<StateRollCall, "sourceId">): string {
  if (roll.sourceId === "az-legislature") return "Arizona State Legislature";
  if (roll.sourceId === "nh-general-court") return "New Hampshire General Court";
  if (roll.sourceId === "nj-legislature") return "New Jersey Legislature / Office of Legislative Services";
  return `${LEGISCAN_ATTRIBUTION.text} (${LEGISCAN_ATTRIBUTION.licence})`;
}

/** Official rows need no LegiScan licence notice; any legacy row still does. */
export function stateRollAttribution(rolls: readonly Pick<StateRollCall, "sourceId">[]) {
  return rolls.length > 0 && rolls.every((roll) =>
    roll.sourceId === "az-legislature" || roll.sourceId === "nh-general-court" || roll.sourceId === "nj-legislature"
  ) ? null : LEGISCAN_ATTRIBUTION;
}

/** One state-chamber roll call. */
export interface StateRollCall {
  /** Stable source-scoped roll id; legacy snapshots use `legiscan:<id>`. */
  id: string;
  /** Explicit publisher family for promoted official records. */
  sourceId?: "az-legislature" | "nh-general-court" | "nj-legislature" | "legiscan";
  /** Exact official identity/stage fields; mandatory at official promotion. */
  officialRollCallId?: string;
  eventId?: string;
  chamber?: "House" | "Senate" | "Assembly";
  term?: string;
  session?: string;
  actionStage?: string;
  /** `AZ` / `NJ` / `NH`. */
  state: string;
  /** LegiScan's session id — the join key back to the dataset. */
  sessionId: number;
  /** The bill's designation as the chamber prints it: `HB 1234`, `S 500`. */
  billNumber: string;
  /**
   * What was voted on, in official words: the bill's official title. Never
   * written or paraphrased by us.
   */
  billTitle: string;
  /** The chamber's own description of the motion. */
  motion: string;
  /** `YYYY-MM-DD`, as the chamber recorded it. */
  date: string;
  /** The chamber's stated tally. */
  yea: number;
  nay: number;
  absent: number;
  nv: number;
  /** The chamber's own outcome line, e.g. "Passed 14-9". */
  result: string;
  /** The bill on the legislature's own site, where the dataset gives one. */
  billUrl: string | null;
  /** The roll call on LegiScan. */
  rollCallUrl: string;
  retrievedAt: string;
}

/** One member's recorded position on one roll call. */
export interface StateMemberVote {
  /** Our roster id for the officeholder. */
  officeholderId: string;
  /** LegiScan's own people id, kept so the join is auditable. */
  legiscanPeopleId: number;
  /** State publisher's exact person identifier in official projections. */
  officialPersonId?: string;
  rollCallId: string;
  position: StateVotePosition;
}

/**
 * What a refresh downloaded, so the next one can skip what has not changed.
 *
 * Committed. `dataset_hash` is LegiScan's; comparing it is the whole of the
 * "never re-download an unchanged dataset" discipline.
 */
export interface LegiscanDatasetRecord {
  state: string;
  sessionId: number;
  sessionName: string;
  datasetHash: string;
  datasetDate: string;
  /** When WE last downloaded it. Null means the hash matched and we skipped. */
  downloadedAt: string | null;
}

export interface StateVotesSnapshot {
  generatedAt: string;
  /** One per state session covered, with its hash. */
  datasets: LegiscanDatasetRecord[];
  /**
   * The identifier-set comparison, per the standing rule: how many LegiScan
   * people ids matched a roster seat, out of how many were seen in the roll
   * calls. A silent zero-match join is the cd:0 failure again, and a 100%
   * match rate pointing at one row is the D40 failure — so this also states
   * how many DISTINCT officeholders the matched ids resolved to.
   */
  identifierMatch: {
    peopleSeen: number;
    peopleMatched: number;
    distinctOfficeholders: number;
    /** Per state, so one state's success cannot mask another's zero. */
    byState: Record<
      string,
      { peopleSeen: number; peopleMatched: number; rollCalls: number }
    >;
  };
  rollCalls: StateRollCall[];
  positions: StateMemberVote[];
}
