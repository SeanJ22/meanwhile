import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { countNeonBytes, countVitalSign, flushNeonBytes, readNeonBytesHour } from "../lib/db/transfer-by-caller.ts";
import {
  HOUR_COSTS_SQL, VITAL_COUNTERS, composeVitalSignsRow, controlPlaneByCaller, costPerFact, formatVitalSignsLine,
  readHourCosts, writeVitalSignsRow,
} from "../lib/control-plane/vital-signs.ts";

const HOUR = "2020-02-03T05:00:00.000Z";
const AT = Date.parse("2020-02-03T05:20:00Z");

test("the hour row sums every process's counts, keeps control-plane bytes apart, and leaves uncounted facts unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "vital-signs-"));
  try {
    countNeonBytes("control-plane", 3_000, AT);
    countNeonBytes("reader", 900, AT);
    countVitalSign(VITAL_COUNTERS.roundsFinished, 2, AT);
    countVitalSign(VITAL_COUNTERS.roundsDeferred, 1, AT);
    flushNeonBytes(dir, AT);
    const accounting = readNeonBytesHour(dir, HOUR);
    const row = composeVitalSignsRow({ accounting, releaseSha: "abc", writtenAt: "2020-02-03T05:20:00.000Z",
      costs: { spendUsd: 1.5, unpricedCharges: 0, paidJobsEnded: 4, paidJobsEndedEmpty: 1 } });
    assert.equal(row.hour, HOUR);
    assert.equal(row.neonBytesRead, 3_000, "the reader database's bytes are not the control plane's");
    assert.equal(Object.values(row.neonBytesByCaller).reduce((a, b) => a + b, 0), 3_000);
    assert.deepEqual([row.roundsFinished, row.roundsKilled, row.roundsDeferred], [2, 0, 1]);
    assert.equal(row.factsLive, null, "no publisher counted facts this hour");
    assert.equal(row.costPerFactUsd, null);
    assert.deepEqual([row.spendUsd, row.paidJobsEnded, row.paidJobsEndedEmpty], [1.5, 4, 1]);
    assert.match(formatVitalSignsLine(row, "last full hour"), /facts live —, spend \$1\.50 .* paid jobs ended empty 1 of 4$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("spend that could not be read is unknown, never zero", () => {
  const row = composeVitalSignsRow({ releaseSha: null, writtenAt: HOUR, costs: null,
    accounting: { hour: HOUR, requests: 0, bytes: { reader: 0, "control-plane": 0 }, byCaller: {}, processes: [], counters: { facts_live: 3 } } });
  assert.deepEqual([row.spendUsd, row.unpricedCharges, row.paidJobsEnded, row.paidJobsEndedEmpty, row.costPerFactUsd], [null, null, null, null, null]);
  assert.equal(row.factsLive, 3);
});

test("cost per fact is spend over facts, unknown when either is unknown or no fact went live", () => {
  assert.equal(costPerFact(2, 8), 0.25);
  assert.equal(costPerFact(2, 0), null);
  assert.equal(costPerFact(null, 8), null);
  assert.equal(costPerFact(2, null), null);
});

test("the caller split keeps the 20 largest control-plane callers and sums the rest as other", () => {
  const byCaller: Record<string, number> = { "reader: x ← lib/r.ts:1": 10_000 };
  for (let i = 0; i < 25; i++) byCaller[`cp_t.list ← lib/a.ts:${i}`] = 100 + i;
  const split = controlPlaneByCaller({ hour: HOUR, requests: 0, bytes: { reader: 0, "control-plane": 0 }, byCaller, processes: [] });
  assert.equal(Object.keys(split).length, 21);
  assert.equal(split["cp_t.list ← lib/a.ts:24"], 124);
  assert.equal(split.other, 100 + 101 + 102 + 103 + 104);
  assert.equal(Object.keys(split).some(key => key.startsWith("reader: ")), false);
});

test("the cost read is one bounded aggregate over the hour by its index; the write says when the table is missing", async () => {
  const sent: { text: string; params: readonly unknown[] }[] = [];
  const sql = { query: async (text: string, params: readonly unknown[] = []) => {
    sent.push({ text, params });
    return [{ spend_usd: "0.88", unpriced: 1, paid_jobs_ended: 4, paid_jobs_ended_empty: 3 }];
  } };
  assert.deepEqual(await readHourCosts(sql, HOUR), { spendUsd: 0.88, unpricedCharges: 1, paidJobsEnded: 4, paidJobsEndedEmpty: 3 });
  assert.equal(sent[0]!.text, HOUR_COSTS_SQL);
  assert.deepEqual(sent[0]!.params, [HOUR, "2020-02-03T06:00:00.000Z"]);
  assert.match(HOUR_COSTS_SQL, /WHERE recorded_at >= \$1::timestamptz AND recorded_at < \$2::timestamptz$/);

  const row = composeVitalSignsRow({ releaseSha: "abc", writtenAt: HOUR, costs: null,
    accounting: { hour: HOUR, requests: 0, bytes: { reader: 0, "control-plane": 0 }, byCaller: {}, processes: [] } });
  const missing = { query: async () => { throw Object.assign(new Error("relation \"cp_vital_signs\" does not exist"), { code: "42P01" }); } };
  assert.equal(await writeVitalSignsRow(missing, row), "TABLE_NOT_INSTALLED");
  const written: unknown[][] = [];
  assert.equal(await writeVitalSignsRow({ query: async (_t: string, p: readonly unknown[] = []) => { written.push([...p]); return []; } }, row), "WRITTEN");
  assert.equal(written[0]![0], HOUR);
  assert.equal(written[0]![8], "{}");
  const broken = { query: async () => { throw Object.assign(new Error("permission denied"), { code: "42501" }); } };
  await assert.rejects(writeVitalSignsRow(broken, row), /permission denied/);
});
