/**
 * **REMOVING A SYNTHETIC ROW THAT THE TRANSACTION TEST LEFT IN THE STORE.**
 * (2026-09-01.)
 *
 * `tests/tracker-transaction.test.ts` proves the tracker write is one
 * transaction by actually performing one: it adds a row through the real
 * `pnpm tracker:add`, asserts all five artifacts moved together, and restores
 * every one of them in a `finally`. When that restore does not complete, the
 * synthetic row is left in the working store — and its own description says so:
 *
 * > *"If this row is in a store, the test did not clean up and it should be
 * > removed."*
 *
 * A left-behind row is worse than untidy. `tracker:add` REFUSES a duplicate
 * title, so the next run of that same test fails with a message about an
 * already-open row rather than about the transaction it exists to check — a
 * true statement about the store read as a false one about the code.
 *
 * ## Why this is a script rather than `git checkout`
 *
 * RULING 48, and `scripts/guard-protected-files.mjs` enforces it: **a session
 * may not use git to revert the author's files.** The tracker stores carry his
 * hand edits, git routes around every collision protection the write path has,
 * and on 2026-08-20 a session did exactly that and destroyed both CSVs. An
 * older version is READ and applied FORWARD, which is what this does.
 *
 * It removes ONE named row and its opened-ledger entry, and it refuses
 * everything else: a row whose author is not the test, a row whose description
 * is not the self-identifying one, or a row that has accumulated a resolution
 * or a session record is left exactly where it is and reported.
 *
 *   pnpm tsx scripts/tracker-remove-synthetic-row.mts <ID>
 *   pnpm tsx scripts/tracker-remove-synthetic-row.mts <ID> --write
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { OPENED_JSON, ROOT, WORKING_CSV, readStore, writeStore } from "./tracker-core.mjs";

const WRITE = process.argv.includes("--write");
const ID = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!ID) {
  console.error("usage: pnpm tsx scripts/tracker-remove-synthetic-row.mts <ID> [--write]");
  process.exit(1);
}

/** The exact marks a row must carry to be removable. All of them, not any. */
const TEST_AUTHOR = "tracker-transaction-test";
const SELF_IDENTIFYING = "the test did not clean up and it should be removed";

const rows = readStore(WORKING_CSV, ROOT) as Record<string, string>[];
const row = rows.find((r) => (r.ID ?? "").trim() === ID);

if (!row) {
  console.log(`\n${ID} is not in the working store — nothing to remove.`);
  process.exit(0);
}

const objections: string[] = [];
if ((row["Opened by"] ?? "").trim() !== TEST_AUTHOR) {
  objections.push(`opened by "${row["Opened by"]}", not by ${TEST_AUTHOR}`);
}
if (!String(row["What this is"] ?? "").includes(SELF_IDENTIFYING)) {
  objections.push("the description does not identify itself as test residue");
}
if (String(row.Resolution ?? "").trim()) objections.push("the row carries a resolution");
if (String(row["Session record"] ?? "").trim()) objections.push("the row carries a session record");
if (String(row.Notes ?? "").trim()) objections.push("the row carries notes — those are the author's");

if (objections.length > 0) {
  console.error(`\nREFUSED — ${ID} is not an unmodified synthetic test row:`);
  for (const o of objections) console.error(`  · ${o}`);
  console.error("\nNothing written. A row that has accumulated content is somebody's work.");
  process.exit(1);
}

const kept = rows.filter((r) => (r.ID ?? "").trim() !== ID);
const removed = floored("working-store rows removed", WORKING_CSV, rows.length, rows.length - kept.length);

/* The opened ledger claims ids per session; drop the claim, and drop the entry
   entirely when the id was its only member. */
const ledger = JSON.parse(readFileSync(join(ROOT, OPENED_JSON), "utf8")) as {
  session: string;
  opened: string;
  ids: string[];
}[];
const ledgerKept = ledger
  .map((e) => ({ ...e, ids: (e.ids ?? []).filter((i) => i !== ID) }))
  .filter((e) => e.ids.length > 0);
const ledgerDropped = floored(
  "opened-ledger entries dropped",
  OPENED_JSON,
  ledger.length,
  ledger.length - ledgerKept.length,
);

if (WRITE) {
  writeFileSync(join(ROOT, WORKING_CSV), writeStore(kept), "utf8");
  writeFileSync(join(ROOT, OPENED_JSON), `${JSON.stringify(ledgerKept, null, 2)}\n`, "utf8");
}

console.log(`\nsynthetic row removal — ${WRITE ? "WRITTEN" : "DRY RUN"}`);
console.log(`  id                  ${ID}`);
console.log(`  title               ${row.Title}`);
console.log(`  ${floorLine(removed)}`);
console.log(`  ${floorLine(ledgerDropped)}`);
console.log(`  working store       ${rows.length} -> ${kept.length}`);
if (WRITE) console.log("\n  now run `pnpm tracker:views` so the generated views agree with the store.");
else console.log("\n  nothing written — pass --write");
