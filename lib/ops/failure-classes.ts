/** Every job names its own cause before it dies: a job log read into named failure classes with plain remedies. */

/** One recognised way a job in this repository dies. */
export interface FailureClass {
  readonly id: string;
  /** What a reader should do, in plain words. Never "see the logs". */
  readonly remedy: string;
  /** The shapes this class takes in a job log, each proved against a captured log line. */
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
      "chrome-linux/chrome.",
    shapes: [/NO CHROMIUM INSTALLED/i, /Executable doesn't exist at/i, /browserType\.launch/i],
  },
  {
    id: "staleness-guard",
    remedy:
      "A source's oldest serving row crossed its allowed age. Inspect that source's canonical " +
      "attempt, retry/backoff, hold, and LKG receipts in Admin; repair its source-scoped data-plane " +
      "contract. Do not refresh or revert a tracked snapshot and do not dispatch software CI.",
    shapes: [/headroom/i, /oldest row/i],
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
    // Production behind merged migrations looks healthy while writes fail; the remedy names both orderings.
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

/** Read a job log and name what killed it; every matching class is reported, not just the first. */
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
