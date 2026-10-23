import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { launchGuarded } from "../scripts/browser.mts";
import { CS01_PLACES, inspectSourceSections, visibleCapitals } from "../scripts/cs-01-reader-scan.mts";

test("CS-01 scans twenty states including the five required ZIPs", () => {
  assert.equal(CS01_PLACES.length, 20);
  assert.equal(new Set(CS01_PLACES.map(row => row.state)).size, 20);
  for (const zip of ["53202", "77005", "19107", "94118", "85701"]) assert.ok(CS01_PLACES.some(row => row.zip === zip));
  assert.ok(CS01_PLACES.every(row => /\d+ .+, .+, [A-Z]{2} \d{5}$/.test(row.address)));
});

test("CS-01 inspects exclusive Sources panels once each without reopening siblings", async () => {
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><body>
    <section data-card-sources><button aria-expanded="false">Sources one</button><p hidden>FIRSTQUOTE</p></section>
    <section data-card-sources><button aria-expanded="false">Sources two</button><p hidden>SECONDQUOTE</p></section>
    <script>document.querySelectorAll('button').forEach(button=>button.onclick=()=>{
      document.querySelectorAll('button').forEach(other=>{const open=other===button;other.setAttribute('aria-expanded',String(open));other.nextElementSibling.hidden=!open;});
    });</script>
  </body></html>`));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await launchGuarded({ label: "cs-01-source-disclosures", blockWrites: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.page();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const scan = await inspectSourceSections(page);
    assert.deepEqual(scan?.offenders.map(row => row.word), ["FIRSTQUOTE", "SECONDQUOTE"]);
    assert.equal(await page.locator('button[aria-expanded="true"]').count(), 1);
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("CS-01 catches source and CSS capitals while excluding hidden text and code fragments", async () => {
  const server = createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><body>
    <p>CITY OF Milwaukee</p><p style="text-transform:uppercase">Page title</p>
    <p>FEMA YMCA BART PAC LLC US III</p><p>AB12CD ZQX123 28AAB</p>
    <p hidden>HIDDEN</p><p style="opacity:0">INVISIBLE</p><details><summary>More</summary>COLLAPSED</details>
    <input aria-label="Example" value="WRITTEN"><p>McDonald O'Brien</p>
  </body></html>`));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const browser = await launchGuarded({ label: "cs-01-capitals-detector", blockWrites: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.page();
    await page.goto(`http://127.0.0.1:${address.port}`);
    const scan = await visibleCapitals(page);
    assert.deepEqual(scan.offenders.map(row => row.word), ["CITY", "PAGE", "TITLE", "WRITTEN"]);
    assert.ok(scan.words > 10);
    assert.equal(scan.offenders.find(row => row.word === "TITLE")?.transform, "uppercase");
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
