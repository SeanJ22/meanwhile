import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import sharp from "sharp";
import { launchGuarded } from "../scripts/browser.mts";
import { normalizePortrait } from "../lib/photos/decode.ts";

test("normal person and candidate cards decode stored portrait bytes on first use", async () => {
  const original = await sharp({ create: { width: 128, height: 144, channels: 3, background: "#456789" } }).png().toBuffer();
  const normalized = await normalizePortrait(original);
  assert.ok("bytes" in normalized && normalized.verdict.ok);
  const output = await build({ stdin: { contents: `
    import React from "react"; import {createRoot} from "react-dom/client";
    import {PersonIdentity} from "./components/officials/person-identity.tsx";
    import {CandidateBattlecard} from "./components/ballot/candidate-battlecard.tsx";
    import {GovernmentListings} from "./components/map/government-listings.tsx";
    const holder={id:"plural:oh:11111111-1111-1111-1111-111111111111",name:"Fixture person",officeTitle:"State Representative",photoUrl:"/portrait.webp",termEnd:null,birthDate:null,partyLabel:null};
    createRoot(document.getElementById("root")).render(<>
      <div id="official"><PersonIdentity holder={holder} seatLabel={null} large /></div>
      <div id="candidate"><CandidateBattlecard name={holder.name} subjectId={holder.id} photoUrl={holder.photoUrl} contactHolder={holder}/></div>
      <GovernmentListings records={[]} states={["OH"]}/>
    </>);`, resolveDir: process.cwd(), sourcefile: "acquisition-reader-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/acquisition-reader-fixture.js", platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const js = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = output.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const server = createServer((request, response) => {
    if (request.url === "/portrait.webp") response.writeHead(200, { "content-type": "image/webp" }).end(normalized.bytes);
    else if (request.url === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(js);
    else if (request.url === "/fixture.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (request.url?.startsWith("/api/public-records?")) response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "HELD", nextOffset: null, records: [{
      id: "government:US-OH:nces:390001", name: "Fixture Education Agency", kind: "EDUCATION_AGENCY", governmentClass: "Education agency", associations: [],
      sourceVintage: "2025–26 preliminary", provenance: { sourceOrg: "NCES", sourceUrl: "https://nces.ed.gov/ccd/", collectedAt: "2026-10-01" },
    }] }));
    else if (request.url === "/") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>');
    else response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ profile: null, records: [], votes: [], districtOffices: [], committees: [], topics: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "acquisition-reader-first-use", blockWrites: true });
    const context = await browser.context({ viewport: { width: 1000, height: 800 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const decode = async (selector: string) => {
      await page.locator(selector).waitFor({ state: "visible" });
      const dimensions = await page.locator(selector).evaluate(async image => {
        const img = image as HTMLImageElement; await img.decode(); return [img.naturalWidth, img.naturalHeight];
      });
      assert.deepEqual(dimensions, [128, 144]);
    };
    await decode("#official img");
    await page.getByText("Browse OH government and school listings", { exact: true }).click();
    await page.getByText("Fixture Education Agency", { exact: true }).click();
    await page.getByText("We have not connected this listing to a verified service area.", { exact: true }).waitFor({ state: "visible" });
    await mkdir(".scratch/ci", { recursive: true });
    await page.screenshot({ path: ".scratch/ci/acquisition-first-use.png", fullPage: true });
    await page.getByRole("button", { name: "View Battlecard", exact: true }).click();
    await decode("[data-candidate-battlecard] img");
    await page.screenshot({ path: ".scratch/ci/acquisition-candidate-portrait.png", fullPage: true });
    await context.close();
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
