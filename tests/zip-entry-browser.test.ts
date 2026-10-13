import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";

test("ZIP-01: first entry and ZIP changes open real places; unplaced ZIPs and mail destinations have a working address box", async () => {
  const output = await build({ stdin: { contents: `
    import React, {useState} from "react"; import {createRoot} from "react-dom/client";
    import {WelcomeOverlay} from "./components/map/welcome-overlay.tsx";
    import {ZipSwitcher} from "./components/map/zip-switcher.tsx";
    import {PostalZipNotice} from "./components/map/postal-zip-notice.tsx";
    import {lookupZctaAsync} from "./lib/geo/zcta-table.ts";
    function Entry() {
      const [location,setLocation]=useState(null);
      const [address,setAddress]=useState(null);
      const [changing,setChanging]=useState(false);
      async function pick(zip,lat,lng) { setLocation(await lookupZctaAsync(zip)); setChanging(false); }
      function addressLocated(zip,lat,lng) { setAddress({zip,lat,lng}); pick(zip,lat,lng); }
      return <>
        <WelcomeOverlay open={!location} onResolved={pick} onAddressLocated={addressLocated} onDismiss={null}/>
        {location && <><p data-opened-zip>{location.zip}</p><button onClick={()=>setChanging(true)}>Change ZIP</button>
          <PostalZipNotice location={location} onLocated={addressLocated} hidden={changing}/></>}
        {changing && <ZipSwitcher current={location?.zip??null} onPick={pick} onAddressLocated={addressLocated} onClose={()=>setChanging(false)}/>}
        {address && <p data-address-point>{JSON.stringify(address)}</p>}
      </>;
    }
    createRoot(document.getElementById("root")).render(<Entry/>);`, resolveDir: process.cwd(), sourcefile: "zip-entry-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const js = output.outputFiles[0].text;
  const css = readFileSync("app/globals.css", "utf8");
  const census = JSON.parse(readFileSync("tests/fixtures/zip-entry/census-address.json", "utf8"));
  const coordinates = census.result.addressMatches[0].coordinates;
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    if (request.url === "/entry.js") response.writeHead(200, { "content-type": "application/javascript" }).end(js);
    else if (request.url === "/entry.css") response.writeHead(200, { "content-type": "text/css" }).end(css);
    else if (request.url === "/api/address/resolve") {
      let body = ""; for await (const chunk of request) body += chunk;
      requests.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true,
        resolution: { status: "RESOLVED", levels: [] }, contestIds: [], point: { lat: coordinates.y, lng: coordinates.x } }));
    } else if (request.url === "/") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><link rel="stylesheet" href="/entry.css"><style>.hidden{display:none}body{margin:0;background:#0f1117;color:white}#root{height:100vh}</style><div id="root"></div><script src="/entry.js"></script>');
    else response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const bound = server.address(); assert.ok(bound && typeof bound !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "zip-01-reader-entry", blockWrites: false });
    await mkdir(".scratch/ci", { recursive: true });
    for (const viewport of [{ width: 1000, height: 800 }, { width: 390, height: 844 }]) {
      const context = await browser.context({ viewport });
      const page = await context.newPage();
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      for (const zip of ["73960", "05009", "11249", "10540", "10008", "00501"]) {
        await page.goto(`http://127.0.0.1:${bound.port}/`);
        await page.getByRole("textbox", { name: /^zip code$/i }).fill(zip);
        const started = Date.now();
        await page.getByRole("button", { name: "Show meetings", exact: true }).click();
        await page.locator("[data-opened-zip]").filter({ hasText: zip }).waitFor();
        assert.ok(Date.now() - started < 3000, `${zip} first entry takes under three seconds`);
        if (zip !== "11249") {
          await page.getByRole("region", { name: "Mailing ZIP location" }).waitFor();
          assert.match(await page.getByRole("status").innerText(), /Your districts depend on where you live/);
          await page.getByRole("textbox", { name: "Street address", exact: true }).waitFor({ state: "visible" });
        }
        if (zip === "73960") {
          assert.match(await page.getByRole("status").innerText(), /Texhoma, TX · Sherman County.*P.O. Box only/);
          await page.screenshot({ path: `.scratch/ci/zip-01-postal-${viewport.width}.png`, fullPage: true });
        }
      }
      await page.getByRole("button", { name: "Change ZIP", exact: true }).click();
      await page.getByRole("dialog", { name: "Change zip" }).getByRole("textbox", { name: /^zip code$/i }).fill("11249");
      await page.getByRole("button", { name: "Go", exact: true }).click();
      await page.locator("[data-opened-zip]").filter({ hasText: "11249" }).waitFor();
      await page.getByRole("button", { name: "Change ZIP", exact: true }).click();
      await page.getByRole("dialog", { name: "Change zip" }).getByRole("textbox", { name: /^zip code$/i }).fill("00000");
      await page.getByRole("button", { name: "Go", exact: true }).click();
      assert.match(await page.getByRole("dialog", { name: "Change zip" }).innerText(), /We don't have that ZIP's area yet/);
      await page.getByRole("textbox", { name: "Street address", exact: true }).fill("Pennsylvania Ave NW, Washington, DC");
      await page.getByRole("button", { name: "Show mine", exact: true }).click();
      await page.locator("[data-address-point]").waitFor();
      assert.ok(requests.some(body => body.zip === "00000" && body.postalEntry === true));
      await page.goto(`http://127.0.0.1:${bound.port}/`);
      await page.getByRole("textbox", { name: /^zip code$/i }).fill("00000");
      await page.getByRole("button", { name: "Show meetings", exact: true }).click();
      await page.getByText("We don't have that ZIP's area yet. Enter your street address and we'll find your districts.", { exact: true }).waitFor();
      await page.getByRole("textbox", { name: "Street address", exact: true }).waitFor();
      await page.screenshot({ path: `.scratch/ci/zip-01-unplaced-${viewport.width}.png`, fullPage: true });
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
