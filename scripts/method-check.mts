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
  CLAIM_CLASS_LETTER,
  classificationCoverage,
  currentTruthFor,
  findDependencyFlags,
  findReopenings,
  isIsoDate,
  readCurrentMethod,
  validateKnowledge,
  type MethodKnowledge,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";
import { projectMethodFor, substantiveAssertions } from "../lib/method/projection.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// An explicit path lets the SAME consumer be pointed at a throwaway copy, so a
// migration can be proved by the instrument a future session will actually read
// with, rather than by a paraphrase of it. No argument means the canonical store.
const STORE = process.argv[2] ?? join(ROOT, "data", "method", "knowledge.json");
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

/*
 * **WHAT A FUTURE SESSION IS BEING TAUGHT.** (2026-08-28.)
 *
 * The four claim classes, the dependency flags a withdrawal raises, and — the
 * part that matters most — the CORRECTED CURRENT ANSWER for every withdrawn
 * claim, printed beside it. A consumer reading this must never be able to take
 * a superseded conclusion for a current one.
 */
const cov = classificationCoverage(k);
console.log(
  `  ${floorLine(
    floored("routes declaring a claim class", "data/method/knowledge.json", cov.routes, cov.classified),
  )}`,
);
console.log(`claims declared          ${cov.claims}`);
for (const [cls, n] of Object.entries(cov.byClass)) {
  console.log(`  ${CLAIM_CLASS_LETTER[cls as keyof typeof CLAIM_CLASS_LETTER]}  ${cls.padEnd(20)} ${n}`);
}
console.log(`withdrawn (kept, never deleted)  ${cov.retracted}`);
console.log(
  `UNCLASSIFIED entries     ${cov.unclassified}  — nobody declared a class for these, which is NOT`,
);
console.log(
  "                         the same as their carrying no conclusion; their prose may hold an",
);
console.log("                         undeclared coverage claim or derived conclusion.");

const flags = findDependencyFlags(k);
const stale = flags.filter((f) => f.status === "STALE");
console.log(`dependency flags         ${flags.length}  (${stale.length} STALE, ${flags.length - stale.length} dispositioned)`);
for (const f of flags) {
  console.log(`  ${f.status.padEnd(14)} ${f.dependent}`);
  console.log(`                 rests on ${f.upstream} (${f.upstreamKind} ${f.upstreamOn})`);
}

const withdrawn = readCurrentMethod(k).flatMap((v) => v.retracted.map((r) => r.claim));
if (withdrawn.length > 0) {
  console.log("");
  console.log("CORRECTED CURRENT TRUTH — a withdrawn claim never answers as current:");
  for (const c of withdrawn) {
    const t = currentTruthFor(k, c.id);
    console.log(`  ASKED    ${c.id}`);
    console.log(`  STATUS   ${t.status}`);
    console.log(`  CURRENT  ${t.claim ? t.claim.id : "(none — see what survives)"}`);
    console.log(`           ${(t.claim?.statement ?? c.retraction?.survives ?? "").slice(0, 220)}`);
  }
}

/*
 * **AND WHAT A WORKER ACTUALLY INHERITS.** (2026-08-28.)
 *
 * The block above reports what the STORE holds. This one reports what the
 * consumer read path HANDS OVER, and the two are different numbers on purpose:
 * a withdrawn coverage claim is still held and is never handed over, and 112
 * unclassified entries are handed over as ROUTES with a named gap rather than as
 * conclusions. Printing only the first number is how a correction that the read
 * path does not read looks green. `lib/method/projection.ts`.
 */
const worker = projectMethodFor(k, { state: "az", governmentType: "county" });
console.log("");
console.log("WHAT A WORKER INHERITS (projection for az/county — the consumer read path):");
console.log(`  routes offered                 ${worker.counts.routesInherited}`);
console.log(`  A  route-existence assertions  ${worker.counts.existenceAssertions}`);
console.log(`  B  recorded walks (tuples)     ${worker.counts.observations}`);
console.log(`  B  outcome assertions          ${worker.counts.observationAssertions}`);
console.log(`  C+D substantive, INHERITED     ${substantiveAssertions(worker).length}`);
console.log(`  C+D substantive, WITHHELD      ${worker.counts.withheld}`);
for (const w of worker.withheld) {
  console.log(`     ${w.reason.padEnd(18)} ${w.id}`);
  console.log(`                        -> ${w.correctedBy ?? "(no successor; the retraction names what survives)"}`);
}
console.log(
  `  legacy UNCLASSIFIED routes     ${worker.counts.routesLegacyUnclassified}  — known as ROUTES; their substantive`,
);
console.log("                                 prose is NOT inherited as a conclusion.");

/*
 * Thirteen legacy sub-branches carry prose where the date belongs — the
 * jurisdiction, date, reason and successor were written into each other's slots
 * before this store had a writer. `subbranch-undated` only checks that the
 * field is non-empty, so it passes them. Counted here rather than swept up,
 * because a rule that keys on a date cannot read these and must not pretend to.
 */
const undatedSubBranches = k.routes.flatMap((r) =>
  r.subBranches.filter((sb) => !isIsoDate(sb.failedOn)).map((sb) => `${r.id}: ${sb.failedOn.slice(0, 60)}`),
);
console.log("");
console.log(`sub-branches whose failedOn is not an ISO date   ${undatedSubBranches.length}`);
if (undatedSubBranches.length > 0) {
  console.log("  (legacy rows whose jurisdiction/date/reason/successor were written into each");
  console.log("   other's slots. Reported, not swept: a dated rule cannot read them.)");
}
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
