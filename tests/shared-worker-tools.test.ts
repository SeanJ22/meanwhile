import assert from "node:assert/strict";
import test from "node:test";
import { sharedScoutBrowser, browseWithPlaywright } from "../scripts/scout-browse.mts";
import type { GuardedBrowser } from "../scripts/browser.mts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { emptyFieldManual, newFieldManualEntry, readFieldManual } from "../lib/control-plane/field-manual.ts";
import { availableWorkerMemoryBytes, routineProcessSlots, WORKER_ENTRY_PEAK_MIB } from "../lib/control-plane/workers/worker-slots.ts";

test("concurrent workers share a browser and close only their own contexts", async () => {
  let launches = 0, pages = 0, contextsClosed = 0, browsersClosed = 0;
  const browser = sharedScoutBrowser(async () => {
    launches++;
    return { page: async () => {
      pages++;
      let address = "";
      return { on: () => {}, goto: async (url: string) => { address = url; return { status: () => 200 }; },
        waitForLoadState: async () => {}, content: async () => "<body>official</body>", evaluate: async () => "official",
        url: () => address, context: () => ({ close: async () => { contextsClosed++; } }) };
    }, close: async () => { browsersClosed++; } } as unknown as GuardedBrowser;
  });
  const results = await Promise.all(["https://one.gov", "https://two.gov"].map(url => browser.browse({ url, timeoutMs: 1000, holder: "test" })));
  assert.deepEqual(results.map(row => row.finalUrl), ["https://one.gov", "https://two.gov"]);
  assert.equal(launches, 1); assert.equal(pages, 2); assert.equal(contextsClosed, 2); assert.equal(browsersClosed, 0);
  await browser.close(); assert.equal(browsersClosed, 1);
});

test("hosted workers receive state manual pieces and browser observations without reloading the manual", async () => {
  const priorUrl = process.env.WTP_WORKER_TOOLS_URL, priorToken = process.env.WTP_WORKER_TOOLS_TOKEN;
  const entry = (state: string) => newFieldManualEntry("test", state || "portable", { role: "SHARED", kind: "REFERENCE",
    title: state, summary: state, outcome: "REFERENCE", states: state ? [state] : [] });
  const entries = [entry("az"), entry("nj"), entry("")];
  const host = await startWorkerToolsHost({ knowledge: { store: { ...emptyFieldManual(), entries }, revision: 7,
    projection: { lines: [], entryIds: [], matched: 3, total: 3 } }, browse: async input => ({ finalUrl: input.url,
    status: 200, html: "official", text: "official", requests: [], transportError: null, durationMs: 1 }) });
  try {
    const repos = { fieldManual: { read: async () => { throw new Error("worker must not reload the manual"); } } };
    const manual = await readFieldManual(repos as never, { state: "az" });
    assert.equal(manual.error, undefined); assert.equal(manual.revision, 7);
    assert.deepEqual(manual.store.entries.map(row => row.states), [["az"], []]);
    assert.equal((await browseWithPlaywright({ url: "https://one.gov", timeoutMs: 1000, holder: "test" })).text, "official");
  } finally {
    await host.close();
    if (priorUrl === undefined) delete process.env.WTP_WORKER_TOOLS_URL; else process.env.WTP_WORKER_TOOLS_URL = priorUrl;
    if (priorToken === undefined) delete process.env.WTP_WORKER_TOOLS_TOKEN; else process.env.WTP_WORKER_TOOLS_TOKEN = priorToken;
  }
});

test("routine sources, reader repairs and catch-up share reservations including the national child", async () => {
  const peak = Math.max(...Object.values(WORKER_ENTRY_PEAK_MIB)) * 1024 * 1024;
  const slots = routineProcessSlots({ availableBytes: () => peak * 3 + 100, headroomBytes: 100 });
  const national = await slots.acquire("national-place:85635");
  const reader = await slots.acquire("reader:meetings");
  let started = false;
  const catchUp = slots.acquire("meetings:catch-up").then(release => { started = true; return release; });
  await Promise.resolve(); assert.equal(started, false);
  national(); const release = await catchUp; assert.equal(started, true);
  national(); reader(); release();
});

test("the staging host size accounts for its already-running parent", () => {
  const prior = process.env.WTP_WORKER_HOST_MEMORY_MIB;
  process.env.WTP_WORKER_HOST_MEMORY_MIB = "1";
  try {
    assert.ok(process.memoryUsage.rss() > 1024 * 1024);
    assert.equal(availableWorkerMemoryBytes(), 0);
  } finally {
    if (prior === undefined) delete process.env.WTP_WORKER_HOST_MEMORY_MIB;
    else process.env.WTP_WORKER_HOST_MEMORY_MIB = prior;
  }
});
