import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const JOBS = ["admission", "verify", "test", "build"];
const TIERS = ["yes", "draft", "main"];

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Interpret only the completed jobs supplied by GitHub's `needs` context.
 * Admission owns preflight. This reducer cannot
 * infer a certification from a missing result or from a skipped job.
 *
 * @param {unknown} needs
 */
export function evaluate(needs) {
  const jobs = record(needs) ? needs : {};
  const admission = record(jobs.admission) ? jobs.admission : {};
  const outputs = record(admission.outputs) ? admission.outputs : {};
  const tier = typeof outputs.tier === "string" && TIERS.includes(outputs.tier)
    ? outputs.tier : null;
  const reasons = [];
  if (!record(needs)) reasons.push("CI_NEEDS must be a JSON object containing all dependency results.");
  if (tier === null) reasons.push("admission.outputs.tier is missing or unsupported; no omitted checks are authorized.");

  const checks = JOBS.map((job) => {
    const value = record(jobs[job]) ? jobs[job] : {};
    const result = typeof value.result === "string" ? value.result : "missing";
    const unneeded = admission.result === "success" && (
      (tier === "draft" && (job === "test" || job === "build"))
      || (tier === "main" && (job === "test" || job === "verify"))
    );
    const accepted = result === "success" || (unneeded && result === "skipped");
    const explanation = unneeded
      ? tier === "main" ? "the merged pull request already ran it" : "draft tier defers full builds and tests"
      : "required for this admission";
    if (!accepted) reasons.push(`${job}: ${result}; ${explanation}.`);
    return { job, result, required: !unneeded, accepted, explanation };
  });

  return { ok: reasons.length === 0, tier, reasons, checks };
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
  console.log(`CI verdict: ${verdict.ok ? "PASS" : "FAIL"} — tier ${verdict.tier ?? "unknown"}`);
  for (const check of verdict.checks) {
    console.log(`${check.job}: ${check.result} (${check.explanation})`);
  }
  for (const reason of verdict.reasons) console.error(`BLOCKED: ${reason}`);
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
