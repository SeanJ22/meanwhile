import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { MODEL_SPEND_SQL, modelSpendView, type ModelSpendRaw } from "../lib/control-plane/admin-view/model-spend.ts";
import { MODELS } from "../lib/models.ts";

test("day totals and per-job model calls reconcile without counting their two views twice", async () => {
  const db = new PGlite();
  try {
    await db.exec("create table cp_log_costs (recorded_at timestamptz, record jsonb)");
    const at = new Date().toISOString();
    const record = (model: string, count: number, usd: number | null) => ({ attemptId: model, workItemId: "job-one", source: "api.anthropic.com", role: "PARSER", model,
      cost: { modelRequestCount: count, usd } });
    for (const row of [record(MODELS.haiku.model, 2, 0.01), record(MODELS.sonnet.model, 1, 0.03), record(MODELS.opus.model, 1, null)]) {
      await db.query("insert into cp_log_costs values ($1,$2)", [at, JSON.stringify(row)]);
    }
    const query = await db.query<Record<string, unknown>>(MODEL_SPEND_SQL, [3]);
    assert.equal(query.rows.length, 6);
    const rows: ModelSpendRaw[] = query.rows.map(r => ({ day: String(r.day), role: String(r.role), model: r.model as string, job: r.job as string | null,
      window: r.window as "day", jobs: Number(r.jobs), calls: r.calls as number | null, usd: r.usd as number | null,
      uncached: null, reads: null, writes: null, writes1h: null, output: null, eligible: null, batched: null, promptBand: 0 }));
    const view = modelSpendView(rows, [], null, at);
    assert.equal(view.days.reduce((sum, row) => sum + (row.calls ?? 0), 0), 4);
    assert.equal(view.jobs.reduce((sum, row) => sum + (row.calls ?? 0), 0), 4);
    assert.ok(view.jobs.every(row => row.job === "job-one"));
    assert.equal(view.days.find(row => row.model === MODELS.opus.model)?.dollars, null);
    assert.equal(view.days.find(row => row.model === MODELS.haiku.model)?.dollars, 0.01);
  } finally { await db.close(); }
});
