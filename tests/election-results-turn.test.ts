import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runElectionResultsWhenDue } from "../lib/election-results/turn.ts";

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
