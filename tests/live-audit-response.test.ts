/** A red flag pulls the fact, reopens its work, lands on the fix list, and keeps a lesson that carries the platform. */
import assert from "node:assert/strict";
import test from "node:test";

import type { AuditCorrection } from "../lib/control-plane/admin-view/v6-audit-read.ts";
import type { FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import type { LiveAuditResult } from "../lib/control-plane/workers/live-audit.ts";
import { fixedAfterReaudit, originFromPublications, redFlagLesson, respondToRedFlag, type FactOrigin, type FixItem, type RedFlagWriters } from "../lib/control-plane/workers/live-audit-response.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const red: LiveAuditResult = { pickedBecause: "ROUTINE", factId: "comment-access:a", family: "comment-access", area: "body-a", verdict: "RED", checkedAt: NOW,
  sourceUrl: "https://clerk.example.gov/rules", reread: { url: "https://clerk.example.gov/rules", retrievedAt: NOW, contentHash: "h", artifactId: "ar" },
  basis: "REREAD", checks: [{ field: "signup", kind: "VALUE_ON_PAGE", ok: false, value: "Sign up" }, { field: "commentPeriod", kind: "VALUE_ON_PAGE", ok: true, value: "YES" }],
  reason: "1 of 2 value(s) are no longer on the page: signup." };
const origin: FactOrigin = { workItemId: "wi-1", parserResultId: "wr-p", parserAttemptId: "at-p", extractionRecordIds: ["rec-1"], platform: "civicplus", recordClass: "PUBLIC_COMMENT_RULE", state: "NH", host: "clerk.example.gov" };

function writers(over: Partial<RedFlagWriters> = {}) {
  const log: string[] = [];
  const w: RedFlagWriters = {
    originOf: async () => origin,
    pull: async (p) => { log.push(`pull ${p.workItemId} ${p.recordIds.join(",")}`); },
    reopenWorkItem: async (id, why) => { log.push(`reopen ${id} ${why}`); },
    addFixItem: async (item: FixItem) => { log.push(`fix ${item.id}`); },
    writeLesson: async (entry: FieldManualEntry) => { log.push(`lesson ${entry.platforms.join(",")}`); },
    recordCorrection: async (c: AuditCorrection) => { log.push(`correction ${c.action}`); },
    ...over,
  };
  return { w, log };
}

test("a red flag pulls, reopens, adds a fix-list item, writes the lesson and records the pull, in one pass", async () => {
  const { w, log } = writers();
  const out = await respondToRedFlag(red, w, NOW);
  assert.equal(out.status, "PULLED_AND_REOPENED");
  assert.deepEqual(log.map((l) => l.split(" ")[0]), ["pull", "reopen", "fix", "lesson", "correction"]);
  assert.ok(log[0].includes("rec-1"));
  assert.ok(log[1].includes("signup"));
  assert.equal(log[2], "fix audit-red:comment-access:a:2026-10-05", "one item per fact per day");
  assert.equal(log[3], "lesson civicplus", "the lesson carries the platform");
});

test("green and inconclusive results do nothing", async () => {
  const { w, log } = writers();
  assert.equal((await respondToRedFlag({ ...red, verdict: "GREEN" }, w, NOW)).status, "NOT_RED");
  assert.equal((await respondToRedFlag({ ...red, verdict: "INCONCLUSIVE" }, w, NOW)).status, "NOT_RED");
  assert.deepEqual(log, []);
});

test("a fact that cannot be traced is never pulled blind; it still lands on the one repair list", async () => {
  const { w, log } = writers({ originOf: async () => null });
  const out = await respondToRedFlag(red, w, NOW);
  assert.equal(out.status, "ORIGIN_UNKNOWN");
  assert.deepEqual(log.map((l) => l.split(" ")[0]), ["fix"]);
});

test("the lesson is keyed by platform and record class, so it reaches every door of that kind", () => {
  const a = redFlagLesson(red, origin, NOW);
  const b = redFlagLesson({ ...red, factId: "comment-access:z", sourceUrl: "https://other.example.gov/" }, { ...origin, host: "other.example.gov" }, NOW);
  assert.equal(a.id, b.id, "same platform, class and fields: one lesson, refreshed");
  assert.deepEqual([a.platforms, a.recordClasses, a.states, a.kind, a.role], [["civicplus"], ["PUBLIC_COMMENT_RULE"], ["nh"], "AUDIT_LESSON", "AUDITOR"]);
  const noPlatform = redFlagLesson(red, { ...origin, platform: null }, NOW);
  assert.deepEqual(noPlatform.platforms, []);
});

test("a pulled fact that audits green again becomes FIXED, once", () => {
  const corrections: AuditCorrection[] = [{ factId: "f1", action: "PULLED", at: "2026-10-05T00:00:00.000Z", summary: "s" }, { factId: "f2", action: "PULLED", at: "2026-10-05T00:00:00.000Z", summary: "s" }];
  const green = (factId: string, at: string): LiveAuditResult => ({ ...red, factId, verdict: "GREEN", checkedAt: at });
  const fixed = fixedAfterReaudit(corrections, [green("f1", "2026-10-06T00:00:00.000Z"), green("f2", "2026-10-04T00:00:00.000Z")]);
  assert.deepEqual(fixed.map((c) => [c.factId, c.action]), [["f1", "FIXED"]], "f2 was green before its pull, which proves nothing");
  assert.deepEqual(fixedAfterReaudit([...corrections, ...fixed], [green("f1", "2026-10-07T00:00:00.000Z")]), [], "recorded once");
});

test("a published member is traced to its work item and extraction through the publication outcome", () => {
  const item = { id: "wi-9", publicationOutcome: { status: "PUBLISHED", workerResultId: "wr-p9",
    recordChanges: [{ recordId: "rec-a", readerId: "comment:body-a" }, { recordId: "rec-b", readerId: "comment:body-b" }] },
    autonomousPlan: { contract: { schemaVersion: 2, recordClass: "PUBLIC_COMMENT_RULE", jurisdiction: { state: "NH" } } } };
  const parser = { id: "wr-p9", result: { role: "PARSER", attemptId: "at-p9" } };
  const traced = originFromPublications({ items: [item] as never, parsers: [parser] as never, memberId: "comment:body-b", host: "h.example.gov", platform: "civicplus" });
  assert.deepEqual([traced?.workItemId, traced?.parserAttemptId, traced?.extractionRecordIds, traced?.recordClass, traced?.state],
    ["wi-9", "at-p9", ["rec-b"], "PUBLIC_COMMENT_RULE", "NH"]);
  assert.equal(originFromPublications({ items: [item] as never, parsers: [parser] as never, memberId: "comment:nobody", host: "h", platform: null }), null);
  const held = { ...item, publicationOutcome: { ...item.publicationOutcome, status: "HELD" } };
  assert.equal(originFromPublications({ items: [held] as never, parsers: [parser] as never, memberId: "comment:body-a", host: "h", platform: null }), null, "a held outcome published nothing");
});
