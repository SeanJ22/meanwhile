/** Explain the admission decision without claiming omitted work passed. */
import { appendFileSync } from 'node:fs';

const tier = process.env.CI_TIER;
const explanation = {
  yes: 'Full certification selected: lint, fresh-checkout types, governance and evidence, both build configurations, every test file across four isolated shards, schema gate and final live release-integrity verification. File-impact selection is not enabled: uncertain and shared changes receive the full suite.',
  draft: 'Draft structural certification selected: preflight, lint, fresh-checkout types, governance and generated-state checks. Builds, browser tests and shipping-only gates are deliberately unneeded for a draft; ready_for_review requires a fresh full certification.',
  'no-certified': 'Exact-tree main-push attestation selected by the fail-closed ancestry/tree/required-context verifier. Expensive checks are deliberately unneeded only because that exact tree already has full certification. No cached output is being represented as new proof.',
  'no-preflight': 'Admission refused: deterministic preflight failed. Expensive work is withheld, and the existing required final status fails. Withheld work is not a passing check.',
}[tier] ?? 'Admission is missing or invalid. No successful certification is established.';
const report = `## Verification selection\n\n${explanation}\n\nThe early production-integrity prerequisite can still refuse a full run before expensive jobs start. The required final status rejects failed, cancelled or missing selected work and repeats the live integrity check.\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
