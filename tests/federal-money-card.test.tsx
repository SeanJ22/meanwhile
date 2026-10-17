import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { launchGuarded } from "../scripts/browser.mts";
import { FEDERAL_MONEY_SOURCES, type FederalMoneyFact } from "../lib/federal-money/model.ts";
import type { FederalMoneyPlaceRead } from "../lib/federal-money/reader.ts";

const division = "ocd-division/country:us/state:ar/county:ouachita";
const body = `${division}#governing`;
const bytes = readFileSync(new URL("./fixtures/federal-money/openfema-live.json", import.meta.url));
const native = JSON.parse(bytes.toString("utf8")).DisasterDeclarationsSummaries[0];
const fact: FederalMoneyFact = {
  id: `openfema:${native.id}`, source: "openfema", sourceId: native.id, state: native.state, kind: "DISASTER",
  title: native.declarationTitle, amount: null, amountLabel: null, period: String(native.fyDeclared), recipient: null, uei: null,
  identifiers: { countyFips: `${native.fipsStateCode}${native.fipsCountyCode}` }, geography: [{ type: "county", geoid: "05103" }],
  bodyIds: [], divisionIds: [division], joinStatus: "JOINED", joinReason: "County FIPS", details: { declarationDate: native.declarationDate },
  provenance: { sourceUrl: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries", sourceOrg: "OpenFEMA", publicationDate: native.declarationDate,
    retrievedAt: "2026-10-12T23:00:19.097Z", official: true, rawHash: createHash("sha256").update(bytes).digest("hex") },
};
function page(records: FederalMoneyFact[], nextCursor: string | null): FederalMoneyPlaceRead {
  return { division, bodyId: body, nextCursor, sources: FEDERAL_MONEY_SOURCES.map(source => ({ source,
    status: source === "openfema" ? "HELD" : "NOT_HELD", records: source === "openfema" ? records : [],
    versionId: source === "openfema" ? "fixture-pagination" : null, checkedAt: fact.provenance.retrievedAt,
    coverageComplete: true, moreRecords: source === "openfema" && nextCursor !== null })) };
}

test("a government card pages exact-place federal facts, deduplicates rows, and retains one bottom Sources list", async () => {
  const output = await build({ stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client";
    import {Card} from "./components/ui/card.tsx";
    import {FederalMoneySection} from "./components/funding/federal-money-section.tsx";
    createRoot(document.getElementById("root")).render(<Card title="Ouachita County" sources={[]}><FederalMoneySection divisionId=${JSON.stringify(division)} bodyId=${JSON.stringify(body)} /></Card>);`,
    resolveDir: process.cwd(), sourcefile: "federal-money-card-fixture.tsx", loader: "tsx" }, bundle: true, write: false,
    outfile: ".scratch/federal-money-card.js", platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent" });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const requests: URL[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/fixture.js") response.writeHead(200, { "content-type": "application/javascript" }).end(javascript);
    else if (url.pathname === "/api/federal-money") {
      requests.push(url);
      const records = url.searchParams.has("cursor") ? [fact, { ...fact, id: "openfema:synthetic-pagination-row", sourceId: "synthetic-pagination-row", title: "Synthetic pagination record" }] : [fact];
      const result = requests.length === 2 ? { ...page([], null), sources: page([], null).sources.map(source => source.source === "openfema" ? { ...source, status: "UNAVAILABLE", versionId: null } : source) } : page(records, url.searchParams.has("cursor") ? null : "next-page");
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    } else if (url.pathname === "/") response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/fixture.js"></script>');
    else response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "federal-money-card", blockWrites: true });
    const context = await browser.context({ viewport: { width: 390, height: 844 } });
    const browserPage = await context.newPage();
    const started = Date.now();
    await browserPage.goto(`http://127.0.0.1:${address.port}/`);
    await browserPage.locator(`[data-federal-record="${fact.id}"]`).waitFor({ state: "visible" });
    assert.ok(Date.now() - started < 3000, "federal facts usable on first visit within three seconds");
    assert.equal(await browserPage.locator("[data-federal-record]").count(), 1);
    await browserPage.getByRole("button", { name: "Load more records", exact: true }).click();
    await browserPage.getByRole("button", { name: "Try loading more records again", exact: true }).waitFor({ state: "visible" });
    assert.equal(await browserPage.locator("[data-federal-record]").count(), 1, "a failed page retains the verified records");
    await browserPage.getByRole("button", { name: "Try loading more records again", exact: true }).click();
    await browserPage.locator('[data-federal-record="openfema:synthetic-pagination-row"]').waitFor({ state: "visible" });
    assert.equal(await browserPage.locator("[data-federal-record]").count(), 2);
    assert.equal(await browserPage.getByRole("button", { name: "Load more records", exact: true }).count(), 0);
    assert.equal(requests.length, 3);
    assert.ok(requests.every(url => url.searchParams.get("division") === division && url.searchParams.get("body") === body));
    assert.equal(requests[1].searchParams.get("cursor"), "next-page");
    assert.equal(await browserPage.locator("[data-card-sources]").count(), 1);
    assert.equal(await browserPage.locator("[data-card-gap]").count(), 1);
    assert.match(await browserPage.locator("[data-card-gap]").innerText(), /federal grants, contracts and loans.*federal audit findings.*federal registration/);
    assert.equal(await browserPage.locator("[data-card-gap]").evaluate(element => element.closest("[data-card-footer]") !== null), true);
    assert.doesNotMatch(await browserPage.locator('[aria-label="Federal money and records"]').innerText(), /Published by|Last checked|Still gathering/);
    await browserPage.getByRole("button", { name: /^Sources/ }).click();
    await browserPage.locator(`[data-card-sources] a[href="${fact.provenance.sourceUrl}"]`).waitFor({ state: "visible" });
    assert.match(await browserPage.locator("[data-card-sources]").innerText(), /published 2026-09-15/);
    assert.equal(await browserPage.locator("[data-card-footer]").evaluate(element => element.parentElement?.lastElementChild === element), true);
    await context.close();
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
