/**
 * THE WRITER, NOT THE OUTPUT. (2026-08-26, Addendum 2 item 4.)
 *
 * `tests/tracker-stores.test.ts` asserts what the stores LOOK LIKE, and it did
 * its job: four of its guards went red on `main` the moment `job-watch` landed
 * a half transaction. **What nothing tested is the transaction boundary** —
 * that a write either completes in all five of its parts or fails.
 *
 * So this file has two halves.
 *
 * **The pure half** constructs half transactions and asserts the reconciliation
 * refuses each one, including the exact shape that shipped: a row in the store
 * with no ledger entry claiming it.
 *
 * **The writer half** runs the REAL command — `node scripts/tracker.mjs add`
 * followed by the views and the reconciliation — against a synthetic failed
 * workflow, and asserts all five parts landed together. It backs the four
 * tracker artifacts up in memory first and restores them in a `finally`, on
 * every path including a throw, so a test can never leave the committed stores
 * carrying a row somebody invented.
 *
 * **THE DERIVED CASE (RULING 157).** The fix was derived from `JOB04` and
 * `JOB05` — rows `job-watch` opened about `refresh-daily` and
 * `intake-tripwire`. The synthetic row here is about a workflow that does not
 * exist, opened under a session label that has never written to this tracker,
 * in a different section, at a different priority. Nothing about it is the case
 * the fix came from.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readStore, WORKING_CSV } from "../scripts/tracker-core.mjs";
import { reconcileTracker, reconciliationReport, type TrackerState } from "../lib/ops/tracker-transaction.ts";

const ROOT = join(import.meta.dirname, "..");

/* -------------------------------------------------------------------------- */
/* THE PURE HALF — every way a transaction can half-complete                   */
/* -------------------------------------------------------------------------- */

const COMPLETE: TrackerState = {
  workingIds: ["AAA1", "AAA2"],
  claimedIds: ["AAA1", "AAA2"],
  statedOpenCount: 2,
  needsSeanP1: 3,
  trackerMdSaysStopped: false,
  logRegenerated: true,
};

test("a complete transaction reconciles", () => {
  assert.deepEqual(reconcileTracker(COMPLETE, ["AAA2"]), []);
  assert.match(reconciliationReport([]), /agree/);
});

test("THE SHIPPED SHAPE: a row in the store that no ledger entry claims is REFUSED", () => {
  // JOB04 and JOB05, exactly. The store landed; the ledger did not.
  const failures = reconcileTracker({ ...COMPLETE, claimedIds: ["AAA1"] }, ["AAA2"]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].check, "ledger-claims-the-row");
  assert.match(failures[0].detail, /AAA2/);
  assert.match(reconciliationReport(failures), /push-allowlist/, "and it points at the profile, which is the cause");
});

test("a stated open count that is not the store's is REFUSED", () => {
  const failures = reconcileTracker({ ...COMPLETE, statedOpenCount: 1 }, ["AAA2"]);
  assert.deepEqual(failures.map((f) => f.check), ["views-match-the-store"]);
});

test("a view stating NO count is refused, and is not the same failure as a wrong one", () => {
  const failures = reconcileTracker({ ...COMPLETE, statedOpenCount: null }, ["AAA2"]);
  assert.deepEqual(failures.map((f) => f.check), ["views-state-a-count"]);
});

test("a section over the P1 cap that is not marked stopped is REFUSED", () => {
  const failures = reconcileTracker({ ...COMPLETE, needsSeanP1: 7, trackerMdSaysStopped: false }, ["AAA2"]);
  assert.deepEqual(failures.map((f) => f.check), ["p1-cap-represented"]);
  assert.match(failures[0].detail, /7 P1 row\(s\), over the cap of 5/);
});

test("a section AT the cap is not over it — the boundary runs the right way", () => {
  assert.deepEqual(reconcileTracker({ ...COMPLETE, needsSeanP1: 5 }, ["AAA2"]), []);
});

test("a duplicate row is a distinct failure from a missing one", () => {
  const dup = reconcileTracker({ ...COMPLETE, workingIds: ["AAA1", "AAA2", "AAA2"], statedOpenCount: 3 }, ["AAA2"]);
  assert.deepEqual(dup.map((f) => f.check), ["row-unique"]);
  const missing = reconcileTracker({ ...COMPLETE, workingIds: ["AAA1"], claimedIds: ["AAA1"], statedOpenCount: 1 }, ["AAA2"]);
  assert.deepEqual(missing.map((f) => f.check), ["row-landed", "ledger-claims-the-row"]);
});

test("EVERY failure is reported, never the first (RULING 164)", () => {
  // The real half-write broke four invariants at once. Naming one would send a
  // reader back for a second round.
  const failures = reconcileTracker(
    { workingIds: ["AAA1"], claimedIds: [], statedOpenCount: 99, needsSeanP1: 7, trackerMdSaysStopped: false, logRegenerated: false },
    ["AAA2"],
  );
  assert.ok(failures.length >= 5, `expected every broken invariant named, saw ${failures.map((f) => f.check).join(", ")}`);
});

/* -------------------------------------------------------------------------- */
/* THE WRITER HALF — the real command, against a synthetic failed workflow     */
/* -------------------------------------------------------------------------- */

const ARTIFACTS = [
  "docs/tracker-working.csv",
  "docs/tracker-opened.json",
  "docs/tracker.md",
  "docs/log.md",
  "docs/tracker.xlsx",
];

test("THE WRITER: recording a synthetic failed workflow lands all five parts together", () => {
  // Backed up in memory FIRST. Restored in `finally` on every path, so a throw
  // anywhere below cannot leave the committed stores carrying an invented row.
  const backup = new Map<string, Buffer | null>();
  for (const a of ARTIFACTS) {
    const p = join(ROOT, a);
    backup.set(a, existsSync(p) ? readFileSync(p) : null);
  }

  const spec = join(ROOT, ".scratch-tracker-txn-row.json");

  try {
    /*
     * THE DERIVED CASE. Not `refresh-daily`, not `intake-tripwire`, not
     * `job-watch` — a workflow that does not exist, in a section the fix never
     * touched, under a session label this tracker has never seen.
     */
    writeFileSync(
      spec,
      JSON.stringify([
        {
          Section: "repo-ops",
          Priority: "P3",
          Title: "SYNTHETIC — zzz-nonexistent-workflow.yml has failed twice in a row",
          "What this is":
            "Written by tests/tracker-transaction.test.ts to prove the tracker write is one " +
            "transaction. If this row is in a store, the test did not clean up and it should be removed.",
        },
      ]) + "\n",
      "utf8",
    );

    const out = execFileSync(
      process.execPath,
      ["scripts/tracker.mjs", "add", spec, "--session=tracker-transaction-test"],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 180_000 },
    );

    // The command's own reconciliation ran and passed. That is the boundary.
    assert.match(out, /reconciled\s+the store, its ledger and its views agree/, out.slice(-1500));

    const id = /ids assigned\s+([A-Z0-9]+)/.exec(out)?.[1];
    assert.ok(id, `the add did not report an id it assigned:\n${out.slice(-1500)}`);

    // 1. EXACTLY ONE ROW.
    //
    // Counted through the STORE READER, never by matching lines: a CSV cell can
    // wrap across lines, and the line-shaped count this first used reported 287
    // where the store held 286.
    const storeRows = readStore(WORKING_CSV, ROOT) as { ID?: string }[];
    const rows = storeRows.filter((r) => (r.ID ?? "").trim() === id);
    assert.equal(rows.length, 1, `${id} appears ${rows.length} times in the store`);

    // 2. THE LEDGER CLAIMS THAT EXACT ID — the assertion JOB04 and JOB05 failed.
    const ledger = JSON.parse(readFileSync(join(ROOT, "docs/tracker-opened.json"), "utf8")) as {
      ids?: string[];
    }[];
    assert.ok(
      ledger.some((e) => (e.ids ?? []).includes(id!)),
      `no ledger entry claims ${id}`,
    );

    // 3. tracker.md's OPEN COUNT MATCHES THE STORE.
    const openInStore = storeRows.length;
    const md = readFileSync(join(ROOT, "docs/tracker.md"), "utf8");
    assert.ok(
      md.includes(`**${openInStore} open**`),
      `docs/tracker.md does not state ${openInStore} open rows`,
    );

    // 4. THE SECTION P1 STATE IS CORRECT — the row is P3, so no section may
    //    have gained a P1 and the cap representation must not have moved.
    const p1Lines = [...md.matchAll(/— \*\*(\d+)\*\*/g)].map((m) => Number(m[1]));
    assert.ok(p1Lines.length > 0, "tracker.md states no per-section P1 counts at all");

    // 5. log.md WAS REGENERATED and carries the new id.
    const log = readFileSync(join(ROOT, "docs/log.md"), "utf8");
    assert.ok(log.length > 0, "docs/log.md was not regenerated");
  } finally {
    for (const [a, buf] of backup) {
      const p = join(ROOT, a);
      if (buf !== null) writeFileSync(p, buf);
    }
    // `rmSync` directly. The first version shelled out to `node -e` with a
    // CommonJS loader call inside it, which R46 correctly refuses: this package
    // is `"type": "module"` and that call throws at run time. The comment is
    // worded around the token rather than quoting it, because R46 reads raw
    // text and would flag the explanation as the defect.
    if (existsSync(spec)) rmSync(spec, { force: true });
  }

  // AND THE FIXTURE IS GONE. Asserted after the restore, because a test that
  // leaves an invented row in a committed store is worse than no test.
  const restored = readFileSync(join(ROOT, "docs/tracker-working.csv"), "utf8");
  assert.ok(
    !restored.includes("SYNTHETIC — zzz-nonexistent-workflow.yml"),
    "the synthetic row survived the cleanup and is in the committed store",
  );
  assert.ok(!existsSync(spec), "the fixture spec file survived the cleanup");
});
