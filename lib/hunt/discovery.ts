/**
 * **RULING 52 — DISCOVERY IS A TREE, NOT A LADDER.**
 * **RULING 53 — RECORDED ABSENCES EXPIRE.**
 * (Both adopted 2026-08-21, NH Hunt 3. Both are law in `CLAUDE.md`.)
 *
 * This is the machinery. The law is in `CLAUDE.md` with its rationale attached;
 * what follows is how the law is made checkable, and why each piece has the
 * shape it has.
 *
 * ## Why a ladder produced wrong answers
 *
 * A ladder has one path with ordered fallbacks, so exhausting it yields a
 * verdict — *unreachable*. That verdict then gets written down and stops being
 * questioned. Three proven instances in this repo, each recorded as settled and
 * each false:
 *
 * - `gc.nh.gov` sat in `CLAUDE.md` as refusing every client this project has,
 *   browsers included. It answers rung 2 at HTTP 200.
 * - `sos.nh.gov` stayed walled host-wide from 2026-08-13 until somebody walked
 *   rung 5.
 * - Kearsarge's nine board emails sat in the page's own `href`s after two
 *   separate sessions recorded them as honest absences.
 *
 * A tree does not have the answer *unreachable* available to it. Branches are
 * independent routes to the same fact, and **a branch coming back empty is one
 * measurement, not a verdict about the fact.**
 *
 * ## What makes two branches independent, and why it is recorded rather than judged
 *
 * Two routes that fail for the same reason are one route wearing two names.
 * Three fetches of the same host with different headers are not three branches;
 * they are one branch walked at three rungs. So a branch declares what it goes
 * `through` — the host, the vendor, the publisher — and independence is counted
 * over DISTINCT `through` values rather than over branch names. A hunt that
 * walked five branches all through `example.gov` has walked one.
 *
 * This is deliberately a recorded claim and not an inference. Nothing here can
 * tell that two hostnames sit behind one WAF; a person can, and writes it down.
 *
 * ## Rungs are not branches, and the distinction is the whole point
 *
 * A **rung** is retrieval mechanics: how to get bytes past a wall. Fourteen of
 * them, numbered in `CLAUDE.md`, and that numbering is canonical (RULING 16).
 * A **branch** is *where the fact might also live* — a different publisher, a
 * different document, a different body that files the same thing. A branch may
 * be walked at any rung, so a branch record may carry the rung it used.
 */

/** An ISO calendar date, `YYYY-MM-DD`, from `corepack pnpm stamp`. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One route to a fact, walked, with what came back.
 *
 * Every field is required except `rung` and `through`, and the two optional
 * ones are optional for opposite reasons: a branch that is not a retrieval at
 * all has no rung, and a branch whose independence is self-evident needs no
 * `through`. A branch with no `through` counts as independent of everything,
 * which is the generous reading — so a hunt that wants to CLAIM independence
 * gets it by default and a hunt that wants it CHECKED says what it went
 * through.
 */
export interface Branch {
  /** What route this was, in words a later session can re-walk. */
  branch: string;
  /** The date it was walked. Never a plausible date — see the date rule. */
  attemptedAt: string;
  /** What came back. An empty result is a result and is written down. */
  result: string;
  /** Whether this branch produced the fact. */
  found: boolean;
  /** The canonical retrieval rung used, where this branch was a retrieval. */
  rung?: string;
  /**
   * What this branch depends on — a host, a vendor, a publisher. Two branches
   * sharing one of these are ONE branch for independence purposes.
   */
  through?: string;
}

/** Is this a branch record the product is allowed to count? */
export function isValidBranch(value: unknown): value is Branch {
  if (typeof value !== "object" || value === null) return false;
  const b = value as Partial<Branch>;
  return (
    typeof b.branch === "string" &&
    b.branch.trim() !== "" &&
    typeof b.result === "string" &&
    b.result.trim() !== "" &&
    typeof b.found === "boolean" &&
    typeof b.attemptedAt === "string" &&
    ISO_DATE.test(b.attemptedAt)
  );
}

/**
 * How many genuinely independent routes were walked.
 *
 * Branches sharing a `through` collapse to one. Branches with no `through` each
 * count for themselves. The number this returns is the one an absence claim
 * rests on, so it deliberately UNDER-counts rather than over-counts: an
 * unrecorded shared dependency is the failure mode that produced all three of
 * the wrong verdicts above.
 */
export function independentBranchCount(branches: readonly Branch[]): number {
  const shared = new Set<string>();
  let standalone = 0;
  for (const b of branches) {
    if (typeof b.through === "string" && b.through.trim() !== "") {
      shared.add(b.through.trim().toLowerCase());
    } else {
      standalone += 1;
    }
  }
  return shared.size + standalone;
}

/**
 * What a set of branches says about one fact.
 *
 * Three outcomes, and the third is the one worth having a type for.
 *
 * - `found` — at least one branch produced it.
 * - `not-found-yet` — every branch walked came back empty. **This is never a
 *   verdict.** It is what the hunt has measured so far, and it goes on the
 *   RULING 53 clock.
 * - `divergent` — two branches produced DIFFERENT values for the same fact.
 *   Where the two do not reconcile, that is the finding and it renders as one;
 *   it is never quietly resolved by preferring one branch.
 */
export type BranchVerdict = "found" | "not-found-yet" | "divergent";

export function verdictOf(
  branches: readonly Branch[],
  valueOf?: (b: Branch) => string | null,
): BranchVerdict {
  const hits = branches.filter((b) => b.found);
  if (hits.length === 0) return "not-found-yet";
  if (!valueOf || hits.length < 2) return "found";
  const values = new Set(
    hits.map((b) => valueOf(b)).filter((v): v is string => v !== null && v.trim() !== ""),
  );
  return values.size > 1 ? "divergent" : "found";
}

/* ───────────────────────────── RULING 53 ────────────────────────────────── */

/**
 * What kind of thing was measured, because they go stale at different rates.
 *
 * The windows are RULING 53's, verbatim, and the reasoning is in the rule: a
 * candidate's fields move fastest because filings open and campaigns launch,
 * and a walled source is re-tested on the same clock as a roster **regardless
 * of how emphatically the wall was recorded** — that clause exists precisely
 * because `gc.nh.gov` and `sos.nh.gov` were recorded emphatically and were
 * wrong.
 */
export const RECALL_WINDOW_DAYS = {
  /** Filings open, campaigns launch, sites appear. */
  candidateField: 7,
  /** Rosters change on a slower clock than a campaign does. */
  bodyOrRoster: 14,
  /** A wall is a measurement of one day's posture, never a property. */
  walledSource: 14,
} as const;

export type RecallKind = keyof typeof RECALL_WINDOW_DAYS;

const DAY_MS = 86_400_000;

/** Whole days between two ISO calendar dates. Negative if `then` is later. */
export function daysBetween(then: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${then}T00:00:00Z`)) / DAY_MS);
}

/**
 * Is this measurement past its window?
 *
 * **Staleness is a state the data carries, not a note in a document.** A record
 * past its window is not wrong and is not deleted — it is *stale*, meaning it
 * must be re-walked before it is relied on. That is the whole of RULING 53's
 * second half: no branch result is permanent, and a fact not found today is
 * hunted again on its cadence, forever.
 *
 * An unparseable or missing date reads as STALE rather than fresh. A record
 * that cannot say when it was measured has no claim on being current, and
 * defaulting the other way is how a bad date buys permanent trust.
 */
export function staleness(
  kind: RecallKind,
  checkedAt: string | null | undefined,
  today: string,
): { stale: boolean; ageDays: number | null; windowDays: number } {
  const windowDays = RECALL_WINDOW_DAYS[kind];
  if (typeof checkedAt !== "string" || !ISO_DATE.test(checkedAt)) {
    return { stale: true, ageDays: null, windowDays };
  }
  const ageDays = daysBetween(checkedAt, today);
  return { stale: ageDays > windowDays, ageDays, windowDays };
}

/**
 * An absence record the product is allowed to act on.
 *
 * RULING 52: *every recorded absence names which branches were walked and on
 * what date. "Not found" without branches and a date is not a valid record.*
 * This is that sentence, made checkable.
 *
 * It is deliberately STRICTER than the rung-based `isEvidencedAbsence` it sits
 * beside in `lib/ballot/hunt-state.ts`: rungs prove the retrieval discipline
 * was walked, branches prove more than one ROUTE was tried, and the three
 * wrong verdicts this ruling was adopted over all had a defensible rung
 * history behind them.
 */
export interface EvidencedAbsence {
  branches: Branch[];
  checkedAt: string;
}

export function isEvidencedByBranches(
  record: unknown,
  options: { minimumIndependent?: number } = {},
): record is EvidencedAbsence {
  if (typeof record !== "object" || record === null) return false;
  const r = record as Partial<EvidencedAbsence>;
  if (typeof r.checkedAt !== "string" || !ISO_DATE.test(r.checkedAt)) return false;
  if (!Array.isArray(r.branches) || r.branches.length === 0) return false;
  if (!r.branches.every(isValidBranch)) return false;
  // A branch that FOUND the thing is not evidence the thing is absent.
  if (r.branches.some((b) => b.found)) return false;
  /*
   * Two independent branches minimum, by default. One branch coming back empty
   * is a measurement and RULING 52 says so in as many words; calling it an
   * absence is exactly the ladder's `unreachable` verdict under a new name.
   */
  const minimum = options.minimumIndependent ?? 2;
  return independentBranchCount(r.branches) >= minimum;
}
