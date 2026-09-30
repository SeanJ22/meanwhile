/** Explain the admission decision without claiming omitted work passed. */
import { appendFileSync } from 'node:fs';

const tier = process.env.CI_TIER;
const explanation = {
  yes: 'Full certification selected: lint, fresh-checkout types, governance and evidence, both build configurations, every test file across four isolated shards, schema compatibility. File-impact selection is not enabled: uncertain and shared changes receive the full suite.',
  draft: 'Draft structural certification selected: preflight, lint, fresh-checkout types, governance and generated-state checks. Builds, browser tests and shipping-only gates are deliberately unneeded for a draft; ready_for_review requires a fresh full certification.',
  'no-preflight': 'Admission refused: deterministic preflight failed. Expensive work is withheld, and the existing required final status fails. Withheld work is not a passing check.',
}[tier] ?? 'Admission is missing or invalid. No successful certification is established.';
const report = `## Verification selection\n\n${explanation}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
