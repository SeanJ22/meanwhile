/**
 * `pnpm orchestration:check` — the engineering-team validator (RULING 190).
 *
 * It reads every session orchestration plan in `data/workstate/orchestration/`
 * and derives, per plan, whether independent executable work was serialized
 * without a proven dependency.
 *
 * **What it does NOT measure.** It does not count branches. A branch count
 * rewards fragmentation, and three branches rewriting one module is worse than
 * one branch rather than better. The semantic checked is the rule itself:
 * independent + executable + serialized with nothing checkable behind it.
 *
 * **The observability limit, stated rather than hidden.** Wall-clock
 * concurrency is not observable from this repository, so a plan declaring
 * `PARALLEL` is taken at its word. What is checked is the shape of the plan and
 * the justification of every serialization — the two things actually written
 * down. `concurrencyEvidence` is reported as corroboration and never scored.
 *
 *   pnpm orchestration:check          check every plan on disk
 *   pnpm orchestration:check --plan <path>
 *
 * A repository with no plan on disk is not a failure — most sessions carry one
 * workstream. A plan that exists and cannot be evaluated IS a failure, because
 * an uncheckable plan is not evidence that the rule was followed.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyOrchestration,
  type OrchestrationPlan,
} from "../lib/workstate/orchestration.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_DIR = join(ROOT, "data", "workstate", "orchestration");

const argv = process.argv.slice(2);
const explicit = argv.includes("--plan") ? argv[argv.indexOf("--plan") + 1] : null;

const planPaths = explicit
  ? [explicit]
  : existsSync(PLAN_DIR)
    ? readdirSync(PLAN_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => join(PLAN_DIR, f))
    : [];

if (planPaths.length === 0) {
  console.log("orchestration:check   no session plan on disk");
  console.log("                      a single-workstream session owes none (RULING 190)");
  console.log("\norchestration:check PASSED");
  process.exit(0);
}

let failed = 0;

for (const p of planPaths) {
  const plan = JSON.parse(readFileSync(p, "utf8")) as OrchestrationPlan;
  const v = classifyOrchestration(plan);
  const rel = p.replace(ROOT, "").replace(/^[\\/]/, "").replace(/\\/g, "/");

  console.log(`\n${"=".repeat(72)}`);
  console.log(`PLAN                  ${rel}`);
  console.log(`session               ${plan.session}`);
  console.log(`integration owner     ${plan.integrationOwner}`);
  console.log(`status                ${v.status}`);
  console.log(`                      ${v.reason}`);
  console.log(
    `counts                ${v.counts.workstreams} workstream(s), ${v.counts.executable} executable, ` +
      `${v.counts.parallel} parallel, ${v.counts.serialized} serialized, ${v.counts.blocked} blocked, ` +
      `${v.counts.readyForIntegration} ready, ${v.counts.integrated} integrated`,
  );
  console.log(`independent pairs     ${v.independentPairs.length}`);

  for (const w of plan.workstreams) {
    const deps = w.dependsOn.length > 0 ? ` <- ${w.dependsOn.join(", ")}` : "";
    console.log(`  ${w.id.padEnd(28)} ${w.disposition.padEnd(22)}${deps}`);
    if (w.disposition === "BLOCKED") console.log(`  ${" ".repeat(28)} wall: ${w.blockedReason}`);
    for (const e of w.concurrencyEvidence ?? []) {
      console.log(`  ${" ".repeat(28)} evidence: ${e}`);
    }
  }

  // Unproven dependencies are REPORTED, never fatal. The session may hold a
  // correctness reason the repository cannot see; the instrument's job is to
  // make it say so out loud, not to overrule it.
  if (v.unprovenDependencies.length > 0) {
    console.log(`\n  unproven dependencies ${v.unprovenDependencies.length} (reported, not fatal)`);
    for (const f of v.unprovenDependencies) console.log(`    ${f.rule}: ${f.detail}`);
  }

  if (v.findings.length > 0) {
    console.log(`\n  FINDINGS ${v.findings.length}`);
    for (const f of v.findings) console.log(`    ${f.rule}: ${f.detail}`);
  }

  if (v.status === "UNJUSTIFIED_SERIALIZATION" || v.status === "MALFORMED_PLAN") failed += 1;
}

console.log();
if (failed > 0) {
  console.error(`orchestration:check FAILED — ${failed} plan(s) violate RULING 190`);
  process.exit(1);
}
console.log("orchestration:check PASSED");
