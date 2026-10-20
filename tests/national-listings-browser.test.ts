import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import test from "node:test";
import { build } from "esbuild";
import { zip } from "../scripts/xlsx.mjs";
import { launchGuarded } from "../scripts/browser.mts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { referenceGovernmentListings } from "../lib/registration/listings.ts";
import { registrationReferenceFromRelease } from "../lib/registration/source-reference.ts";
import { schoolListingsFromRelease } from "../lib/registration/school-sources.ts";
import { registrationCandidate } from "../lib/registration/candidate.ts";
import { heldRegistrationReceipt } from "../lib/registration/acquire.ts";
import { registrationTarget } from "../lib/registration/publication.ts";
import { governmentListingsForDivisions } from "../lib/registry/server.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { stateOfficesForStates } from "../lib/reference/state-offices.ts";
import { attachGovernmentDomains, parseDotGovRegistry, DOTGOV_BOUNDARY, type DotGovSnapshot } from "../lib/civic-data/dotgov.ts";
import type { KnownReleaseFile } from "../lib/sources/known-release-file.ts";
import { knownReleaseFileFixture } from "./helpers/known-release-file-fixture.ts";
import type { RegistrationReadModel } from "../lib/registration/candidate.ts";

const places = [["85004", "AZ"], ["30303", "GA"], ["02108", "MA"], ["48201", "MI"], ["97201", "OR"]] as const;
function fixtureRelease(member: string, url: string): KnownReleaseFile {
  const bytes = zip([{ name: member, data: readFileSync(`tests/fixtures/national-listings/${member}`) }], "2026-10-12");
  return knownReleaseFileFixture({ sourceId: "fixture", releaseId: member, bytes, sha256: createHash("sha256").update(bytes).digest("hex"), requestedUrl: url, finalUrl: url,
    httpStatus: 200, retrievedAt: "2026-10-12T00:00:00.000Z", sourceObservedAt: "2026-10-12T00:00:00.000Z", checkedAt: "2026-10-12T00:00:00.000Z",
    lastCheckStatus: 200, lastModified: null, etag: null, contentType: "application/zip", reused: true });
}

test("five ZIPs first show their source-code school district, government contacts and state offices", async () => {
  const domains = parseDotGovRegistry(readFileSync("tests/fixtures/dotgov/current-full.csv", "utf8"));
  const origin = JSON.parse(readFileSync("tests/fixtures/dotgov/retrieval.json", "utf8"));
  const byType: Record<string, number> = {};
  for (const row of domains) byType[row.type] = (byType[row.type] ?? 0) + 1;
  const registry: DotGovSnapshot = { source: { sha: origin.sha, url: origin.sourceUrl, readAt: origin.retrievedAt },
    counts: { domains: domains.length, electionDomains: domains.filter(row => /election/i.test(row.type)).length, byType }, domains, boundary: DOTGOV_BOUNDARY };
  const regions: Record<string, { state: string; records: unknown[]; offices: unknown[] }> = {};
  for (const [postal, state] of places) {
    const reference = await registrationReferenceFromRelease(loadRegistrationReference(process.cwd(), state), fixtureRelease("census-government-sample.csv", "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP"));
    const schools = await schoolListingsFromRelease(reference, fixtureRelease("nces-lea-directory.csv", "https://nces.ed.gov/ccd/data/zip/ccd_lea_029_2526_w_0a_050626.zip"));
    const listings = new Map(referenceGovernmentListings(reference).map(row => [row.id, row]));
    for (const school of schools) listings.set(school.id, school);
    const candidate = registrationCandidate({ target: registrationTarget(state), reference: { ...reference, listings: [...listings.values()] }, receipt: heldRegistrationReceipt() });
    const value = candidate.readModel as RegistrationReadModel;
    const index = JSON.parse(readFileSync(`data/derived/zip-divisions/${postal.slice(0, 2)}.json`, "utf8"));
    const divisions: string[] = index.zips[postal].map((at: number) => index.divisions[at]);
    const records = await withReaderAuthorityEdge({ edgeOnly: true, registrations: { load: async code => {
      assert.equal(code, state.toLowerCase()); return { value, versionId: `fixture:${state}` };
    } } }, async () => (await governmentListingsForDivisions(divisions)).records);
    assert.ok(records.some(row => row.nativeIds.nces_leaid && row.associations.some(link => ["unsd", "elsd", "scsd"].includes(link.layer) && link.basis === "SOURCE_CODE")), postal);
    assert.ok(records.some(row => row.mailingAddress && row.contactTitle && row.website), postal);
    regions[postal] = { state, records: attachGovernmentDomains(records, registry), offices: stateOfficesForStates([state]) };
  }
  const output = await build({ stdin: { contents: `
    import React,{useState} from "react"; import {createRoot} from "react-dom/client";
    import {GovernmentListings} from "./components/map/government-listings.tsx";
    import {StateOfficeContacts} from "./components/state-office-contacts.tsx";
    const regions=${JSON.stringify(regions)};
    function Reader(){const [zip,setZip]=useState("");const selected=regions[zip];return <><label>ZIP<input aria-label="ZIP" value={zip} onChange={event=>setZip(event.target.value)}/></label>{selected&&<><GovernmentListings records={selected.records} states={[]}/><StateOfficeContacts offices={selected.offices}/></>}</>}
    createRoot(document.getElementById("root")).render(<Reader/>);`, sourcefile: "national-listings-fixture.tsx", resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, outfile: ".scratch/national-listings-fixture.js", platform: "browser", format: "iife", jsx: "automatic", logLevel: "silent" });
  const javascript = output.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const server = createServer((request, response) => request.url === "/fixture.js"
    ? response.writeHead(200, { "content-type": "application/javascript" }).end(javascript)
    : response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><div id="root"></div><script src="/fixture.js"></script>'));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  let browser: Awaited<ReturnType<typeof launchGuarded>> | null = null;
  try {
    browser = await launchGuarded({ label: "national-listings-five-regions", blockWrites: true });
    const context = await browser.context({ viewport: { width: 1024, height: 900 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    for (const [postal, state] of places) {
      const start = Date.now();
      await page.getByRole("textbox", { name: "ZIP" }).fill(postal);
      const records = regions[postal].records as RegistrationReadModel["governments"];
      const school = records!.find(row => row.nativeIds.nces_leaid && row.associations.length)!;
      await page.getByText(school.name, { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator('[data-state-office="ELECTION_OFFICE"]').count(), 1);
      assert.equal(await page.locator('[data-state-office="CAMPAIGN_FINANCE_OFFICE"]').count(), 1);
      assert.ok(await page.locator(`[data-office-state="${state}"] a[href^="tel:"]`).count() >= 2);
      assert.ok(Date.now() - start < 3000, `${postal}: first usable result must fit three seconds`);
      const government = records!.find(row => row.contactTitle && row.mailingAddress && row.website)!;
      await page.getByText(government.name, { exact: true }).click();
      await page.getByText(`Mailing address: ${government.mailingAddress}`, { exact: true }).waitFor({ state: "visible" });
      await page.locator(`[data-government-listing="${government.id}"] a[href="${government.website}"]`).waitFor({ state: "visible" });
    }
    await mkdir(".scratch/ci", { recursive: true });
    await page.screenshot({ path: ".scratch/ci/national-listings-five-regions.png", fullPage: true });
    await context.close();
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
