import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { projectBodyDetail, type ReaderBodyDetail } from "../lib/reader/body-detail.ts";
import { withRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { membersOfBody, earlierMembersOfBody } from "../lib/registry/body-membership.ts";
import { officePhoneForBody } from "../lib/meetings/office-phone.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { GET } from "../app/api/reader/body/route.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { factDb } from "./helpers/fact-db.ts";
import { loadBodyDetail } from "../lib/registry/body-roster-client.ts";

test("one-body detail retains the existing member, photo, phone and field sources", () => {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/registry-transfer-import.json.gz", import.meta.url))).toString());
  const bodyId = "ocd-division/country:us/state:az/county:pima#governing";
  const source = { sourceUrl: "https://example.gov/council", sourceOrg: "Council", collectedAt: "2026-10-01", verifiedAt: null };
  const member = { id: "roster:fixture#one", name: "A Person", officeTitle: "Chair", termNote: null,
    email: "a@example.gov", phone: "520-555-0100", websiteUrl: null, fieldSources: { phone: source } };
  const registry = { ...fixture.projection.payload,
    registry: { ...fixture.projection.payload.registry, bodies: [{ id: bodyId, fieldSources: { officePhone: source } }] },
    bodyRosters: [{ bodyId, bodyName: "County Board", sourceUrl: source.sourceUrl, sourceOrg: source.sourceOrg,
      collectedAt: source.collectedAt, partisanship: "UNDETERMINED", members: [member] }],
    rosterReaderDispositions: [], officialPhotos: { photos: [] }, rosterPhotos: { [member.id]: "/person.jpg" },
  } as RegistryRuntimeReadModel;
  const expected = withRegistryRuntimeProjection(registry, ["AZ"], () => ({
    members: membersOfBody(bodyId).members, earlierMembers: earlierMembersOfBody(bodyId), officePhone: officePhoneForBody(bodyId),
  }));
  const detail = projectBodyDetail("AZ", bodyId, registry, []);
  assert.deepEqual(detail.roster.members, expected.members);
  assert.deepEqual(detail.roster.earlierMembers ?? [], expected.earlierMembers);
  assert.deepEqual(detail.roster.officePhone, expected.officePhone);
  assert.equal(detail.roster.members[0].photoUrl, "/person.jpg");
  assert.deepEqual(detail.fieldSources, { officePhone: source });
});

test("concurrent requests for the same body share one request, and a later open can refresh", async t => {
  const detail = { bodyId: "body:one", roster: { members: [], gaps: [], officePhone: null } };
  let requests = 0;
  t.mock.method(globalThis, "fetch", async input => {
    requests++;
    const url = new URL(String(input), "https://example.test");
    assert.equal(url.searchParams.get("state"), "AZ");
    assert.equal(url.searchParams.get("body"), detail.bodyId);
    return Response.json(detail);
  });
  const [first, second] = await Promise.all([loadBodyDetail("AZ", detail.bodyId), loadBodyDetail("AZ", detail.bodyId)]);
  assert.deepEqual(first, detail);
  assert.deepEqual(second, detail);
  assert.equal(requests, 1);
  await loadBodyDetail("AZ", detail.bodyId);
  assert.equal(requests, 2);
});

test("a failed or mismatched body answer is not cached as an empty roster", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return calls === 1 ? new Response(null, { status: 503 })
      : Response.json({ bodyId: "other", roster: { members: [], gaps: [], officePhone: null } });
  });
  await assert.rejects(loadBodyDetail("AZ", "body:two"));
  await assert.rejects(loadBodyDetail("AZ", "body:two"));
  assert.equal(calls, 2);
});

test("the keyed reader selects one body and its people, including its portrait", async () => {
  const db = await factDb();
  try {
    await db.pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,current_version_id text,payload jsonb);
      CREATE TABLE civic_data_rows(promotion_key text,version_id text,collection text,ordinal bigint,row_id text,body_id text,aliases text[],value jsonb);
      CREATE FUNCTION reader_payload_node(jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT $1';
      CREATE FUNCTION reader_payload_value(jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT $1';
      CREATE FUNCTION reader_payload_members(jsonb) RETURNS TABLE(item jsonb,ordinal_index bigint) LANGUAGE sql IMMUTABLE AS
        'SELECT value,ordinality FROM jsonb_array_elements(coalesce($1,''[]''::jsonb)) WITH ORDINALITY';`);
    const body = "ocd-division/country:us/state:az/county:pima#governing";
    const other = "ocd-division/country:us/state:az/county:other#governing";
    const source = { sourceUrl: "https://example.gov/council", sourceOrg: "Council", collectedAt: "2026-10-01", verifiedAt: null };
    const member = { id: "roster:pima#one", name: "A Person", officeTitle: "Chair", termNote: null,
      email: null, phone: "520-555-0100", websiteUrl: null, fieldSources: { phone: source } };
    const key = "REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime";
    await db.query("INSERT INTO civic_data_promotions VALUES($1,'v1',$2::jsonb)", [key, JSON.stringify({
      officialPhotos: { photos: [] }, rosterPhotos: { [member.id]: "/portrait.jpg", "other:person": "/other.jpg" },
    })]);
    const add = (collection: string, id: string, value: unknown) => db.query("INSERT INTO civic_data_rows VALUES($1,'v1',$2,1,$3,$3,ARRAY[$3],$4::jsonb)",
      [key, collection, id, JSON.stringify(value)]);
    await add("registry.bodies", body, { id: body, fieldSources: { officePhone: source } });
    await add("bodyRosters", body, { bodyId: body, bodyName: "County Board", sourceUrl: source.sourceUrl,
      sourceOrg: source.sourceOrg, collectedAt: source.collectedAt, partisanship: "UNDETERMINED", members: [member] });
    await add("bodyRosters", other, { bodyId: other, bodyName: "Other", sourceUrl: source.sourceUrl,
      sourceOrg: source.sourceOrg, collectedAt: source.collectedAt, partisanship: "UNDETERMINED", members: [{ ...member, id: "other:person" }] });
    installFactReader(db.query);
    const response = await GET(new Request(`https://example.test/api/reader/body?state=AZ&body=${encodeURIComponent(body)}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("netlify-vary"), "query=state|body");
    const detail = await response.json() as ReaderBodyDetail;
    assert.deepEqual(detail.roster.members.map(person => person.id), [member.id]);
    assert.equal(detail.roster.members[0].photoUrl, "/portrait.jpg");
    assert.deepEqual(detail.fieldSources, { officePhone: source });
  } finally { installFactReader(undefined); await db.pg.close(); }
});
