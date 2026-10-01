import assert from "node:assert/strict";
import test from "node:test";
import { FREE_FORM_TOPIC, NO_TOPIC_COUNTS_YET, TOPIC_ROW_LIMIT, readTopicCounts, topicCountsView, topicLabel, type TopicCountRow } from "../lib/control-plane/admin-view/topic-counts.ts";

const row = (over: Partial<TopicCountRow> = {}): TopicCountRow => ({ period: "2026-09-28", grain: "week", zip: "85635", district: null, topic: "property-tax", users: 12, totalUsers: 98, ...over });
const READ_AT = "2026-10-01T18:00:00.000Z";

test("a store that is not installed answers 'no topic counts yet', never an empty list or a zero", async () => {
  const seam = await readTopicCounts(async () => ({ kind: "NOT_INSTALLED", detail: "" }));
  assert.equal(seam.kind, "NOT_INSTALLED");
  const view = topicCountsView(seam);
  assert.equal(view.kind, "NOT_INSTALLED");
  assert.equal((view as { says: string }).says, NO_TOPIC_COUNTS_YET);
  assert.match(NO_TOPIC_COUNTS_YET, /No topic counts yet/);
});

test("the store's totals become topic counts for everyone: a topic's readers beside all readers in the same week or day", async () => {
  const total = (grain: "day" | "week", period: string, topic: string, type: string, users: number) => ({ grain, period, zip: null, district: null, topic, type, events: users, users });
  const read = await readTopicCounts(async (q) => ({ kind: "ROWS", rows: q.grain === "week"
    ? [total("week", "2026-09-28", "*", "*", 10), total("week", "2026-09-28", "water", "*", 4), total("week", "2026-09-28", "water", "ASK", 3), total("week", "2026-09-28", "free-form", "*", 2)]
    : [total("day", "2026-10-01", "*", "*", 5), total("day", "2026-10-01", "water", "*", 1)] }), new Date("2026-10-01T12:00:00Z"));
  assert.equal(read.kind, "RECORDED");
  const view = topicCountsView(read);
  assert.equal(view.kind, "READ");
  assert.deepEqual((view.kind === "READ" ? view.rows : []).map((r) => [r.grain, r.period, r.topic, r.users, r.totalUsers, r.percent]),
    [["day", "2026-10-01", "water", 1, 5, 20], ["week", "2026-09-28", "water", 4, 10, 40], ["week", "2026-09-28", "free-form", 2, 10, 20]]);
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
  const view = topicCountsView({ kind: "RECORDED", observedAt: READ_AT, rows: [row({ users: 0, totalUsers: 0 }), row({ users: 9, totalUsers: 4 }), row({ users: 1.5 }), row({ period: "last week" }), row({ grain: "month" as never }), row({ zip: "8563" })] });
  assert.equal(view.kind, "READ");
  if (view.kind !== "READ") return;
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].percent, null);
  assert.equal(view.hidden, 5, "more askers than users, a fractional count, a bad period, a bad grain and a bad ZIP are all named, not dropped quietly");
});

test("free-form questions stay their own topic, a district names itself, and only the aggregate fields are passed on", () => {
  const dirty = { ...row({ zip: null, district: "AZ-06", topic: FREE_FORM_TOPIC, users: 7, totalUsers: 40 }), email: "a@b.c", userId: "u-1", address: "1 Main St" } as unknown as TopicCountRow;
  const view = topicCountsView({ kind: "RECORDED", observedAt: READ_AT, rows: [dirty] });
  assert.equal(view.kind, "READ");
  if (view.kind !== "READ") return;
  assert.deepEqual(Object.keys(view.rows[0]).sort(), ["grain", "kind", "percent", "period", "place", "topic", "topicLabel", "totalUsers", "users"], "no person field survives");
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
  assert.deepEqual(view.periods, ["week:2026-09-28"]);
});

test("rows may be by day or by week, and each says which, so capture's daily counts and weekly roll-ups sit in the same view", () => {
  const view = topicCountsView({ kind: "RECORDED", observedAt: READ_AT, rows: [row({ period: "2026-10-01", grain: "day", users: 3, totalUsers: 12 }), row({ period: "2026-09-28", grain: "week" })] });
  assert.equal(view.kind, "READ");
  if (view.kind !== "READ") return;
  assert.deepEqual(view.periods, ["week:2026-09-28", "day:2026-10-01"].sort().reverse());
  assert.deepEqual(view.rows.map((r) => [r.grain, r.period]), [["day", "2026-10-01"], ["week", "2026-09-28"]], "newest period first");
});
