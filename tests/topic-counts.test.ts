import assert from "node:assert/strict";
import test from "node:test";
import { FREE_FORM_TOPIC, NO_TOPIC_COUNTS_YET, TOPIC_ROW_LIMIT, readTopicCounts, topicCountsView, topicLabel, type TopicCountRow } from "../lib/control-plane/admin-view/topic-counts.ts";

const row = (over: Partial<TopicCountRow> = {}): TopicCountRow => ({ week: "2026-09-28", zip: "85635", district: null, topic: "property-tax", users: 12, totalUsers: 98, ...over });
const READ_AT = "2026-10-01T18:00:00.000Z";

test("until S6's read exists, the answer is 'no topic counts yet', never an empty list or a zero", async () => {
  const seam = await readTopicCounts();
  assert.equal(seam.kind, "NOT_INSTALLED");
  const view = topicCountsView(seam);
  assert.equal(view.kind, "NOT_INSTALLED");
  assert.equal((view as { says: string }).says, NO_TOPIC_COUNTS_YET);
  assert.match(NO_TOPIC_COUNTS_YET, /No topic counts yet/);
});

test("each row is a percentage of users with the count beside it, and a small group is shown exactly like a large one", () => {
  const view = topicCountsView({ kind: "RECORDED", observedAt: READ_AT, rows: [row(), row({ topic: "water", users: 1, totalUsers: 3 }), row({ zip: "85641", topic: "water", users: 0, totalUsers: 2 })] });
  assert.equal(view.kind, "READ");
  if (view.kind !== "READ") return;
  assert.deepEqual(view.rows.map((r) => [r.place, r.topic, r.percent, r.users, r.totalUsers]),
    [["ZIP 85635", "water", 33.3, 1, 3], ["ZIP 85635", "property-tax", 12.2, 12, 98], ["ZIP 85641", "water", 0, 0, 2]], "every group is here, the smallest included, newest week then biggest share first");
  assert.equal(view.hidden, 0, "nothing was suppressed for being small");
});

test("a group with no users has no percentage, not 0%, and a row that cannot be true is counted as hidden, never shown as a number", () => {
  const view = topicCountsView({ kind: "RECORDED", observedAt: READ_AT, rows: [row({ users: 0, totalUsers: 0 }), row({ users: 9, totalUsers: 4 }), row({ users: 1.5 }), row({ week: "last week" }), row({ zip: "8563" })] });
  assert.equal(view.kind, "READ");
  if (view.kind !== "READ") return;
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].percent, null);
  assert.equal(view.hidden, 4, "more askers than users, a fractional count, a bad week and a bad ZIP are all named, not dropped quietly");
});

test("free-form questions stay their own topic, a district names itself, and only the aggregate fields are passed on", () => {
  const dirty = { ...row({ zip: null, district: "AZ-06", topic: FREE_FORM_TOPIC, users: 7, totalUsers: 40 }), email: "a@b.c", userId: "u-1", address: "1 Main St" } as unknown as TopicCountRow;
  const view = topicCountsView({ kind: "RECORDED", observedAt: READ_AT, rows: [dirty] });
  assert.equal(view.kind, "READ");
  if (view.kind !== "READ") return;
  assert.deepEqual(Object.keys(view.rows[0]).sort(), ["kind", "percent", "place", "topic", "topicLabel", "totalUsers", "users", "week"], "no person field survives");
  assert.equal(view.rows[0].place, "AZ-06");
  assert.equal(view.rows[0].kind, "district");
  assert.equal(view.rows[0].topicLabel, "Free-form question");
  assert.doesNotMatch(JSON.stringify(view), /a@b\.c|u-1|Main St/);
  assert.equal(topicLabel("water-quality"), "Water quality");
});

test("the view is bounded: past the row limit the rest are counted, with the weeks and topics offered for filtering", () => {
  const rows = Array.from({ length: TOPIC_ROW_LIMIT + 3 }, (_, i) => row({ topic: `t${i}`, users: 1, totalUsers: 2 }));
  const view = topicCountsView({ kind: "RECORDED", observedAt: READ_AT, rows });
  assert.equal(view.kind, "READ");
  if (view.kind !== "READ") return;
  assert.equal(view.rows.length, TOPIC_ROW_LIMIT);
  assert.equal(view.hidden, 3);
  assert.deepEqual(view.weeks, ["2026-09-28"]);
});
