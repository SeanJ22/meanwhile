import assert from "node:assert/strict";
import test from "node:test";
import { auditPull } from "../lib/civic-data/worker-publication-evidence.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";

const parser = { id: "wr-parser", workItemId: "wi-1", endedAt: "2026-09-30T10:00:00.000Z", result: { role: "PARSER", attemptId: "at-parse" } } as unknown as WorkerResultRecord;
const audit = (verdict: string, endedAt: string, extra: Record<string, unknown> = {}, workItemId = "wi-1") =>
  ({ id: `wr-audit-${endedAt}`, workItemId, endedAt, result: { role: "ADVERSARIAL_AUDITOR", verdict, producerAttemptId: "at-parse", ...extra } }) as unknown as WorkerResultRecord;

test("a BROKE audit of an extraction pulls the records it names, or all of it when it names none", () => {
  assert.equal(auditPull([parser, audit("SURVIVED", "2026-09-30T11:00:00.000Z")], parser), null);
  assert.equal(auditPull([parser, audit("BROKE", "2026-09-30T11:00:00.000Z", {}, "wi-other")], parser), null, "another job's audit pulls nothing here");
  const named = auditPull([parser, audit("BROKE", "2026-09-30T11:00:00.000Z", { brokenRecordIds: ["r2"] })], parser)!;
  assert.deepEqual([named.all, [...named.recordIds], named.at], [false, ["r2"], "2026-09-30T11:00:00.000Z"]);
  const whole = auditPull([parser, audit("BROKE", "2026-09-30T11:00:00.000Z", { brokenRecordIds: ["r2"] }), audit("BROKE", "2026-09-30T12:00:00.000Z")], parser)!;
  assert.deepEqual([whole.all, whole.at], [true, "2026-09-30T12:00:00.000Z"]);
});
