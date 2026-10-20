import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { answerNativeAsk, startNativeAskBridge, type AskBridgeInput } from "../scripts/rh01-ask-bridge.mts";
import { currentProductionReadOwner, withProductionReadOwner } from "../scripts/rh01-network.mjs";
import { askSnapshot } from "./helpers/playbooks.ts";

const fixtureOrigin = "https://rh01-ask.invalid";
const request = (path = "/api/ask/classify", body = JSON.stringify({ question: "When does my council meet?" })): AskBridgeInput => ({
  url: fixtureOrigin + path, method: "POST", body,
  headers: { "content-type": "application/json", origin: fixtureOrigin, "x-wtp-synthetic-run": "rh01-native-ask-test" },
});
function temporaryEnvironment(values: Record<string, string | undefined>): () => void {
  const prior = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(values)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  return () => { for (const [name, value] of Object.entries(prior)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } };
}

test("the Ask adapter keeps native no-key and validation replies and refuses foreign, organic and unrelated requests", async () => {
  const restore = temporaryEnvironment({ SHOOT_BASE_URL: fixtureOrigin, WTP_RH01_CODE_ROOT: process.cwd(),
    ANTHROPIC_API_KEY: undefined, OPENAI_API_KEY: undefined });
  const originalFetch = globalThis.fetch, snapshot = askSnapshot();
  let settingsReads = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), fixtureOrigin + "/api/reader/settings");
    assert.equal(init?.method ?? "GET", "GET"); settingsReads++;
    return Response.json({ available: true, ...snapshot });
  };
  try {
    for (const input of [
      { ...request(), url: "https://foreign.invalid/api/ask/classify" },
      { ...request(), url: fixtureOrigin + "/api/ask/agenda" },
      { ...request(), method: "GET" },
      { ...request(), headers: { ...request().headers, origin: "https://foreign.invalid" } },
      { ...request(), headers: { ...request().headers, "x-forwarded-host": "foreign.invalid" } },
      { ...request(), headers: { "content-type": "application/json", origin: fixtureOrigin } },
    ]) await assert.rejects(answerNativeAsk(input), /RH01_ASK_REQUEST/);
    assert.equal(settingsReads, 0);
    const classified = await answerNativeAsk(request());
    assert.equal(classified.status, 200);
    assert.deepEqual(JSON.parse(classified.body), { topic: null, why: "no-key" });
    assert.match(classified.headers["content-type"], /application\/json/);
    const native = await import("../app/api/ask/grounded/route.ts");
    const { withAskSettings } = await import("../lib/ask/runtime-settings.ts");
    const input = request("/api/ask/grounded", "{");
    const original = await withAskSettings(snapshot, () => native.POST(new Request(input.url, { method: input.method, headers: input.headers, body: input.body })));
    const bridged = await answerNativeAsk(input);
    assert.equal(bridged.status, original.status);
    assert.equal(bridged.body, await original.text());
    assert.equal(bridged.status, 400);
    process.env.ANTHROPIC_API_KEY = "not-a-usable-provider-key";
    const before = settingsReads;
    await assert.rejects(answerNativeAsk(request()), /must not possess a model credential/);
    assert.equal(settingsReads, before);
    delete process.env.ANTHROPIC_API_KEY;
    globalThis.fetch = async () => Response.json({ available: false, values: {} }, { status: 503 });
    await assert.rejects(answerNativeAsk(request()), /PUBLISHED_SETTINGS_UNAVAILABLE/);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test("the native Ask infrastructure child removes CP and provider credentials, uses the published snapshot, and exits cleanly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-ask-child-"));
  const snapshot = askSnapshot(), methods: string[] = [];
  const settings = createServer((incoming, outgoing) => {
    methods.push(`${incoming.method} ${incoming.url}`);
    assert.equal(incoming.method, "GET"); assert.equal(incoming.url, "/api/reader/settings");
    outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ available: true, ...snapshot }));
  });
  settings.listen(0, "127.0.0.1"); await once(settings, "listening");
  const address = settings.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const restore = temporaryEnvironment({ SHOOT_BASE_URL: origin, WTP_RH01_CODE_ROOT: process.cwd(), WTP_RH01_HARNESS_ROOT: process.cwd(),
    WTP_RH01_DIRECTORY: directory, WTP_RH01_SHARED_STATE_DIRECTORY: directory,
    ANTHROPIC_API_KEY: "must-not-reach-native-child", OPENAI_API_KEY: "must-not-reach-native-child",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:fixture@ep-control.neon.invalid/db",
    DATABASE_URL: undefined, WTP_PRODUCTION_DATABASE_URL_READONLY: undefined,
    NODE_OPTIONS: `--import=${join(process.cwd(), "scripts/rh01-model-preload.mjs")}` });
  const bridge = startNativeAskBridge("http://127.0.0.1:1/query");
  try {
    const input = { ...request(), url: origin + "/api/ask/classify", headers: { ...request().headers, origin } };
    const reply = await bridge.answer(input, { "x-rh01-owner-pid": String(process.pid), "x-rh01-owner-job": "browser:actual-mode" });
    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body), { topic: null, why: "no-key" });
    assert.deepEqual(methods, ["GET /api/reader/settings"]);
    await assert.rejects(bridge.answer({ ...input, headers: { ...input.headers, origin: "https://foreign.invalid" } }, {}), /ORIGIN_OR_MARKER_REFUSED/);
    assert.equal(methods.length, 1);
  } finally {
    await bridge.close(); restore();
    await new Promise<void>((accept, reject) => settings.close(error => error ? reject(error) : accept()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("delegated native reader and Ask RPCs retain the browser owner without altering the original question", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-ask-owner-"));
  const calls: { path: string; job?: string; task?: string; pid?: string; body: unknown }[] = [];
  const server = createServer(async (incoming, outgoing) => {
    let body = ""; for await (const chunk of incoming) body += chunk;
    calls.push({ path: incoming.url!, job: incoming.headers["x-rh01-owner-job"] as string,
      task: incoming.headers["x-rh01-owner-task"] as string, pid: incoming.headers["x-rh01-owner-pid"] as string, body: JSON.parse(body) });
    outgoing.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(incoming.url === "/ask"
      ? { status: 400, headers: { "content-type": "application/json" }, body: '{"error":"native fixture refusal"}' } : { results: [[{ count: 1 }]] }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const restore = temporaryEnvironment({ WTP_RH01_FACTS_URL: `http://127.0.0.1:${address.port}/query`,
    WTP_RH01_DIRECTORY: directory, WTP_RH01_SHARED_STATE_DIRECTORY: directory,
    WTP_RH01_JOB_ID: "infrastructure-not-the-browser", WTP_RUNTIME_AUTHORITY_CONTRACT: undefined });
  try {
    const { readonlyReaderQuery, measurementAskResponse } = await import("../scripts/rh01-readonly-runtime.mts");
    const owner = { ownerPid: 123456, jobId: "resident-tasks:actual-command", taskId: "actual-question-owner" }, input = request("/api/ask/grounded");
    await withProductionReadOwner(owner, async () => {
      assert.equal(currentProductionReadOwner(), owner);
      assert.deepEqual(await readonlyReaderQuery()!([{ text: "SELECT count(*) AS count FROM entity WHERE id=$1", params: ["selected-place"] }]), [[{ count: 1 }]]);
      assert.equal((await measurementAskResponse(input))!.status, 400);
      assert.equal(await measurementAskResponse({ ...input, method: "GET" }), null);
      assert.equal(await measurementAskResponse({ ...input, url: fixtureOrigin + "/api/ask/agenda" }), null);
    });
    assert.equal(currentProductionReadOwner(), undefined);
    assert.deepEqual(calls.map(({ path, job, task, pid }) => ({ path, job, task, pid })), ["/reader-select", "/ask"].map(path =>
      ({ path, job: owner.jobId, task: owner.taskId, pid: String(owner.ownerPid) })));
    assert.deepEqual(calls[1].body, input);
  } finally {
    restore(); await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    await rm(directory, { recursive: true, force: true });
  }
});
