import test from "node:test";
import assert from "node:assert/strict";
import { campaignPublicationDue, readLatestCampaignApprovalAt, CAMPAIGN_PUBLICATION_TASK } from "../lib/civic-data/campaign-publication-due.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue, routineFailureDomainFrontier } from "../lib/civic-data/runner.ts";

test("new approvals enter the normal publication frontier before hourly cadence without changing other families", () => {
  const task = ROUTINE_SOURCE_TASKS.find(task => task.id === CAMPAIGN_PUBLICATION_TASK)!;
  const clock = { lastAttemptedAt: "2026-09-26T10:00:00Z", lastSucceededAt: "2026-09-26T10:00:00Z" };
  const nowMs = Date.parse("2026-09-26T10:05:00Z");
  const input = { taskId: task.id, approvalAt: "2026-09-26T10:04:00Z", ...clock, nowMs };
  assert.equal(routineTaskDue(task, clock, nowMs), false);
  assert.equal(campaignPublicationDue(input), true);
  assert.equal(routineFailureDomainFrontier([{ task, lastConsideredAt: clock.lastAttemptedAt }]).length, 1);
  for (const other of ROUTINE_SOURCE_TASKS.filter(row => row.id !== task.id)) assert.equal(campaignPublicationDue({ ...input, taskId: other.id }), false);
  assert.equal(campaignPublicationDue({ ...input, lastAttemptedAt: "2026-09-26T10:04:30Z" }), false, "a restart after an attempt does not loop unchanged failures");
  assert.equal(campaignPublicationDue({ ...input, approvalAt: "2026-09-26T11:00:00Z" }), false);
  assert.equal(campaignPublicationDue({ ...input, approvalAt: null }), false);
});

test("publication admission uses a bounded approval clock and preserves unread errors", async () => {
  let sql = "";
  assert.equal(await readLatestCampaignApprovalAt(async query => { sql = query; return [{ approved_at: "2026-09-26 10:04:00+00" }]; }), "2026-09-26T10:04:00.000Z");
  assert.match(sql, /APPROVED_FOR_PROMOTION/);
  assert.match(sql, /campaignSite/);
  assert.match(sql, /LIMIT 1$/);
  assert.match(sql, /ORDER BY recorded_at DESC/);
  assert.doesNotMatch(sql, /record->>'at'/);
  assert.equal(await readLatestCampaignApprovalAt(async () => []), null);
  await assert.rejects(readLatestCampaignApprovalAt(async () => [{ approved_at: "invalid" }]), /CLOCK_INVALID/);
  await assert.rejects(readLatestCampaignApprovalAt(async () => { throw new Error("read unavailable"); }), /read unavailable/);
});
