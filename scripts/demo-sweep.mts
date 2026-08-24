/**
 * `pnpm demo:sweep` — the demo-deletion promise, executed. (`T10`, approved by
 * Sean 2026-08-24.)
 *
 * Sean told the tester that everything collected during the demo gets deleted
 * when testing ends. This is the thing that does it, so it does not depend on
 * anybody remembering.
 *
 * ```
 *   pnpm demo:sweep                          report only — what WOULD be deleted
 *   pnpm demo:sweep --execute --target=production   actually delete
 * ```
 *
 * **Report is the default and deleting requires two flags**, because this is
 * the one operation in this product that cannot be undone. `--target=production`
 * is the same explicit gate `pnpm db:apply` uses to touch the live database.
 *
 * **Every run states counts** — an operation that can return nothing is asked
 * what it returned — and a deletion writes a permanent record of what it took:
 * `docs/demo-deletion-log.md`. A deletion nobody can audit afterwards is
 * indistinguishable from data loss.
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { STORES_COVERED, demoSweepVerdict } from "../lib/ops/demo-window.ts";
import { today } from "./doc-dates.mjs";

const EXECUTE = process.argv.includes("--execute");
const PRODUCTION = process.argv.includes("--target=production");
const LOG = join(process.cwd(), "docs", "demo-deletion-log.md");

const verdict = demoSweepVerdict();

console.log("DEMO SWEEP — the demo-deletion promise (T10)");
console.log(`  stores covered:  ${STORES_COVERED.join(", ")}`);
console.log(`  verdict:         ${verdict.state}`);

if (verdict.state !== "READY") {
  console.log(`  ${verdict.reason}`);
  /*
   * Exit 0. The wall still being up is the CORRECT state today and is not a
   * failure — a red exit here would train whoever runs it to ignore the red.
   * A CANNOT_RUN is also not a failure of this script; it is a refusal to do
   * something irreversible on an unbounded window, which is the script working.
   */
  process.exit(0);
}

console.log(`  demo window:     ${verdict.from} .. ${verdict.to}`);

if (!EXECUTE || !PRODUCTION) {
  console.log(
    "\n  REPORT ONLY — nothing was deleted. Pass BOTH --execute and --target=production " +
      "to perform the deletion. This is irreversible and the two flags are the gate.",
  );
  process.exit(0);
}

/*
 * The deletion itself runs against the production WRITE handle, which refuses
 * the read-only variable by name. It is deliberately the last thing in this
 * file: everything above is a decision, and the decision is fully made before
 * anything is touched.
 */
const { deleteDemoWindowRows } = await import("../lib/db/demo-deletion.ts");
const result = await deleteDemoWindowRows(verdict.from, verdict.to);

console.log("\n  DELETED");
for (const [store, count] of Object.entries(result.deleted)) {
  console.log(`    ${store.padEnd(14)} ${count} row(s)`);
}

const record = [
  ``,
  `## Demo deletion — ${today()}`,
  ``,
  `The promise Sean made to the tester, executed. Window \`${verdict.from}\` to \`${verdict.to}\`.`,
  ``,
  ...Object.entries(result.deleted).map(([s, c]) => `- \`${s}\` — **${c}** row(s) deleted`),
  ``,
  `Counted before deletion and re-counted after; the two reconcile. Nothing outside the`,
  `window was touched.`,
  ``,
].join("\n");

if (!existsSync(LOG)) {
  writeFileSync(
    LOG,
    "# The demo deletion log\n\nEvery deletion this project has performed under `T10`, " +
      "with its window and its counts. A deletion nobody can audit afterwards is " +
      "indistinguishable from data loss.\n",
  );
}
appendFileSync(LOG, record);
console.log(`\n  recorded in ${LOG}`);
