/**
 * `pnpm governance:open --task <domain>` — session open on CURRENT authority.
 *
 * It prints the root constitution's rules, the current policy for the task's
 * domain, active decisions, unresolved conflicts, the governance snapshot, and
 * — where a workstream exists — canonical work state and the exact cursor.
 *
 * **It does not print the history.** RULING 186. History is retrieved on
 * demand, by asking *why*, and the whole point of the remediation is that a
 * session no longer has to read 80,000 words of chronology to find out what is
 * true.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { findClaimConflicts, CLAIM_KEYS, currentClaims } from "../lib/governance/claims.ts";
import { loadIndex } from "../lib/governance/ledger.ts";
import { CURRENT_STATUSES, DOMAINS } from "../lib/governance/schema.ts";
import { ELIGIBLE_EDGE_VERSION } from "../lib/workstate/eligibility.ts";
import { generateHandoff, type Workstream } from "../lib/workstate/workstream.ts";
import { floored } from "../lib/ops/denominator-floor.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const taskArg = argv[argv.indexOf("--task") + 1];
const task = argv.includes("--task") && taskArg && !taskArg.startsWith("--") ? taskArg : null;
const wantWork = !argv.includes("--no-work");

if (task && !DOMAINS.includes(task as never)) {
  console.error(`unknown task domain: ${task}`);
  console.error(`known: ${DOMAINS.join(", ")}`);
  process.exit(2);
}

const index = loadIndex();
const snapshot =
  (JSON.parse(readFileSync(join(ROOT, "docs", "governance", "index.json"), "utf8")) as {
    snapshot: string;
  }).snapshot ?? "unknown";

const current = index.records.filter((r) => CURRENT_STATUSES.includes(r.status));
const law = current.filter((r) => r.kind === "LAW_DECISION");
const decisions = current.filter((r) => r.kind === "DECISION");

// RULING 159 — a session brief built from zero current law is a broken load,
// never a repository with no rules.
floored("governance:open current law", "the compiled current authority", current.length, law.length);

console.log("=".repeat(72));
console.log(`SESSION START — governance snapshot ${snapshot}`);
console.log("=".repeat(72));
// Since 2026-09-25 Sean's standing decisions are docs/rulings.md and CLAUDE.md
// is the working guide that applies them; everything this script prints from
// the ledger is historical evidence (docs/rulings.md §9), not current law.
console.log("AUTHORITY");
console.log("  1 Sean's current explicit instructions");
console.log("  2 docs/rulings.md — Sean's standing decisions, the single source for owner policy");
console.log("  3 CLAUDE.md (AGENTS.md for Codex) — the working guide that applies them");
console.log("  Everything below is the governance ledger: historical evidence, not an");
console.log("  independently active instruction.");
console.log("");
console.log(`task domain            ${task ?? "(none given — pass --task <domain>)"}`);
console.log(`ledger law records     ${law.length} ACTIVE in the ledger`);
console.log(`ledger decisions       ${decisions.length}`);
console.log(`historical records     ${index.records.length - current.length} (NOT loaded — ask why)`);
console.log("");

console.log("READ NOW");
console.log("  docs/rulings.md");
console.log("  CLAUDE.md");
console.log("LEDGER VIEWS FOR THIS TASK (historical evidence)");
if (task) console.log(`  docs/governance/policies/${task}.md   (${law.filter((r) => r.domain === task).length} rules)`);
else for (const d of DOMAINS) console.log(`  docs/governance/policies/${d}.md`);
if (decisions.length) console.log("  docs/governance/current-decisions.md");
console.log("");

// The compiled answer to every declared rule slot. This is the part that used
// to require chronological archaeology.
console.log("CURRENT ANSWERS TO THE DECLARED RULE SLOTS");
const answers = currentClaims(index.records);
for (const k of CLAIM_KEYS) {
  const a = answers.get(k.key);
  const val = a ? `${a.value}   [${a.by}]` : "UNSET — no active record answers this";
  console.log(`  ${k.key.padEnd(34)} ${val}`);
  console.log(`  ${" ".repeat(34)} ${k.question}`);
}
console.log("");

const conflicts = findClaimConflicts(index.records);
console.log(`UNRESOLVED GOVERNANCE CONFLICTS   ${conflicts.length}`);
for (const c of conflicts) {
  console.log(`  ${c.key}: ${c.holders.map((h) => `${h.id}=${h.value}`).join(" | ")}`);
}
const uncertain = index.records.filter((r) => r.uncertain.length > 0);
console.log(`RECORDS WITH UNCERTAIN PROVENANCE ${uncertain.length} (none of them bind)`);
console.log("");

// --- workstream and method state ------------------------------------------
if (wantWork) {
  const wsDir = join(ROOT, "data", "workstate");
  if (existsSync(wsDir)) {
    const files = readdirSync(wsDir).filter((f) => f.endsWith(".json") && f !== "migration-summary.json");
    for (const f of files) {
      const w = JSON.parse(readFileSync(join(wsDir, f), "utf8")) as Workstream;
      const h = generateHandoff(
        w,
        { today: process.env.WTP_TODAY ?? "2026-08-26", methodVersion: w.methodVersion, eligibleEdgeVersion: ELIGIBLE_EDGE_VERSION },
        // A session OPEN is not a session close, so no stopping claim is made
        // here. The status shown is the one the state supports for the run
        // being resumed, and the real verdict is computed at close.
        "EARLY_HANDOFF",
      );
      console.log("");
      console.log(`WORKSTREAM             ${w.id}`);
      console.log(`  status               ${h.workstream}`);
      console.log(`  graph                ${h.graph}`);
      console.log(`  resume cursor        ${h.resumeCursor ?? "(none — this is a defect)"}`);
      console.log(`  open children        ${h.open.length}`);
      console.log(`  blocked              ${h.blocked.length}`);
      console.log(`  discovered/unworked  ${h.discoveredNotProcessed.length}`);
      console.log(`  recheck due          ${h.recheckDue.length}`);
      console.log(`  permission unread    ${h.permissionUnresolved.length}`);
      console.log(
        `  candidates           ${h.candidates.candidates} lead(s), ` +
          `${h.candidates.promoted} promoted body/bodies  <- the coverage numerator`,
      );
    }
  }
}

console.log("");
console.log("HISTORY IS NOT LOADED. Ask for it by name when you need to know WHY:");
console.log("  docs/governance/history.md      full narrative, all records");
console.log("  docs/governance/rulings-index.md  the historical RULING n index");
console.log("  docs/governance/ledger.jsonl    canonical store");
