/**
 * THE REQUIRED-CHECK CONTEXTS, AND THE RENAME THAT WOULD DISARM THEM.
 * (`NS20`/`NS21`, 2026-08-25. RULING 156.)
 *
 * **A required status check is registered by NAME, and a name is a string
 * somebody can edit.**
 *
 * Branch protection on `main` requires three contexts. Two of them are matrix
 * legs — `build (default)` and `build (standalone)` — and the third,
 * `gates (test · lint · tsc)`, carries a middot-separated display name that a
 * tidying edit would change without a second thought. GitHub matches a required
 * context against the check-run name a workflow reports, as a literal string.
 * Rename the job and the produced check is a DIFFERENT context: the required
 * one never arrives, and a required check that never arrives is not a blocked
 * merge — GitHub simply has nothing to wait for. **Protection disarms itself,
 * silently, with nothing anywhere going red.**
 *
 * That is the same shape as the hole RULING 155 was adopted over: a gate that
 * reported nothing because it was not running, rather than a gate that failed.
 *
 * **The anchor is the WORKFLOW FILE** (RULING 147 — no reconciliation may
 * compare a parser to itself). `REQUIRED_CONTEXTS` below is the list read back
 * from the GitHub API, and `contextsProducedByWorkflow` derives what the
 * workflow ACTUALLY reports by parsing the workflow's own job names and
 * expanding its matrix. Re-deriving one from the other would prove only that
 * the file equals itself and would agree with a rename on every run.
 *
 * A rename is not forbidden. It has to move BOTH — the workflow and this list
 * — in one diff, and then be re-registered on the branch. That is the same
 * mechanism `tests/guard-census.json` uses to let a guard leave: leaving is
 * allowed, leaving silently is not.
 */

import { parse } from "yaml";

/** The workflow whose jobs report the required contexts. */
export const REQUIRED_CHECKS_WORKFLOW = ".github/workflows/build-check.yml";

/**
 * The contexts branch protection requires, re-exported so every existing
 * importer is unchanged.
 *
 * THE LIST LIVES IN `required-contexts.ts`, which imports nothing, because
 * `scripts/certified-tree.mjs` reads it BEFORE `pnpm install` and this module
 * imports `yaml`. Run 34160631768 is the measurement: the tree-equivalence
 * step answered FULL on `Cannot find package yaml` and the attestation could
 * never have fired. Splitting the data from the parser is not a second table —
 * there is one list, and it has one home.
 */
export { REQUIRED_CONTEXTS } from "./required-contexts.ts";

type JobSpec = {
  name?: unknown;
  strategy?: { matrix?: Record<string, unknown> } | unknown;
};

/**
 * Every check-run name the workflow reports, with matrix legs expanded.
 *
 * A job's reported name is its `name:` when it has one and its key otherwise,
 * with `${{ matrix.<key> }}` substituted per leg. Anything else in a name —
 * another expression form, a nested include — is REFUSED rather than guessed
 * at, because a parser that quietly dropped a leg would under-report the
 * produced set and make a rename look like agreement.
 */
export function contextsProducedByWorkflow(source: string): string[] {
  const doc = parse(source) as { jobs?: Record<string, JobSpec> } | null;
  const jobs = doc?.jobs;
  if (!jobs || typeof jobs !== "object") {
    throw new Error(
      `${REQUIRED_CHECKS_WORKFLOW}: no \`jobs:\` block could be parsed — ` +
        `refusing to report an empty produced set, which would read as agreement.`,
    );
  }

  const produced: string[] = [];
  for (const [key, job] of Object.entries(jobs)) {
    const template = typeof job?.name === "string" ? job.name : key;
    const matrix = matrixOf(job);
    for (const leg of expandMatrix(matrix)) {
      produced.push(substitute(template, leg, key));
    }
  }
  return produced.sort();
}

function matrixOf(job: JobSpec): Record<string, unknown> {
  const strategy = job?.strategy;
  if (!strategy || typeof strategy !== "object") return {};
  const matrix = (strategy as { matrix?: unknown }).matrix;
  if (!matrix || typeof matrix !== "object") return {};
  return matrix as Record<string, unknown>;
}

/**
 * Matrices admission computes at run time, with EVERY leg each can produce.
 * The test matrix is `["affected"]` for a pull request's affected tests and
 * the four shards otherwise (`TEST_LEGS` in scripts/ci-affected-tests.mjs;
 * tests/ci-affected-tests.test.ts holds the two lists equal). An expression
 * not listed here is refused, never skipped.
 */
export const DYNAMIC_MATRIX_LEGS: Readonly<Record<string, readonly string[]>> = {
  "${{ fromJSON(needs.admission.outputs.test_legs) }}": ["affected", "1/4", "2/4", "3/4", "4/4"],
};

/** One entry per matrix leg; a job with no matrix has exactly one leg. */
function expandMatrix(matrix: Record<string, unknown>): Array<Record<string, string>> {
  let legs: Array<Record<string, string>> = [{}];
  for (const [key, declared] of Object.entries(matrix)) {
    /* `include`/`exclude` are not used here; refuse rather than mis-expand. */
    if (key === "include" || key === "exclude") {
      throw new Error(
        `${REQUIRED_CHECKS_WORKFLOW}: matrix \`${key}\` is not supported by this ` +
          `reader. Expand it here before using it, or the produced set is wrong.`,
      );
    }
    let raw = declared;
    if (typeof raw === "string") {
      const known = DYNAMIC_MATRIX_LEGS[raw.trim()];
      if (!known) {
        throw new Error(
          `${REQUIRED_CHECKS_WORKFLOW}: matrix \`${key}\` is the expression \`${raw}\`, ` +
            `whose legs this reader does not know. List them in DYNAMIC_MATRIX_LEGS.`,
        );
      }
      raw = known;
    }
    if (!Array.isArray(raw)) continue;
    const next: Array<Record<string, string>> = [];
    for (const leg of legs) {
      for (const value of raw) next.push({ ...leg, [key]: String(value) });
    }
    legs = next;
  }
  return legs;
}

const MATRIX_EXPRESSION = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g;

function substitute(template: string, leg: Record<string, string>, jobKey: string): string {
  const filled = template.replace(MATRIX_EXPRESSION, (_whole, key: string) => {
    const value = leg[key];
    if (value === undefined) {
      throw new Error(
        `${REQUIRED_CHECKS_WORKFLOW}: job \`${jobKey}\` names \`matrix.${key}\` ` +
          `and the matrix does not define it.`,
      );
    }
    return value;
  });
  if (filled.includes("${{")) {
    throw new Error(
      `${REQUIRED_CHECKS_WORKFLOW}: job \`${jobKey}\` reports a name this reader ` +
        `cannot resolve (\`${template}\`). Teach it the expression rather than ` +
        `letting the produced set silently disagree with the branch.`,
    );
  }
  return filled;
}
