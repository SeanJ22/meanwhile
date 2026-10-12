/** The required-check contexts, and the workflow rename that would disarm them: a required check is registered by name. */

import { parse } from "yaml";

/** The workflow whose jobs report the required contexts. */
export const REQUIRED_CHECKS_WORKFLOW = ".github/workflows/build-check.yml";

/** The contexts branch protection requires, re-exported; the list lives in `required-contexts.ts`, which imports nothing. */
export { REQUIRED_CONTEXTS } from "./required-contexts.ts";

type JobSpec = {
  name?: unknown;
  strategy?: { matrix?: Record<string, unknown> } | unknown;
};

/** Every check-run name the workflow reports, matrix legs expanded; any unsupported expression form is refused, never guessed. */
export function contextsProducedByWorkflow(source: string, eventName = "pull_request"): string[] {
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
      produced.push(substitute(template, leg, key, eventName));
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

/** Matrices computed at run time, with every leg each can produce; an expression not listed is refused. */
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

/** The one event expression a name may carry: a prefix that keeps scheduled runs off the required contexts. */
const EVENT_PREFIX = /\$\{\{\s*github\.event_name\s*==\s*'([A-Za-z_]+)'\s*&&\s*'([^']*)'\s*\|\|\s*''\s*\}\}/g;

function substitute(template: string, leg: Record<string, string>, jobKey: string, eventName: string): string {
  const prefixed = template.replace(EVENT_PREFIX, (_whole, event: string, text: string) => (event === eventName ? text : ""));
  const filled = prefixed.replace(MATRIX_EXPRESSION, (_whole, key: string) => {
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
