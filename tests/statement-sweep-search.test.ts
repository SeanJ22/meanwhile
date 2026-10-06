import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SWEEP_SCHEDULE, SWEEP_QUERY_KINDS, searchCoversTopic, searchSweepPeople, sweepDueAt, sweepIntervalDays,
  sweepIsDue, validSweepSchedule, daysToElection,
} from "../lib/corpus/statement-sweep-search.ts";
import type { ScoutSearch } from "../lib/control-plane/scheduler/scout-contract.ts";

const topics = [{ id: "water", label: "water" }, { id: "jobs", label: "jobs" }];
const ok: ScoutSearch = async () => ({
  hits: [{ url: "https://guide.example/county", title: "County voter guide", provider: "brave" }],
  requestCount: 1, bytesFetched: 0, providersUsed: ["brave"], errors: [],
});

test("every person gets the same queries on every topic", async () => {
  const people = [{ subjectId: "a", name: "Ana Reyes" }, { subjectId: "b", name: "Bo Tran" }];
  const [a, b] = await searchSweepPeople(people, ok, topics);
  assert.equal(a.searched.length, topics.length * SWEEP_QUERY_KINDS.length);
  assert.equal(b.searched.length, a.searched.length);
  assert.equal(a.complete && b.complete, true);
  assert.ok(a.searched.some((s) => s.query.includes("voter guide")));
  assert.equal(a.leads.length, 2); // one lead per topic, deduped within a topic
});

test("a refused query is named and leaves the topic open", async () => {
  const refuse: ScoutSearch = async () => ({ hits: [], requestCount: 0, bytesFetched: 0, providersUsed: [], errors: ["budget spent"] });
  const [r] = await searchSweepPeople([{ subjectId: "a", name: "Ana Reyes" }], refuse, topics);
  assert.equal(r.complete, false);
  assert.equal(searchCoversTopic(r, "water"), false);
  assert.match(r.searched[0].error ?? "", /budget spent/);
});

test("the schedule tightens as the election nears", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  assert.equal(daysToElection("2026-11-03", now), 29);
  assert.equal(sweepIntervalDays(29), 7);
  assert.equal(sweepIntervalDays(5), 1);
  assert.equal(sweepIntervalDays(200), 30);
  assert.equal(sweepIntervalDays(null), 30);
  assert.equal(sweepIntervalDays(-3), 30);
  assert.equal(sweepIsDue(null, "2026-11-03", now), true);
  assert.equal(sweepIsDue("2026-10-01T12:00:00Z", "2026-11-03", now), false);
  assert.equal(sweepIsDue("2026-09-28T12:00:00Z", "2026-11-03", now), true);
  assert.equal(sweepDueAt("2026-10-01T12:00:00Z", "2026-11-03", now).toISOString(), "2026-10-08T12:00:00.000Z");
});

test("a schedule that loosens near the election is refused", () => {
  assert.equal(validSweepSchedule(DEFAULT_SWEEP_SCHEDULE), true);
  assert.equal(validSweepSchedule([{ withinDays: 7, everyDays: 14 }, { withinDays: 30, everyDays: 7 }]), false);
  assert.equal(validSweepSchedule([]), false);
});
