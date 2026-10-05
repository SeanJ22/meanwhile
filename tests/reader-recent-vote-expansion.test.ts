import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

test("actual map and ballot vote components expose a planted held tail beyond twenty", async () => {
  // Synthetic records stay in this local fixture server. The component,
  // fetch, React state, disclosure, and expansion gestures are production code.
  const member = "congress:Z999998";
  const votes = Array.from({ length: 21 }, (_, i) => ({
    id: `planted:roll-call:${i + 1}`, chamber: "house", congress: 119,
    session: 1, rollNumber: 21 - i, title: `Planted official roll call ${i + 1}`,
    question: "On Passage", result: "Passed", legisNum: null, billUrl: null,
    date: "2026-09-04", position: "YES", partyBreakdown: null,
    rollCallUrl: `https://example.test/roll-call/${i + 1}`,
  }));
  const output = await build({
    stdin: {
      contents: `import React from "react"; import {createRoot} from "react-dom/client";
        import {RecentVotes} from "./components/map/popup/official-popup.tsx";
        import {CardSection} from "./components/officials/card-section.tsx";
        import {Card} from "./components/ui/card.tsx";
        const holder={id:${JSON.stringify(member)},name:"Planted official"};
        createRoot(document.getElementById("root")).render(<>
          <div id="map"><Card title="Map official" sources={[]}><RecentVotes holder={holder} reactionContext={null} columns /></Card></div>
          <div id="ballot"><Card title="Ballot official" sources={[]}><CardSection title="Voting record"><RecentVotes holder={holder} reactionContext={null} contentOnly /></CardSection></Card></div>
        </>);`,
      resolveDir: process.cwd(), sourcefile: "reader-vote-expansion-fixture.tsx", loader: "tsx",
    },
    bundle: true, write: false, outfile: ".scratch/reader-vote-expansion-fixture.js",
    platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  // esbuild needs an output name to assemble CSS Modules. Serve that actual
  // stylesheet beside the fixture JS; no product component or CSS is stubbed.
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))?.text;
  const stylesheet = output.outputFiles.find(file => file.path.endsWith(".css"))?.text;
  assert.ok(javascript && stylesheet, "the real component bundle must include its JS and CSS Modules");
  const server = createServer((request, response) => {
    if (request.url?.startsWith("/api/votes?")) {
      const history = new URL(request.url, "http://fixture.test").searchParams.get("history") === "1";
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(history
        ? { historicalVotes: [], historyStatus: "COMPLETE", nextHistoricalVersionId: null, currentVersionId: "fixture:current" }
        : { member, votes, chamber: "house", keyVotes: [] }));
    } else if (request.url === "/fixture.js") {
      response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    } else if (request.url === "/fixture.css") {
      response.writeHead(200, { "content-type": "text/css" }).end(stylesheet);
    } else if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
    } else {
      response.writeHead(200, { "content-type": "application/json" }).end("{}");
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const browser = await launchGuarded({ label: "reader-vote-tail-plant" });
  try {
    const context = await browser.context({ viewport: { width: 900, height: 800 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    for (const mode of ["map", "ballot"] as const) {
      const surface = page.locator(`#${mode}`);
      await surface.getByRole("button", { name: mode === "map" ? "Voting Record" : "Voting record", exact: true }).click();
      await surface.locator("[data-recent-vote-id]").first().waitFor({ state: "visible" });
      assert.equal(await surface.locator("[data-recent-vote-id]").count(), 20);
      assert.equal(await surface.locator("[data-recent-vote-count]").getAttribute("data-recent-vote-count"), "20");
      await surface.getByRole("button", { name: "Show all 21 recorded votes", exact: true }).click();
      const tail = surface.locator('[data-recent-vote-id="planted:roll-call:21"]');
      await tail.waitFor({ state: "visible" });
      assert.equal(await surface.locator("[data-recent-vote-id]").count(), 21);
      assert.equal(await surface.locator("[data-recent-vote-count]").getAttribute("data-recent-vote-count"), "21");
      assert.ok((await tail.innerText()).includes(votes[20].title));
      assert.equal(await tail.locator(`a[href="${votes[20].rollCallUrl}"]`).count(), 0, "citations never appear on the vote face");
      await surface.getByRole("button", { name: "Sources", exact: true }).click();
      const citation = surface.locator(`[data-card-sources] a[href="${votes[20].rollCallUrl}"]`);
      await citation.waitFor({ state: "visible" });
      assert.equal(await citation.count(), 1, "the expanded tail retains its real citation in Sources");
      await surface.getByRole("button", { name: mode === "map" ? "Voting Record" : "Voting record", exact: true }).click();
      await surface.getByRole("button", { name: "Show latest 20", exact: true }).click();
      assert.equal(await surface.locator("[data-recent-vote-id]").count(), 20);
    }
    await context.close();
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
