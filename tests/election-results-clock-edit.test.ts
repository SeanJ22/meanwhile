import assert from "node:assert/strict";
import test from "node:test";
import { applyManualEdit, checkDoorDraft } from "../lib/doors/registry.ts";
import { electionResultsDoorDrafts } from "../lib/election-results/schedule.ts";
import { publishElectionResultBatch } from "../lib/election-results/publisher.ts";
import type { ElectionResultBatch } from "../lib/election-results/types.ts";

test("an Admin clock edit recalculates saved race times before the unchanged fingerprint shortcut", async () => {
  let reads = 0;
  const query = async () => { reads++; return []; };
  const db = { query, transaction: async <T>(run: (execute: typeof query) => Promise<T>) => run(query) };
  const at = "2026-11-04T00:00:00.000Z";
  const batch: ElectionResultBatch = {
    source: { name: "Synthetic result feed", url: "https://example.org/results" },
    summaries: [], evidence: { text: "Synthetic fixture", contentHash: "", contentType: "text/plain" },
    races: [{ sourceId: "multistate", sourceName: "Synthetic result feed", sourceUrl: "https://example.org/results", creditedSources: [],
      sourceRaceId: "synthetic-clock-race", state: "AZ", office: "governor", officeName: "Governor", electionDate: "2026-11-03",
      status: "counting", candidates: [], checkedAt: at, quote: "Synthetic fixture" }],
  };
  const first = await publishElectionResultBatch({ query, db, batch, ballots: [], state: "AZ", now: new Date(at) });
  const key = Object.keys(first.progress.races)[0];
  assert.equal(first.progress.races[key].nextCheckAt, "2026-11-04T06:00:00.000Z");
  const draft = electionResultsDoorDrafts()[0];
  const checked = checkDoorDraft({ ...draft, config: { ...draft.config, countingMinutes: 60 } });
  assert.ok(checked.ok);
  const door = applyManualEdit(null, checked.value, "2026-11-04T01:30:00.000Z");
  const before = reads;
  const second = await publishElectionResultBatch({ query, db, batch, ballots: [], state: "AZ", prior: first.progress,
    door, now: new Date("2026-11-04T02:00:00.000Z") });
  assert.equal(second.progress.races[key].lastCheckedAt, "2026-11-04T02:00:00.000Z");
  assert.equal(second.progress.races[key].nextCheckAt, "2026-11-04T03:00:00.000Z");
  assert.equal(reads, before, "an unchanged result creates no per-race database reads or writes");
  const slowed = await publishElectionResultBatch({ query, db, batch, ballots: [], state: "AZ", prior: first.progress,
    door: { ...door, config: { ...door.config, countingMinutes: 720 } }, now: new Date("2026-11-04T06:00:00.000Z") });
  assert.equal(slowed.progress.races[key].lastCheckedAt, at);
  assert.equal(slowed.nextCheckAt, "2026-11-04T12:00:00.000Z");
});
