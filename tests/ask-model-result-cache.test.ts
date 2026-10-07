import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedTtlCache,
  interpretationCacheKey,
  normalizeAskQuestion,
  synthesisCacheKey,
} from "../lib/ask/model-result-cache.ts";

/**
 * One model call per distinct evidence, not per visitor. The key
 * is the input: when the civic data behind an answer changes, the pack changes
 * and so does the key, so a stale answer can never be replayed over new
 * evidence.
 */

const pack = {
  question: "Is Pima County voting on data centers?",
  intent: "AGENDA_TOPIC",
  temporal: { kind: "NONE" },
  subject: { kind: "BODY", id: "ocd-division/country:us/state:az/county:pima#governing", name: "Pima County Board Of Supervisors" },
  records: [{ kind: "MEETING_ACTION", id: "327593#action", text: "The recorded action was \"approve\".", sourceUrl: "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1824" }],
  gaps: [{ whose: "OURS", statement: "We have not read the agenda of the September 22nd, 2026 meeting." }],
  denominators: { topicTimelineEntries: 2 },
  today: "2026-09-24",
};

test("equivalent wording shares a key; different evidence never does", () => {
  assert.equal(normalizeAskQuestion("  Is Pima County voting on DATA centers?? "), "is pima county voting on data centers");
  const base = synthesisCacheKey(pack, "claude-opus-5", "medium");
  assert.equal(synthesisCacheKey({ ...pack, question: "is pima county voting on data centers" }, "claude-opus-5", "medium"), base);
  const refreshed = { ...pack, gaps: [], records: [...pack.records, { kind: "MEETING_ACTION", id: "331773#action", text: "The recorded action was \"approve as amended\".", sourceUrl: "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1828" }] };
  assert.notEqual(synthesisCacheKey(refreshed, "claude-opus-5", "medium"), base, "new evidence is a new key: the old answer cannot be replayed");
  assert.notEqual(synthesisCacheKey({ ...pack, today: "2026-09-25" }, "claude-opus-5", "medium"), base, "a new day is a new key");
  assert.notEqual(synthesisCacheKey(pack, "claude-opus-5-5", "medium"), base, "a model change is a new key");
  assert.notEqual(synthesisCacheKey(pack, "claude-opus-5", "low"), base, "an effort change is a new key");
  assert.notEqual(interpretationCacheKey("is pima county voting on data centers", { today: "2026-09-24", inventory: ["a"] }, "m"),
    interpretationCacheKey("is pima county voting on data centers", { today: "2026-09-24", inventory: ["b"] }, "m"),
    "what the model is shown is part of the key");
});

test("the cache is bounded in time and in size", () => {
  const cache = new BoundedTtlCache<string>(2, 1_000);
  cache.set("a", "A", 0);
  cache.set("b", "B", 10);
  assert.equal(cache.get("a", 20), "A", "a hit refreshes recency");
  cache.set("c", "C", 30);
  assert.equal(cache.get("b", 40), null, "the least recently used entry is evicted at the bound");
  assert.equal(cache.get("a", 50), "A");
  assert.equal(cache.get("a", 2_000), null, "an entry past its TTL is never served");
  assert.equal(cache.size, 1);
});
