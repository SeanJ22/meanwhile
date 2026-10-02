import assert from "node:assert/strict";
import test from "node:test";
import { sharedScoutBrowser, browseWithPlaywright } from "../scripts/scout-browse.mts";
import type { GuardedBrowser } from "../scripts/browser.mts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { emptyFieldManual, newFieldManualEntry, readFieldManual } from "../lib/control-plane/field-manual.ts";

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
