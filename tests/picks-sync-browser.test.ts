import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { PGlite } from "@electric-sql/pglite";
import { launchGuarded } from "../scripts/browser.mts";
import { handleSavedPicks } from "../lib/ballot/saved-picks-handler.ts";
import { savedPicksStore } from "../lib/db/saved-picks.ts";
import type { PickableContest } from "../lib/ballot/pick-tally.ts";

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

test("two fresh browsers restore, sync in both directions, keep offline edits and resume tomorrow without extra pick events", { timeout: 60_000 }, async () => {
  const priorRole = process.env.WTP_DB_ROLE;
  process.env.WTP_DB_ROLE = "local";
  const db = new PGlite();
  await db.exec(readFileSync("lib/db/migrations/PK-01_saved_picks.sql", "utf8"));
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
  const requests: { url: string; synthetic: boolean }[] = [];
  let privateOffline = false;
  const server = createServer(async (request, response) => {
    const path = request.url?.split("?")[0];
    requests.push({ url: request.url!, synthetic: Boolean(request.headers["x-wtp-synthetic-run"]) });
    if (path === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (path === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (path === "/ballot") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html lang="en"><link rel="stylesheet" href="/fixture.css"><body class="mw-reader"><main id="root"></main><script src="/fixture.js"></script></body></html>');
    else if (path === "/api/ballot/picks") {
      if (privateOffline) { response.writeHead(503).end(); return; }
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
    const first = await browser.page({ viewport: { width: 1200, height: 900 } });
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
    const fresh = await browser.page({ viewport: { width: 390, height: 844 } });
    fresh.on("pageerror", error => errors.push(error.message));
    const restoredAt = Date.now();
    await fresh.goto(link);
    await fresh.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor();
    const restoreMs = Date.now() - restoredAt;
    assert.ok(restoreMs < 3000, "first restore is usable within three seconds");
    assert.equal(new URL(fresh.url()).hash, "", "the capability is removed from the address bar");
    await fresh.getByRole("button", { name: labelB, exact: true }).click();
    await first.getByRole("button", { name: labelB, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    await first.getByRole("button", { name: "Candidate C", exact: true }).click();
    await first.getByRole("button", { name: "Candidate D", exact: true }).click();
    await fresh.getByRole("button", { name: /Candidate C/, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("button", { name: /Candidate D/, pressed: true }).waitFor({ timeout: 3000 });
    // Disconnected devices edit different contests, then reconnect against the real SQL revision check.
    privateOffline = true;
    await first.getByRole("button", { name: labelA, exact: true }).click();
    await fresh.getByRole("button", { name: "Candidate E", exact: true }).click();
    privateOffline = false;
    await first.getByRole("button", { name: /Candidate E/, pressed: true }).waitFor({ timeout: 5000 });
    await fresh.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 5000 });
    // Reload under tomorrow's clock: ordinary mount/poll scheduling restores the same saved state.
    await fresh.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
    await first.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
    await fresh.reload();
    await fresh.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("button", { name: /Candidate E/, pressed: true }).waitFor({ timeout: 3000 });
    // The receiver's ordinary scheduled interval must pick up each next-day edit, without a Sync click.
    await first.getByRole("button", { name: labelB, exact: true }).click();
    await fresh.getByRole("button", { name: labelB, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("button", { name: labelA, exact: true }).click();
    await first.getByRole("button", { name: labelA, exact: true, pressed: true }).waitFor({ timeout: 3000 });
    mkdirSync(".scratch/pk-01", { recursive: true });
    await fresh.screenshot({ path: ".scratch/pk-01/phone.png", fullPage: true });
    await first.getByRole("button", { name: "not sure", exact: true }).first().click();
    await fresh.getByRole("button", { name: /not sure yet/, pressed: true }).waitFor({ timeout: 3000 });
    await fresh.getByRole("button", { name: "Clear my picks", exact: true }).click();
    await fresh.getByRole("button", { name: "Clear", exact: true }).click();
    await first.getByRole("button", { name: "Candidate E", exact: true, pressed: false }).waitFor({ timeout: 3000 });
    await fresh.reload();
    await fresh.getByRole("status").filter({ hasText: "Your picks are saved" }).waitFor();
    assert.equal(await fresh.getByRole("button", { pressed: true }).count(), 0, "clear and unsure state sync without resurrecting picks on reload");
    await first.evaluate("window.flushPicksEvents()");
    await fresh.evaluate("window.flushPicksEvents()");
    await first.waitForFunction(() => true); // Give the initiated fetch a turn without a timed sleep.
    await new Promise<void>(resolve => setImmediate(resolve));
    const picks = captured.filter(event => event.type === "BALLOT_PICK");
    assert.equal(picks.length, 10, "eight candidate taps, one unsure and one cleared race emit ten events; save, restore and polling emit none");
    assert.ok(picks.every(event => event.zip === "85701"));
    assert.ok(picks.filter(event => (event.ballotPick as { contestId: string }).contestId === ballot[0]!.contestId).every(event => event.district === ballot[0]!.contestOcdId));
    assert.ok(!JSON.stringify(captured).includes(secret));
    assert.ok(requests.filter(request => request.url.startsWith("/api/")).every(request => request.synthetic));
    assert.ok(requests.every(request => !request.url.includes(secret)));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ replaySource: replay?.source ?? "synthetic fixture", capturedAt: replay?.observedAt ?? null,
      restoreMs, tomorrow: "2026-10-24", automaticPollingBothWays: true, emittedPicks: picks.length, runId: browser.runId }));
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.close();
    if (priorRole === undefined) delete process.env.WTP_DB_ROLE; else process.env.WTP_DB_ROLE = priorRole;
  }
});
