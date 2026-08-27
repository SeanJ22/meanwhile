/**
 * `pnpm method:check` — the cumulative-knowledge validator.
 *
 * It refuses the failures the remediation brief names, and it reports the one
 * number that says whether the method is compounding: **routes known now**,
 * stated as what the project knows rather than as what exists.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import {
  findReopenings,
  validateKnowledge,
  type MethodKnowledge,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STORE = join(ROOT, "data", "method", "knowledge.json");
const CONCLUSIONS = join(ROOT, "data", "method", "conclusions.json");

if (!existsSync(STORE)) {
  console.error(`no method store at ${STORE} — run \`pnpm method:ingest\``);
  process.exit(1);
}

const k = JSON.parse(readFileSync(STORE, "utf8")) as MethodKnowledge;
const conclusions: PriorConclusion[] = existsSync(CONCLUSIONS)
  ? (JSON.parse(readFileSync(CONCLUSIONS, "utf8")) as PriorConclusion[])
  : [];

const issues = validateKnowledge(k, conclusions);
const reopenings = findReopenings(k, conclusions);

const byPortability: Record<string, number> = {};
for (const r of k.routes) {
  byPortability[r.applicability.portability] = (byPortability[r.applicability.portability] ?? 0) + 1;
}

// RULING 159 — zero routes is a store that failed to load. The project knows
// 61 routes; a report of none is an error, not a finding.
console.log(floorLine(floored("method:check routes", "data/method/knowledge.json", k.routes.length, k.routes.filter((r) => r.applicability).length)));

console.log(`method version           ${k.version}`);
console.log(`routes known now         ${k.routes.length}`);
console.log(`with applicability       ${k.routes.filter((r) => r.applicability).length} of ${k.routes.length}`);
console.log(`by portability           ${JSON.stringify(byPortability)}`);
console.log(`unknown portability      ${byPortability.UNKNOWN ?? 0}  (a VALID state — never a gap to guess at)`);
console.log(`sub-branches retained    ${k.routes.reduce((n, r) => n + r.subBranches.length, 0)}`);
console.log(`retired (never deleted)  ${k.routes.filter((r) => r.retiredOn).length}`);
console.log(`prior conclusions        ${conclusions.length}`);
console.log(`  carrying a version     ${conclusions.filter((c) => typeof c.earnedAtVersion === "number").length}`);
console.log(`  reopened by new routes ${conclusions.filter((c) => c.reopenedBy).length}`);
console.log(`  AWAITING reopening     ${reopenings.length}`);
console.log("");
console.log("NO ROUTE CAP EXISTS. This number is WHAT THE PROJECT KNOWS NOW,");
console.log("never a statement about how many routes there are.");
console.log("");

const byRule = new Map<string, number>();
for (const i of issues) byRule.set(i.rule, (byRule.get(i.rule) ?? 0) + 1);
console.log(`issues                   ${issues.length}`);
for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule.padEnd(30)} ${n}`);
}
for (const i of issues.slice(0, 30)) console.log(`  ${i.id} ${i.rule}: ${i.detail}`);

if (issues.length > 0) {
  console.error(`\nmethod:check FAILED — ${issues.length} problem(s)`);
  process.exit(1);
}
console.log("\nmethod:check PASSED");
