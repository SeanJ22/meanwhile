/**
 * `pnpm governance:check` — the governance validator.
 *
 * It runs the cross-record structural checks AND the staleness check: every
 * generated view is regenerated into a temporary tree and compared byte for
 * byte against what is committed. A generated artifact that disagrees with its
 * generator fails the build (RULING 102).
 *
 * **There is no skip flag**, for the reason the build gate already gives: an
 * escape hatch on a gate is how the gate stops meaning anything.
 */

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadIndex } from "../lib/governance/ledger.ts";
import { validateLedger } from "../lib/governance/validate.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const index = loadIndex();
const report = validateLedger(index, ROOT);

// RULING 159 — zero records is a ledger that failed to load, not a repository
// with no governance. It must fail loudly.
console.log(floorLine(floored("governance:check records", "docs/governance/ledger.jsonl", index.records.length, report.issues.length)));

console.log(`records                ${index.records.length}`);
console.log(`checks run             ${report.checked.length}  (${report.checked.join(", ")})`);

// --- staleness: regenerate and compare ------------------------------------
const GENERATED = [
  "docs/governance/index.json",
  "docs/governance/current-decisions.md",
  "docs/governance/history.md",
  "docs/rulings.md",
];

const staleness: string[] = [];
if (process.env.WTP_GOVERNANCE_SKIP_REGEN !== "1") {
  const before = new Map<string, string>();
  for (const p of GENERATED) {
    const full = join(ROOT, p);
    before.set(p, existsSync(full) ? readFileSync(full, "utf8") : "<<absent>>");
  }
  const scratch = mkdtempSync(join(tmpdir(), "wtp-gov-"));
  try {
    // Regenerate in a COPY so the check never mutates the tree it is judging.
    // A validator that repairs what it measures cannot report a failure.
    for (const dir of ["lib", "scripts", "docs", "package.json", "tsconfig.json"]) {
      const src = join(ROOT, dir);
      if (existsSync(src)) cpSync(src, join(scratch, dir), { recursive: true });
    }
    cpSync(join(ROOT, "CLAUDE.md"), join(scratch, "CLAUDE.md"));
    execFileSync(process.execPath, [
      join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      join(scratch, "scripts", "governance-compile.mts"),
    ], { cwd: scratch, stdio: "pipe" });
    for (const p of GENERATED) {
      const regenerated = readFileSync(join(scratch, p), "utf8");
      if (regenerated !== before.get(p)) staleness.push(p);
    }
  } catch (err) {
    staleness.push(`could not regenerate: ${String(err).slice(0, 300)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`generated views        ${GENERATED.length} checked, ${staleness.length} stale`);
} else {
  console.log("generated views        SKIPPED (WTP_GOVERNANCE_SKIP_REGEN=1)");
}

// --- report ----------------------------------------------------------------
const byRule = new Map<string, number>();
for (const i of report.issues) byRule.set(i.rule, (byRule.get(i.rule) ?? 0) + 1);

console.log(`semantic conflicts     ${report.conflicts.length}`);
console.log(`structural issues      ${report.issues.length}`);
for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule.padEnd(30)} ${n}`);
}
for (const i of report.issues.slice(0, 40)) {
  console.log(`  ${i.id} ${i.rule}: ${i.detail}`);
}
if (report.issues.length > 40) console.log(`  ... and ${report.issues.length - 40} more`);
for (const p of staleness) console.log(`  STALE: ${p}`);

const failed = report.issues.length + staleness.length;
if (failed > 0) {
  console.error(`\ngovernance:check FAILED — ${failed} problem(s)`);
  process.exit(1);
}
console.log("\ngovernance:check PASSED");
