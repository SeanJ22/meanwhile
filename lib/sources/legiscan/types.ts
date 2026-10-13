/**
 * The state-legislature voting record, the state-level sibling of `lib/votes/`.
 * - Record-tier evidence only: how a member voted, as recorded by the attributed publisher.
 *   Never merged with the statement corpus.
 * - Never characterized by us: the title is the bill's official title or the chamber's own description.
 *   No record may carry a `score`, `rank`, `rating`, `match`, `fit`, `grade`, `alignment` or
 *   `recommendation` key (`tests/neutrality-guards.test.ts`).
 * - Production serves validated, independently attributed source projections from the data plane.
 *
 * LegiScan's data is published under CC BY 4.0; `LEGISCAN_ATTRIBUTION` is the single string every
 * surface renders with it. Its weekly state datasets supplement independently attributed official
 * sources; exact official roll calls retain precedence in Reader.
 */

/**
 * The normalized compatibility states a chamber record may project.
 *
 * `UNKNOWN` is deliberately not folded into `NOT_VOTING`: some official
 * exports contain a position row whose publisher label is blank or outside
 * the currently understood vocabulary.  The exact publisher label remains
 * on `StateMemberVote.publisherPosition`, while this value keeps Reader from
 * inventing a substantive voting disposition.
 */
export type StateVotePosition = "YES" | "NO" | "ABSTAIN" | "PRESENT" | "NOT_VOTING" | "UNKNOWN";

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
  /** Exact source event family when the publisher exposes separate horizons. */
  officialEventKind?: "ASSEMBLY_FLOOR" | "SENATE_FLOOR" | "ASSEMBLY_COMMITTEE" | "SENATE_COMMITTEE";
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
  /**
   * Exact named tally fields when an official publisher's schema does not
   * align one-for-one with the legacy compatibility counters above.
   */
  publisherTally?: Readonly<Record<string, number>>;
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
  /** Exact publisher value, including an intentionally empty string. */
  publisherPosition?: string;
}

/**
 * What a refresh downloaded, so the next one can skip what has not changed. Research metadata;
 * production official projections carry their own source/version proof.
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
  /** Exact source-specific cross-file accounting retained with the projection. */
  officialSourceReconciliation?: {
    rollCount: number;
    positionCount: number;
    exactPublisherCategoryMatches: number;
    publisherCategoryDrift: readonly {
      officialRollCallId: string;
      publisherPresent: number;
      publisherAbsent: number;
      historyNotExcusedOrPresiding: number;
      historyExcused: number;
    }[];
  };
  /** Source-specific exact-horizon reconciliation retained with the promotion. */
  officialHorizonAudit?: {
    authorityMode: "API_ARCHIVE_EXACT_RECONCILIATION";
    sessionIndexUrl: string;
    sessionDisplay: string;
    expectedParticipantRequests: number;
    completedParticipantRequests: number;
    apiRollCalls: number;
    apiPositions: number;
    reconciledArchivePositions: number;
    archives: readonly {
      kind: string;
      url: string;
      sha256: string;
      rollCalls: number;
      positions: number;
    }[];
  };
  /**
   * Exact promoted official-person authority used by the acquisition that joined member positions.
   * Required for permanent official projections.
   */
  officialIdentityAuthority?: {
    contractId: string;
    sourceId: string;
    scope: string;
    versionId: string;
    /** Digest of the independently promoted current-officeholder pointer. */
    currentOfficeholderIdsSha256: string;
    /**
     * Exact term/session participant universe used for historical positions.
     * Former members may be present here without being rendered as current
     * officeholders.  This set is source-versioned inside the same candidate
     * evidence and may never be substituted with the current roster.
     */
    sessionParticipantSet: {
      term: string;
      session: string;
      sourceVersion: string;
      count: number;
      officeholderIdsSha256: string;
      /** Exact source-side identity enrichment reconciliation, when published. */
      audit?: {
        historyParticipantCount: number;
        legislatorsIdentityCount: number;
        enrichedParticipantCount: number;
        historyOnlyParticipantCount: number;
        historyOnlyPersonIds: readonly string[];
      };
    };
  };
  /** One per state session covered, with its hash. */
  datasets: LegiscanDatasetRecord[];
  /**
   * The identifier-set comparison: how many LegiScan people ids matched a roster seat, out of how many were
   * seen, and how many distinct officeholders the matched ids resolved to (a silent zero-match join and a
   * many-to-one match both show here).
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

/** One member's own recorded position on one roll, in the per-legislator
 *  projection. Roll metadata (title, motion, result) is joined from the
 *  per-state roll index rather than repeated on every member. */
export interface StateLegislatorVotePosition {
  rollCallId: string;
  position: StateVotePosition;
  publisherPosition?: string;
  /** `YYYY-MM-DD`, carried so the member's page can order votes without the
   *  roll index; every other roll field is joined, never duplicated here. */
  date: string;
}

/**
 * **THE PER-LEGISLATOR VOTING RECORD (`STATE_LEGISLATOR_VOTES`).**
 *
 * One member's votes across a term, scoped to their exact officeholder id. Its
 * write is bounded by the member's own tenure — never the whole chamber times
 * every year — so the largest state we will ever load promotes one bounded
 * candidate per member and re-promotes only members whose votes changed.
 */
export interface StateLegislatorVotes {
  generatedAt: string;
  officeholderId: string;
  sourceId: "az-legislature" | "nh-general-court" | "nj-legislature";
  jurisdiction: string;
  chamber: StateRollCall["chamber"] | null;
  term: string;
  session: string;
  positions: readonly StateLegislatorVotePosition[];
  /** Exact roll metadata for this member's positions, acquired in the same source version. */
  rollCalls?: readonly StateRollCall[];
  officialIdentityAuthority: NonNullable<StateVotesSnapshot["officialIdentityAuthority"]>;
}

/**
 * The per-state fan-out marker the standing runner's clock reads: a watermark
 * over one term's acquisition. It carries no positions and is promoted at a
 * distinct scope from the reader's `STATE_ROLL_CALL:<jurisdiction>` pointer, so
 * a promoted marker never renders as a false "no votes" for any member.
 */
export interface StateLegislatorVotesSessionMarker {
  generatedAt: string;
  jurisdiction: string;
  sourceId: "az-legislature" | "nh-general-court" | "nj-legislature";
  term: string;
  session: string;
  throughRollId: string | null;
  throughDate: string | null;
  rollCount: number;
  legislatorCount: number;
  positionCount: number;
  /**
   * Digest of the exact source documents this acquisition fetched, over
   * `sha256(bodies.map(sha256).join("\n"))`, kept on the marker so the fan-out retains source provenance
   * without duplicating raw bytes onto every member.
   */
  sourceDocumentsSha256: string;
  officialIdentityAuthority: NonNullable<StateVotesSnapshot["officialIdentityAuthority"]>;
}
