import assert from "node:assert/strict";
import test from "node:test";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorkerToolsHost } from "../scripts/worker-tools-host.mts";
import { sharedScoutBrowser, browseWithPlaywright } from "../scripts/scout-browse.mts";
import type { GuardedBrowser } from "../scripts/browser.mts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { newFieldManualEntry, readFieldManual, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { methodVersionEntry } from "./method-store-fixture.ts";
import { unknownApplicability } from "../lib/method/portability.ts";

function countedBrowser() {
  const counts = { launches: 0, pages: 0, contextsClosed: 0, browsersClosed: 0 };
  return { counts, create: () => sharedScoutBrowser(async () => {
    counts.launches++;
    return { page: async () => {
      counts.pages++;
      let address = "";
      return { on: () => {}, goto: async (url: string) => { address = url; return { status: () => 200 }; },
        waitForLoadState: async () => {}, content: async () => "<body>official</body>", evaluate: async () => "official",
        url: () => address, context: () => ({ close: async () => { counts.contextsClosed++; } }) };
    }, close: async () => { counts.browsersClosed++; } } as unknown as GuardedBrowser;
  }) };
}

interface Ready { kind: "ready"; owned: boolean; inherited: boolean; version: number; routes: string[]; states: string[][]; finalUrl: string }
function client(state: string) {
  const child = fork(fileURLToPath(new URL("./helpers/worker-tools-client.mts", import.meta.url)), [state], {
    execArgv: ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--import", "./tests/helpers/install-fixture-doors.ts"],
    stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env },
  });
  let stderr = "";
  child.stderr?.on("data", chunk => { stderr += String(chunk); });
  const exited = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`worker ${state} exited ${code}: ${stderr}`)));
  });
  const ready = new Promise<Ready>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker ${state} never became ready: ${stderr}`)), 15_000);
    child.once("message", value => { clearTimeout(timer); resolve(value as Ready); });
    exited.catch(error => { clearTimeout(timer); reject(error); });
  });
  return { child, ready, exited };
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill("SIGKILL"); });
}

test("two inherited worker processes use one browser and one pinned catalog, without their own tools or repositories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worker-tools-lifecycle-"));
  const priorTmp = process.env.TMPDIR;
  process.env.TMPDIR = directory;
  const repos = createMemoryRepositories();
  await writeFieldManual(repos, [
    methodVersionEntry({ version: 11, updatedOn: "2026-10-20", routes: [] }),
    newFieldManualEntry("learned", "portable", { kind: "ROUTE", role: "SHARED", title: "Portable", summary: "Portable", outcome: "REFERENCE",
      payload: { id: "portable", title: "Portable", fields: ["meeting"], outcomes: [], applicability: unknownApplicability() } }),
    ...["az", "nj"].map(state => newFieldManualEntry("test", state, { kind: "REFERENCE", role: "SHARED", title: state, summary: state, outcome: "REFERENCE", states: [state] })),
  ], "2026-10-20T00:00:00.000Z");
  const browser = countedBrowser();
  const host = await ensureWorkerToolsHost({ repos, createBrowser: browser.create });
  const address = process.env.WTP_WORKER_TOOLS_URL;
  const children: ReturnType<typeof client>[] = [];
  try {
    assert.equal(host.owned, true);
    children.push(client("az"), client("nj"));
    const results = await Promise.all(children.map(child => child.ready));
    for (const [i, state] of ["az", "nj"].entries()) assert.deepEqual(results[i], {
      kind: "ready", owned: false, inherited: true, version: 12, routes: ["portable"], states: [[state]], finalUrl: `https://${state}.example.gov/`,
    });
    assert.deepEqual(browser.counts, { launches: 1, pages: 2, contextsClosed: 2, browsersClosed: 0 });
    assert.equal((await readdir(directory)).filter(name => name.startsWith("meanwhile-history-")).length, 1,
      "both live worker tokens share the same retained catalog snapshot");
    for (const child of children) child.child.send({ kind: "close" });
    await Promise.all(children.map(child => child.exited));
    assert.equal(process.env.WTP_WORKER_TOOLS_URL, address, "borrower shutdown cannot close its parent's host");
    assert.equal((await readFieldManual(repos, { state: "az", kinds: ["REFERENCE"] })).store.entries.length, 1);
    assert.equal((await readdir(directory)).filter(name => name.startsWith("meanwhile-history-")).length, 0);
    await Promise.all([host.close(), host.close()]);
    assert.equal(browser.counts.browsersClosed, 1);
    assert.equal(process.env.WTP_WORKER_TOOLS_URL, undefined);
    await assert.rejects(fetch(address!, { signal: AbortSignal.timeout(1000) }));
  } finally {
    await Promise.all(children.map(child => stop(child.child)));
    await host.close();
    if (priorTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = priorTmp;
    await rm(directory, { recursive: true, force: true });
  }
});

test("standalone browser fallback host calls its direct browser rather than recursing through its own RPC", async () => {
  const repos = createMemoryRepositories(), browser = countedBrowser();
  let reads = 0;
  const host = await ensureWorkerToolsHost({ repos: async () => { reads++; return repos; }, createBrowser: browser.create });
  try {
    const results = await Promise.all(["one", "two"].map(place => browseWithPlaywright({ url: `https://${place}.gov/`, timeoutMs: 1000, holder: place })));
    assert.deepEqual(results.map(row => row.finalUrl), ["https://one.gov/", "https://two.gov/"]);
    assert.equal(reads, 1);
    assert.deepEqual(browser.counts, { launches: 1, pages: 2, contextsClosed: 2, browsersClosed: 0 });
    const inherited = await ensureWorkerToolsHost({ repos: async () => { throw new Error("must not open borrowed repositories"); },
      createBrowser: () => { throw new Error("must not create a borrowed browser"); } });
    assert.equal(inherited.owned, false);
    await inherited.close();
    assert.equal((await browseWithPlaywright({ url: "https://three.gov/", timeoutMs: 1000, holder: "three" })).status, 200);
  } finally { await host.close(); }
  assert.equal(browser.counts.browsersClosed, 1);
});

test("failed tools startup closes an already launched browser and leaves no host environment", async () => {
  const browser = countedBrowser();
  await assert.rejects(ensureWorkerToolsHost({ repos: createMemoryRepositories(), createBrowser: browser.create,
    startHost: async input => {
      await input.browse({ url: "https://startup.gov/", timeoutMs: 1000, holder: "startup" });
      throw new Error("STARTUP_FAILED");
    } }), /STARTUP_FAILED/);
  assert.deepEqual(browser.counts, { launches: 1, pages: 1, contextsClosed: 1, browsersClosed: 1 });
  assert.equal(process.env.WTP_WORKER_TOOLS_URL, undefined);
  assert.equal(process.env.WTP_WORKER_TOOLS_TOKEN, undefined);
});

test("every runner parent owns or inherits the same tools lifecycle before admitting worker children", async () => {
  const source = async (name: string) => readFile(new URL(`../scripts/${name}.mts`, import.meta.url), "utf8");
  const pilot = await source("pilot-runner"), routine = await source("routine-civic-data-runner");
  const freshness = await source("freshness-shadow"), hunter = await source("hunter-lane");
  assert.ok(pilot.indexOf("pilotWorkerToolsHost = await ensureWorkerToolsHost") < pilot.indexOf("handoffExitCode = await reconcileRuntimeReleaseAtBoundary"));
  assert.match(pilot, /finally\s*\{\s*try \{ await pilotWorkerToolsHost\?\.close\(\); \}\s*finally \{ await PILOT_PROCESS_LEASE\.release\(\); \}/);
  assert.ok(routine.indexOf("await ensureWorkerToolsHost") < routine.indexOf("await runBoundedChildPass"));
  assert.ok(hunter.indexOf("await ensureWorkerToolsHost") < hunter.indexOf("const lane = hunterLane"));
  assert.match(hunter, /finally \{ await workerToolsHost\.close\(\); \}/);
  assert.match(freshness, /standaloneWorkerToolsHost = await ensureWorkerToolsHost\(\{ repos \}\)/);
  assert.doesNotMatch([pilot, routine, freshness, hunter].join("\n"), /startWorkerToolsHost\(\{[^}]*browse:\s*browseWithPlaywright/);
});
