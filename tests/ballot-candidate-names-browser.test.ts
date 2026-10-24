import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

test("candidate names keep the official quote and the held portrait preserves candidate background", async () => {
  const quote = "Democratic Party | Benson, Jocelyn / Brinks, Winnie | 04/16/2026 | Petitions";
  const candidate = { givenName: "", familyName: "Benson, Jocelyn / Brinks, Winnie", provenance: {
    sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "Fixture election authority",
    collectedAt: "2026-10-14T00:00:00.000Z", verifiedAt: "2026-10-14T00:00:00.000Z", quote,
  } };
  const output = await build({ stdin: { contents: `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import {Card} from "./components/ui/card.tsx";
    import {CandidateCard} from "./components/ballot/candidate-card.tsx";
    import {ballotCandidateDisplayName} from "./lib/ballot/name-case.ts";
    const candidate = ${JSON.stringify(candidate)};
    createRoot(document.getElementById("root")).render(<Card title="Governor and Lieutenant Governor" sources={[]}>
      <CandidateCard name={ballotCandidateDisplayName(candidate)} partyLine="Democratic Party"
        card={{photoUrl:"/campaign-portrait.jpg",photoSource:"Campaign's own site",bio:"Campaign biography retained"}}
        holder={{id:"held-governor",photoUrl:"/official-portrait.jpg",provenance:{sourceUrl:"https://governor.example.gov/about",
          sourceOrg:"Governor's office",collectedAt:"2026-10-14T00:00:00.000Z",verifiedAt:null}}}
        links={null} filingProvenance={candidate.provenance}/>
    </Card>);`, resolveDir: process.cwd(), sourcefile: "candidate-names-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/ci/candidate-names-fixture.js", platform: "browser",
    format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = readFileSync("app/globals.css", "utf8") + readFileSync("app/reader.css", "utf8");
  const server = createServer((request, response) => {
    if (request.url === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (request.url === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (request.url === "/") response.writeHead(200, { "content-type": "text/html" }).end(
      '<!doctype html><html lang="en"><link rel="stylesheet" href="/fixture.css"><body class="mw-reader"><main id="root"></main><script src="/fixture.js"></script></body></html>');
    else response.writeHead(503, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "BL-10-candidate-name-order", blockWrites: true });
    const context = await browser.context({ viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const startedAt = Date.now();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.locator(".candidate-row").getByText("Jocelyn Benson / Winnie Brinks", { exact: true }).waitFor();
    assert.ok(Date.now() - startedAt < 3000, "the first candidate card is usable within three seconds");
    assert.doesNotMatch(await page.locator(".candidate-row").innerText(), /Benson, Jocelyn/);
    assert.equal(await page.locator(".candidate-row img").getAttribute("src"), "/official-portrait.jpg");
    await page.locator(".candidate-row").getByText("“Campaign biography retained”", {exact:true}).waitFor();
    await page.getByRole("button", { name: /^Sources/ }).click();
    await page.getByText(`“${quote}”`, { exact: true }).waitFor();
    const sourceUrls = await page.locator("[data-source-list] a").evaluateAll(links => links.map(link => link.getAttribute("href")));
    assert.ok(sourceUrls.includes(candidate.provenance.sourceUrl));
    assert.ok(sourceUrls.includes("https://governor.example.gov/about"));
    assert.deepEqual(errors, []);
    mkdirSync(".scratch/ci", { recursive: true });
    await page.screenshot({ path: ".scratch/ci/BL-10-candidate-name-order.png", fullPage: true });
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
