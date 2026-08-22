import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  EXIT_CLEAN,
  EXIT_NOTHING_WRITTEN,
  EXIT_WRITTEN_WITH_JOB_FAILURES,
  commitsDespiteFailure,
} from "../lib/meetings/refresh-exit.ts";

/**
 * **NH31 - a refresh that commits only when every source is healthy never
 * commits at national volume.** (2026-08-21.)
 *
 * ## The arithmetic, which is the whole finding
 *
 * The meetings refresh ran 37 times in the eight days to 2026-08-21 and
 * failed 14 of them. At eleven composite children that implies a per-source
 * job-failure rate of `1 - 0.622^(1/11)` = 0.042, which reads as ordinary
 * flakiness and was treated as such.
 *
 * It is not flakiness. A run that commits only when NO source fails commits
 * with probability `(1 - p)^n`. That is 62% at n = 11 and `3e-94` at
 * n = 5000. The product's whole direction is toward n = 5000 - RULING 57 says
 * every township water authority in the country gets named - so the refresh
 * was on a path to never committing again, with every run red for an honest
 * reason and the corpus frozen at whatever it held on the day it crossed the
 * threshold.
 *
 * ## The failure the fix removes
 *
 * Run 32485680324, 2026-08-21T13:12Z: 11 sources attempted, **10 read**, one
 * job-failed on an eventless VCALENDAR, **330 rows written to disk** - and
 * nothing committed. Ten sources' fresh data was fetched, normalised, written
 * and discarded by the eleventh, because the ingest signalled that outcome
 * with the same exit code it uses for "nothing was written at all" and the
 * workflow could not tell the two apart.
 *
 * This is the per-body-isolation rule (CLAUDE.md, the refresh corollary) one
 * layer up. There, one host's refusal emptied bodies on other hosts. Here,
 * one source's broken parser discarded ten sources' rows.
 *
 * ## What is NOT changed, and why the distinction matters
 *
 * RULING 12 is untouched. A JOB failure is our stopwatch running out, not a
 * wall, and it may never be compiled into a skip - so a code-2 run still ends
 * RED, still names the source, and still feeds the two-consecutive detector
 * that opens a Needs Sean row. Committing the survivors is not skipping the
 * failure; it is refusing to let the failure take hostages.
 */

const INGEST = readFileSync("scripts/ingest.ts", "utf8");
const WORKFLOW = readFileSync(
  ".github/workflows/refresh-meetings-snapshot.yml",
  "utf8",
);

test("NH31: the three outcomes carry three distinct exit codes", () => {
  const codes = [
    EXIT_CLEAN,
    EXIT_NOTHING_WRITTEN,
    EXIT_WRITTEN_WITH_JOB_FAILURES,
  ];
  assert.equal(
    new Set(codes).size,
    codes.length,
    "two outcomes sharing a code is the defect itself - the caller cannot " +
      "tell 'nothing to commit' from 'commit this and then go red'",
  );
  assert.equal(EXIT_CLEAN, 0, "a clean run must exit 0 or every caller breaks");
  /*
   * Widened to `number` deliberately. These are `const`, so TypeScript knows
   * their literal types and calls `EXIT_NOTHING_WRITTEN !== 0` a comparison
   * with no overlap — which is true today and is exactly what the assertion
   * is here to keep true. Comparing the VALUES rather than the literal types
   * keeps the guard live: set either constant to 0 and this fails, which is
   * the regression it exists for (a failure that exits 0 commits nothing and
   * tells nobody).
   */
  const failureCodes: number[] = [
    EXIT_NOTHING_WRITTEN,
    EXIT_WRITTEN_WITH_JOB_FAILURES,
  ];
  assert.ok(
    failureCodes.every((code) => code !== 0),
    "both failure outcomes must be non-zero: the run is red either way",
  );
});

test("NH31: only the written-with-failures code asks the caller to commit", () => {
  assert.equal(commitsDespiteFailure(EXIT_WRITTEN_WITH_JOB_FAILURES), true);
  assert.equal(
    commitsDespiteFailure(EXIT_NOTHING_WRITTEN),
    false,
    "committing when nothing was written would push an empty or stale file",
  );
  assert.equal(commitsDespiteFailure(EXIT_CLEAN), false);
});

test("NH31: a job failure exits WRITTEN_WITH_JOB_FAILURES, never NOTHING_WRITTEN", () => {
  // The regression this guards is a one-character edit: someone reads
  // `process.exitCode = EXIT_WRITTEN_WITH_JOB_FAILURES` as noise and
  // "simplifies" it back to 1, and the refresh silently stops committing
  // again with every run looking exactly as red as it did before.
  const jobFailBlock = INGEST.slice(INGEST.indexOf("refresh FAILED:"));
  assert.ok(
    jobFailBlock.includes("process.exitCode = EXIT_WRITTEN_WITH_JOB_FAILURES"),
    "the job-failure path must exit with the code that means 'commit this'",
  );
  assert.ok(
    !/refresh FAILED:[\s\S]{0,2000}?process\.exitCode = 1\b/.test(INGEST),
    "the job-failure path must not exit 1 - that is the code that stops the commit",
  );
});

test("NH31: a run that wrote nothing still refuses to commit", () => {
  for (const marker of [
    "composite produced no run report",
    "sources failed - ",
    "sources failed — ",
  ]) {
    const at = INGEST.indexOf(marker);
    if (at === -1) continue;
    const after = INGEST.slice(at, at + 700);
    assert.ok(
      after.includes("process.exitCode = EXIT_NOTHING_WRITTEN"),
      `${marker}: nothing reached disk, so the caller must be told not to commit`,
    );
  }
  // Both no-write paths must be present and accounted for, or this test
  // passes by finding nothing - the zero-row shape it exists to prevent.
  assert.equal(
    (INGEST.match(/process\.exitCode = EXIT_NOTHING_WRITTEN/g) ?? []).length,
    2,
    "exactly two paths write nothing: no run report, and every source failed",
  );
});

test("NH31: the workflow carries a code-2 run past the gate to its commit", () => {
  assert.ok(
    WORKFLOW.includes('echo "ingest_exit=$code" >> "$GITHUB_OUTPUT"'),
    "the workflow must capture the ingest's exit code rather than dying on it",
  );
  // Code 2 falls through; anything else non-zero stops the job where it stands.
  assert.match(
    WORKFLOW,
    /case "\$code" in[\s\S]*?2\)[\s\S]*?\*\)[\s\S]*?exit "\$code"/,
    "code 2 must continue and every other non-zero code must stop the job",
  );
});

test("NH31: a code-2 run still ends red, and does so LAST", () => {
  const failStep = WORKFLOW.indexOf(
    "A source failed for a JOB reason",
  );
  assert.ok(failStep > -1, "the run must still fail - RULING 12, not a skip");
  assert.ok(
    WORKFLOW.slice(failStep).includes("exit 1"),
    "the final step must actually fail the job",
  );
  const commitStep = WORKFLOW.indexOf("node scripts/push-main.mjs");
  assert.ok(
    commitStep > -1 && commitStep < failStep,
    "the commit must come BEFORE the step that fails the run - a red step " +
      "placed earlier reintroduces NH31 for everything after it",
  );
  assert.ok(
    WORKFLOW.slice(failStep).includes("if: always()"),
    "the failure must fire whatever the steps between it and the ingest did",
  );
});

test("NH31: the proof harness cannot fire on a scheduled run", () => {
  const at = INGEST.indexOf("function forceJobFailureIfDispatchedProof");
  assert.ok(at > -1, "the dispatch-only proof harness must exist");
  const body = INGEST.slice(at, INGEST.indexOf("\n}\n", at));
  assert.ok(
    body.includes('process.env.WTP_INGEST_DISPATCHED !== "true"'),
    "the harness must refuse any run that is not a workflow_dispatch",
  );
  assert.ok(
    /WTP_INGEST_DISPATCHED[\s\S]*?return;/.test(body),
    "the non-dispatch branch must return without touching the exit code",
  );
  // And the workflow must only ever hand it a dispatch's own event name.
  assert.ok(
    WORKFLOW.includes(
      "WTP_INGEST_DISPATCHED: ${{ github.event_name == 'workflow_dispatch' }}",
    ),
    "the workflow must derive the gate from the event, never from an input",
  );
});

/**
 * The class sweep, held open. (A named instance is an example of a class-wide
 * defect - CLAUDE.md.)
 *
 * Four scheduled refreshes share the same workflow shape: a bare `run:` fetch
 * step, then diff, then gate, then commit. In three of them that shape is
 * CORRECT, because those three never write a governed artifact and then exit
 * non-zero - every non-zero exit they have precedes any write (a missing API
 * key, the FEC thin-snapshot guard deliberately refusing to ship a shrink, an
 * unhandled throw). Nothing is on disk to lose, so dying at the fetch step
 * loses nothing.
 *
 * The sweep found the defect in 1 of 4, and that one is fixed above. What
 * this test holds shut is the silent return: the day one of the other three
 * grows partial-progress semantics - a per-state loop, a per-committee loop,
 * anything with children - it inherits NH31 the moment it does, and the
 * symptom is a snapshot that quietly stops moving while every run is red for
 * a reason that reads as honest. That is a defect nobody would look for,
 * because the run is telling the truth about the part it noticed.
 */
test("NH31 class sweep: no other refresh writes its artifact and then exits non-zero", () => {
  const others = {
    "scripts/fetch-dotgov.mts": ["writeFileSync("],
    "scripts/fetch-fec.mts": ["await writeFile(OUT"],
    "scripts/fetch-legiscan.mts": ["await writeFile(SNAPSHOT"],
  };
  for (const [path, writes] of Object.entries(others)) {
    const src = readFileSync(path, "utf8");
    for (const marker of writes) {
      const at = src.indexOf(marker);
      assert.ok(at > -1, `${path}: the write anchor ${marker} has moved`);
      // Everything after the artifact write, minus the generic unhandled-throw
      // catch, which fires only if the write itself threw.
      const after = src
        .slice(at)
        .replace(/main\(\)\.catch\([\s\S]*$/, "")
        .replace(/\.catch\(\(error\)[\s\S]*$/, "");
      assert.ok(
        !/process\.exit(Code)?\s*[=(]\s*[1-9]/.test(after),
        `${path} now exits non-zero AFTER writing its governed artifact. ` +
          "That is NH31: the workflow's fetch step dies, the commit step " +
          "never runs, and the artifact on disk is discarded. Give it the " +
          "three-code contract in lib/meetings/refresh-exit.ts and teach its " +
          "workflow to commit before it goes red.",
      );
    }
  }
});

test("NH31: the proof harness runs after the write and touches no data", () => {
  const write = INGEST.indexOf(
    "writeMeetingsSnapshot(source, meetings, previous)",
  );
  const call = INGEST.indexOf("forceJobFailureIfDispatchedProof()");
  assert.ok(
    write > -1 && call > write,
    "the harness must run AFTER the snapshot is written, so the file on disk " +
      "is byte-identical to an unforced run's",
  );
  const at = INGEST.indexOf("function forceJobFailureIfDispatchedProof");
  const body = INGEST.slice(at, INGEST.indexOf("\n}\n", at));
  for (const forbidden of [
    "writeSnapshot",
    "snapshot.sources",
    "meetings.push",
  ]) {
    assert.ok(
      !body.includes(forbidden),
      `the harness must not touch ${forbidden} - a synthetic failure that ` +
        "wrote anything durable would be indistinguishable from a real one",
    );
  }
  assert.ok(
    body.includes("SYNTHETIC JOB FAILURE"),
    "the harness must say what it is in the log a human reads",
  );
});
