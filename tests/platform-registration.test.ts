import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { matchRegisteredPlatformTenant, platformRegistrationBinding, readPlatformRegistrationPage } from "../lib/control-plane/discovery/platform-registration.ts";

test("native registration paging and catalogue names distinguish a county from a district sharing its website", async () => {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE civic_data_promotions(key text,record_class text,scope text,current_version_id text,promoted_at timestamptz,payload jsonb);
    CREATE TABLE civic_data_candidates(id text,normalized_hash text);`);
  const county = { id: "government:US-WA:cog:1", state: "WA", name: "COUNTY OF ALPHA", jurisdictionId: "wa:county:county-of-alpha",
    governmentClass: "COUNTY", website: "https://www.alpha.gov/", bodyIds: [], aliases: ["ocd-division/country:us/state:wa/county:alpha#governing"],
    associations: [{ basis: "SOURCE_CODE", divisionId: "ocd-division/country:us/state:wa/county:alpha" }] };
  const district = { ...county, id: "government:US-WA:cog:2", name: "ALPHA SOIL AND WATER DISTRICT", jurisdictionId: "wa:special:alpha-water", associations: [], aliases: [] };
  await pg.query("INSERT INTO civic_data_candidates VALUES ('version',$1)", ["c".repeat(64)]);
  await pg.query("INSERT INTO civic_data_promotions VALUES ('REGISTRATION:US-WA:registration:v1','REGISTRATION','US-WA:registration:v1','version',now(),$1::jsonb)", [JSON.stringify({ governments: [county, district] })]);
  const query = async (sql: string, params: readonly unknown[]) => (await pg.query<Record<string, unknown>>(sql, [...params])).rows;
  try {
    const page = await readPlatformRegistrationPage(query, "WA", 0);
    assert.equal(page?.government.id, county.id);
    assert.equal((await readPlatformRegistrationPage(query, "WA", 1))?.government.id, district.id);
    assert.equal(await readPlatformRegistrationPage(query, "WA", 2), null);
    const tenant = { platform: "legistar", url: "https://alpha.legistar.com/", name: "Alpha County", state: "WA", source: "public directory" };
    const named = await matchRegisteredPlatformTenant(query, tenant);
    assert.deepEqual(named.map(row => row.government.id), [county.id]);
    assert.deepEqual(await matchRegisteredPlatformTenant(query, { ...tenant, state: "OR" }), []);
    const shared = await matchRegisteredPlatformTenant(query, { ...tenant, name: null }, ["https://council.alpha.gov/"]);
    assert.equal(shared.length, 2, "a shared government website leaves identity ambiguous");
    const located = platformRegistrationBinding(shared.find(row => row.government.id === district.id)!);
    assert.ok("bodyId" in located);
    assert.equal(located.bodyId, `${district.id}#governing`, "a district keeps its native government identity");
    assert.equal(located.ocdId, "ocd-division/country:us/state:wa", "a Census county cannot make the district a government of every ZIP there");
    assert.deepEqual(district.associations, [], "opening a meeting calendar creates no service boundary");
    const bound = platformRegistrationBinding(page!);
    assert.ok("bodyId" in bound);
    assert.equal(bound.bodyId, county.aliases[0]);
  } finally { await pg.close(); }
});
