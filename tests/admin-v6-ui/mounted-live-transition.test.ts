/** A mounted client adapter exercise. Responses are local simulated contracts;
 * this checks browser behavior, not hosted Admin acceptance. */
import assert from "node:assert/strict";
import { test } from "node:test";

import { build } from "esbuild";
import { launchGuarded } from "../../scripts/browser.mts";

const entry = `
  import React, { useState, useSyncExternalStore } from "react";
  import { createRoot } from "react-dom/client";
  import { usePulseFeed } from "./app/(admin)/_mw/admin-v6/live-connection.ts";
  import { LiveSync } from "./app/(admin)/_mw/admin-v6/live-sync.ts";
  import { SECTION_IDS } from "./app/(admin)/_mw/admin-v6/contract.ts";

  function MountedAdapter() {
    const [scope, setScope] = useState("st:az");
    const [draft, setDraft] = useState("");
    const [sync] = useState(() => new LiveSync({ screen: "now", sections: SECTION_IDS,
      scope: "st:az",
      fetch: (url, init) => fetch(url, { ...init, cache: "no-store" }),
      schedule: (fn, ms) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); },
    }));
    const snapshot = useSyncExternalStore((fn) => sync.subscribe(fn), () => sync.snapshot(), () => sync.snapshot());
    const connection = usePulseFeed({ onPulse: (pulse) => sync.onPulse(pulse), onReconnected: () => sync.catchUp() });
    return <main>
      <button id="change-scope" onClick={() => { setScope("geo:az.zcta.85635"); sync.setScope("geo:az.zcta.85635"); }}>Choose ZIP</button>
      <output id="scope">{scope}</output><input id="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <output id="phase">{snapshot.stuck.phase}</output>
      <output id="rows">{JSON.stringify(snapshot.stuck.data)}</output>
      <output id="connection">{connection.connection}</output>
    </main>;
  }
  createRoot(document.getElementById("root")).render(<MountedAdapter />);
`;

test("an already-mounted v6 adapter picks up readiness, scoped changes and a brief disconnect without reload or mutation", async () => {
  const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), sourcefile: "mounted-admin-adapter.tsx", loader: "tsx" },
    alias: { "@": process.cwd() }, bundle: true, platform: "browser", format: "iife", write: false });
  const browser = await launchGuarded({ label: "admin-v6-mounted-transition", headless: true });
  try {
    const page = await browser.page();
    let rows = ["first"];
    let reads = 0;
    let mutations = 0;
    await page.route("http://admin.local/harness", route => route.fulfill({ status: 200, contentType: "text/html", body: "<div id='root'></div>" }));
    await page.route("**/api/admin/action", route => { mutations += 1; return route.fulfill({ status: 500 }); });
    await page.route("**/api/admin/v6/stuck?*", route => {
      reads += 1;
      const scope = new URL(route.request().url()).searchParams.get("scope");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        contract: "admin-v6/stuck@1", scope, revision: currentSectionRevision,
        asOf: new Date().toISOString(), data: [...rows],
      }) });
    });
    let currentSectionRevision = "s1";
    const pulse = async (revision: string, section?: { contract: string; revision: string }) => {
      await page.evaluate(({ revision, section }) => window.dispatchEvent(new CustomEvent("meanwhile:admin-pulse", {
        detail: { revision, at: new Date().toISOString(), v6: { version: 1,
          sections: section ? { stuck: { contract: section.contract, href: "/api/admin/v6/stuck", revision: section.revision } } : {}, actions: {} } },
      })), { revision, section });
    };
    await page.goto("http://admin.local/harness");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.locator("#phase").getByText("waiting").waitFor();
    await page.locator("#draft").fill("unsent owner note");
    await pulse("p0");
    assert.equal(reads, 0, "unannounced endpoints are never guessed");
    await pulse("p1", { contract: "admin-v6/stuck@1", revision: "s1" });
    await page.locator("#rows").getByText('["first"]').waitFor();
    assert.equal(reads, 1);
    await pulse("p1", { contract: "admin-v6/stuck@1", revision: "s1" });
    assert.equal(reads, 1, "an unchanged announcement does not duplicate the read");
    rows = ["first", "second"];
    currentSectionRevision = "s2";
    await pulse("p2", { contract: "admin-v6/stuck@1", revision: "s2" });
    await page.locator("#rows").getByText('["first","second"]').waitFor();
    assert.equal(reads, 2, "a moved revision replaces the mounted data");
    await page.locator("#change-scope").click();
    await page.locator("#scope").getByText("geo:az.zcta.85635").waitFor();
    await page.locator("#rows").getByText('["first","second"]').waitFor();
    assert.equal(reads, 3);
    assert.equal(await page.locator("#draft").inputValue(), "unsent owner note");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
      window.dispatchEvent(new Event("offline"));
    });
    await page.locator("#connection").getByText("offline").waitFor();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
      window.dispatchEvent(new Event("online"));
    });
    await page.locator("#connection").getByText("reconnecting").waitFor();
    rows = ["first", "second", "reconnected"];
    await pulse("p2", { contract: "admin-v6/stuck@1", revision: "s2" });
    await page.locator("#rows").getByText('["first","second","reconnected"]').waitFor();
    assert.equal(reads, 4, "the same-revision pulse catches up after a brief disconnect");
    assert.equal(await page.locator("#draft").inputValue(), "unsent owner note");
    await pulse("p3", { contract: "admin-v6/stuck@2", revision: "s3" });
    await page.locator("#phase").getByText("incompatible").waitFor();
    assert.equal(reads, 4, "an incompatible backend is not read");
    assert.equal(mutations, 0, "readiness and recovery never send an action");
    await page.close();
  } finally {
    await browser.close();
  }
});
