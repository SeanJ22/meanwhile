import assert from "node:assert/strict";
import test from "node:test";

import { fixItems } from "../lib/control-plane/fix-list.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { readAuditWeek, readLiveAuditPulls, weekDayKeys } from "../lib/control-plane/live-audit-log.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { curatedReaderCatalog, type PageRead } from "../lib/control-plane/workers/live-audit.ts";
import { combinedCatalog, runLiveAuditCycle } from "../lib/control-plane/workers/live-audit-run.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const LATER = "2026-10-07T12:00:00.000Z";
const URL = "https://clerk.example.gov/rules";
const rule = (id: string) => ({ id, kind: "comment-access", bodyId: `body-${id}`, commentPeriod: "YES",
  commentPeriodDetail: `Residents of ${id} may speak for three minutes.`, sourceUrl: `${URL}/${id}`, verifiedAt: NOW });
const pageOf = (texts: Record<string, string>) => async (url: string): Promise<PageRead | null> => {
  const id = url.split("/").at(-1)!;
  return id in texts ? { url, text: texts[id], retrievedAt: NOW, contentHash: `h-${id}`, artifactId: null } : null;
};
const catalog = combinedCatalog([curatedReaderCatalog("comment-access", [rule("a"), rule("b")]), curatedReaderCatalog("comment-access", [rule("c")])]);
const policy = { perAreaPerPass: 1, areasPerPass: 10, minHoursBetweenAudits: 24, poolPerArea: 5, refreshMaxAgeHours: 36,
  maxFetchesPerPass: 10, boostExtraPerArea: 0, boostedMinHoursBetweenAudits: 24 };

test("every result is kept by day; a red flag unpulled for want of a trace goes on the fix list and teaches a lesson", async () => {
  const repos = createMemoryRepositories();
  const out = await runLiveAuditCycle({ repos, catalog, policy, now: NOW, passId: "p1",
    fetchPage: pageOf({ a: "Residents of a may speak for three minutes.", b: "Residents of b may speak for five minutes." }) });
  assert.deepEqual([out.summary.green, out.summary.red, out.summary.inconclusive], [1, 1, 1]);
  const week = await readAuditWeek(repos, NOW);
  assert.equal(week.results.length, 3);
  assert.deepEqual(out.redFlags.map((r) => [r.factId, r.status]), [["comment-access:b", "ORIGIN_UNKNOWN"]]);
  const config = (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { fixList: true })).value as AdminConfig;
  const items = fixItems(config);
  assert.equal(items.length, 1);
  assert.equal(items[0].where, "comment-access:b");
  assert.equal(items[0].addedBy, "The live audit");
  assert.match(items[0].says, /not pulled automatically/);
  assert.deepEqual(await repos.fieldManual.list(), [], "no lesson without a traced origin");

  const again = await runLiveAuditCycle({ repos, catalog, policy, now: NOW, passId: "p1", fetchPage: async () => { throw new Error("no fetch"); } });
  assert.equal(again.summary.sampled, 0, "a fact checked within the hold is not checked again");
});

test("a traced red flag is pulled, its work reopened and its lesson kept; when it audits green again it is marked fixed", async () => {
  const repos = createMemoryRepositories();
  const reopened: string[] = [];
  const trace = {
    originOf: async (factId: string) => ({ workItemId: `wi-${factId.split(":")[1]}`, parserResultId: "pr", parserAttemptId: "pa",
      extractionRecordIds: ["r1", "r2"], platform: "granicus", recordClass: "comment-rules", state: "AZ", host: "clerk.example.gov" }),
    reopenWorkItem: async (id: string) => { reopened.push(id); },
  };
  const one = combinedCatalog([curatedReaderCatalog("comment-access", [rule("b")])]);
  const first = await runLiveAuditCycle({ repos, catalog: one, policy, now: NOW, passId: "p1", trace,
    fetchPage: pageOf({ b: "Residents of b may speak for five minutes." }) });
  assert.equal(first.redFlags[0].status, "PULLED_AND_REOPENED");
  assert.deepEqual(reopened, ["wi-b"]);
  const pulls = await readLiveAuditPulls(repos, "wi-b");
  assert.deepEqual(pulls.map((p) => [p.parserAttemptId, p.recordIds]), [["pa", ["r1", "r2"]]]);
  const manual = { value: { entries: (await repos.fieldManual.list()).map((row) => row.value) } };
  const lesson = manual?.value.entries.find((e) => e.kind === "AUDIT_LESSON");
  assert.deepEqual(lesson?.platforms, ["granicus"], "the lesson reaches every door on the platform");
  assert.deepEqual((await readAuditWeek(repos, NOW)).corrections.map((c) => c.action), ["PULLED"]);

  const second = await runLiveAuditCycle({ repos, catalog: one, policy, now: LATER, passId: "p2", trace,
    fetchPage: pageOf({ b: "Residents of b may speak for three minutes." }) });
  assert.equal(second.summary.green, 1);
  assert.equal(second.fixed, 1);
  assert.deepEqual((await readAuditWeek(repos, LATER)).corrections.map((c) => c.action), ["PULLED", "FIXED"]);
});

test("a week of day keys reaches back seven days and includes today", () => {
  const keys = weekDayKeys(NOW);
  assert.equal(keys.length, 8);
  assert.equal(keys[0], "day:2026-10-05");
  assert.equal(keys.at(-1), "day:2026-09-28");
});

test("the work-item trace reopens with a recorded REOPENED transition, and finds no origin for a member no work published", async () => {
  const { createWorkItem } = await import("../lib/control-plane/work-item.ts");
  const { workItemTrace } = await import("../lib/control-plane/workers/live-audit-run.ts");
  const repos = createMemoryRepositories();
  const item = createWorkItem({ project: "p", subject: "s", obligation: "o", why: "w", now: NOW });
  await repos.workItems.put(item.id, item, NOW);
  const trace = workItemTrace(repos, () => "clerk.example.gov");
  assert.equal(await trace.originOf("comment-access:nobody"), null);
  await trace.reopenWorkItem(item.id, "Live audit: a value left its page.");
  const after = (await repos.workItems.mustRead(item.id)).value;
  assert.equal(after.state, "REOPENED");
  assert.match(after.transitions.at(-1)?.by ?? "", /^live-audit:/);
  assert.equal((await repos.transitions.read(item.id)).length, 1);
});

test("the audit policy is Admin's audit.policy setting; unset or invalid reads the code default (DP-17)", async () => {
  const { auditPolicyFrom } = await import("../lib/control-plane/workers/live-audit-run.ts");
  const { AUDIT_POLICY_SETTING, LIVE_AUDIT_DEFAULT_POLICY, isLiveAuditPolicy } = await import("../lib/control-plane/audit-policy.ts");
  const { settingDefinition, withSetting } = await import("../lib/control-plane/settings.ts");
  const { defaultAdminConfig } = await import("../lib/control-plane/gateway/admin-config.ts");
  const repos = createMemoryRepositories();
  assert.deepEqual(await auditPolicyFrom(repos), LIVE_AUDIT_DEFAULT_POLICY);
  assert.ok(settingDefinition(AUDIT_POLICY_SETTING), "Admin lists the setting");
  const wider = { ...LIVE_AUDIT_DEFAULT_POLICY, perAreaPerPass: 3, maxFetchesPerPass: 120 };
  await repos.adminConfig.put(ADMIN_CONFIG_ID, withSetting(defaultAdminConfig(NOW), { id: "c1", key: AUDIT_POLICY_SETTING, after: wider, at: NOW, why: "" }), NOW);
  assert.deepEqual(await auditPolicyFrom(repos), wider);
  assert.equal(isLiveAuditPolicy({ ...wider, perAreaPerPass: 0 }), false);
  assert.equal(isLiveAuditPolicy({ ...wider, extra: 1 }), false);
});
