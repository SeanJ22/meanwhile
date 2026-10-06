/** DP-32: a door that breaks in the same month across years, or right after the same event, gets a lesson with the fix that worked last time. */
import assert from "node:assert/strict";
import test from "node:test";

import { withEpisodeKept, type FixItemWithHistory } from "../lib/control-plane/fix-history.ts";
import { FIELD_MANUAL_ID } from "../lib/control-plane/field-manual.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { BREAK_PATTERN_KIND, breakPatterns, runBreakPatternPass } from "../lib/method/break-patterns.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const base = (over: Partial<FixItemWithHistory> = {}): FixItemWithHistory => ({
  id: "fix-1", where: "Door d-1", says: "The meetings door is shut.", addedBy: "The shut-door check", addedAt: "2025-03-04T15:00:00.000Z",
  state: "FIXED", fixedAt: "2025-03-05T15:00:00.000Z", whatChanged: "The door's record was edited to read the new agenda page.", ...over,
});
/** Broke March 2025, fixed; broke March 2026, fixed again. */
const twoMarches = (): FixItemWithHistory => ({ ...withEpisodeKept(base(), "2026-03-09T15:00:00.000Z"), state: "FIXED", fixedAt: "2026-03-10T15:00:00.000Z" });

test("the same month in two years is a pattern; one year, or two different months, is not", () => {
  const found = breakPatterns([twoMarches()], NOW);
  assert.deepEqual(found.map((p) => [p.where, p.kind, p.when, p.breaks.length]), [["Door d-1", "SAME_MONTH", "March", 2]]);
  assert.equal(found[0].lastFix, "The door's record was edited to read the new agenda page.");
  assert.deepEqual(breakPatterns([base()], NOW), [], "one break is not a pattern");
  const twoMonths: FixItemWithHistory = { ...withEpisodeKept(base(), "2026-06-09T15:00:00.000Z"), state: "FIXED", fixedAt: "2026-06-10T15:00:00.000Z" };
  assert.deepEqual(breakPatterns([twoMonths], NOW), []);
});

test("breaking within a week after the same event twice is a pattern", () => {
  const events = [{ name: "the fiscal year starting", at: "2025-03-01T00:00:00.000Z" }, { name: "the fiscal year starting", at: "2026-03-05T00:00:00.000Z" }];
  const found = breakPatterns([twoMarches()], NOW, events).filter((p) => p.kind === "AFTER_EVENT");
  assert.deepEqual(found.map((p) => [p.when, p.breaks.length]), [["the fiscal year starting", 2]]);
});

test("the pass writes one lesson per pattern to the field manual, and rewrites it rather than duplicating", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { ...defaultAdminConfig(NOW), fixList: [twoMarches()] }, NOW);
  assert.deepEqual(await runBreakPatternPass(repos, NOW), { patterns: 1, written: 1 });
  await runBreakPatternPass(repos, NOW);
  const entries = (await repos.fieldManual.read(FIELD_MANUAL_ID))!.value.entries.filter((e) => e.kind === BREAK_PATTERN_KIND);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].role, "DETECTIVE");
  assert.match(entries[0].summary, /^Door d-1 has broken in March in 2025 and 2026\. Have the last fix ready before March: The door's record was edited/);
  assert.doesNotMatch(entries[0].summary, /\n/);
});

test("with no history the pass writes nothing", async () => {
  const repos = createMemoryRepositories();
  assert.deepEqual(await runBreakPatternPass(repos, NOW), { patterns: 0, written: 0 });
  assert.equal(await repos.fieldManual.read(FIELD_MANUAL_ID), null);
});
