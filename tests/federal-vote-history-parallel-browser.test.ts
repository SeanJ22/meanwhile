import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

const roll = (id: string, title: string) => ({ id, title, titleSource: "BILL_TITLE", chamber: "senate", congress: 119,
  session: 1, rollNumber: 12, date: "2026-10-24", question: "On Passage", result: "Passed", position: "YES",
  legisNum: null, billUrl: null, rollCallUrl: `https://rollcalls.example.gov/${id}`, retrievedAt: "2026-10-24",
  partyBreakdown: null, billSummary: null, billSummaryPending: false });
const current = roll("current", "Current held roll call"), earlier = roll("earlier", "Earlier held roll call"),
  oldest = roll("oldest", "Oldest held roll call");

// The current HTTP response remains pending until the test releases it. History
// must be requested, rendered and paginated while that response is still pending.
test("a first-click federal card reads current and earlier votes together and retains independent partial records", async () => {
  const bundle = await build({ stdin: { contents: `
    import React from "react";import {createRoot} from "react-dom/client";
    import {CandidateBattlecard} from "./components/ballot/candidate-battlecard.tsx";
    import {RecentVotes} from "./components/map/popup/official-popup.tsx";
    const people=[['pending','congress:Z999994'],['failed','congress:Z999993']];
    createRoot(document.getElementById('root')).render(<>{people.map(([mode,id])=>{
      const holder={id,name:'Fixture '+mode,officeTitle:'U.S. Senator',state:'GA',photoUrl:null,partyLabel:null,birthDate:null,termEnd:null};
      return <div data-scenario={mode} key={id}><CandidateBattlecard name={holder.name} subjectId={id} contactHolder={holder}
        sectionIds={['record','sources']} sections={{record:<RecentVotes holder={holder} reactionContext={null} contentOnly/>}}/></div>;
    })}</>);`, resolveDir: process.cwd(), sourcefile: "federal-vote-history-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/ci/federal-vote-history-fixture.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = readFileSync("app/globals.css", "utf8") + readFileSync("app/reader.css", "utf8");
  const observed: { member: string | null; history: boolean; cursor: string | null; anchor: string | null; at: number }[] = [];
  let releaseCurrent = () => {};let currentReleased = false;
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") return response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    if (request.url === "/fixture.css") return response.writeHead(200, { "content-type": "text/css" }).end(css);
    if (request.url?.startsWith("/api/votes?")) {
      const query = new URL(request.url, "http://fixture.test").searchParams;
      const member = query.get("member"), history = query.get("history") === "1", cursor = query.get("cursor"), anchor = query.get("anchor");
      observed.push({ member, history, cursor, anchor, at: performance.now() });
      const answer = (body: unknown, status = 200) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (history) return answer({ historicalVotes: cursor ? [earlier, oldest] : [earlier],
        historyStatus: cursor ? "UNAVAILABLE" : member === "congress:Z999994" ? "MORE" : "COMPLETE",
        nextHistoricalVersionId: !cursor && member === "congress:Z999994" ? "fixture:older-page" : null,
        currentVersionId: "fixture:current-window" });
      if (member === "congress:Z999993") return answer({ votes: [], holdingStatus: "HOLDING_UNAVAILABLE" }, 503);
      releaseCurrent = () => { if (currentReleased) return;currentReleased = true;answer({ member, votes: [current], chamber: "senate", keyVotes: [] }); };
      return;
    }
    if (request.url?.startsWith("/api/")) return response.writeHead(503, { "content-type": "application/json" }).end("{}");
    response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html lang="en"><link rel="stylesheet" href="/fixture.css"><body class="mw-reader"><main id="root"></main><script src="/fixture.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  const artifact = ".scratch/ci/federal-vote-history";mkdirSync(artifact, { recursive: true });
  try {
    browser = await launchGuarded({ label: "CL-01-federal-votes-parallel", blockWrites: true, headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.page({ viewport: { width: 1100, height: 900 } });
    const errors: string[] = [];page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    for (const mode of ["pending", "failed"]) {
      const historyRequest = page.waitForRequest(request => request.url().includes("/api/votes?")
        && new URL(request.url()).searchParams.get("history") === "1"
        && new URL(request.url()).searchParams.get("member") === (mode === "pending" ? "congress:Z999994" : "congress:Z999993"), { timeout: 2500 });
      const clicked = performance.now();
      await page.locator(`[data-scenario="${mode}"]`).getByRole("button", { name: "View Battlecard", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `Fixture ${mode}`, exact: true });
      await dialog.waitFor({ state: "visible", timeout: 3000 });
      await historyRequest;
      assert.ok(performance.now() - clicked < 3000, "the first enabled click opens and starts both independent reads");
      await dialog.getByRole("button", { name: "Voting record", exact: true }).click();
      await dialog.locator('[data-recent-vote-id="earlier"]').waitFor({ state: "visible" });
      assert.ok(performance.now() - clicked < 3000, "held earlier votes are usable without the current response");
      if (mode === "pending") {
        assert.equal(currentReleased, false);
        assert.equal(observed.filter(row => row.member === "congress:Z999994" && !row.history).length, 1);
        await dialog.getByRole("button", { name: "Load more earlier records", exact: true }).click();
        await dialog.locator('[data-recent-vote-id="oldest"]').waitFor({ state: "visible" });
        assert.equal(currentReleased, false, "pagination gets its anchor from history, independently of current votes");
        const pagination = observed.find(row => row.cursor);
        assert.equal(pagination?.anchor, "fixture:current-window");
        assert.equal(pagination?.cursor, "fixture:older-page");
        assert.equal(await dialog.locator('[data-recent-vote-id="earlier"]').count(), 1, "history pages deduplicate without dropping held records");
        const historyGap = dialog.locator('[data-card-gap-contribution="earlier-votes:congress:Z999994"]')
          .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' card-section-body ')]").locator("[data-card-gap]");
        await historyGap.getByText(/We[’']re working on getting this info/).waitFor({ state: "visible" });
        assert.equal(await historyGap.getByRole("button", { name: "Want us to get this sooner?", exact: true }).count(), 1);
        releaseCurrent();
        await dialog.getByRole("button", { name: /^Recent/ }).click();
        await dialog.locator('[data-recent-vote-id="current"]').waitFor({ state: "visible" });
        await dialog.getByRole("button", { name: /^Sources/ }).click();
        await dialog.locator(`[data-source-list] a[href="${current.rollCallUrl}"]`).waitFor({ state: "visible" });
        await dialog.getByRole("button", { name: "Voting record", exact: true }).click();
        await dialog.getByRole("button", { name: /^Earlier records/ }).click();
        await dialog.locator('[data-recent-vote-id="oldest"]').waitFor({ state: "visible" });
      } else {
        const recentGap = dialog.locator('[data-card-gap-contribution="recent-votes:congress:Z999993"]')
          .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' card-section-body ')]").locator("[data-card-gap]");
        await recentGap.getByText(/We[’']re working on getting this info/).waitFor({ state: "visible" });
        assert.equal(await recentGap.getByRole("button", { name: "Want us to get this sooner?", exact: true }).count(), 1);
        assert.equal(await dialog.getByRole("button", { name: /^Recent/ }).count(), 0, "a current failure cannot hide held history behind an empty tab");
      }
      await dialog.getByRole("button", { name: /^Sources/ }).click();
      await dialog.locator(`[data-source-list] a[href="${earlier.rollCallUrl}"]`).waitFor({ state: "visible" });
      await page.screenshot({ path: `${artifact}/${mode}-sourced-history.png` });
      await dialog.getByRole("button", { name: `Close Fixture ${mode}`, exact: true }).click();
    }
    assert.deepEqual(errors, []);
  } finally {
    writeFileSync(`${artifact}/requests.json`, JSON.stringify(observed, null, 2));
    releaseCurrent();await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
