/** Explain the admission decision without claiming omitted work passed. */
import { appendFileSync } from 'node:fs';

const tier = process.env.CI_TIER;
const plan = process.env.CI_TEST_PLAN;
const event = process.env.CI_EVENT_NAME;
const documents = process.env.CI_TEST_SCOPE === 'documents';
const build = process.env.CI_DEPLOY_BUILD === 'no'
  ? 'no application build, because the deploy classification finds no shipping path (the build jobs report without building)'
  : 'the standalone build';
const tests = (documents ? {
  // A change made only of documents.
  affected: 'only the tests that read the changed documents (by name, through a module or script that names them, or by listing the files where they live), in one job; source sweeps do not run for a documents-only change',
  none: 'no tests, because no test file reads the changed documents (documents only)',
} : {
  affected: 'the tests this change can reach through its imports and the files that name it, plus every test that sweeps source trees, in one job',
  none: 'no tests, because the change reaches no test file',
})[plan] ?? {
  full: 'every test file across four isolated shards',
}[plan] ?? 'tests as planned by admission (no plan was recorded, so a skipped test job cannot pass)';
const yes = event === 'schedule'
  ? `Scheduled certification of main (every three hours): one install for lint, fresh-checkout types and governance; ${build}; ${tests}; schema compatibility. This is the integration check behind affected-only pull-request tests.`
  : `Certification selected: one install for lint, fresh-checkout types and governance; ${build}; ${tests}; schema compatibility. The scheduled run re-runs the whole suite on main every three hours.`;
const explanation = {
  yes,
  draft: 'Draft certification selected: preflight, lint and fresh-checkout types. Governance, generated-state checks, builds, browser tests and shipping-only gates wait for the ready pull request; ready_for_review requires a fresh full certification.',
  waiting: 'Ready pull request without auto-merge: preflight, lint and fresh-checkout types. The standalone build and the tests run when auto-merge is turned on or the run-full-ci label is added; until then the final verdict stays red so nothing merges on this run.',
  main: 'Push to main selected: preflight, the standalone build and the schema gate. Lint, types, governance, the affected tests and the default build ran on the merged pull request; the scheduled run re-runs the whole suite on main every three hours.',
  'no-preflight': 'Admission refused: deterministic preflight failed. Expensive work is withheld, and the existing required final status fails. Withheld work is not a passing check.',
}[tier] ?? 'Admission is missing or invalid. No successful certification is established.';
const report = `## Verification selection\n\n${explanation}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
