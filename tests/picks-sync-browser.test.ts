import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";
import type { Page } from "playwright";
import { launchGuarded } from "../scripts/browser.mts";
import { handleSavedPicks } from "../lib/ballot/saved-picks-handler.ts";
import { savedPicksStore } from "../lib/db/saved-picks.ts";
import type { PickableContest } from "../lib/ballot/pick-tally.ts";
import { markerFromRequestWithBody } from "../lib/db/run-marker.ts";

const replay = process.env.PK01_REPLAY_BALLOT_FILE ? JSON.parse(readFileSync(process.env.PK01_REPLAY_BALLOT_FILE, "utf8")) as {
  source: string; observedAt: string; contests: { contestId: string; contestTitle: string; contestOcdId: string; options: { label: string }[] }[];
} : null;
const production = replay?.contests[0];
const ballot: PickableContest[] = [
  production ? { ...production, voteFor: 1, options: production.options.map(option => ({ id: option.label, label: option.label })) }
    : { contestId: "race", contestTitle: "Mayor", contestOcdId: "ocd-division/country:us/state:az/place:tucson", voteFor: 1,
      options: [{ id: "candidate-a", label: "Candidate A" }, { id: "candidate-b", label: "Candidate B" }] },
  { contestId: "board", contestTitle: "School board", voteFor: 2,
    options: [{ id: "candidate-c", label: "Candidate C" }, { id: "candidate-d", label: "Candidate D" }, { id: "candidate-e", label: "Candidate E" }] },
];
const labelA = ballot[0]!.options[0]!.label;
const labelB = ballot[0]!.options[1]!.label;
const saved = (page: Page) => page.getByRole("status").filter({ hasText: "Your picks are saved" }).waitFor();
const poll = async (page: Page, runEveryTimer = false) => {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/ballot/picks" && response.request().method() === "GET");
  // Counting an idle minute must run every interval; fastForward coalesces repeated timers.
  if (runEveryTimer) await page.clock.runFor(30_000);
  else await page.clock.fastForward(30_000);
  await (await response).finished();
};
const setVisibility = (page: Page, visibility: "visible" | "hidden") => page.evaluate(value => {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}, visibility);
const flushCapturedEvents = async (page: Page) => {
  // Finish queued analytics while the frame is present; unload keepalive requests
  // may lose Playwright's headers (the real intake also accepts the body marker).
  await page.evaluate("window.flushPicksEvents()");
  await page.waitForLoadState("networkidle");
};

test("two fresh browsers restore, sync in both directions, keep offline edits and resume tomorrow without extra pick events", { timeout: 60_000 }, async () => {
  const priorRole = process.env.WTP_DB_ROLE;
  process.env.WTP_DB_ROLE = "local";
  const db = new PGlite();
  await db.exec(readFileSync("lib/db/migrations/0050_pk01_saved_picks.sql", "utf8"));
  const store = savedPicksStore(async (text, params) => (await db.query(text, [...params])).rows as Record<string, unknown>[]);
  const output = await build({ stdin: { contents: `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import {PickControl} from "./components/ballot/pick-control.tsx";
    import {MyPicks} from "./components/ballot/my-picks.tsx";
    import {flushEvents} from "./lib/events/client.ts";
    const ballot = ${JSON.stringify(ballot)};
    window.flushPicksEvents = flushEvents;
    createRoot(document.getElementById("root")).render(<>
      {ballot.map(contest => <article key={contest.contestId}><h1>{contest.contestTitle}</h1><PickControl {...contest}/></article>)}
      <MyPicks pickable={ballot}/>
    </>);`, resolveDir: process.cwd(), sourcefile: "picks-sync-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const javascript = output.outputFiles[0]!.text;
  const css = readFileSync("app/globals.css", "utf8") + readFileSync("app/reader.css", "utf8");
  const captured: Record<string, unknown>[] = [];
  const eventBatches = new Set<string>();
  const requests: { url: string; synthetic: boolean; device: string }[] = [];
  let privateOffline = false;
  let holdNextRead: Promise<void> | undefined;
  let releaseRead: (() => void) | undefined;
  const server = createServer(async (request, response) => {
    const path = request.url?.split("?")[0];
    const observed={ url: request.url!, synthetic: Boolean(request.headers["x-wtp-synthetic-run"]), device: String(request.headers["x-pk-test-device"] ?? "") };
    requests.push(observed);
    if (path === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (path === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (path === "/ballot") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html lang="en"><link rel="stylesheet" href="/fixture.css"><body class="mw-reader"><main id="root"></main><script src="/fixture.js"></script></body></html>');
    else if (path === "/api/ballot/picks") {
      if (privateOffline) { response.writeHead(503).end(); return; }
      if (request.method === "GET" && request.headers["x-pk-test-device"] === "first" && holdNextRead) {
        const held = holdNextRead;
        holdNextRead = undefined;
        await held;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = await handleSavedPicks(new Request(`http://${request.headers.host}${request.url}`, {
        method: request.method, headers: request.headers as Record<string, string>,
        ...(chunks.length ? { body: Buffer.concat(chunks).toString() } : {}),
      }), store);
      response.writeHead(result.status, Object.fromEntries(result.headers)).end(await result.text());
    } else if (path === "/api/events") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      observed.synthetic=markerFromRequestWithBody(new Request(`http://${request.headers.host}${request.url}`,{
        headers:request.headers as Record<string,string>,
      }),body).runClass!=="ORGANIC";
      if (!eventBatches.has(body.batchId)) {
        eventBatches.add(body.batchId);
        captured.push(...body.events);
      }
      response.writeHead(202).end();
    } else response.writeHead(204).end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof launchGuarded>> | undefined;
  try {
    browser = await launchGuarded({ label: "PK-01-browser-sync" });
    const first = await browser.page({ viewport: { width: 1200, height: 900 }, extraHTTPHeaders: { "x-pk-test-device": "first" } });
    await first.clock.install({ time: new Date("2026-10-23T12:00:00Z") });
    const errors: string[] = [];
    first.on("pageerror", error => errors.push(error.message));
    await first.goto(`${base}/ballot?zip=85701`);
    await first.getByRole("button", { name: labelA, exact: true }).click();
    assert.ok(!requests.some(request => request.url.startsWith("/api/ballot/picks")), "private storage is opt-in");
    await first.getByRole("button", { name: "Save my picks on another device" }).click();
    await first.getByRole("status").filter({ hasText: "Your picks are saved" }).waitFor();
    const link = await first.getByRole("textbox", { name: "Private picks link" }).inputValue();
    const secret = new URL(link).hash.slice("#picks=".length);
    assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
    const fresh = await browser.page({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { "x-pk-test-device": "fresh" } });
    await fresh.clock.install({ time: new Date("2026-10-23T12:00:00Z") });
    fresh.on("pageerror", error => errors.push(error.message));
    const restoredAt = Date.now();
    await fresh.goto(link);
    await fresh.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor();
    const restoreMs = Date.now() - restoredAt;
    assert.ok(restoreMs < 3000, "first restore is usable within three seconds");
    assert.equal(new URL(fresh.url()).hash, "", "the capability is removed from the address bar");
    const privateRequests = (device: string) => requests.filter(request => request.device === device && request.url.startsWith("/api/ballot/picks")).length;
    const beforeIdle = privateRequests("first");
    await poll(first, true);
    await poll(first, true);
    assert.equal(privateRequests("first") - beforeIdle, 2, "one idle visible minute makes exactly two checks");
    await setVisibility(first, "hidden");
    const beforeHidden = privateRequests("first");
    await first.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online")); });
    await first.clock.fastForward(120_000);
    assert.equal(privateRequests("first"), beforeHidden, "hidden pages make zero checks, including focus and online events");
    await fresh.getByRole("button", { name: labelB, exact: true }).click();
    await saved(fresh);
    assert.equal(privateRequests("first"), beforeHidden, "a change elsewhere does not wake a hidden page");
    await setVisibility(first, "visible");
    await first.getByRole("button", { name: labelB, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    holdNextRead = new Promise<void>(resolve => { releaseRead = resolve; });
    const reading = first.waitForRequest(request => new URL(request.url()).pathname === "/api/ballot/picks" && request.method() === "GET");
    await first.clock.fastForward(30_000);
    await reading;
    await first.getByRole("button", { name: "Candidate C", exact: true }).click();
    await first.getByRole("button", { name: "Candidate D", exact: true }).click();
    releaseRead!();
    // No clock advance: edits queued behind an in-flight check must send immediately.
    await saved(first);
    await poll(fresh);
    await fresh.getByRole("button", { name: /Candidate C/, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("button", { name: /Candidate D/, pressed: true }).waitFor({ timeout: 3000 });
    // Disconnected devices edit different contests, then reconnect against the real SQL revision check.
    privateOffline = true;
    await first.getByRole("button", { name: labelA, exact: true }).click();
    await fresh.getByRole("button", { name: "Candidate E", exact: true }).click();
    await first.getByRole("status").filter({ hasText: "Picks could not sync" }).waitFor();
    await fresh.getByRole("status").filter({ hasText: "Picks could not sync" }).waitFor();
    privateOffline = false;
    await poll(first);
    await saved(first);
    await poll(fresh);
    await saved(fresh);
    await poll(first);
    await first.getByRole("button", { name: /Candidate E/, pressed: true }).waitFor({ timeout: 5000 });
    await fresh.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 5000 });
    // Reload under tomorrow's clock: ordinary mount/poll scheduling restores the same saved state.
    await fresh.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
    await first.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
    await flushCapturedEvents(fresh);
    await fresh.reload();
    await fresh.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("button", { name: /Candidate E/, pressed: true }).waitFor({ timeout: 3000 });
    // The receiver's ordinary scheduled interval must pick up each next-day edit, without a Sync click.
    await first.getByRole("button", { name: labelB, exact: true }).click();
    await saved(first);
    await poll(fresh);
    await fresh.getByRole("button", { name: labelB, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("button", { name: labelA, exact: true }).click();
    await saved(fresh);
    await first.evaluate(() => window.dispatchEvent(new Event("focus")));
    await first.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    mkdirSync(".scratch/pk-01", { recursive: true });
    await fresh.screenshot({ path: ".scratch/pk-01/phone.png", fullPage: true });
    await first.getByRole("button", { name: "not sure", exact: true }).first().click();
    await saved(first);
    await fresh.evaluate(() => window.dispatchEvent(new Event("online")));
    await fresh.getByRole("button", { name: /not sure yet/, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("button", { name: "Clear my picks", exact: true }).click();
    await fresh.getByRole("button", { name: "Clear", exact: true }).click();
    await saved(fresh);
    await poll(first);
    await first.getByRole("button", { name: "Candidate E", exact: true, pressed: false }).waitFor({ timeout: 3000 });
    await flushCapturedEvents(fresh);
    await fresh.reload();
    await fresh.getByRole("status").filter({ hasText: "Your picks are saved" }).waitFor();
    assert.equal(await fresh.getByRole("button", { pressed: true }).count(), 0, "clear and unsure state sync without resurrecting picks on reload");
    const hidden = await browser.page({ extraHTTPHeaders: { "x-pk-test-device": "hidden" } });
    await hidden.clock.install();
    await hidden.addInitScript(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); });
    await hidden.goto(link);
    await hidden.clock.fastForward(60_000);
    assert.equal(privateRequests("hidden"), 0, "opening a saved link while hidden does not prefetch or poll");
    await setVisibility(hidden, "visible");
    await saved(hidden);
    await hidden.context().close();
    await flushCapturedEvents(first);
    await flushCapturedEvents(fresh);
    const picks = captured.filter(event => event.type === "BALLOT_PICK");
    assert.equal(picks.length, 10, "eight candidate taps, one unsure and one cleared race emit ten events; save, restore and polling emit none");
    assert.ok(picks.every(event => event.zip === "85701"));
    assert.ok(picks.filter(event => (event.ballotPick as { contestId: string }).contestId === ballot[0]!.contestId).every(event => event.district === ballot[0]!.contestOcdId));
    assert.ok(!JSON.stringify(captured).includes(secret));
    assert.deepEqual(requests.filter(request => request.url.startsWith("/api/") && !request.synthetic), [], "all test API requests declare the synthetic run");
    assert.ok(requests.every(request => !request.url.includes(secret)));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ replaySource: replay?.source ?? "synthetic fixture", capturedAt: replay?.observedAt ?? null,
      restoreMs, tomorrow: "2026-10-24", automaticPollingBothWays: true, idleChecksPerMinute: 2, hiddenChecks: 0,
      emittedPicks: picks.length, runId: browser.runId }));
  } finally {
    releaseRead?.();
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    if (priorRole === undefined) delete process.env.WTP_DB_ROLE; else process.env.WTP_DB_ROLE = priorRole;
  }
});
