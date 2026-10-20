import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dotgovDomainLeads, heldCensusWebsiteNeeds, observePlatformCensus, readPlatformCensusNeeds, referenceTenantLeads, refreshDotgovCensusLeads } from "../lib/control-plane/discovery/platform-census.ts";
import { writeFieldManual } from "../lib/control-plane/field-manual.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import { eachStore } from "./control-plane-fixtures.ts";
import { acquireDotGov } from "../lib/civic-data/dotgov-acquisition.ts";

const NOW = "2026-10-12T12:00:00.000Z";
const csv = readFileSync(new URL("./fixtures/platform-census/dotgov.csv", import.meta.url), "utf8");
test("CISA source fixture preserves every selected state's official domain without making it a government", () => {
  const idaho = dotgovDomainLeads(csv, "ID");
  assert.equal(idaho.length, 1);
  assert.equal(idaho[0].url, "https://aberdeenidaho.gov/");
  assert.equal(idaho[0].kind, "PLATFORM_CENSUS_DOMAIN");
  assert.deepEqual(idaho[0].states, ["id"]);
  assert.equal(dotgovDomainLeads(csv, "NH").length, 0);
  assert.throws(() => dotgovDomainLeads("Wrong,Columns\na.gov,ID", "ID"), /columns changed/);
});
test("committed CivicPlus and Legistar tenant CSVs are loaded as leads, including unlocated tenants", () => {
  const ca = referenceTenantLeads("CA");
  assert.equal(ca.filter(row => row.platforms.includes("civicplus")).length, 117);
  assert.ok(ca.every(row => row.kind === "MEETINGS_TENANT_LEAD" && row.outcome === "REFERENCE"));
  assert.ok(referenceTenantLeads("US").some(row => row.url === "https://a2gov.legistar.com"));
  assert.ok(!referenceTenantLeads("CA").some(row => row.title === "Banff"));
});
test("real BoardBook source markup supplies the published tenant and route on the census slow clock", () => {
  const html = readFileSync(new URL("./fixtures/boardbook-amphi-2065.html", import.meta.url), "utf8");
  const observation = observePlatformCensus(html, "https://meetings.boardbook.org/Public/Organization/2065", "capture", NOW);
  assert.ok(observation.matches.some(row => row.platform === "boardbook" && row.tenant === "2065"));
  assert.equal(observation.artifactId, "capture");
  assert.equal(observation.recheckAfter, "2026-10-13T00:00:00.000Z");
});
test("held Census websites are walked before a state's registration is promoted", async () => {
  const needs = heldCensusWebsiteNeeds("AL");
  const autauga = needs.find(need => need.jurisdictionId === "al:county:county-of-autauga");
  assert.ok(autauga);
  assert.equal(autauga.countyFips, "01001");
  assert.match(autauga.ownWebAddress ?? "", /autaugaco\.org/);
  const [[, repos]] = await eachStore("census-website-fallback");
  const reading = await readPlatformCensusNeeds("AL", null, { repos });
  assert.ok(reading.needs.some(need => need.jurisdictionId === autauga.jurisdictionId));
  assert.deepEqual(reading.failures, []);
});
for (const [kind, repos] of await eachStore("platform-census")) {
test(`${kind}: standing census reads state-scoped government and domain records with no Send`, async () => {
  await writeFieldManual(repos, dotgovDomainLeads(csv, "ID"), NOW);
  const registry = { stateCode: "ID", jurisdictions: [{ id: "id:city:aberdeen", stateCode: "ID", name: "City of Aberdeen", govClass: "CITY_OR_TOWN", ownWebAddress: "https://aberdeenidaho.gov", sourceIds: [], countyFips: "16011" }] } as unknown as JurisdictionRegistry;
  const reading = await readPlatformCensusNeeds("ID", registry, { repos, reviewedVersionId: "reviewed-source-version" });
  assert.equal(reading.needs.length, 1, "a domain already on a government is not walked twice");
  assert.equal(reading.needs[0].countyFips, "16011");
  assert.equal(reading.needs[0].addressSource?.versionId, "reviewed-source-version");
  assert.deepEqual(reading.failures, []);
  const domains = await readPlatformCensusNeeds("ID", null, { repos, census: () => [] });
  assert.equal(domains.needs[0].jurisdictionId, "id:domain:aberdeenidaho.gov");
  assert.equal((await readPlatformCensusNeeds("AZ", null, { repos, census: () => [] })).needs.length, 0);
});
test(`${kind}: CISA standing reference refresh saves source bytes once and waits for its slow clock`, async () => {
  let reads = 0, captures = 0;
  const source = await acquireDotGov(undefined, { minimumDomains: 1, minimumElectionDomains: 0,
    fetchImpl: (async input => String(input).includes("api.github.com")
      ? new Response(JSON.stringify([{ sha: "1".repeat(40) }])) : new Response(csv)) as typeof fetch });
  const runtime = { now: () => NOW, budget: { spent: () => false }, spaceOut: async () => {},
    open: async () => { throw new Error("the runtime must not retain a national CSV body"); },
    vault: async () => { captures++; return { stored: true, where: "fixture", why: "held" }; } };
  try {
    const shared = async () => { reads++; return source; };
    await refreshDotgovCensusLeads(repos, runtime, "ID", shared);
    await refreshDotgovCensusLeads(repos, runtime, "ID", shared);
  } finally { await source.dispose(); }
  assert.equal(reads, 1);
  assert.equal(captures, 1);
  assert.ok((await readPlatformCensusNeeds("ID", null, { repos, census: () => [] })).needs.some(need => need.ownWebAddress === "https://aberdeenidaho.gov/"));
});
}
