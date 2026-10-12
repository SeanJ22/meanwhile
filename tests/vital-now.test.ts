import assert from "node:assert/strict";
import test from "node:test";
import { NEON_HOUR_TARGET_BYTES, readVitalNow, vitalHours } from "../lib/control-plane/admin-view/vital-now.ts";

const row = (hour: string, extra: Record<string, unknown> = {}) => ({ hour, facts_live: 12, cost_per_fact_usd: "0.25", neon_bytes_read: "500000000", rounds_finished: 4, rounds_killed: 1, paid_jobs_ended_empty: 0, paid_jobs_ended: 9, ...extra });

test("the last two hours come out newest first; a count nobody recorded stays null, never zero", () => {
  const h = vitalHours([row("2026-10-06T10:00:00Z", { facts_live: null, cost_per_fact_usd: null, neon_bytes_read: null }), row("2026-10-06T11:00:00Z")]);
  assert.deepEqual(h.map((x) => x.hour), ["2026-10-06T11:00:00.000Z", "2026-10-06T10:00:00.000Z"]);
  assert.equal(h[0]!.costPerFactUsd, 0.25);
  assert.equal(h[0]!.neonGb, 0.5);
  assert.equal(h[0]!.overNeonTarget, false);
  assert.equal(h[1]!.factsLive, null);
  assert.equal(h[1]!.neonGb, null);
  assert.equal(h[1]!.overNeonTarget, null);
});

test("over 0.7 GB is flagged; paid jobs that ended empty carry both counts", () => {
  const [h] = vitalHours([row("2026-10-06T11:00:00Z", { neon_bytes_read: String(NEON_HOUR_TARGET_BYTES + 1), paid_jobs_ended_empty: 2 })]);
  assert.equal(h!.overNeonTarget, true);
  assert.equal(h!.paidJobsEndedEmpty, 2);
  assert.equal(h!.paidJobsEnded, 9);
});

test("one bounded read of the two complete hours before now; the open hour is not read; a missing table is not measured", async () => {
  const seen: unknown[][] = [];
  const sql = Object.assign(async () => [], { query: async (text: string, params: unknown[]) => { seen.push([text, params]); return []; } });
  const rows = await readVitalNow(sql as never, "2026-10-06T11:40:00Z");
  assert.deepEqual(rows, []);
  assert.deepEqual(seen[0]?.[1], ["2026-10-06T09:00:00.000Z", "2026-10-06T11:00:00.000Z"]);
  assert.match(String(seen[0]?.[0]), /LIMIT 2/);
  const missing = Object.assign(async () => [], { query: async () => { throw Object.assign(Error("no table"), { code: "42P01" }); } });
  assert.equal(await readVitalNow(missing as never, "2026-10-06T11:40:00Z"), null);
});
