import test from "node:test";
import assert from "node:assert/strict";
import { readSourceChecks, SOURCE_CHECK_PAGE_SIZE } from "../lib/control-plane/admin-view/v6-source-checks-read.ts";

test("source visibility pages one state without reading saved response bodies", async () => {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const view = await readSourceChecks(async (text, params) => {
    calls.push({ text, params });
    if (text.includes("cp_source_check_days")) return [{ day: "2026-10-15", checks: "20", unchanged: "15" }];
    return Array.from({ length: SOURCE_CHECK_PAGE_SIZE + 1 }, (_, i) => ({ cache_key: String(i).padStart(64, "0"),
      source_id: `body-${i}`, url: `https://council${i}.gov/calendar`, checked_at: "2026-10-15T12:00:00Z", http_status: 304,
      unchanged: true, next_due_at: "2026-10-15T13:00:00Z" }));
  }, "US-TX", "", "2026-10-15T12:30:00Z", "responses");
  assert.equal(view.rows.length, SOURCE_CHECK_PAGE_SIZE);
  assert.equal(view.next, view.rows.at(-1)!.key);
  assert.equal(view.rows[0]!.result, "Unchanged without a download");
  assert.equal(view.rows[0]!.nextDueAt, "2026-10-15T13:00:00.000Z");
  assert.equal(view.days[0]!.unchangedShare, 0.75);
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.params[0], "US-TX");
  assert.match(calls[0]!.text, /cache_key > \$2 ORDER BY cache_key LIMIT \$3/);
  assert.doesNotMatch(calls[0]!.text, /SELECT \*|\bvalue\b/);
  assert.match(calls[1]!.text, /America\/New_York/);
});


test("registered bodies appear before their first fetch and stay distinct behind one publisher", async () => {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const view = await readSourceChecks(async (text, params) => {
    calls.push({ text, params });
    if (text.includes("cp_source_check_days")) return [];
    if (text.includes("cp_source_checks")) return [{ source_id: "meetings:ical:ocd-division%2Fcountry%3Aus%2Fstate%3Atx%2Fplace%3Aexample%23council",
      url: "https://example.gov/calendar.ics", checked_at: "2026-10-15T12:00:00Z", http_status: 304, unchanged: true, next_due_at: "2026-10-15T13:00:00Z" }];
    return ["council", "school-board"].map((body, index) => ({ id: "calendar", ordinality: index + 1,
      body_id: `ocd-division/country:us/state:tx/place:example#${body}`, kind: "ical", status: "OPEN", is_meeting: true,
      source_name: "Example City", url: "https://example.gov/calendar.ics" }));
  }, "US-TX", "", "2026-10-15T12:30:00Z");
  assert.equal(view.rows.length, 2);
  assert.deepEqual(view.rows.map(row => row.name), ["Example City — council", "Example City — school board"]);
  assert.equal(view.rows[0]!.result, "Unchanged without a download");
  assert.equal(view.rows[1]!.checkedAt, null);
  assert.equal(view.rows[1]!.result, "Not checked yet");
  assert.equal(view.rows[1]!.nextDueAt, "2026-10-15T12:30:00.000Z");
  const inventory = calls.find(call => call.text.includes("cp_doors"))!;
  assert.match(inventory.text, /scopeState.*= \$1/);
  assert.match(inventory.text, /ORDER BY d.id,body.ordinality LIMIT \$4/);
  assert.equal(inventory.params[3], SOURCE_CHECK_PAGE_SIZE + 1);
  assert.deepEqual(calls.find(call => call.text.includes("cp_source_checks"))!.params[1], [
    "meetings:ical:ocd-division%2Fcountry%3Aus%2Fstate%3Atx%2Fplace%3Aexample%23council",
    "meetings:ical:ocd-division%2Fcountry%3Aus%2Fstate%3Atx%2Fplace%3Aexample%23school-board",
  ]);
});


test("registered nonmeeting contracts retain their identity and paused sources are not due", async () => {
  let asked: readonly unknown[] = [];
  const view = await readSourceChecks(async (text, params) => {
    if (text.includes("cp_source_check_days")) return [];
    if (text.includes("cp_source_checks")) { asked = params; return []; }
    return [{ id: "votes", ordinality: 1, body_id: "city#council", contract_id: "votes-example", kind: "votes",
      is_meeting: false, status: "SUSPENDED", source_name: "Council votes", url: "https://user:pass@example.gov/votes?api_key=private&year=2026" }];
  }, "US-TX", "", "2026-10-15T12:30:00Z");
  assert.deepEqual(asked[1], ["votes-example"]);
  assert.equal(view.rows[0]!.result, "Set aside");
  assert.equal(view.rows[0]!.nextDueAt, null);
  assert.equal(view.rows[0]!.url, "https://example.gov/votes?year=2026");
});
