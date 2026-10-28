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
import { bodyDetailState, loadBodyDetail } from "../lib/registry/body-roster-client.ts";
import type { CoveredBody } from "../lib/registry/coverage.ts";
import { bodyRosterSummaries } from "../lib/reader/body-summary.ts";

test("a cross-state body's own identifier selects the body reader's state", () => {
  const body: CoveredBody = { bodyId: "government:US-CA:cog:123#board", ocdId: "ocd-division/country:us/state:nv/county:clark",
    name: null, divisionLabel: "", divisionType: null, lsad: null, schoolDependency: "UNCLASSIFIED", bodyClass: "GOVERNING",
    coverageStatus: "NOT_ATTEMPTED", homepageUrl: null, agendaSourceRef: null, lookedAt: false, tier: "local" };
  assert.equal(bodyDetailState(body, "NV"), "CA");
});

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
  const summary = bodyRosterSummaries(registry, [bodyId]);
  assert.equal(summary.summaries.get(bodyId)?.memberCount, expected.members.length);
  assert.deepEqual([...summary.memberIds], expected.members.map(person => person.id));
  assert.deepEqual(Object.keys(summary.summaries.get(bodyId)!).sort(), ["hasSelectBoard", "memberCount"]);
});

test("concurrent requests for the same body share one request, and a later open can refresh", async t => {
  const detail = { bodyId: "body:one", roster: { members: [], gaps: [], officePhone: null } };
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
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

test("a saved body detail keeps its portraits, shared phone and field sources without source reads",async()=>{
  const {migratedReaderDb}=await import('./helpers/migrated-reader-db.ts');
  const {packReadyPlace}=await import('../lib/reader/place-ready.ts');
  const {pg}=await migratedReaderDb();
  const body='ocd-division/country:us/state:az/county:pima#governing';
  const source={sourceUrl:'https://example.gov/council',sourceOrg:'Council',collectedAt:'2026-10-01',verifiedAt:null};
  const roster={members:[{id:'member:one',name:'A Person',photoUrl:'/portrait.jpg'}],gaps:[],officePhone:{phone:'520-555-0100',sourceUrl:source.sourceUrl,sourceOrg:source.sourceOrg}};
  const place={registry:{registry:{bodies:[{id:body,fieldSources:{officePhone:source}}]}},bodies:[]} as unknown as import('../lib/reader/place-types.ts').PlacePackage;
  try {
    await pg.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','County Board','AZ')",[body]);
    await pg.query("INSERT INTO place_page(place_id,version,built_at,body,history_body,context) VALUES($1,1,now(),$2,'{}',$3)",[body,JSON.stringify(packReadyPlace(place)),JSON.stringify({bodyRoster:roster})]);
    const statements:string[]=[];
    installFactReader(async(text,params=[])=>{statements.push(text);return(await pg.query<Record<string,unknown>>(text,[...params])).rows;});
    const response=await GET(new Request(`https://example.test/api/reader/body?state=AZ&body=${encodeURIComponent(body)}`));
    assert.equal(response.status,200);assert.equal(response.headers.get('netlify-vary'),'query=state|body');
    assert.deepEqual(await response.json(),{bodyId:body,roster,fieldSources:{officePhone:source}});
    assert.ok(statements.length&&statements.every(sql=>!(/civic_data_(?:candidates|promotions|candidate_events|payload_parts)/.test(sql))));
    assert.equal((await GET(new Request(`https://example.test/api/reader/body?state=CA&body=${encodeURIComponent(body)}`))).status,503);
  }finally{installFactReader(undefined);await pg.close();}
});
