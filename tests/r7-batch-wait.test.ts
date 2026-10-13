import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { runLeaseWorkerProcesses } from "../lib/control-plane/workers/process-pool.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { MODELS } from "../lib/models.ts";

test("R7: actual batch waiting outlasts the worker clock and its quiet clock, then releases the worker normally", async () => {
  const root = await mkdtemp(join(tmpdir(), "r7-batch-wait-"));
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/register-test-loader.mjs"), "");
    await writeFile(join(root, "worker.mjs"), `let config; process.on('message', message => {
      if (!message.id) { config=message; process.send({kind:'model',id:'batch',taskId:'owed',jurisdiction:{subjectId:'fixture',state:'NH'},
        body:{model:'${MODELS.haiku.model}',max_tokens:10,system:[],tools:[],messages:[]}}); }
      else { process.send({kind:'result',body:{routeTaskId:'owed',attemptId:'fixture',outcome:message.error?'FAILED':'WORKED'}});
        process.send({kind:'finished',body:config.taskIds}); process.disconnect(); }
    });`);
    let customId = "";
    const transport = backgroundBatchTransport({ apiKey: "fixture", pollIntervalMs: 1, sleep: async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
    }, fetchImpl: async (url, init) => {
      if (init?.method === "POST") {
        const request = JSON.parse(String(init.body)).requests[0];
        customId = request.custom_id;
        assert.equal(request.params.onBatchWait, undefined);
        return Response.json({ id: "fixture-batch", processing_status: "in_progress", request_counts: {}, results_url: null });
      }
      if (String(url).endsWith("/results")) return new Response(JSON.stringify({ custom_id: customId,
        result: { type: "succeeded", message: { model: MODELS.haiku.model, content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } } }));
      return Response.json({ id: "fixture-batch", processing_status: "ended", request_counts: {}, results_url: "https://api.anthropic.com/fixture/results" });
    } });
    const results = await runLeaseWorkerProcesses({ entry: "worker.mjs", childTimeoutMs: 300,
      config: { root, postgres: false, taskIds: ["owed"], modelEnabled: true, searchEnabled: false, ceilingUsd: 1, fundedSubjects: [] },
      standing: { quietMs: 300 }, capacity: () => 1, transportFor: () => transport });
    assert.equal(results.length, 1);
    assert.equal(results[0].outcome, "WORKED", results[0].detail);
  } finally { await rm(root, { recursive: true, force: true }); }
});
