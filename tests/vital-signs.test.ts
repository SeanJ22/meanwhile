import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { countNeonBytes, countVitalSign, formatVitalSignsReport, parseVitalSignsReport, takeNeonBytesHours, type NeonBytesHour } from "../lib/db/transfer-by-caller.ts";
import { keepNeonBytesPart, readNeonBytesHour } from "../lib/ops/vital-signs-hours.ts";
import {
  HOUR_COSTS_SQL, VITAL_COUNTERS, composeVitalSignsRow, controlPlaneByCaller, costPerFact, formatVitalSignsLine,
  readHourCosts, writeVitalSignsRow,
} from "../lib/control-plane/vital-signs.ts";
import { readVitalSigns } from "../lib/control-plane/admin-view/vital-signs-read.ts";

const HOUR = "2020-02-03T05:00:00.000Z";
const AT = Date.parse("2020-02-03T05:20:00Z");

test("Admin keeps the runner readings after the line inventory is retired, without crediting unmeasured delivery", async () => {
  let query = "";
  let params: readonly unknown[] = [];
  const rows = await readVitalSigns({ query: async (text, values = []) => {
    query = text; params = values;
    return [{ hour: HOUR, facts_live: null, cost_per_fact_usd: null, neon_bytes_read: "800000000",
      rounds_finished: 4, rounds_killed: 1, paid_jobs_ended_empty: 2, paid_jobs_ended: 3 }];
  } }, "2020-02-03T06:05:00Z");
  assert.match(query, /FROM cp_vital_signs WHERE hour >=/);
  assert.doesNotMatch(query, /cp_owner_snapshots/);
  assert.deepEqual(params, ["2020-02-03T06:00:00.000Z"]);
  assert.deepEqual([rows[0].factsLive, rows[0].factsLiveConfirmed, rows[0].costPerFactUsd], [null, false, null]);
  assert.deepEqual([rows[0].roundsFinished, rows[0].roundsKilled, rows[0].paidJobsEndedEmpty], [4, 1, 2]);
  assert.deepEqual([rows[0].neonGb, rows[0].neonAtLeast, rows[0].overNeonTarget], [0.8, true, true]);
});

test("the hour row sums every process's counts, keeps control-plane bytes apart, and leaves uncounted facts unknown", () => {
  const dir = mkdtempSync(join(tmpdir(), "vital-signs-"));
  try {
    countNeonBytes("control-plane", 3_000, AT);
    countNeonBytes("reader", 900, AT);
    countVitalSign(VITAL_COUNTERS.roundsFinished, 2, AT);
    countVitalSign(VITAL_COUNTERS.roundsDeferred, 1, AT);
    for (const part of takeNeonBytesHours(AT)) keepNeonBytesPart(dir, part);
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
  const split = controlPlaneByCaller({ hour: HOUR, requests: 0, bytes: { reader: 10_000, "control-plane": 2_800 }, byCaller, processes: [] });
  assert.equal(Object.keys(split).length, 21);
  assert.equal(split["cp_t.list ← lib/a.ts:24"], 124);
  assert.equal(split.other, 100 + 101 + 102 + 103 + 104);
  assert.equal(Object.keys(split).some(key => key.startsWith("reader: ")), false);
});

test("merged truncated child reports reconcile control-plane callers without including hidden reader bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "vital-signs-truncated-"));
  try {
    const hot = "cp_hot.read ← scripts/hunt.ts:1";
    const byCaller: Record<string, number> = { [hot]: 100_000, "reader: pages.read ← app/page.ts:1": 200_000 };
    const bytes = { reader: 200_000, "control-plane": 100_000 };
    for (let index = 0; index < 120; index++) {
      const database = index % 2 ? "reader" : "control-plane";
      const amount = 100 + index;
      byCaller[`${database === "reader" ? "reader: " : ""}query ← lib/${"long-caller-path-".repeat(10)}:${index}`] = amount;
      bytes[database] += amount;
    }
    const part: NeonBytesHour = { hour: HOUR, requests: 122, bytes, byCaller, processes: ["child#42"], pid: 42, startedMs: 1 };
    const report = formatVitalSignsReport(part);
    assert.ok(Buffer.byteLength(report) <= 3_800);
    const child = parseVitalSignsReport(report)!;
    const keptReader = Object.entries(child.byCaller).filter(([name]) => name.startsWith("reader: ")).reduce((total, [, amount]) => total + amount, 0);
    const keptControl = Object.entries(child.byCaller).filter(([name]) => name !== "other" && !name.startsWith("reader: ")).reduce((total, [, amount]) => total + amount, 0);
    assert.ok(keptReader < bytes.reader && keptControl < bytes["control-plane"], "truncation groups callers from both databases");
    assert.equal(child.byCaller.other, bytes.reader - keptReader + bytes["control-plane"] - keptControl);
    keepNeonBytesPart(dir, child);
    const parent = "cp_parent.read ← scripts/runner.ts:1";
    keepNeonBytesPart(dir, { hour: HOUR, requests: 1, bytes: { reader: 0, "control-plane": 250_000 },
      byCaller: { [parent]: 250_000 }, processes: ["parent#43"], pid: 43, startedMs: 1 });
    const accounting = readNeonBytesHour(dir, HOUR);
    const row = composeVitalSignsRow({ accounting, releaseSha: "abc", writtenAt: HOUR, costs: null });
    assert.equal(row.neonBytesByCaller[hot], 100_000);
    for (const split of [row.neonBytesByCaller, controlPlaneByCaller(accounting, 1)]) {
      assert.equal(split[parent], 250_000);
      assert.equal(Object.values(split).reduce((total, amount) => total + amount, 0), row.neonBytesRead);
      assert.equal(Object.keys(split).some(name => name.startsWith("reader: ")), false);
      assert.ok(split.other > 0);
    }
    assert.equal(row.neonBytesRead, bytes["control-plane"] + 250_000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
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

test("facts live count once per published version, in BR-31's unit, and a check counts none", async () => {
  const { recordPublicationFlow } = await import("../lib/civic-data/publication-flow.ts");
  const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
  const { processNeonBytes, hourStart } = await import("../lib/db/transfer-by-caller.ts");
  const facts = () => processNeonBytes().find(hour => hour.hour === hourStart(Date.now()))?.counters?.facts_live ?? 0;
  const repos = createMemoryRepositories();
  const before = facts();
  const at = new Date().toISOString();
  await recordPublicationFlow(repos, "cand-1", { workerResultId: "wr-1", stage: "CHECKED", records: 9, changedRecords: 4, versionId: null }, at);
  await recordPublicationFlow(repos, "cand-1", { workerResultId: "wr-1", stage: "LIVE", records: 9, changedRecords: 4, versionId: "v1" }, at);
  await recordPublicationFlow(repos, "cand-1", { workerResultId: "wr-1", stage: "LIVE", records: 9, changedRecords: 4, versionId: "v1" }, at);
  await recordPublicationFlow(repos, "cand-2", { workerResultId: "wr-2", stage: "LIVE", records: 3, changedRecords: 0, versionId: "v2" }, at);
  assert.equal(facts() - before, 4);
});
