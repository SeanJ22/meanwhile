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
  }, "US-TX", "", "2026-10-15T12:30:00Z");
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
