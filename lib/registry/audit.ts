import type { AgendaSourceType, CoverageStatus } from "./types.ts";

/**
 * What was actually tried when someone went looking for a body's agendas. `NOT_ATTEMPTED` is the
 * default; `NO_SOURCE_FOUND` is a claim that may appear only on a body with an audit row saying the
 * ladder was walked and came back empty. Rows record human work, so they are hand-maintained, and each
 * cites the URL it was read from.
 */

/**
 * The rungs of the source hunt, in the order they are walked, ordered by how long the source can be
 * trusted to keep working. Rungs 1-7 are passive retrieval. Rung 9 (a formal records request) is never
 * automated; see `docs/vendor-review.md`.
 */
export type LadderRung =
  /** 1. A vendor API this repo already has a cleared adapter for. */
  | "VENDOR_API"
  /** 2. A machine-readable feed the body itself publishes — iCal, RSS, JSON. */
  | "BODY_FEED"
  /** 3. A syndication channel the body operates — GovDelivery, e-alerts. */
  | "BODY_SUBSCRIBE"
  /** 4. The body's own agenda or minutes page, in HTML. */
  | "BODY_AGENDA_PAGE"
  /** 5. The body's own homepage, when no agenda page was found on it. */
  | "BODY_HOMEPAGE"
  /** 6. A parent government's page that lists this body. */
  | "PARENT_LISTING"
  /** 7. A vendor portal this repo is **not** cleared to read. */
  | "VENDOR_PORTAL_BLOCKED"
  /** 8. Walked the open web and found nothing. */
  | "OPEN_WEB_EXHAUSTED"
  /** 9. A formal public-records request. Never automated. */
  | "RECORDS_REQUEST";

/**
 * What a single rung returned. `BLOCKED_ROBOTS` is its own outcome, not a miss: a site that refuses
 * automated agents is neither "not found" nor readable on a schedule.
 */
export type RungOutcome = "HIT" | "MISS" | "BLOCKED_ROBOTS" | "BLOCKED_TERMS";

export interface RungResult {
  rung: LadderRung;
  outcome: RungOutcome;
  /** Exactly what was opened. Never constructed — this is the whole point. */
  url: string | null;
  /** What was seen there, in one line. */
  note: string;
}

/**
 * The outcome of the whole hunt for one body. `FOUND_UNBUILT`: a readable source exists and no adapter
 * reads it yet, distinct from both covered and nothing-to-find.
 */
export type HuntOutcome =
  /** An adapter reads this body today. */
  | "COVERED"
  /** A usable source was located; nothing reads it yet. */
  | "FOUND_UNBUILT"
  | "BLOCKED"
  /** The ladder was walked to rung 8 and came back empty. */
  | "EXHAUSTED";

export interface BodyCoverageAudit {
  /** `<ocdId>#<slot>` — matches `Body.id` exactly. */
  bodyId: string;
  /** When the ladder was walked. A hunt is a dated claim, not a standing fact. */
  attemptedAt: string;
  /** Who or what walked it. */
  attemptedBy: string;
  outcome: HuntOutcome;
  /** Every rung tried, in order, including the ones that missed. */
  rungs: RungResult[];
  /** The body's own page, read off whichever rung produced it, kept even when no feed was found. */
  homepageUrl: string | null;
  /** Where the agendas actually live, when a source was found. */
  agendaSourceType: AgendaSourceType;
  agendaSourceRef: string | null;
  /** What the body's coverage status becomes. Overlaid at registry build. */
  coverageStatus: CoverageStatus;
  /** Anything a later reader needs, including statutory context. */
  notes: string;
}

/** A body nobody has looked at yet. The default, and it is a real state. */
export const NOT_ATTEMPTED_STATUS: CoverageStatus = "NOT_ATTEMPTED";

export interface CoverageAuditFile {
  generatedAt: string;
  audits: BodyCoverageAudit[];
}

/** Index the audit by body id. */
export function indexAudits(
  file: CoverageAuditFile,
): Map<string, BodyCoverageAudit> {
  return new Map(file.audits.map((a) => [a.bodyId, a]));
}

/**
 * Whether this body's `NO_SOURCE_FOUND`-shaped status is a finding or a gap.
 *
 * Deliberately takes the audit index rather than the body, because the answer
 * lives in the *absence* of a row and a body cannot carry its own absence.
 */
export function wasLookedAt(
  audits: Map<string, BodyCoverageAudit>,
  bodyId: string,
): boolean {
  return audits.has(bodyId);
}
