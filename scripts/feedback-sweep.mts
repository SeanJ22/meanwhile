/**
 * `pnpm feedback:sweep` — THE OWNER-PASS GATE, AND THE SWEPT.md VIEW.
 * (Session B, WS2.5, 2026-08-30.)
 *
 * ## What it refuses
 *
 * **A date folder, or an item inside one, that a sweep neither PROCESSES nor
 * lists as UNIDENTIFIABLE.** That is the whole gate. Silence about an owner's
 * item is the one disposition refused, because silence is what a deferral
 * decays into — the A.1 sweep accounted for all twenty 8.30.26 captures as
 * "unidentifiable, deferred", which is an honest accounting and is not a
 * sweep.
 *
 * ## The two halves, and why they live in different places
 *
 * ```
 *   data/feedback/sweeps/<M.D.YY>.json   COMMITTED. The authority.
 *   feedback/SWEPT.md                    GENERATED, beside the owner's own
 *                                        folders, for the owner to read.
 * ```
 *
 * `feedback/` is gitignored — RULING 20 refuses committed binaries and the
 * owner's captures are binaries — so a gate on CI cannot read anything in
 * there. The committed JSON is therefore the authority and `SWEPT.md` is its
 * rendering. **Nothing is ever written INSIDE an owner date folder**: that
 * folder is the owner's input, and a machine writing into it makes the input
 * unreadable as input.
 *
 * `--check` validates and exits non-zero. With no flag it also writes
 * `feedback/SWEPT.md` when the owner folder is present locally.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import {
  checkSweepGate,
  countSweep,
  type SweepRecord,
} from "../lib/feedback/sweep.ts";

const ROOT = process.cwd();
const SWEEPS = join(ROOT, "data", "feedback", "sweeps");
const FEEDBACK = join(ROOT, "feedback");
const CHECK = process.argv.includes("--check");

/** Owner date folders present on this machine. Empty on CI, by design. */
function ownerFolders(): string[] {
  if (!existsSync(FEEDBACK)) return [];
  return readdirSync(FEEDBACK, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{1,2}\.\d{1,2}\.\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

function sweeps(): SweepRecord[] {
  if (!existsSync(SWEEPS)) return [];
  return readdirSync(SWEEPS)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => JSON.parse(readFileSync(join(SWEEPS, n), "utf8")) as SweepRecord);
}

const records = sweeps();
const folders = ownerFolders();

/*
 * The gate is asked about the union, not about whichever list is longer. A
 * folder with no record is the seeded failure; a recorded sweep whose folder is
 * absent is fine and expected — CI has no owner folders at all, and the record
 * is what survives.
 */
const verdict = checkSweepGate(folders, records);

console.log(`feedback:sweep · ${records.length} recorded sweep(s), ${folders.length} owner folder(s) on disk`);
for (const sweep of records) {
  const c = countSweep(sweep);
  console.log(
    `  ${sweep.folder} · ${c.filesInventoried} file(s) inventoried · ${c.itemsFound} item(s) — ` +
      `${c.verifiedFixed} verified fixed, ${c.openBlocked} open with a named blocker, ` +
      `${c.positivesKept} positive kept, ${c.unidentifiable} unidentifiable`,
  );
  /*
   * RULING 159: every count this prints states its own denominator, and an
   * empty population states WHY rather than rendering a bare zero. It matters
   * most on exactly the number a reader of this report cares about — an owner
   * pass with nothing fixed and an owner pass with nothing reported are
   * different facts and "0" says the same thing for both.
   */
  console.log(
    `      the pair — ${floorLine(
      floored(
        "items the owner reported wrong, verified fixed on the rendered surface",
        `the ${sweep.folder} sweep`,
        c.reportedDefects,
        c.verifiedFixed,
        c.reportedDefects === 0 ? "this pass reported no defects at all" : undefined,
      ),
    )}`,
  );
  console.log(
    `      class instances — ${floorLine(
      floored(
        "instances of a reported class, fixed",
        `the ${sweep.folder} sweep`,
        c.instancesFound,
        c.instancesFixed,
        c.instancesFound === 0
          ? "no item in this pass has had its class swept for other instances yet"
          : undefined,
      ),
    )}`,
  );
  console.log(
    `      processed — ${floorLine(
      floored(
        "items processed rather than left unidentifiable",
        `the ${sweep.folder} sweep`,
        c.itemsFound,
        c.itemsProcessed,
        c.itemsFound === 0 ? "the pass carried no items" : undefined,
      ),
    )}`,
  );
}

if (verdict.problems.length > 0) {
  console.error(`\nfeedback:sweep · REFUSED — ${verdict.problems.length} problem(s):`);
  for (const p of verdict.problems) console.error(`  · ${p}`);
}

/* ------------------------------------------------------------- the view */

if (!CHECK && existsSync(FEEDBACK) && records.length > 0) {
  const out: string[] = [
    "# SWEPT — owner feedback passes, and what happened to each item",
    "",
    "Machine-owned. Generated by `pnpm feedback:sweep` from",
    "`data/feedback/sweeps/*.json`, which is the committed authority. Nothing is",
    "ever written inside an owner date folder.",
    "",
    "A date folder, or an item inside one, that a sweep neither processes nor",
    "lists as unidentifiable fails the gate. Silence about an item is refused.",
    "",
  ];
  for (const sweep of records) {
    const c = countSweep(sweep);
    out.push(`## ${sweep.folder} — swept at \`${(sweep.sweptAtSha ?? "unknown").slice(0, 12)}\` on ${sweep.sweptAt}`);
    out.push("");
    out.push(
      `**${c.reportedDefects} reported wrong · ${c.verifiedFixed} verified fixed on the rendered surface.**`,
    );
    out.push("");
    out.push(
      `${c.filesInventoried} file(s) inventoried · ${c.itemsFound} item(s) found · ` +
        `${c.itemsProcessed} processed · ${c.unidentifiable} unidentifiable · ` +
        `${c.openBlocked} open with a named blocker · ${c.positivesKept} positive kept.`,
    );
    out.push("");
    out.push("| Item | Surface | Zip | Class | Disposition | Instances found / fixed | Check |");
    out.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const i of sweep.items) {
      out.push(
        `| \`${i.id}\` | ${i.surface} | ${i.zip ?? "—"} | ${i.failureClass} | ${i.disposition} | ` +
          `${i.instancesFound} / ${i.instancesFixed} | ${i.checkId ?? "—"} |`,
      );
    }
    out.push("");
    const open = sweep.items.filter((i) => i.blocker);
    if (open.length > 0) {
      out.push(`### Open, with the exact blocker (${open.length})`);
      out.push("");
      for (const i of open) {
        out.push(`- **\`${i.id}\` — ${i.reported}**`);
        out.push(`  - ${i.blocker}`);
      }
      out.push("");
    }
    out.push("### Files inventoried");
    out.push("");
    for (const f of sweep.filesInventoried) out.push(`- \`${f}\``);
    out.push("");
  }
  mkdirSync(FEEDBACK, { recursive: true });
  writeFileSync(join(FEEDBACK, "SWEPT.md"), out.join("\n"), "utf8");
  console.log(`\n  wrote feedback/SWEPT.md`);
}

if (!verdict.passed) process.exit(1);
console.log("\nfeedback:sweep · every owner pass on disk is recorded, and every item is disposed");
