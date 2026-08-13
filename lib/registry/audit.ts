import type { AgendaSourceType, CoverageStatus } from "./types.ts";

/**
 * What was actually tried when someone went looking for a body's agendas.
 *
 * **The distinction this exists to make.** Before it, every one of the 265
 * derived bodies read `NO_SOURCE_FOUND`, and that single value was doing two
 * completely different jobs: *we walked the ladder and there is nothing to
 * find*, and *nobody has ever looked*. Those call for opposite actions — the
 * first is a finding, the second is a queue item — and the registry could not
 * tell them apart, because `NO_SOURCE_FOUND` was simply the derivation's
 * default for a body no human had touched.
 *
 * So `NOT_ATTEMPTED` is now the default and `NO_SOURCE_FOUND` is a *claim*: it
 * may only appear on a body that has an audit row saying the ladder was walked
 * and came back empty. **A body with no row in this file is `NOT_ATTEMPTED`**,
 * and the absence is the signal rather than an oversight.
 *
 * This file is hand-maintained, unlike everything else in `lib/registry/`. It
 * records human work — someone opened a page and read it — so it cannot be
 * generated, and every row cites the URL it was read from. `build-registry.ts`
 * overlays it onto the derived bodies; the derivation itself stays pure.
 */

/**
 * The rungs of the source hunt, in the order they are walked.
 *
 * Ordered by how much the source can be trusted to keep working, not by how
 * easy it is to read today. A feed the body itself publishes outlives a vendor
 * contract; an HTML page outlives a scraper written against one layout.
 *
 * Rungs 1–7 are passive retrieval of something already published. **Rung 8 is
 * deliberately the last automated rung and rung 9 is not automated at all** —
 * a formal records request goes to a custodian, and in Arizona that is where
 * A.R.S. § 39-121.03's commercial-purpose statement attaches (see
 * `docs/vendor-review.md`). Nothing in this repo may walk rung 9 unattended.
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
 * What a single rung returned.
 *
 * `BLOCKED_ROBOTS` is its own outcome and not a miss. Newbury's town site
 * answers 403 to any identified automated agent while serving a human the page
 * perfectly — recording that as "not found" would be false, and recording it as
 * "found" would imply we can read it on a schedule. It is neither.
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
 * The outcome of the whole hunt for one body.
 *
 * `FOUND_UNBUILT` is by far the most common real answer and the one that had
 * nowhere to live: a source exists, it was opened, it is readable — and no
 * adapter reads it yet. That is a queue item with a known destination, which is
 * a completely different thing from either "covered" or "nothing to find".
 */
export type HuntOutcome =
  /** An adapter reads this body today. */
  | "COVERED"
  /** A usable source was located; nothing reads it yet. */
  | "FOUND_UNBUILT"
  /** A source was located and this repo may not read it. See `docs/vendor-review.md`. */
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
  /**
   * The body's own page, read off whichever rung produced it.
   *
   * This is the field that made the audit worth writing in the same change as
   * the link ladder: a hunt that fails to find a *feed* has still visited the
   * body's page, and throwing that URL away discards most of the work and
   * leaves the reader with nowhere to click.
   */
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
