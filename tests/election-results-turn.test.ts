import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runElectionResultsStep, runElectionResultsWhenDue } from "../lib/election-results/turn.ts";

test("the standing turn makes no database polls between source checks and honors Admin edits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "election-results-clock-"));
  try {
    const path = join(directory, "clock.json"), now = "2026-11-04T00:00:00.000Z";
    let reads = 0;
    const run = async () => { reads++; return { nextCheckAt: "2026-11-04T06:00:00.000Z", published: 3 }; };
    assert.deepEqual(await runElectionResultsWhenDue({ path, now, run }), { nextCheckAt: "2026-11-04T06:00:00.000Z", published: 3 });
    for (let hour = 1; hour < 6; hour++) assert.equal(await runElectionResultsWhenDue({ path, now: `2026-11-04T0${hour}:00:00.000Z`, run }), null);
    assert.equal(reads, 1);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { checkedAt: now, nextCheckAt: "2026-11-04T06:00:00.000Z" });
    await runElectionResultsWhenDue({ path, now: "2026-11-04T03:00:00.000Z", requestedAt: "2026-11-04T02:00:00.000Z", run });
    assert.equal(reads, 2, "a changed source clock is effective before the cached due time");
    await runElectionResultsWhenDue({ path, now: "2026-11-04T06:00:00.000Z", run });
    assert.equal(reads, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("certified-only sources stop until a new request; a broken hint or a slowed job never loses owed work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "election-results-stop-"));
  try {
    const path = join(directory, "clock.json"), now = "2026-11-04T00:00:00.000Z";
    let reads = 0;
    const run = async () => { reads++; return { nextCheckAt: null }; };
    await runElectionResultsWhenDue({ path, now, run: async () => null });
    await runElectionResultsWhenDue({ path, now, run });
    assert.equal(reads, 1);
    await runElectionResultsWhenDue({ path, now: "2026-11-10T00:00:00.000Z", run });
    assert.equal(reads, 1);
    await runElectionResultsWhenDue({ path, now: "2026-11-10T00:00:00.000Z", requestedAt: "2026-11-09T00:00:00.000Z", run });
    assert.equal(reads, 2);
    await writeFile(path, "{bad json", "utf8");
    await runElectionResultsWhenDue({ path, now: "2026-11-10T00:00:00.000Z", run });
    assert.equal(reads, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the routine step runs on the turn deadline, and a turn with no time left records the skip and stays due", async () => {
  const directory = await mkdtemp(join(tmpdir(), "election-results-step-"));
  try {
    const path = join(directory, "clock.json"), start = Date.parse("2026-11-04T00:00:00.000Z");
    const skips: string[] = [];
    let runs = 0;
    const run = async () => { runs++; return { nextCheckAt: "2026-11-04T06:00:00.000Z" }; };
    // Fact maintenance's own 60-second budget is long spent; the step only answers to the turn's deadline.
    const turnDeadlineMs = start + 20 * 60_000;
    const late = await runElectionResultsStep({ path, deadlineMs: turnDeadlineMs, now: () => turnDeadlineMs + 1, run, skipped: detail => skips.push(detail) });
    assert.equal(late, null);
    assert.equal(runs, 0);
    assert.match(skips.join(), /ELECTION_RESULTS_TURN_DEADLINE_PASSED/);
    await assert.rejects(readFile(path, "utf8"), /ENOENT/, "a skipped turn leaves no clock, so the next turn is due");
    const first = await runElectionResultsStep({ path, deadlineMs: turnDeadlineMs, now: () => start + 5 * 60_000, run, skipped: detail => skips.push(detail) });
    assert.deepEqual(first, { nextCheckAt: "2026-11-04T06:00:00.000Z" });
    assert.equal(runs, 1);
    assert.equal(skips.length, 1, "a run that had time records no skip");
    const second = await runElectionResultsStep({ path, deadlineMs: turnDeadlineMs, now: () => start + 10 * 60_000, run, skipped: detail => skips.push(detail) });
    assert.equal(second, null, "the next turn waits for the 6 hour clock the first run wrote");
    assert.equal(runs, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
