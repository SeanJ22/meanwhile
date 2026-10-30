import assert from "node:assert/strict";
import test from "node:test";
import { mergePlaceRows } from "../lib/reader/place-compose.ts";
import { composePlaceRow } from "../lib/reader/place-decode.ts";
import { sittingRows } from "./helpers/meeting-fact-rows.ts";
import type { Meeting } from "../lib/sources/types.ts";

const STATE = "ocd-division/country:us/state:az", COUNTY = `${STATE}/county:pima`, CITY = `${COUNTY}/place:tucson`, FRINGE = `${COUNTY}/place:oro_valley`;
const BOARD = `${CITY}#governing`, COUNTY_BOARD = `${COUNTY}#supervisors`, OTHER_BOARD = `${FRINGE}#governing`;
const AT = "2026-10-25T02:00:00.000Z";
type Row = Record<string, unknown>;
const entries = (value: unknown) => value as Row[];
const model = (value: unknown) => value as Row;
const entity = (id: string, division = CITY) => ({ id, kind: "body", state: "AZ", division, placed: true, name: id });
const sitting = (id: string, bodyId: string, startsAt = "2026-10-26T18:00:00Z"): Meeting => ({ id, bodyId, bodyName: "Board", ocdId: CITY, title: `Sitting ${id}`, startsAt,
  timeZone: "UTC", location: null, agendaUrl: null, jurisdiction: "Local", status: "SCHEDULED",
  provenance: { sourceUrl: "https://example.gov/calendar", sourceOrg: "Example", collectedAt: AT, verifiedAt: AT } });
const sittings = (...rows: Meeting[]) => sittingRows(rows);

function page(id: string, bodies: Row[], extra: Row = {}): Row {
  return { page_id: id, page_kind: "place", built_at: AT, division_ids: [id], entities: bodies,
    fields: [], rosters: [], comments: [], sittings: [], agenda_documents: [], agenda_document_links: [],
    agenda_texts: [], parts: {}, everyday_routing: { routes: ["held"] }, registration_held: true,
    governments: [], divisions: [{ ocdId: id, label: id }],
    registry: { formatVersion: 1, registry: { generatedAt: AT, bodies: bodies.map(body => ({ id: body.id, ocdId: body.division })),
      divisions: [{ ocdId: CITY, parentOcdId: COUNTY }, { ocdId: COUNTY, parentOcdId: STATE }, { ocdId: STATE, parentOcdId: null }] },
      bodyRosters: bodies.map(body => ({ bodyId: body.id, members: [{ id: `${body.id}:member` }] })), rosterReaderDispositions: [], statewideExecutives: [],
      officialCandidacies: { formatVersion: 1, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} }, ...extra };
}

test("a split ZIP unions overlapping ready rows once and retains every body's fields, members and sittings", () => {
  const city = page(CITY, [entity(BOARD), entity(COUNTY_BOARD, COUNTY)], {
    fields: [{ entity_id: BOARD, field: "name", value: "Mayor and Council" }, { entity_id: COUNTY_BOARD, field: "name", value: "Supervisors" }],
    comments: [{ entity_id: BOARD, field: "comment:detail", value: "Three minutes" }],
    rosters: [{ body_id: BOARD, person_id: "city-member" }, { body_id: COUNTY_BOARD, person_id: "county-member" }],
    sittings: sittings(sitting("legistar:city", BOARD), sitting("legistar:county", COUNTY_BOARD)),
    governments: [{ id: "city", name: "Tucson" }, { id: "county", name: "Pima" }],
  });
  const county = page(COUNTY, [entity(COUNTY_BOARD, COUNTY)], {
    fields: [{ entity_id: COUNTY_BOARD, field: "name", value: "Supervisors" }], rosters: [{ body_id: COUNTY_BOARD, person_id: "county-member" }],
    sittings: sittings(sitting("legistar:county", COUNTY_BOARD)), governments: [{ id: "county", name: "Pima" }],
  });
  const before = structuredClone([city, county]);
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY, COUNTY] }, [city, county]);
  assert.deepEqual(entries(result.entities).map(body => body.id), [BOARD, COUNTY_BOARD]);
  assert.deepEqual(entries(result.rosters).map(row => row.person_id), ["city-member", "county-member"]);
  assert.equal(entries(result.fields).length, 2);
  assert.equal(entries(result.comments)[0]!.value, "Three minutes");
  assert.equal(entries(result.governments).length, 2);
  assert.deepEqual([...new Set(entries(result.sittings).map(row => row.entity_id))], ["meeting:legistar:city", "meeting:legistar:county"]);
  assert.deepEqual([city, county], before, "merging cannot alter the reusable stored page rows");
});

test("a fringe division supplies its name without supplying its bodies, members or meetings", () => {
  const city = page(CITY, [entity(BOARD)]), fringe = page(FRINGE, [entity(OTHER_BOARD, FRINGE)], {
    sittings: sittings(sitting("legistar:fringe", OTHER_BOARD)),
  });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], namedDivisionIds: [FRINGE] }, [city, fringe]);
  assert.deepEqual(entries(result.entities).map(body => body.id), [BOARD]);
  assert.deepEqual(entries(result.divisions).map(division => division.ocdId), [CITY, FRINGE]);
  assert.equal(entries(result.sittings).length, 0);
  assert.deepEqual(entries(model(model(result.registry).registry).bodies).map(body => body.id), [BOARD]);
  assert.deepEqual(entries(model(result.registry).bodyRosters).map(body => body.bodyId), [BOARD]);
});

test("the newest complete body row carries removals across overlapping cached pages", () => {
  const older = page(COUNTY, [entity(BOARD)], {
    fields: [{ entity_id: BOARD, field: "office_phone", value: "obsolete" }], rosters: [{ body_id: BOARD, person_id: "departed-member" }],
    sittings: sittings(sitting("legistar:withdrawn", BOARD), sitting("legistar:archive", BOARD, "2020-01-01T18:00:00Z")),
    agenda_documents: [{ id: "archive-doc", meetingId: "legistar:archive" }],
  });
  const newer = page(CITY, [entity(BOARD)], { built_at: "2026-10-25T02:01:00Z" });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY, COUNTY], includeAgenda: true }, [newer, older]);
  assert.deepEqual(result.fields, []);
  assert.deepEqual(result.rosters, []);
  assert.deepEqual(result.sittings, []);
  assert.deepEqual(result.agenda_documents, []);
});

test("an explicit body page adds only that body's ready facts to the requested place", () => {
  const city = page(CITY, [entity(BOARD)]);
  const explicit = page(COUNTY_BOARD, [entity(COUNTY_BOARD, COUNTY)], { page_kind: "body", division_ids: [], fields: [{ entity_id: COUNTY_BOARD, field: "name", value: "Supervisors" }] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], bodyIds: ["legacy-supervisors-alias"] }, [city, explicit]);
  assert.deepEqual(entries(result.entities).map(body => body.id), [BOARD, COUNTY_BOARD]);
  assert.equal(entries(result.fields)[0]!.value, "Supervisors");
  assert.deepEqual(result.division_ids, [CITY]);
});

test("a shared board unions all service associations and displays the selected place with its current placement basis", async () => {
  const county = page(COUNTY, [{ ...entity(BOARD, STATE), divisions: [COUNTY], linked: true, placement_basis: "SERVICE_AREA" }]);
  const city = page(CITY, [{ ...entity(BOARD, STATE), divisions: [CITY], linked: true, placement_basis: "HOST_COUNTY" }], {
    built_at: "2026-10-25T02:01:00Z",
  });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY, COUNTY] }, [city, county]);
  assert.equal(entries(result.entities).length,1);
  assert.equal(entries(result.entities)[0]!.division, STATE,"the current parent remains a fallback, not one selected service association");
  assert.deepEqual(entries(result.entities)[0]!.divisions,[COUNTY,CITY]);
  assert.equal(entries(result.entities)[0]!.linked, true);
  for (const division of [CITY,COUNTY]) {
    const decoded = await composePlaceRow({state:"AZ",divisionIds:[division]},{...result,division_ids:[division]});
    assert.equal(decoded.bodies[0]!.fields.ocdId,division);
    assert.deepEqual(decoded.bodies[0]!.fields.alsoServesOcdIds,[division===CITY?COUNTY:CITY]);
    assert.equal(decoded.bodies[0]!.fields.placementBasis,"HOST_COUNTY");
  }
});

test("ready agendas preserve each revision, alias and text dictionary without joining equal text as one document", () => {
  const city = page(CITY, [entity(BOARD)], { sittings: sittings(sitting("legistar:city", BOARD), sitting("native:old", BOARD, "2020-01-01T18:00:00Z")),
    agenda_documents: [
      { id: "legistar:city@a", meetingId: "legistar:city", text: { $readerAgendaText: 0 } },
      { id: "legistar:city@b", meetingId: "legistar:city", text: { $readerAgendaText: 1 } },
      { id: "native:old@a", meetingId: "native:old", text: "Old minutes" },
      { id: "elsewhere@a", meetingId: "elsewhere", text: "Another body's agenda" },
    ], agenda_texts: ["Original agenda", "Amended agenda"] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], includeAgenda: true, includeHistory: true }, [city]);
  assert.deepEqual(entries(result.agenda_documents).map(doc => [doc.id, doc.text]), [
    ["legistar:city@a", "Original agenda"], ["legistar:city@b", "Amended agenda"], ["native:old@a", "Old minutes"],
  ]);
  assert.deepEqual(result.agenda_texts, []);
  const headers = mergePlaceRows({ state: "AZ", divisionIds: [CITY] }, [city]);
  assert.deepEqual(headers.agenda_documents, []);
});

test("an empty geographic selection reads its ready registry shell", () => {
  const empty = page(STATE, [], { page_kind: "empty", division_ids: [] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [] }, [empty]);
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.division_ids, []);
  assert.deepEqual(model(model(result.registry).registry).divisions, []);
  assert.equal(model(model(result.registry).registry).generatedAt, AT);
  const city = page(CITY, [entity(BOARD)]);
  const selected = mergePlaceRows({ state: "AZ", divisionIds: [CITY] }, [city, empty]);
  assert.deepEqual(selected.sittings, [], "the empty shell supplies no unrelated sittings to a selected place");
});

test("an agenda lookup retains identity context and omits unrelated member and directory data", () => {
  const city = page(CITY, [entity(BOARD)], { rosters: [{ body_id: BOARD, person_id: "member" }],
    sittings: sittings(sitting("legistar:target", BOARD), sitting("calendar:related", BOARD)) });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], includeAgenda: true, meetingIds: ["legistar:target"] }, [city]);
  assert.equal(new Set(entries(result.sittings).map(row => row.entity_id)).size, 2);
  assert.deepEqual(result.rosters, []);
  assert.deepEqual(entries(model(result.registry).bodyRosters)[0]!.members, []);
  assert.deepEqual(model(model(result.registry).officialCandidacies).rows, []);
  assert.equal(result.registration_held, false);
  assert.equal(result.everyday_routing, null);
});

test("body-facts-only reads retain local facts without claiming that their independent state directory was loaded", () => {
  const city = page(CITY, [entity(BOARD)], { fields: [{ entity_id: BOARD, field: "name", value: "Council" }] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], bodyFactsOnly: true }, [city]);
  assert.equal(entries(result.fields)[0]!.value, "Council");
  assert.equal(result.registry, null);
  assert.equal(result.everyday_routing, null);
  assert.equal(result.registration_held, false);
  assert.deepEqual(result.divisions, []);
  assert.deepEqual(result.governments, []);
});

test("saved current and history contexts keep meetings, agendas and members from folded calendar labels",async()=>{
  const alias=`${CITY}#body:city-council-special-meeting`;
  const full=(id:string,startsAt:string)=>({...sitting(id,alias,startsAt),bodyName:'City Council Special Meeting',title:'Council sitting',timeZone:'America/Phoenix',jurisdiction:'Tucson'});
  const current=full('native:current','2026-10-26T18:00:00Z'),past=full('native:past','2020-01-01T18:00:00Z');
  for(const includeHistory of [false,true]) {
    const source=page(CITY,[{...entity(BOARD),name:'City Council'}],{
      body_aliases:{[alias]:BOARD},sittings:sittings(...(includeHistory?[current,past]:[current])),
      agenda_documents:[{id:'current-agenda',meetingId:current.id,text:'Council agenda'},...(includeHistory?[{id:'old-minutes',meetingId:past.id,text:'Council minutes'}]:[])],
    });
    const input={state:'AZ',divisionIds:[CITY],includeAgenda:true,includeHistory};
    const merged=mergePlaceRows(input,[source]);
    assert.ok(entries(merged.sittings).every(row=>row.body_id===BOARD),"the folded label's sittings are filed under the canonical body");
    const decoded=await composePlaceRow(input,merged);
    assert.deepEqual(decoded.bodies.map(body=>body.id),[BOARD]);
    assert.deepEqual(decoded.meetings.map(meeting=>meeting.id).sort(),(includeHistory?[past.id,current.id]:[current.id]).sort());
    assert.ok(decoded.meetings.every(meeting=>meeting.bodyId===BOARD&&meeting.bodyName==='City Council'));
    assert.deepEqual(decoded.snapshot.agendaDocuments.map(document=>document.id).sort(),(includeHistory?['old-minutes','current-agenda']:['current-agenda']).sort());
  }
});
