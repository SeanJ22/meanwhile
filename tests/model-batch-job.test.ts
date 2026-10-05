import assert from "node:assert/strict";
import test from "node:test";
import { batchEnabledForJob } from "../lib/control-plane/model-batch.ts";

test("BX-13: reader deadlines use immediate transport even when batch is enabled", () => {
  for (const lane of ["background-worker-parse", "background-worker-audit"] as const) {
    for (const job of ["LIVE_REFRESH", "PUBLISH_NOW", "MISSION_CORE", undefined] as const)
      assert.equal(batchEnabledForJob(lane, job, { WTP_BACKGROUND_WORKER_BATCH: "1" }), false);
    for (const job of ["BACKFILL", "HISTORY", "AUDIT_SAMPLE"] as const) {
      assert.equal(batchEnabledForJob(lane, job, {}), true);
      assert.equal(batchEnabledForJob(lane, job, { WTP_BACKGROUND_WORKER_BATCH: "0" }), false);
    }
  }
});
