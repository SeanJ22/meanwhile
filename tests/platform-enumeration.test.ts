import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csvFileRecords, heldPlatformTenants, matchPlatformGovernment, samePlatformTenant } from "../lib/control-plane/discovery/platform-enumeration.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { legistarClientCatalog, dotgovPlatformTenants, dotgovTenantForGovernment } from "../lib/control-plane/discovery/platform-catalog.ts";

const government = (id: string, name: string, govClass = "CITY_OR_TOWN"): MeetingsDiscoveryNeed => ({
  jurisdictionId: id, name, govClass, stateCode: "OR", ownWebAddress: null, basis: "SOURCE_DISCOVERY_OWED", sources: [],
});

test("catalogue records survive UTF-8 chunk boundaries and multiline quoted cells", () => {
  const path = join(mkdtempSync(join(tmpdir(), "platform-csv-")), "directory.csv");
  const name = "é".repeat(40_000) + '\nCity "hall"';
  writeFileSync(path, `name,url\r\n"${name.replaceAll('"', '""')}",https://example.gov\r\n`);
  assert.deepEqual([...csvFileRecords(path)], [{ name, url: "https://example.gov" }]);
});

test("catalogue names select exact state governments without crossing county or district names", () => {
  const city = government("or:city:city-of-example", "City of Example");
  const county = government("or:county:county-of-example", "County of Example", "COUNTY");
  const tenant = { platform: "civicplus", url: "https://directory.example/AgendaCenter", name: "Example", state: "OR", source: "catalogue" };
  assert.deepEqual(matchPlatformGovernment(tenant, [city, county]), { kind: "CANDIDATE", government: city, basis: "DIRECTORY_NAME" });
  assert.equal(matchPlatformGovernment({ ...tenant, state: "WA" }, [city]).kind, "UNRESOLVED");
  assert.equal(matchPlatformGovernment(tenant, [city, { ...city, jurisdictionId: "or:city:another-example" }]).kind, "AMBIGUOUS");
  assert.equal(matchPlatformGovernment({ ...tenant, name: null, state: null }, [city]).kind, "UNRESOLVED");
});

test("national held enumeration retains unlocated Legistar tenants once and excludes foreign catalogues", () => {
  const rows = [...heldPlatformTenants()];
  assert.ok(rows.length > 1000);
  assert.ok(rows.some(row => row.platform === "legistar" && row.state === null));
  assert.ok(!rows.some(row => row.state === "AB"));
});

test("an empty or replaced public directory cannot erase the retained inventory", () => {
  assert.throws(() => [...legistarClientCatalog("")], /no header/);
  assert.throws(() => [...dotgovPlatformTenants("", "source")], /no header/);
  assert.throws(() => [...legistarClientCatalog("Wrong\nexample")], /columns changed/);
});

test("a government's missing website is filled from its exact state and CISA identity before background work", () => {
  const csv = "Domain name,Organization name,State\nexample.gov,City of Example,OR\nother.gov,City of Example,WA\n";
  const need = government("or:city:example", "City of Example");
  assert.equal(dotgovTenantForGovernment(csv, "cisa-version", need)?.url, "https://example.gov/");
  assert.equal(dotgovTenantForGovernment(csv + "ambiguous.gov,City of Example,OR\n", "cisa-version", need), undefined);
  assert.equal(dotgovTenantForGovernment(csv, "cisa-version", { ...need, ownWebAddress: "https://recorded.gov/" }), undefined);
});

test("shared vendor hosts keep the exact published tenant", () => {
  assert.equal(samePlatformTenant("https://go.boarddocs.com/az/vail/Board.nsf/Public", "https://go.boarddocs.com/az/other/Board.nsf/Public"), false);
  assert.equal(samePlatformTenant("https://meetings.boardbook.org/Public/Organization/2065", "https://meetings.boardbook.org/Public/Organization/999"), false);
  assert.equal(samePlatformTenant("https://ca-ventura.civicplus.com/AgendaCenter", "https://ca-russianriver.civicplus.com/AgendaCenter"), false);
  assert.equal(samePlatformTenant("https://metro.legistar.com/Calendar.aspx", "https://oregonmetro.legistar.com/Calendar.aspx"), false);
  assert.equal(samePlatformTenant("https://webapi.legistar.com/v1/metro/Events", "https://webapi.legistar.com/v1/oregonmetro/Events"), false);
  assert.equal(samePlatformTenant("https://metro.legistar.com/Calendar.aspx", "https://webapi.legistar.com/v1/metro/Events"), true);
  assert.equal(samePlatformTenant("https://pub-capecoral.escribemeetings.com/", "https://pub-leecounty.escribemeetings.com/"), false);
  assert.equal(samePlatformTenant("https://go.boarddocs.com/az/vail/Board.nsf", "https://go.boarddocs.com/az/vail/Board.nsf/Public"), true);
});
