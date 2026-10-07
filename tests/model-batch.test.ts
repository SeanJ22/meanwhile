/**
 * The batch route: the request shape against a fake fetch, each lane's flag and default, the results file's shape,
 * and the prohibition that no reader-facing path reaches the batch module.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import {
  BATCH_LANES,
  MESSAGE_BATCHES_ENDPOINT,
  MessageBatchError,
  batchEnabledFor,
  batchRequestBody,
  readMessageBatchResults,
  runSingleRequestBatch,
  backgroundBatchTransport,
} from "../lib/control-plane/model-batch.ts";
import { MODELS } from "../lib/models.ts";
import { modelResponseUsd } from "../lib/control-plane/fleet-safety.ts";

test("unattended reviews coalesce, correlate out-of-order results, cache and charge the batch price", async () => {
  let submitted: { custom_id: string; params: Record<string, unknown> }[] = [];
  let posts = 0;
  const transport = backgroundBatchTransport({ apiKey: "test", fetchImpl: async (url, init) => {
    if (String(url) === MESSAGE_BATCHES_ENDPOINT) {
      posts++;
      submitted = JSON.parse(String(init?.body)).requests;
      assert.equal((submitted[0].params.cache_control as { type: string }).type, "ephemeral");
      return jsonResponse(200, { id: "mb", processing_status: "ended", results_url: "https://provider/results" });
    }
    return jsonResponse(200, submitted.slice().reverse().map(entry => JSON.stringify({ custom_id: entry.custom_id,
      result: { type: "succeeded", message: { model: entry.params.model, stop_reason: "end_turn", content: [],
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } })).join("\n"), true);
  } });
  const request = { max_tokens: 10, system: [], tools: [], messages: [] };
  const results = await Promise.all([transport({ ...request, model: MODELS.haiku.model }), transport({ ...request, model: MODELS.sonnet.model })]);
  assert.equal(posts, 1);
  assert.equal(submitted.length, 2);
  assert.deepEqual(results.map(result => result.model), [MODELS.haiku.model, MODELS.sonnet.model]);
  assert.ok(results.every(result => result.batch));
  assert.equal(modelResponseUsd(results[0]), modelResponseUsd({ ...results[0], batch: false })! / 2);
});

const jsonResponse = (status: number, body: unknown, text = false): Response =>
  new Response(text ? String(body) : JSON.stringify(body), { status, headers: { "content-type": text ? "application/x-ndjson" : "application/json" } });

test("each unattended lane uses its declared default and its own flag", () => {
  for (const lane of Object.keys(BATCH_LANES) as (keyof typeof BATCH_LANES)[]) {
    assert.equal(BATCH_LANES[lane].readerFacing, false, `${lane} is not reader-facing`);
    assert.equal(batchEnabledFor(lane, {}), BATCH_LANES[lane].defaultEnabled);
    assert.equal(batchEnabledFor(lane, { [BATCH_LANES[lane].flag]: "0" }), false);
    assert.equal(batchEnabledFor(lane, { [BATCH_LANES[lane].flag]: "yes" }), false, "anything but 1/true/on is off");
    assert.equal(batchEnabledFor(lane, { [BATCH_LANES[lane].flag]: "1" }), true);
    assert.equal(batchEnabledFor(lane, { [BATCH_LANES[lane].flag]: "true" }), true);
  }
});

test("PC-8: the submission is one POST to /v1/messages/batches carrying {requests: [{custom_id, params}]} with the Messages headers", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (calls.length === 1) return jsonResponse(200, { id: "msgbatch_1", processing_status: "in_progress", request_counts: { processing: 1, succeeded: 0, errored: 0, canceled: 0, expired: 0 }, results_url: null });
    if (calls.length === 2) return jsonResponse(200, { id: "msgbatch_1", processing_status: "ended", request_counts: { processing: 0, succeeded: 1, errored: 0, canceled: 0, expired: 0 }, results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results" });
    return jsonResponse(200, `${JSON.stringify({ custom_id: "single", result: { type: "succeeded", message: { id: "msg_1", content: [{ type: "text", text: "{\"answer\":\"a\",\"citedSources\":[]}" }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } })}\n`, true);
  };
  const params = { model: "claude-opus-5", max_tokens: 64, messages: [{ role: "user", content: "hello" }] };
  const out = await runSingleRequestBatch(params, { apiKey: "sk-test", fetchImpl, pollIntervalMs: 1, sleep: async () => undefined });
  assert.equal(out.batchId, "msgbatch_1");
  assert.equal((out.message as { id: string }).id, "msg_1");
  assert.equal(calls[0].url, MESSAGE_BATCHES_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["x-api-key"], "sk-test");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { requests: [{ custom_id: "single", params }] });
  assert.equal(calls[1].url, `${MESSAGE_BATCHES_ENDPOINT}/msgbatch_1`, "the batch is polled by id");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[2].url, "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results");
});

test("PC-8: results are JSON Lines keyed by custom_id in any order; an errored, canceled or expired request throws by name", async () => {
  const lines = [
    { custom_id: "b", result: { type: "succeeded", message: { id: "msg_b" } } },
    { custom_id: "a", result: { type: "errored", error: { type: "invalid_request_error", message: "bad" } } },
  ];
  const results = await readMessageBatchResults("k", "https://x/results", async () => jsonResponse(200, lines.map((l) => JSON.stringify(l)).join("\n"), true));
  assert.deepEqual(results.map((r) => r.custom_id), ["b", "a"]);
  let n = 0;
  const failing: typeof fetch = async () => {
    n += 1;
    if (n === 1) return jsonResponse(200, { id: "mb", processing_status: "ended", request_counts: { processing: 0, succeeded: 0, errored: 1, canceled: 0, expired: 0 }, results_url: "https://x/results" });
    return jsonResponse(200, `${JSON.stringify({ custom_id: "single", result: { type: "errored", error: { type: "invalid_request_error" } } })}\n`, true);
  };
  await assert.rejects(runSingleRequestBatch({ model: "m" }, { apiKey: "k", fetchImpl: failing, sleep: async () => undefined }), (e: Error) => e instanceof MessageBatchError && /errored/.test(e.message));
  assert.throws(() => batchRequestBody([]), /at least one request/);
  assert.throws(() => batchRequestBody([{ custom_id: "x", params: {} }, { custom_id: "x", params: {} }]), /unique/);
});

test("PC-8: no reader-facing path reaches the batch module — nothing under app/, and none of the reader-facing Ask call sites", () => {
  const root = process.cwd();
  const readerFacing = [
    "lib/ask/synthesize.ts",
    "lib/ask/interpret.ts",
    "lib/routing/classifier.ts",
    "lib/routing/unsourced-fallback.ts",
  ];
  const offenders: string[] = [];
  for (const path of filesThatWouldBeCommitted({ cwd: root })) {
    if (!(path.startsWith("app/") || readerFacing.includes(path))) continue;
    if (!/\.(ts|tsx|mts|js|mjs)$/.test(path)) continue;
    const source = readFileSync(`${root}/${path}`, "utf8");
    if (/model-batch|messages\/batches/.test(source)) offenders.push(path);
  }
  assert.deepEqual(offenders, [], "a reader is waiting on these paths; the Batches API is prohibited there absolutely");
  for (const lane of Object.values(BATCH_LANES)) assert.equal(lane.readerFacing, false);
});
