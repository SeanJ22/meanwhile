/** Mounted polling acceptance with controlled browser time and local HTTP responses.
 * Request counts here are browser requests, not Netlify/Neon billing measurements. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { launchGuarded } from "../../scripts/browser.mts";

const entry = `
  import React, { useState } from "react";
  import { createRoot } from "react-dom/client";
  import { LiveRefresh } from "./app/(admin)/_mw/live-refresh.tsx";
  import { useReading } from "./app/(admin)/_mw/admin-v6/use-reading.ts";
  import { UpdatesPanel } from "./app/(admin)/_mw/admin-v6/updates-panel.tsx";
  function Panel({ id }) {
    const [version, setVersion] = useState(1);
    const { reading, reload, status } = useReading('/api/admin/panel/' + id + '?v=' + version);
    return <section id={'panel-' + id} style={{ minHeight: 240, border: '1px solid gray' }}>
      <h2>Panel {id}</h2>{status}
      <output>{reading.kind === 'ready' ? JSON.stringify(reading.data) : reading.kind}</output>
      <button onClick={reload}>Refresh {id}</button><button onClick={() => setVersion(version + 1)}>Change {id}</button>
    </section>;
  }
  createRoot(document.getElementById('root')).render(<React.StrictMode><LiveRefresh />
    {Array.from({ length: 16 }, (_, i) => <Panel key={i} id={i} />)}<UpdatesPanel />
  </React.StrictMode>);
`;

async function bundle() {
  return build({ stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: "admin-polling.tsx", loader: "tsx" },
    alias: { "@": process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false, outdir: "out",
    loader: { ".module.css": "local-css", ".css": "css" }, jsx: "automatic",
    plugins: [{ name: "navigation", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "test" }));
      b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: 'export function useSearchParams() { return new URLSearchParams(location.search); }' }));
    } }],
  });
}

test("one pulse serves on-screen panels; hidden and five-minute idle tabs make no requests", async () => {
  const js = (await bundle()).outputFiles.find(f => f.path.endsWith(".js"))!.text;
  const browser = await launchGuarded({ label: "ap-01-polling", headless: true });
  try {
    const page = await browser.page({ viewport: { width: 1200, height: 600 } });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    const counts = new Map<string, number>();
    let fail = false;
    let delayed = false;
    let release: (() => void) | undefined;
    await page.route("http://admin.local/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/harness") return route.fulfill({ contentType: "text/html", body: "<div id='root'></div>" });
      counts.set(path, (counts.get(path) ?? 0) + 1);
      if (delayed && path === "/api/admin/panel/0") await new Promise<void>(resolve => { release = resolve; });
      const data = path === "/api/admin/live"
        ? { revision: "r1", at: new Date().toISOString(), counts: { agentJobsRunning: 0 }, lanes: null, unread: [] }
        : path === "/api/admin/v6/updates" ? { data: { updates: [] } } : { count: counts.get(path), version: new URL(route.request().url()).searchParams.get("v") };
      await route.fulfill({ status: fail && path !== "/api/admin/live" ? 503 : 200, contentType: "application/json", body: JSON.stringify(data) }).catch(() => {});
    });
    await page.clock.install({ time: new Date("2026-10-26T12:00:00Z") });
    await page.goto("http://admin.local/harness");
    await page.addScriptTag({ content: js });
    await page.locator("#panel-0 time").waitFor();
    await page.locator("#panel-1 time").waitFor();
    assert.equal(counts.get("/api/admin/panel/15") ?? 0, 0, "offscreen panels defer their first load");
    assert.equal(counts.get("/api/admin/panel/0"), 1, "StrictMode and the initial shell pulse do not duplicate the first read");
    assert.equal(counts.get("/api/admin/live"), 1);
    await page.clock.runFor(45_000);
    await page.waitForFunction(() => document.querySelector("#panel-0 output")?.textContent?.includes('"count":2'));
    assert.equal(counts.get("/api/admin/panel/0"), 2, "visible panels refresh on the existing pulse");
    const lastLoaded = await page.locator("#panel-0 time").getAttribute("datetime");
    fail = true;
    await page.clock.runFor(45_000);
    await page.locator("#panel-0").getByText(/Stale/).waitFor();
    assert.equal(await page.locator("#panel-0 time").getAttribute("datetime"), lastLoaded, "a failed refresh preserves the successful timestamp");
    fail = false;
    const visibility = async (state: string) => page.evaluate(state => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: state });
      document.dispatchEvent(new Event("visibilitychange"));
    }, state);
    await visibility("hidden");
    const beforeHidden = [...counts.entries()];
    await page.clock.runFor(10 * 60_000);
    assert.deepEqual([...counts.entries()], beforeHidden, "ten hidden minutes make zero requests");
    await visibility("visible");
    await page.waitForFunction(() => !document.querySelector("#panel-0")?.textContent?.includes("Updates paused"));
    await page.waitForFunction(() => document.querySelector("#panel-0 output")?.textContent?.includes('"count":4'));
    // Reach the idle deadline without skipping any scheduled callbacks.
    await page.clock.runFor(5 * 60_000);
    await page.locator("#panel-0").getByText(/Updates paused/).waitFor();
    const beforeIdle = [...counts.entries()];
    await page.clock.runFor(60 * 60_000);
    assert.deepEqual([...counts.entries()], beforeIdle, "an idle hour makes zero requests after the five-minute deadline");
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" })));
    await page.waitForFunction(() => !document.querySelector("#panel-0")?.textContent?.includes("Updates paused"));
    // Scroll to a previously unseen panel. It loads without waiting for a pulse.
    await page.locator("#panel-15").scrollIntoViewIfNeeded();
    await page.locator("#panel-15 time").waitFor();
    const offscreenCount = counts.get("/api/admin/panel/0");
    await page.clock.runFor(45_000);
    await page.waitForFunction(() => document.querySelector("#panel-15 output")?.textContent?.includes('"count":2'));
    assert.equal(counts.get("/api/admin/panel/0"), offscreenCount, "offscreen panels do not refresh");
    // A URL change discards old-scope data and loads its own answer.
    await page.locator("#panel-0").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Change 0", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#panel-0 output")?.textContent?.includes('"version":"2"'));
    // Delayed requests cannot overlap and are aborted as soon as the tab is hidden.
    delayed = true;
    await page.getByRole("button", { name: "Refresh 0", exact: true }).click();
    await page.waitForTimeout(20);
    const inFlightCount = counts.get("/api/admin/panel/0");
    await page.clock.runFor(45_000);
    assert.equal(counts.get("/api/admin/panel/0"), inFlightCount, "a pulse cannot overlap a pending panel read");
    await visibility("hidden");
    delayed = false;
    release?.();
    const quiet = [...counts.entries()];
    await page.clock.runFor(10 * 60_000);
    assert.deepEqual([...counts.entries()], quiet);
    assert.deepEqual(errors, []);
    await page.close();
  } finally { await browser.close(); }
});
