import {gzipSync} from "node:zlib";
import assert from "node:assert/strict";
import test from "node:test";
import { packPlaceContext, packReadyPlace, unpackPlaceContextRow, unpackReadyPlace, unpackReadyTerritory } from "../lib/reader/place-ready.ts";
import { READY_PLACE_SQL, placePageCacheIds, placePageTerritory, readPlacePackage } from "../lib/reader/place.ts";
import type { PlacePackage } from "../lib/reader/place-types.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const BODY = "ocd-division/country:us/state:az/place:example#council";
const meeting: Meeting = { id: "calendar:exact-id", mergedMeetingIds: ["portal:prior-id"], bodyId: BODY,
  ocdId: BODY.split("#")[0]!, bodyName: "Public council", title: "Budget hearing — educación", startsAt: "2020-01-01T12:00:00Z",
  timeZone: "UTC", location: null, agendaUrl: "https://example.gov/agenda", jurisdiction: "Example", status: "SCHEDULED",
  provenance: { sourceUrl: "https://example.gov/calendar", sourceOrg: "Public council", collectedAt: "2026-10-24T12:00:00Z", verifiedAt: null } };
const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: "2026-10-24T12:00:00Z", meetings: [meeting],
  agendaDocuments: [{ id: "document:exact-id", meetingId: meeting.id, ocdId: meeting.ocdId, documentUrl: "https://example.gov/agenda",
    contentHash: "a".repeat(64), retrievedAt: "2026-10-24T12:00:00Z", contentType: "text/html", text: "Presupuesto público — 予算\n".repeat(100),
    extraction: "html", extractionNote: null, sourceUrl: "https://example.gov/agenda", sourceOrg: "Public council", collectedAt: "2026-10-24T12:00:00Z", verifiedAt: null }],
  sources: [], counts: snapshotCounts([meeting], 0) };
const page: PlacePackage = { registry: null, everydayRouting: null, publicationAttempts: [], bodies: [], governments: [], divisions: [],
  registrationHeld: false, meetings: [meeting], snapshot, snapshotHeldAt: snapshot.generatedAt, bodySnapshots: { [BODY]: snapshot },
  agendaDocumentLinks: [{ meetingId: meeting.id, documentUrl: "https://example.gov/agenda" }] };

test("ready compression preserves the complete JSON, exact event identities and Unicode source text", () => {
  const published = { ...page, futureSourceFields: { blank: "", absent: null, count: 0, enabled: false, values: ["résumé", "予算"] } };
  const packed = packReadyPlace(published);
  assert.deepEqual(Object.keys(packed), ["encoding", "data"]);
  assert.equal(packed.encoding, "br-json-v1");
  assert.deepEqual(unpackReadyPlace(packed), JSON.parse(JSON.stringify(published)));
  assert.ok(Buffer.byteLength(JSON.stringify(packed)) < Buffer.byteLength(JSON.stringify(published)) / 3);
});

test("compressed and legacy ready pages each resolve exact IDs through one existing reader query", async () => {
  for (const stored of [packReadyPlace(page), {encoding:"gzip-json-v1",data:gzipSync(JSON.stringify(page)).toString("base64")}, page]) {
    let queries = 0;
    const value = await readPlacePackage({ state: "AZ", placeId: BODY, divisionIds: [], includeHistory: true }, async (text, params) => {
      queries++;
      assert.equal(text, READY_PLACE_SQL);
      assert.deepEqual(params, [BODY, true]);
      return [{ page: stored, version: 2 }];
    });
    assert.equal(queries, 1);
    assert.deepEqual(value, page);
    assert.deepEqual(placePageCacheIds(value), [BODY]);
    assert.deepEqual(value.meetings[0].mergedMeetingIds, ["portal:prior-id"]);
  }
});

test("a corrupt compressed ready page fails its single read without querying source tables", async () => {
  assert.throws(() => unpackReadyPlace({ encoding: "another-format", data: "" }), /PLACE_PAGE_ENCODING_INVALID/);
  assert.throws(() => unpackReadyPlace({ encoding: "br-json-v1" }), /PLACE_PAGE_ENCODING_INVALID/);
  let queries = 0;
  await assert.rejects(readPlacePackage({ state: "AZ", placeId: BODY, divisionIds: [] }, async text => {
    queries++;
    assert.equal(text, READY_PLACE_SQL);
    return [{ page: { encoding: "br-json-v1", data: "corrupt-gzip" }, version: 2 }];
  }));
  assert.equal(queries, 1);
});

test("private ZIP territory metadata preserves the public page and distinguishes no geometry from a legacy page",async()=>{
  const selected={type:"BodyTerritorySelection" as const,inside:[BODY],known:[BODY,"canonical:outside#governing"]};
  for(const territory of [selected,null,undefined]) {
    const packed=packReadyPlace(page,territory);
    assert.deepEqual(unpackReadyTerritory(packed),territory);
    assert.deepEqual(unpackReadyPlace(packed),page);
    let reads=0;
    const answer=await readPlacePackage({state:"AZ",placeId:"zip:85701",divisionIds:[]},async sql=>{
      reads++;assert.equal(sql,READY_PLACE_SQL);return [{page:packed,version:1}];
    });
    assert.equal(reads,1);assert.deepEqual(answer,page);assert.deepEqual(placePageTerritory(answer),territory);
    assert.equal(JSON.stringify(answer).includes("BodyTerritorySelection"),false);
  }
});

test("context modes preserve exact source JSON and omit only the data their reader flags exclude", () => {
  const row={division_ids:[meeting.ocdId],entities:[{id:BODY}],fields:[{entity_id:BODY,value:false}],rosters:[{body_id:BODY,person_id:"person:exact"}],
    comments:[{entity_id:BODY,value:"Public comment — 予算"}],sittings:[{body_id:BODY,entity_id:`meeting:${meeting.id}`}],
    registry:{future:{glyph:"é",blank:"",absent:null}},everyday_routing:{kept:true},registration_held:true,governments:[{id:"government:exact"}],divisions:[{ocdId:meeting.ocdId}],
    agenda_documents:snapshot.agendaDocuments,
    agenda_document_links:[{meetingId:meeting.id,documentUrl:meeting.agendaUrl}],agenda_texts:["Exact — educación"],parts:{},futureRows:{enabled:false,absent:null}};
  const packed=packPlaceContext({formatVersion:1,current:row,history:row,emptyCurrent:row,emptyHistory:row});
  for(const key of ["current","history","emptyCurrent","emptyHistory"]) {
    const modes=packed[key] as Record<string,unknown>;
    assert.deepEqual(Object.keys(modes),["full","brief","facts"]);
    assert.deepEqual(unpackPlaceContextRow(modes.full),JSON.parse(JSON.stringify(row)));
    const brief=unpackPlaceContextRow(modes.brief),facts=unpackPlaceContextRow(modes.facts);
    for(const selected of [brief,facts]) {
      assert.deepEqual(selected.rosters,row.rosters);
      assert.deepEqual(selected.fields,row.fields);
      assert.deepEqual(selected.comments,row.comments);
      assert.deepEqual(selected.sittings,row.sittings);
      assert.deepEqual(selected.futureRows,row.futureRows);
      assert.deepEqual(selected.agenda_documents,[]);
      assert.deepEqual(selected.agenda_document_links,[]);
      assert.deepEqual(selected.agenda_texts,[]);
    }
    assert.deepEqual(brief.registry,row.registry);
    assert.deepEqual(brief.everyday_routing,row.everyday_routing);
    assert.equal(brief.registration_held,true);
    assert.equal(facts.registry,null);
    assert.equal(facts.everyday_routing,null);
    assert.equal(facts.registration_held,false);
    assert.deepEqual(facts.governments,[]);
    assert.deepEqual(facts.divisions,[]);
  }
  assert.equal(unpackPlaceContextRow(row),row,"legacy raw context stays readable without another query");
});

test("rebuildable body aliases remain transient in every packed context mode",()=>{
  const body_aliases={'former-body':BODY};
  const row={entities:[{id:BODY}],meeting_rows:[],body_aliases};
  const packed=packPlaceContext({formatVersion:1,current:row,history:row,emptyCurrent:row,emptyHistory:row});
  for(const key of ['current','history','emptyCurrent','emptyHistory'])for(const mode of ['full','brief','facts'])
    assert.equal(Object.hasOwn(unpackPlaceContextRow((packed[key] as Record<string,unknown>)[mode]),'body_aliases'),false);
  assert.equal(row.body_aliases,body_aliases,'packing leaves the current build turn intact');
});
