/**
 * Retire the reader diagnostic that asserted an acquisition gap that does not
 * exist. (Session B closure, 2026-08-31, the author's correction.)
 *
 * `reader-diagnostic:acquisition:rq:22ccea0471ab113e` was opened when the
 * evaluator classed every `NO_EVIDENCE` answer as an acquisition failure. For
 * this question the engine bound NO subject, so nothing was searched — and the
 * diagnostic's own obligation therefore claimed *we hold nothing that answers*
 * about a search that never ran.
 *
 * Measurement says otherwise: `pnpm rollcall:walk` reports **417 roll calls and
 * 2,083 per-person vote rows** held from the Pima tenant, **285 of them for the
 * 2026-08-25 sitting** the question is about. Asking the same question with the
 * body named returns `GROUNDED_CLAUDE` with 60 member-vote records.
 *
 * It is TRANSITIONED and not deleted. A work item that vanishes takes the
 * record of the wrong diagnosis with it, and the next session would have no way
 * to know the class had ever been wrong. The replacement —
 * `reader-diagnostic:identity:rq:22ccea0471ab113e` — is open beside it.
 *
 * Run once. Idempotent: an already-transitioned item is left alone.
 */

import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { transitionWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";

const ROOT = process.cwd();
const STORE = join(ROOT, "data", "control-plane", "pilot-health");
const TARGET = "reader-diagnostic:acquisition:rq:22ccea0471ab113e";
const NOW = new Date().toISOString();

const repos = await createFileRepositories(STORE);
const all = await repos.workItems.list();
const found = all.filter((row) => row.value.obligation === TARGET);

console.log(`retire-false-acquisition-diagnostic · ${found.length} matching item(s)`);

for (const row of found) {
  if (row.value.state !== "OPEN" && row.value.state !== "REOPENED") {
    console.log(`  ${row.id} is already ${row.value.state} — left alone`);
    continue;
  }
  await transitionWorkItem(repos, {
    workItemId: row.id,
    to: "VERIFIED_COMPLETE",
    by: "session-b-closure",
    why:
      "MISDIAGNOSED, and retired rather than deleted. This item asserted an ACQUISITION gap — " +
      "that we hold nothing answering how each supervisor voted on 2026-08-25. We hold 285 " +
      "per-person vote rows for that exact sitting (pnpm rollcall:walk: 417 roll calls and 2,083 " +
      "rows across 20 Pima sittings, three routes walked for every one). The engine returned " +
      "NO_EVIDENCE because it bound no subject, not because it searched and found nothing, and " +
      "the evaluator classed every NO_EVIDENCE as acquisition regardless. The real failure is " +
      "carried by reader-diagnostic:identity:rq:22ccea0471ab113e, which is open.",
    now: NOW,
  });
  console.log(`  ${row.id} → VERIFIED_COMPLETE (misdiagnosis retired)`);
}

const after = await repos.workItems.list();
const open = after.filter(
  (r) => /reader-diagnostic/.test(r.value.obligation) && r.value.state === "OPEN",
);
console.log(`\n  reader diagnostics still OPEN: ${open.length}`);
for (const r of open) console.log(`    ${r.value.obligation}`);
