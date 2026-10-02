/** Explain the admission decision without claiming omitted work passed. */
import { appendFileSync } from 'node:fs';

const tier = process.env.CI_TIER;
const plan = process.env.CI_TEST_PLAN;
const tests = {
  affected: 'the tests this change can reach through its imports and the files that name it, plus every test that sweeps source trees, in one job',
  full: 'every test file across four isolated shards, because the change touches something the import graph does not follow (data, configuration, workflows, the test runner) or the selector was in doubt',
  none: 'no tests, because the change reaches no test file (documentation only)',
}[plan] ?? 'tests as planned by admission (no plan was recorded, so a skipped test job cannot pass)';
const explanation = {
  yes: `Certification selected: one install for lint, fresh-checkout types and governance; the standalone build; ${tests}; schema compatibility. Main re-runs the whole suite after merge.`,
  draft: 'Draft certification selected: preflight, lint and fresh-checkout types. Governance, generated-state checks, builds, browser tests and shipping-only gates wait for the ready pull request; ready_for_review requires a fresh full certification.',
  waiting: 'Ready pull request without auto-merge: preflight, lint and fresh-checkout types. The standalone build and the tests run when auto-merge is turned on or the run-full-ci label is added; until then the final verdict stays red so nothing merges on this run.',
  main: 'Push to main selected: preflight, the standalone build, every test file across four shards (the integration check, since pull requests run only their affected tests) and the schema gate. Lint, types, governance and the default build ran on the merged pull request. A newer push to main supersedes this run.',
  'no-preflight': 'Admission refused: deterministic preflight failed. Expensive work is withheld, and the existing required final status fails. Withheld work is not a passing check.',
}[tier] ?? 'Admission is missing or invalid. No successful certification is established.';
const report = `## Verification selection\n\n${explanation}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
