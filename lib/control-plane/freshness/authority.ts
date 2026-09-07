/**
 * **THERE IS ONE FRESHNESS CLOCK, AND WHICH ONE IS A DERIVED FACT.**
 * (FCP-1, 2026-09-07.)
 *
 * ## The state this repository is actually in
 *
 * Two clocks exist and only one is authoritative, and that is not an accident —
 * it is the transition rule RULING 212 and RULING 218 share, stated in
 * `refresh-cadence.ts` and at the top of `refresh-daily.yml`:
 *
 * > the legacy jobs remain as explicitly non-authoritative runtime until the
 * > replacement is PROVED, because the gap between deleting the old clock and
 * > trusting the new one is a gap in which nothing refreshes at all.
 *
 * FCP-1 asks for the transfer to be completed. The brief also says, in its own
 * implementation constraints, *do not remove the legacy runtime before the
 * governance-required independent reproduction proves the replacement*, and
 * *once proof is satisfied, do not leave two authoritative clocks running "for
 * safety"*. Those two sentences describe a GATE, not a decision, and the reason
 * this file exists is that until now the gate was a paragraph.
 *
 * ## Why this session cannot flip it, stated rather than worked around
 *
 * RULING 216 defines INDEPENDENTLY_REPRODUCED as reproduction by a canonical
 * execution **separate from the implementation's own proving observation**. A
 * session that builds the scheduler cannot supply that by running it; that is
 * the whole content of the class. `lib/ops/run-provenance.ts` enforces it
 * mechanically — `runClass` falls back to `LOCAL_SESSION`, which can never earn
 * the stronger label, and the absent case is always the weak case.
 *
 * So this module does not assert the transfer. It makes the transfer
 * **mechanical**: `readAuthority` derives which clock is authoritative from the
 * proof state, and `AUTHORITY_TRANSFER_GATE` states the four conditions. When
 * a canonical run this session did not perform reproduces the contracts, the
 * gate opens and the derived answer changes with it. Nobody has to remember to
 * do anything, and nobody can decide it by feel.
 *
 * ## The invariant that outranks both clocks
 *
 * > **There is never a period in which two clocks independently run the same
 * > due work.**
 *
 * `judgeAuthority` refuses that state rather than reporting it, in both
 * directions: two authoritative clocks is a refusal, and zero authoritative
 * clocks is a refusal too. The second is the one that is easy to reach by
 * accident — retire the legacy on a Friday, discover the replacement is not
 * activated on the Monday, and nothing has refreshed all weekend.
 *
 * PURE. `readAuthority` takes the proof state; the caller reads it from the
 * activation gate.
 */

export const AUTHORITY_FORMAT_VERSION = 1;

export const FRESHNESS_CLOCKS = [
  /** `.github/workflows/refresh-daily.yml` — cron, hosted, measured 186-313 min late. */
  "GITHUB_SCHEDULED_WORKFLOW",
  /** `lib/control-plane/scheduler/*` on the standing runner, the machine's own clock. */
  "STANDING_RUNNER_SCHEDULER",
] as const;
export type FreshnessClock = (typeof FRESHNESS_CLOCKS)[number];

/** What a clock is permitted to be, at one moment. */
export const CLOCK_ROLES = [
  /** It decides what is due and dispatches it. Exactly one clock, always. */
  "AUTHORITATIVE",
  /** It runs, and is explicitly non-authoritative about whether anything is fresh. */
  "NON_AUTHORITATIVE_BACKUP",
  /** It does not run on a schedule at all; a person may dispatch it. */
  "MANUAL_ONLY",
  /** It is gone. */
  "RETIRED",
] as const;
export type ClockRole = (typeof CLOCK_ROLES)[number];

/**
 * The four conditions that transfer authority, and the ruling behind each.
 *
 * Stated as data so `tests/freshness-control-plane.test.ts` asserts against
 * them and so the report can print which are met without a session narrating
 * its own progress.
 */
export const AUTHORITY_TRANSFER_GATE = [
  {
    id: "READER_GREEN",
    what: "the READER contract is GREEN",
    ruling: "RULING 268",
  },
  {
    id: "TRUTH_GREEN",
    what: "the TRUTH contract is GREEN",
    ruling: "RULING 268",
  },
  {
    id: "FRESHNESS_GREEN",
    what: "the FRESHNESS contract is GREEN",
    ruling: "RULING 268",
  },
  {
    id: "INDEPENDENTLY_REPRODUCED",
    what:
      "the reading was taken by a canonical execution separate from the implementing session's " +
      "own proving observation, against a committed integration head",
    ruling: "RULING 216",
  },
] as const;

export interface ProofState {
  readonly reader: string;
  readonly truth: string;
  readonly freshness: string;
  readonly independentlyReproduced: boolean;
  /** Where the reading came from, for the receipt. Null when there was none. */
  readonly readFrom: string | null;
}

export interface AuthorityReading {
  readonly formatVersion: typeof AUTHORITY_FORMAT_VERSION;
  readonly authoritative: FreshnessClock;
  readonly roles: Readonly<Record<FreshnessClock, ClockRole>>;
  /** Which gate conditions are met, by id. */
  readonly met: readonly string[];
  readonly unmet: readonly string[];
  readonly transferred: boolean;
  readonly reason: string;
}

/**
 * Which clock is authoritative right now.
 *
 * Before the gate: the legacy workflow, and the scheduler runs in shadow. That
 * is the honest reading and it is the one the repository has been in since
 * RULING 218 — the scheduler observes, acquires and records; it does not
 * promote.
 *
 * After the gate: the standing runner, and the legacy cron drops to
 * MANUAL_ONLY. Not RETIRED, because RULING 268 keeps a backup wakeup and a
 * hand dispatch is how a source is debugged; MANUAL_ONLY is precisely "it
 * cannot independently execute the same due work", which is FCP-8 row 12's
 * requirement and is weaker than deletion for a reason.
 */
export function readAuthority(proof: ProofState): AuthorityReading {
  const met: string[] = [];
  const unmet: string[] = [];
  const push = (id: string, ok: boolean) => (ok ? met : unmet).push(id);

  push("READER_GREEN", proof.reader === "GREEN");
  push("TRUTH_GREEN", proof.truth === "GREEN");
  push("FRESHNESS_GREEN", proof.freshness === "GREEN");
  push("INDEPENDENTLY_REPRODUCED", proof.independentlyReproduced);

  const transferred = unmet.length === 0;

  return {
    formatVersion: AUTHORITY_FORMAT_VERSION,
    authoritative: transferred ? "STANDING_RUNNER_SCHEDULER" : "GITHUB_SCHEDULED_WORKFLOW",
    roles: transferred
      ? {
          STANDING_RUNNER_SCHEDULER: "AUTHORITATIVE",
          GITHUB_SCHEDULED_WORKFLOW: "MANUAL_ONLY",
        }
      : {
          GITHUB_SCHEDULED_WORKFLOW: "AUTHORITATIVE",
          STANDING_RUNNER_SCHEDULER: "NON_AUTHORITATIVE_BACKUP",
        },
    met,
    unmet,
    transferred,
    reason: transferred
      ? "every transfer condition is met: the standing runner's scheduler is the freshness clock " +
        "and the GitHub cron is manual-only, so no second clock can independently run the same " +
        "due work"
      : `${unmet.length} of ${AUTHORITY_TRANSFER_GATE.length} transfer condition(s) are unmet ` +
        `(${unmet.join(", ")}), so the legacy runtime keeps authority. Removing it now would ` +
        "open the gap RULING 212 and RULING 218's shared transition rule exists to prevent — a " +
        `period in which nothing refreshes at all. Reading from ${proof.readFrom ?? "no run record"}`,
  };
}

/**
 * **THE ONE-CLOCK INVARIANT, ENFORCED IN BOTH DIRECTIONS.**
 *
 * Returns null when the arrangement is lawful, and the refusal when it is not.
 * Called by the tests and by the runner's own preflight, so an arrangement that
 * violates it cannot be reached by editing one file and forgetting the other.
 */
export function judgeAuthority(
  roles: Readonly<Record<FreshnessClock, ClockRole>>,
): string | null {
  const authoritative = FRESHNESS_CLOCKS.filter((c) => roles[c] === "AUTHORITATIVE");
  if (authoritative.length > 1) {
    return (
      `${authoritative.join(" and ")} are both AUTHORITATIVE. Two clocks independently running ` +
      "the same due work is the arrangement the transition rule forbids on both sides: it is " +
      "why the legacy is not removed early, and it is why it does not stay 'for safety' after " +
      "the transfer"
    );
  }
  if (authoritative.length === 0) {
    return (
      "no clock is AUTHORITATIVE. This is the failure that looks like caution and is not: retire " +
      "the legacy before the replacement is activated and nothing refreshes at all, which reads " +
      "to every surface above it as freshness"
    );
  }
  return null;
}

/**
 * **WHAT A NON-AUTHORITATIVE BACKUP MAY COST.**
 *
 * FCP-5's cost law says a quiet day costs zero hosted minutes for freshness,
 * and the legacy cron currently spends on every one of them — checkout, node,
 * install and a full source sweep before it can discover that nothing moved.
 * The transition rule keeps the backup; it does not require the backup to be
 * expensive.
 *
 * So a backup wakeup's job is to ask one question — *did the authoritative
 * clock do its work?* — and to do the work only when the answer is no. That is
 * the shape `refresh-daily.yml` now takes, and this is the predicate it asks.
 */
export interface BackupDecision {
  readonly runTheWork: boolean;
  readonly reason: string;
}

/** How stale the standing runner's last cycle may be before the backup acts. */
export const BACKUP_TAKES_OVER_AFTER_HOURS = 26;

export function decideBackup(input: {
  /** Hours since the authoritative clock last completed a cycle. Null = unknown. */
  readonly hoursSinceAuthoritativeCycle: number | null;
  readonly authoritative: FreshnessClock;
}): BackupDecision {
  if (input.authoritative === "GITHUB_SCHEDULED_WORKFLOW") {
    return {
      runTheWork: true,
      reason:
        "the GitHub workflow IS the authoritative clock until the transfer gate opens, so it does " +
        "its own work; this predicate governs it only after authority moves",
    };
  }
  if (input.hoursSinceAuthoritativeCycle === null) {
    return {
      runTheWork: true,
      reason:
        "the authoritative clock's last cycle could not be read, and an unreadable heartbeat is " +
        "never read as a healthy one — the backup does the work rather than assume it was done",
    };
  }
  if (input.hoursSinceAuthoritativeCycle >= BACKUP_TAKES_OVER_AFTER_HOURS) {
    return {
      runTheWork: true,
      reason:
        `the authoritative clock last completed a cycle ${input.hoursSinceAuthoritativeCycle.toFixed(1)}h ` +
        `ago, past the ${BACKUP_TAKES_OVER_AFTER_HOURS}h at which a daily obligation is genuinely ` +
        "unserved; this is the gap the backup exists for",
    };
  }
  return {
    runTheWork: false,
    reason:
      `the authoritative clock completed a cycle ${input.hoursSinceAuthoritativeCycle.toFixed(1)}h ` +
      "ago, so there is nothing for a backup to do: it reports that and stops, costing a checkout " +
      "and one read rather than a full source sweep",
  };
}
