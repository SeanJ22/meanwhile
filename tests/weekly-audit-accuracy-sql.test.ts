import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordAuditCorrection, recordLiveAuditResult } from "../lib/control-plane/live-audit-log.ts";
import { readAuditWeek } from "./helpers/live-audit.ts";
import { weeklyAuditAccuracy } from "./helpers/live-audit.ts";
import { readWeeklyAuditAccuracy } from "../lib/control-plane/admin-view/weekly-audit-accuracy.ts";
import type { LiveAuditResult } from "../lib/control-plane/workers/live-audit.ts";

const NOW = "2026-10-20T12:00:00.000Z";
test("the Scoreboard's server summary matches complete fixture semantics without transferring saved fact checks or old corrections", async () => {
  const memory = createMemoryRepositories(), db = new PGlite();
  const result = (factId: string, verdict: LiveAuditResult["verdict"], checkedAt: string, area: string): LiveAuditResult => ({
    factId, verdict, checkedAt, area, family: "meetings", pickedBecause: factId === "b" ? "DEMAND" : "ROUTINE",
    sourceUrl: "https://clerk.example.gov/meeting", reread: null, basis: "REREAD", reason: "value checked",
    checks: [{field: "agenda", kind: "VALUE_ON_PAGE", ok: true, value: "private-large-page ".repeat(1000)}],
  });
  try {
    for (const row of [result("a", "GREEN", "2026-10-18T10:00:00.000Z", "current-a"),
      result("a", "RED", "2026-10-19T10:00:00.000Z", "current-a"), result("a", "GREEN", "2026-10-20T10:00:00.000Z", "current-a"),
      result("b", "RED", "2026-10-20T11:00:00.000Z", "current-b"), result("b", "GREEN", "2026-10-13T01:00:00.000Z", "older-b"),
      result("c", "INCONCLUSIVE", "2026-10-19T10:00:00.000Z", "current-c")]) await recordLiveAuditResult(memory, row);
    await recordAuditCorrection(memory, {factId: "a", action: "FIXED", at: "2026-10-20T10:00:00.000Z", summary: "The agenda is corrected."});
    await recordAuditCorrection(memory, {factId: "b", action: "PULLED", at: "2026-10-20T11:00:00.000Z", summary: "The incorrect date was pulled."});
    await recordAuditCorrection(memory, {factId: "old", action: "PULLED", at: "2026-09-01T11:00:00.000Z", summary: "old unrelated correction"});
    await db.exec("CREATE TABLE cp_log_live_audits(key text,position bigint,record jsonb)");
    for (const key of await memory.liveAudits.keys()) for (const [position, record] of (await memory.liveAudits.read(key)).entries())
      await db.query("INSERT INTO cp_log_live_audits VALUES($1,$2,$3)", [key, position, JSON.stringify(record)]);
    const returned: unknown[] = [];
    const actual = await readWeeklyAuditAccuracy({query: async (text, params) => {
      const rows = (await db.query(text, params ? [...params] : [])).rows; returned.push(rows); return rows;
    }}, NOW);
    const expected = weeklyAuditAccuracy({...await readAuditWeek(memory, NOW), now: NOW});
    assert.deepEqual(actual, expected);
    assert.ok(!JSON.stringify(returned).includes("private-large-page") && !JSON.stringify(returned).includes("old unrelated correction"));
    assert.ok(JSON.stringify(returned).length < 1000);
  } finally {await db.close();}
});
