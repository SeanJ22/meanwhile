/**
 * EVERY JOB NAMES ITS OWN CAUSE BEFORE IT DIES.
 * (2026-08-26, the sources-and-incumbency session. Item 8a of that brief. It is
 * RULING 164 — a workflow reports every failure, not just the first — carried
 * one step further: reporting a failure is not the same as NAMING it.)
 *
 * **`Error: Process completed with exit code 1` is not an error message. It is
 * the absence of one.** Sean has been pasting workflow logs that end in exactly
 * that line, and every failure has therefore been handled as an incident rather
 * than as a class, so the next one arrives looking new.
 *
 * This is the class list. A workflow's last step runs `pnpm diagnose` on the
 * failure path, which reads the job's own log and prints:
 *
 *   - for a KNOWN class, the class and the remedy in plain words
 *   - for an UNKNOWN failure, that it is unknown, loudly, with what it saw
 *
 * **The unknown case is the load-bearing one.** An unrecognised failure is the
 * one most worth a person's attention, and today it is indistinguishable from
 * the six that are already understood. A diagnoser that printed nothing when it
 * recognised nothing would be the capture script reporting `0 offenders` about
 * a panel it never opened (RULING 159).
 *
 * **The class list only grows.** A cause diagnosed once is never diagnosed
 * twice: the shape goes in here, with the remedy, and every workflow inherits
 * it because they all call the same step.
 */

/** One recognised way a job in this repository dies. */
export interface FailureClass {
  readonly id: string;
  /** What a reader should do, in plain words. Never "see the logs". */
  readonly remedy: string;
  /**
   * The shapes this class takes in a job log. SHAPES, not strings (RULING 110)
   * — each is proved against a real captured log line in
   * `tests/failure-classes.test.ts`.
   */
  readonly shapes: readonly RegExp[];
}

export const FAILURE_CLASSES: readonly FailureClass[] = [
  {
    id: "push-refused-by-ruleset",
    remedy:
      "The branch ruleset correctly refused a direct push. Terminal PDC permits no workflow, " +
      "runtime process, deploy key, or app bypass around software CI. Remove the direct writer; " +
      "a real software change must use the normal pull-request and exact-head certification path.",
    shapes: [/\bGH013\b/, /repository rule violations/i, /\bGH006\b/, /protected branch (update failed|hook declined)/i],
  },
  {
    id: "tracker-store-and-views-disagree",
    remedy:
      "An engineering tracker store was changed without its deterministic views, or the other way " +
      "round. Regenerate the views locally and carry store plus views through the same ordinary " +
      "software pull request. Do not add a workflow, direct-main writer, or bypass to repair it.",
    shapes: [
      /states an open count other than/i,
      /the stated open count is the store's/i,
      /no session's ledger entry claims them/i,
      /must say the section is stopped/i,
    ],
  },
  {
    id: "browser-not-installed",
    remedy:
      "The gate needs Chromium and could not find it where it looked. Check the install step's own " +
      "log for the directory it wrote to and compare it against the path lib/ops/chromium-pin.ts " +
      "searches — Chrome for Testing writes chrome-linux64/chrome, the legacy layout was " +
      "chrome-linux/chrome (RULING 113).",
    shapes: [/NO CHROMIUM INSTALLED/i, /Executable doesn't exist at/i, /browserType\.launch/i],
  },
  {
    id: "staleness-guard",
    remedy:
      "A source's oldest serving row crossed its allowed age. Inspect that source's canonical " +
      "attempt, retry/backoff, hold, and LKG receipts in Admin; repair its source-scoped data-plane " +
      "contract. Do not refresh or revert a tracked snapshot and do not dispatch software CI.",
    shapes: [/headroom/i, /oldest row/i, /past its RULING 53 window/i],
  },
  {
    id: "credential-missing",
    remedy:
      "A required secret is not set in this job's environment. Add it to the step's `env:` block; a " +
      "repository secret that exists is still invisible to a step that does not name it.",
    shapes: [/is not set in this job's environment/i, /secret [A-Z_]+ not set/i, /missing (api )?key/i],
  },
  {
    id: "gate-suite-failed",
    remedy:
      "The test suite refused the change. The failing assertions are named above this line; each " +
      "one states what it expected and what it saw. Nothing here is a flake to re-run past.",
    shapes: [/✖ failing tests:/, /ELIFECYCLE\s+Test failed/],
  },
  {
    /*
     * Added 2026-08-28, the day this class was diagnosed as UNKNOWN while the
     * log said exactly what was wrong. Production was two migrations behind the
     * merged code, and the shape that makes it dangerous is that NOTHING LOOKED
     * BROKEN: every insert naming a column those migrations add failed, the
     * route caught it, and the page was still served. A reader saw a working
     * site while the writes went nowhere.
     *
     * The remedy names BOTH orderings on purpose. Migrate-always-first is wrong
     * for a contract migration, whose whole point is that it must not precede
     * the code that stops needing what it removes.
     */
    id: "schema-out-of-sync",
    remedy:
      "Production is missing a committed migration, named above by tag. If it is EXPAND, apply it " +
      "BEFORE the code deploys: `corepack pnpm db:apply --target=production`. If it is CONTRACT, the " +
      "deploy goes first and the migration follows — `lib/db/migration-phases.ts` carries the phase, " +
      "derived from the migration's own SQL. Nothing here is a flake: the page will keep rendering " +
      "while the writes fail, so a green-looking site is not evidence against it.",
    shapes: [/OUT OF SYNC/, /NOT APPLIED\s+\d{4}_/, /committed migration\(s\) NOT APPLIED/i],
  },
];

export type DiagnosisVerdict = "KNOWN" | "UNKNOWN";

export interface Diagnosis {
  readonly verdict: DiagnosisVerdict;
  readonly classes: readonly FailureClass[];
  /** Ready to print. Always populated, for both verdicts. */
  readonly message: string;
}

/**
 * Read a job log and name what killed it.
 *
 * EVERY matching class is reported, not the first (RULING 164). A run that hit
 * a credential problem AND a stale source has two things wrong with it, and
 * naming one sends the reader back for a second round.
 */
export function diagnose(log: string, tail: readonly string[] = []): Diagnosis {
  const hits = FAILURE_CLASSES.filter((c) => c.shapes.some((s) => s.test(log)));

  if (hits.length > 0) {
    const lines = [
      `diagnose: ${hits.length} known failure class(es) recognised in this job's log.`,
      "",
      ...hits.flatMap((c) => [`  [${c.id}]`, `    ${c.remedy}`, ""]),
    ];
    return { verdict: "KNOWN", classes: hits, message: lines.join("\n") };
  }

  const lines = [
    "diagnose: THIS FAILURE IS NOT ONE THIS REPOSITORY RECOGNISES.",
    "",
    "  That is the most interesting kind and it is said loudly on purpose: an unrecognised",
    "  failure is indistinguishable from an understood one when nothing names it. Read the",
    "  lines below, then add its shape and its remedy to lib/ops/failure-classes.ts so the",
    "  next run diagnoses itself.",
    "",
    ...(tail.length > 0
      ? ["  the last lines this reader saw:", ...tail.map((l) => `    ${l}`)]
      : ["  (no log tail was captured — that is itself a defect in the diagnosing step)"]),
  ];
  return { verdict: "UNKNOWN", classes: [], message: lines.join("\n") };
}
