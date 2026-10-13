import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { normalizeFederalCapture } from "../lib/sources/congress/normalize.ts";
import { publishFederalPartition } from "../lib/sources/congress/publication.ts";
import { readFederalMember, readFederalRules } from "../lib/sources/congress/reader.ts";
import { launchGuarded } from "../scripts/browser.mts";
import type { FederalCapture } from "../lib/sources/congress/types.ts";

test("source fixtures reach the hydrated member card with bills, text, comment deadlines and one bottom Sources list", async () => {
  const now = "2026-10-12T18:00:00Z", store = new MemoryRoutineDataStore();
  const captures: FederalCapture[] = [["congress-bill.json", "bill"], ["congress-committees.json", "committees"], ["congress-text.json", "text-versions"]].map(([file, kind]) => ({
    source: "congress-api", kind: kind as FederalCapture["kind"], body: readFileSync(new URL(`./fixtures/src-cg/${file}`, import.meta.url), "utf8"),
    url: `https://api.congress.gov/v3/bill/117/hr/21/${kind}`, retrievedAt: now, context: { billId: "117:hr:21" },
  }));
  await publishFederalPartition({ source: "congress-api", partition: "congress:C001078", captures, records: captures.flatMap(normalizeFederalCapture), store, now });
  const rule: FederalCapture = { source: "regulations-gov", kind: "rules", url: "https://api.regulations.gov/v4/documents", retrievedAt: now,
    body: JSON.stringify({ data: [{ id: "FIXTURE-2026-0001", attributes: { title: "Controlled comment-period transport case", postedDate: "2026-10-10", commentEndDate: "2026-10-14T23:59:59Z" } }] }) };
  await publishFederalPartition({ source: "regulations-gov", partition: "rules", captures: [rule], records: normalizeFederalCapture(rule), store, now });
  const member = await readFederalMember("congress:C001078", { store, now }), rules = await readFederalRules({ store, now });
  const output = await build({ stdin: { contents: `
    import React from "react";import {createRoot} from "react-dom/client";
    import {PersonCard} from "./components/ui/person-card.tsx";
    import {FederalMemberRecords} from "./components/officials/federal-records.tsx";
    import {FederalCommentRules} from "./components/officials/federal-comment-rules.tsx";
    createRoot(document.getElementById("root")).render(<PersonCard title="Gerald Connolly" identityKey="congress:C001078" identity={<h1>Gerald Connolly</h1>} contact={<p>Congress</p>} sections={{}} afterSections={<><FederalMemberRecords memberId="congress:C001078"/><FederalCommentRules/></>}/>);`,
    resolveDir: process.cwd(), sourcefile: "src-cg-browser.tsx", loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const script = output.outputFiles[0].text;
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") response.writeHead(200, { "Content-Type": "application/javascript" }).end(script);
    else if (request.url?.startsWith("/api/federal-civic")) response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(request.url.includes("member=") ? member : rules));
    else response.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "src-cg-member-reader", blockWrites: true });
    const context = await browser.context({ viewport: { width: 420, height: 900 } }), page = await context.newPage();
    const started = Date.now(); await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByText("Sponsored bills", { exact: true }).click();
    await page.getByRole("link", { name: member.bills[0].title, exact: true }).waitFor({ state: "visible" });
    assert.ok(Date.now() - started < 3000, "First-use card facts must be usable within three seconds.");
    await page.getByText("Make your voice heard", { exact: true }).click();
    await page.getByText("Comments close 2026-10-14", { exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("link", { name: "Submit a comment", exact: true }).getAttribute("href"), "https://www.regulations.gov/commenton/FIXTURE-2026-0001");
    assert.equal(await page.getByText("Sources", { exact: true }).count(), 1);
    assert.equal(await page.locator("[data-card-gap]").count(), 1);
    assert.match(await page.locator("[data-card-gap]").innerText(), /lobbying contributions/);
    assert.equal(await page.locator("[data-card-sources]").evaluate(source => source === source.parentElement?.lastElementChild), true);
    assert.doesNotMatch(await page.locator("body").innerText(), /working on getting this info|Want us to get this/i);
    await page.getByText("Sources", { exact: true }).click();
    await page.getByText("Library of Congress — Congress.gov", { exact: true }).first().waitFor({ state: "visible" });
    assert.match(await page.locator("body").innerText(), /Published 2021-01-04/);
    await mkdir(".scratch/ci", { recursive: true });
    await page.screenshot({ path: ".scratch/ci/src-cg-member.png", fullPage: true });
    await context.close();
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
