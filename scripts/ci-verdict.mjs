import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const JOBS = ["admission", "verify", "test", "build"];
const TIERS = ["yes", "draft", "main", "waiting"];
const TEST_PLANS = ["affected", "full", "none"];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Interpret only the completed jobs supplied by GitHub's `needs` context.
 * Admission owns preflight and the test plan. This reducer cannot infer a
 * certification from a missing result or from a skipped job.
 *
 * - draft / waiting: tests and builds are deferred; waiting never certifies.
 * - yes: structural checks, builds and tests are required. A skipped test job
 *   is accepted only when admission's plan says the change reaches no test.
 * - main: the builds and the whole suite (the integration check, since pull
 *   requests run only their affected tests); lint, types and governance ran
 *   on the pull request.
 *
 * @param {unknown} needs
 */
export function evaluate(needs) {
  const jobs = record(needs) ? needs : {};
  const admission = record(jobs.admission) ? jobs.admission : {};
  const outputs = record(admission.outputs) ? admission.outputs : {};
  const tier = typeof outputs.tier === "string" && TIERS.includes(outputs.tier)
    ? outputs.tier : null;
  const plan = typeof outputs.test_plan === "string" && TEST_PLANS.includes(outputs.test_plan)
    ? outputs.test_plan : null;
  const reasons = [];
  if (!record(needs)) reasons.push("CI_NEEDS must be a JSON object containing all dependency results.");
  if (tier === null) reasons.push("admission.outputs.tier is missing or unsupported; no omitted checks are authorized.");

  const admitted = admission.result === "success";
  const checks = JOBS.map((job) => {
    const value = record(jobs[job]) ? jobs[job] : {};
    const result = typeof value.result === "string" ? value.result : "missing";
    const unneeded = admitted && (
      ((tier === "draft" || tier === "waiting") && (job === "test" || job === "build"))
      || (tier === "main" && job === "verify")
      || (tier === "yes" && plan === "none" && job === "test")
    );
    const accepted = result === "success" || (unneeded && result === "skipped");
    const explanation = unneeded
      ? tier === "main" ? "the merged pull request already ran it"
        : tier === "waiting" ? "the tests run when auto-merge is on"
          : tier === "yes" ? "the change reaches no test file"
            : "draft tier defers full builds and tests"
      : "required for this admission";
    if (!accepted) reasons.push(`${job}: ${result}; ${explanation}.`);
    return { job, result, required: !unneeded, accepted, explanation };
  });

  if (tier === "waiting") {
    reasons.push("waiting: lint and types only; turn auto-merge on (or add run-full-ci) to run the tests this PR merges on.");
  }
  return { ok: reasons.length === 0, tier, plan, reasons, checks };
}

function main() {
  let needs;
  try {
    needs = JSON.parse(process.env.CI_NEEDS ?? "");
  } catch {
    console.error("CI verdict: FAIL — CI_NEEDS is missing or invalid JSON.");
    process.exitCode = 1;
    return;
  }
  const verdict = evaluate(needs);
  console.log(`CI verdict: ${verdict.ok ? "PASS" : "FAIL"} — tier ${verdict.tier ?? "unknown"}, tests ${verdict.plan ?? "unplanned"}`);
  for (const check of verdict.checks) {
    console.log(`${check.job}: ${check.result} (${check.explanation})`);
  }
  for (const reason of verdict.reasons) console.error(`BLOCKED: ${reason}`);
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
