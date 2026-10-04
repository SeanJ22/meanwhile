import assert from "node:assert/strict";
import test from "node:test";

import { POSITION_TOPICS } from "../lib/corpus/positions.ts";
import { mayShowNotFound, pagesCountingFor, sweepPerson } from "../lib/corpus/statement-sweep.ts";
import type { SourceSnapshot, StatementCorpus } from "../lib/corpus/types.ts";

function snap(over: Partial<SourceSnapshot>): SourceSnapshot {
  return {
    id: "s",
    subjectId: "congress:A",
    subjectName: "Ana Reyes",
    kind: "CAMPAIGN_SITE",
    url: "https://example.org/a",
    contentHash: "h",
    retrievedAt: "2026-09-01T00:00:00.000Z",
    httpStatus: 200,
    extraction: "ok",
    text: "Housing costs too much. I will fix it.",
    title: null,
    ...over,
  };
}

const person = { subjectId: "congress:A", name: "Ana Reyes" };

test("every topic is swept against the same pages for one person", () => {
  const corpus: StatementCorpus = { snapshots: [snap({})] };
  const r = sweepPerson(person, corpus);
  assert.equal(r.topics.length, POSITION_TOPICS.length);
  const first = JSON.stringify(r.topics[0].sourcesSearched);
  assert.ok(r.topics.every((t) => JSON.stringify(t.sourcesSearched) === first));
  assert.equal(r.topics.find((t) => t.topic === "housing")?.answer, "MATCHED");
  assert.equal(r.topics.find((t) => t.topic === "water")?.answer, "SEARCHED_NOTHING_MATCHED");
  assert.equal(r.equalEffort, true);
});

test("not-found is allowed only after an equal-effort sweep found nothing", () => {
  const swept = sweepPerson(person, { snapshots: [snap({})] });
  assert.equal(mayShowNotFound(swept, "water"), true);
  assert.equal(mayShowNotFound(swept, "housing"), false);
  const empty = sweepPerson(person, { snapshots: [] });
  assert.equal(empty.equalEffort, false);
  assert.ok(empty.topics.every((t) => t.answer === "NOT_YET_COLLECTED"));
  assert.equal(mayShowNotFound(empty, "water"), false);
});

test("a page counts when it is theirs or quotes them by name, not otherwise", () => {
  const corpus: StatementCorpus = {
    snapshots: [
      snap({ id: "1" }),
      snap({ id: "2", subjectId: "board:x", kind: "MINUTES", url: "https://example.org/min", text: "Ana Reyes said water rates must fall." }),
      snap({ id: "3", subjectId: "board:x", kind: "MINUTES", url: "https://example.org/other", text: "Someone else spoke about water." }),
      snap({ id: "4", subjectId: "board:x", url: "https://example.org/first", text: "Ana spoke." }),
    ],
  };
  const { sources } = pagesCountingFor(person, corpus);
  assert.deepEqual(sources.map((s) => [s.url, s.basis]), [
    ["https://example.org/a", "THEIRS"],
    ["https://example.org/min", "QUOTES_BY_NAME"],
  ]);
  const r = sweepPerson(person, corpus);
  assert.equal(r.topics.find((t) => t.topic === "water")?.answer, "MATCHED");
});

test("an unreadable held page is named, never counted as read", () => {
  const r = sweepPerson(person, { snapshots: [snap({}), snap({ id: "2", url: "https://example.org/b", extraction: "failed", text: null })] });
  assert.equal(r.unreadable, 1);
  assert.equal(r.topics[0].sourcesSearched.length, 1);
});
