/** The Scoreboard's audit row reads the week's live audits from the log: a real N, the share still accurate, the facts fixed or pulled, and "—" when nothing was judged. */
import assert from "node:assert/strict";
import test from "node:test";

import { buildLearningTrends } from "../lib/control-plane/admin-view/learning-trends.ts";
import { auditRow, buildScoreboard, v6LearningView, type ScoreboardReadings } from "../lib/control-plane/admin-view/scoreboard-read.ts";
import { weeklyAuditAccuracy } from "./helpers/live-audit.ts";
import { recordAuditCorrection, recordLiveAuditResult } from "../lib/control-plane/live-audit-log.ts";
import { readAuditWeek } from "./helpers/live-audit.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { LiveAuditResult } from "../lib/control-plane/workers/live-audit.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const result = (factId: string, verdict: LiveAuditResult["verdict"], checkedAt = "2026-10-04T12:00:00.000Z"): LiveAuditResult => ({
  pickedBecause: "ROUTINE", factId, family: "comment-access", area: "area-1", verdict, checkedAt, sourceUrl: "https://clerk.example.gov/rules",
  reread: null, basis: "REREAD", checks: [], reason: "Read the page again.",
});
const readings = (audit: ScoreboardReadings["audit"]): ScoreboardReadings => ({
  places: null, placesUnread: 0, orders: null, publication: null, shutDoors: null, returning: null, doors: null, gates: null, readiness: [],
  learning: v6LearningView(buildLearningTrends([], NOW), null), audit,
});

test("the row reads the logged week: N judged, the share still right, and the facts we fixed", async () => {
  const repos = createMemoryRepositories();
  for (const r of [result("f1", "GREEN"), result("f2", "GREEN"), result("f3", "GREEN"), result("f4", "RED"), result("f5", "INCONCLUSIVE"),
    result("old", "RED", "2026-09-20T12:00:00.000Z")]) await recordLiveAuditResult(repos, r);
  await recordAuditCorrection(repos, { factId: "f4", action: "PULLED", at: "2026-10-04T13:00:00.000Z", summary: "The speaking time was wrong, so it was taken off the page." });
  const audit = weeklyAuditAccuracy({ ...(await readAuditWeek(repos, NOW)), now: NOW });
  const row = buildScoreboard(readings(audit)).rows.find((r) => r.id === "Audit accuracy")!;
  assert.equal(row.value, "75%");
  assert.match(row.says, /^Of 4 facts audited this week, 75% are still accurate\. Here is the one we pulled\./);
  assert.equal(row.counts, "3 still right · 1 wrong · 1 could not be checked · 0 fixed · 1 taken off the page");
  assert.deepEqual(row.items, ["Taken off the page Oct 4: The speaking time was wrong, so it was taken off the page."]);
  assert.ok(row.technical?.[0].startsWith("f4 · "), "the fact's ID stays behind Technical details");
  assert.equal(row.notMeasured, null);
});

test("nothing audited shows — with why; an unreadable log and an unread one say so, never 0%", () => {
  const none = auditRow(weeklyAuditAccuracy({ results: [], corrections: [], now: NOW }));
  assert.equal(none.value, null);
  assert.equal(none.notMeasured, "No published fact has been audited this week.");
  assert.equal(auditRow(null).value, null);
  assert.match(auditRow(null).notMeasured!, /could not be read/);
  assert.equal(auditRow(undefined).value, null);
});
