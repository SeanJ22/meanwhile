import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { normalizeFederalCaptureWithRoster } from "../lib/sources/congress/normalize.ts";
import { publishFederalPartition } from "../lib/sources/congress/publication.ts";
import { readFederalMember } from "../lib/sources/congress/reader.ts";
import { launchGuarded } from "../scripts/browser.mts";
import { ldaHonoreeCaptures, seedSrcCgRoster, SRC_CG_NOW } from "./helpers/src-cg-roster.ts";

test("a real joined LDA filing reaches the hydrated member card and its single Sources footer", async () => {
  const store = new MemoryRoutineDataStore(), roster = await seedSrcCgRoster(store);
  const capture = { ...ldaHonoreeCaptures()[0], context: { honoreeRosterVersionId: roster.versionId } };
  await publishFederalPartition({ source: "senate-lda", partition: "congress:C001056", store, now: SRC_CG_NOW, captures: [capture], records: normalizeFederalCaptureWithRoster(capture, roster) });
  const member = await readFederalMember("congress:C001056", { store, now: SRC_CG_NOW });
  const output = await build({ stdin: { contents: `
    import React from "react";import {createRoot} from "react-dom/client";
    import {PersonCard} from "./components/ui/person-card.tsx";
    import {FederalMemberRecords} from "./components/officials/federal-records.tsx";
    createRoot(document.getElementById("root")).render(<PersonCard title="John Cornyn" identityKey="congress:C001056" identity={<h1>John Cornyn</h1>} contact={<p>U.S. Senate · Texas</p>} sections={{}} afterSections={<FederalMemberRecords memberId="congress:C001056"/>}/>);`,
    resolveDir: process.cwd(), sourcefile: "src-cg-lda-browser.tsx", loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") response.writeHead(200, { "Content-Type": "application/javascript" }).end(output.outputFiles[0].text);
    else if (request.url?.startsWith("/api/federal-civic")) response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(member));
    else response.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "src-cg-lda-reader", blockWrites: true });
    const context = await browser.context({ viewport: { width: 420, height: 900 } }), page = await context.newPage();
    const started = Date.now(); await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByText("Lobbying contributions", { exact: true }).click();
    await page.getByText(`Lobbying contributions: $${member.contributions[0].amount}`, { exact: false }).waitFor({ state: "visible" });
    assert.ok(Date.now() - started < 3000, "First-use contributions must be usable within three seconds.");
    assert.equal(await page.getByText("Sources", { exact: true }).count(), 1);
    assert.equal(await page.locator("[data-card-gap]").count(), 1);
    assert.match(await page.locator("[data-card-gap]").innerText(), /sponsored bills/);
    assert.equal(await page.locator("[data-card-sources]").evaluate(source => source === source.parentElement?.lastElementChild), true);
    assert.doesNotMatch(await page.locator("body").innerText(), /working on getting this info|Want us to get this/i);
    await page.getByText("Sources", { exact: true }).click();
    await page.getByText("U.S. Senate Office of Public Records — Lobbying Disclosure Act", { exact: true }).waitFor({ state: "visible" });
    await page.getByText("unitedstates/congress-legislators (community project)", { exact: true }).waitFor({ state: "visible" });
    assert.match(await page.locator("body").innerText(), /Honoree identity: Sen\. John Cornyn \(R-TX\)/);
    await mkdir(".scratch/ci", { recursive: true });
    await page.screenshot({ path: ".scratch/ci/src-cg-lda-member.png", fullPage: true });
    await context.close();
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
