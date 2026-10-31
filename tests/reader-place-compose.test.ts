import assert from "node:assert/strict";
import test from "node:test";
import { mergePlaceRows } from "../lib/reader/place-compose.ts";
import { composePlaceRow } from "../lib/reader/place-decode.ts";

const STATE = "ocd-division/country:us/state:az", COUNTY = `${STATE}/county:pima`, CITY = `${COUNTY}/place:tucson`, FRINGE = `${COUNTY}/place:oro_valley`;
const BOARD = `${CITY}#governing`, COUNTY_BOARD = `${COUNTY}#supervisors`, OTHER_BOARD = `${FRINGE}#governing`;
const AT = "2026-10-25T02:00:00.000Z";
type Row = Record<string, unknown>;
const entries = (value: unknown) => value as Row[];
const model = (value: unknown) => value as Row;
const entity = (id: string, division = CITY) => ({ id, kind: "body", state: "AZ", division, placed: true, name: id });
const sitting = (id: string, bodyId: string | null, ocdId = CITY) => ({ id, bodyId, ocdId, startsAt: "2026-10-26T18:00:00Z" });
const family = (meetings: Row[], bodies: string[]) => ({ scope: "source:derived:family:US-AZ", current_version_id: "version-1", confirmation: "confirmation",
  payload: { formatVersion: 1, generatedAt: AT, meetings, agendaDocuments: [], sources: [{ source: "legistar", fetched: 20 }],
    derivedMembers: bodies.map(bodyId => ({ id: `legistar:${bodyId}`, source: "legistar", bodyId, status: "ACTIVE", outcome: "FRESH" })) } });

function page(id: string, bodies: Row[], extra: Row = {}): Row {
  return { page_id: id, page_kind: "place", built_at: AT, division_ids: [id], entities: bodies,
    fields: [], rosters: [], comments: [], sittings: [], meeting_rows: [], archived_meetings: [], archived_documents: [], archived_document_links: [],
    agenda_texts: [], parts: {}, registration_held: true,
    governments: [], divisions: [{ ocdId: id, label: id }],
    registry: { formatVersion: 1, registry: { generatedAt: AT, bodies: bodies.map(body => ({ id: body.id, ocdId: body.division })),
      divisions: [{ ocdId: CITY, parentOcdId: COUNTY }, { ocdId: COUNTY, parentOcdId: STATE }, { ocdId: STATE, parentOcdId: null }] },
      bodyRosters: bodies.map(body => ({ bodyId: body.id, members: [{ id: `${body.id}:member` }] })), rosterReaderDispositions: [], statewideExecutives: [],
      officialCandidacies: { formatVersion: 1, rows: [] }, officialPhotos: { photos: [] }, rosterPhotos: {} }, ...extra };
}

test("a split ZIP unions overlapping ready rows once and retains every body's fields, members and meeting partition", () => {
  const city = page(CITY, [entity(BOARD), entity(COUNTY_BOARD, COUNTY)], {
    fields: [{ entity_id: BOARD, field: "name", value: "Mayor and Council" }, { entity_id: COUNTY_BOARD, field: "name", value: "Supervisors" }],
    comments: [{ entity_id: BOARD, field: "comment:detail", value: "Three minutes" }],
    rosters: [{ body_id: BOARD, person_id: "city-member" }, { body_id: COUNTY_BOARD, person_id: "county-member" }],
    meeting_rows: [family([sitting("legistar:city", BOARD), sitting("legistar:county", COUNTY_BOARD, COUNTY)], [BOARD, COUNTY_BOARD])],
    governments: [{ id: "city", name: "Tucson" }, { id: "county", name: "Pima" }],
  });
  const county = page(COUNTY, [entity(COUNTY_BOARD, COUNTY)], {
    fields: [{ entity_id: COUNTY_BOARD, field: "name", value: "Supervisors" }], rosters: [{ body_id: COUNTY_BOARD, person_id: "county-member" }],
    meeting_rows: [family([sitting("legistar:county", COUNTY_BOARD, COUNTY)], [COUNTY_BOARD])], governments: [{ id: "county", name: "Pima" }],
  });
  const before = structuredClone([city, county]);
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY, COUNTY] }, [city, county]);
  assert.deepEqual(entries(result.entities).map(body => body.id), [COUNTY_BOARD, BOARD]);
  assert.deepEqual(entries(result.rosters).map(row => row.person_id), ["city-member", "county-member"]);
  assert.equal(entries(result.fields).length, 2);
  assert.equal(entries(result.comments)[0]!.value, "Three minutes");
  assert.equal(entries(result.governments).length, 2);
  const merged = model(entries(result.meeting_rows)[0]!.payload);
  assert.deepEqual(entries(merged.meetings).map(row => row.id), ["legistar:city", "legistar:county"]);
  assert.deepEqual(entries(merged.derivedMembers).map(row => row.bodyId), [BOARD, COUNTY_BOARD]);
  assert.deepEqual(merged.sources, [{ source: "legistar", fetched: 20 }]);
  assert.deepEqual([city, county], before, "merging cannot alter the reusable stored page rows");
});

test("a family keeps each body's outcome when source reports have no synthetic member ID", () => {
  const cityPartition = family([sitting("legistar:city", BOARD)], [BOARD]);
  cityPartition.payload.derivedMembers = [{ bodyId: BOARD, source: "legistar", outcome: "FRESH" }] as never;
  const countyPartition = family([sitting("legistar:county", COUNTY_BOARD, COUNTY)], [COUNTY_BOARD]);
  countyPartition.payload.derivedMembers = [{ bodyId: COUNTY_BOARD, source: "legistar", outcome: "HELD" }] as never;
  const city = page(CITY, [entity(BOARD)], { meeting_rows: [cityPartition] });
  const county = page(COUNTY, [entity(COUNTY_BOARD, COUNTY)], { meeting_rows: [countyPartition] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY, COUNTY] }, [city, county]);
  assert.deepEqual(entries(model(entries(result.meeting_rows)[0]!.payload).derivedMembers), [
    { bodyId: BOARD, source: "legistar", outcome: "FRESH" }, { bodyId: COUNTY_BOARD, source: "legistar", outcome: "HELD" },
  ]);
});

test("a fringe division supplies its name without supplying its bodies, members or meetings", () => {
  const city = page(CITY, [entity(BOARD)]), fringe = page(FRINGE, [entity(OTHER_BOARD, FRINGE)], {
    meeting_rows: [family([sitting("legistar:fringe", OTHER_BOARD, FRINGE)], [OTHER_BOARD])],
  });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], namedDivisionIds: [FRINGE] }, [city, fringe]);
  assert.deepEqual(entries(result.entities).map(body => body.id), [BOARD]);
  assert.deepEqual(entries(result.divisions).map(division => division.ocdId), [CITY, FRINGE]);
  assert.equal(entries(result.meeting_rows).length, 0);
  assert.deepEqual(entries(model(model(result.registry).registry).bodies).map(body => body.id), [BOARD]);
  assert.deepEqual(entries(model(result.registry).bodyRosters).map(body => body.bodyId), [BOARD]);
});

test("the newest complete body row carries removals across overlapping cached pages", () => {
  const older = page(COUNTY, [entity(BOARD)], {
    fields: [{ entity_id: BOARD, field: "office_phone", value: "obsolete" }], rosters: [{ body_id: BOARD, person_id: "departed-member" }],
    meeting_rows: [family([sitting("legistar:withdrawn", BOARD)], [BOARD])],
    archived_meetings: [sitting("legistar:archive", BOARD)], archived_documents: [{ id: "archive-doc", meetingId: "legistar:archive" }],
  });
  const newer = page(CITY, [entity(BOARD)], { built_at: "2026-10-25T02:01:00Z", meeting_rows: [family([], [BOARD])] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY, COUNTY], includeAgenda: true }, [newer, older]);
  assert.deepEqual(result.fields, []);
  assert.deepEqual(result.rosters, []);
  assert.deepEqual(result.archived_meetings, []);
  assert.deepEqual(result.archived_documents, []);
  assert.deepEqual(model(entries(result.meeting_rows)[0]!.payload).meetings, []);
});

test("an explicit body page adds only that body's ready facts to the requested place", () => {
  const city = page(CITY, [entity(BOARD)]);
  const explicit = page(COUNTY_BOARD, [entity(COUNTY_BOARD, COUNTY)], { page_kind: "body", division_ids: [], fields: [{ entity_id: COUNTY_BOARD, field: "name", value: "Supervisors" }] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], bodyIds: ["legacy-supervisors-alias"] }, [city, explicit]);
  assert.deepEqual(entries(result.entities).map(body => body.id), [COUNTY_BOARD, BOARD]);
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
  const partition = family([sitting("legistar:city", BOARD)], [BOARD]);
  partition.payload.agendaDocuments = [
    { id: "legistar:city@a", meetingId: "legistar:city", text: { $readerAgendaText: 0 } },
    { id: "legistar:city@b", meetingId: "legistar:city", text: { $readerAgendaText: 1 } },
  ] as never;
  const city = page(CITY, [entity(BOARD)], { meeting_rows: [partition], agenda_texts: ["Original agenda", "Amended agenda"],
    archived_meetings: [sitting("native:old", BOARD)], archived_documents: [{ id: "native:old@a", meetingId: "native:old", text: "Old minutes" }] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], includeAgenda: true, includeHistory: true }, [city]);
  assert.deepEqual(entries(model(entries(result.meeting_rows)[0]!.payload).agendaDocuments).map(doc => [doc.id, doc.text]), [
    ["legistar:city@a", "Original agenda"], ["legistar:city@b", "Amended agenda"],
  ]);
  assert.equal(entries(result.archived_documents)[0]!.text, "Old minutes");
  assert.deepEqual(result.agenda_texts, []);
  const headers = mergePlaceRows({ state: "AZ", divisionIds: [CITY] }, [city]);
  assert.deepEqual(model(entries(headers.meeting_rows)[0]!.payload).agendaDocuments, []);
  assert.deepEqual(headers.archived_documents, []);
});

test("an empty published family keeps its source version and checked time", () => {
  const city = page(CITY, [], { meeting_rows: [family([], [])] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY] }, [city]);
  const partition = entries(result.meeting_rows)[0]!;
  assert.equal(partition.current_version_id, "version-1");
  assert.equal(partition.confirmation, "confirmation");
  assert.equal(model(partition.payload).generatedAt, AT);
});

test("an empty geographic selection reads its ready registry shell and family checked time", () => {
  const empty = page(STATE, [], { page_kind: "empty", division_ids: [], meeting_rows: [family([], [])] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [] }, [empty]);
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.division_ids, []);
  assert.deepEqual(model(model(result.registry).registry).divisions, []);
  assert.equal(model(model(result.registry).registry).generatedAt, AT);
  assert.equal(model(entries(result.meeting_rows)[0]!.payload).generatedAt, AT);
  const city = page(CITY, [entity(BOARD)]);
  const selected = mergePlaceRows({ state: "AZ", divisionIds: [CITY] }, [city, empty]);
  assert.deepEqual(selected.meeting_rows, [], "the empty shell supplies no unrelated source version to a selected place");
});

test("a division-only meeting keeps its exact source ID when several selected pages share it", () => {
  const city = page(CITY, [], { meeting_rows: [family([sitting("native:city", null)], [])] });
  const county = page(COUNTY, [], { meeting_rows: [family([sitting("native:city", null)], [])] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY, COUNTY] }, [city, county]);
  assert.deepEqual(entries(model(entries(result.meeting_rows)[0]!.payload).meetings).map(meeting => meeting.id), ["native:city"]);
});

test("an agenda lookup retains identity context and omits unrelated member and directory data", () => {
  const city = page(CITY, [entity(BOARD)], { rosters: [{ body_id: BOARD, person_id: "member" }],
    meeting_rows: [family([sitting("legistar:target", BOARD), sitting("calendar:related", BOARD)], [BOARD])] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], includeAgenda: true, meetingIds: ["legistar:target"] }, [city]);
  assert.equal(entries(model(entries(result.meeting_rows)[0]!.payload).meetings).length, 2);
  assert.deepEqual(result.rosters, []);
  assert.deepEqual(entries(model(result.registry).bodyRosters)[0]!.members, []);
  assert.deepEqual(model(model(result.registry).officialCandidacies).rows, []);
  assert.equal(result.registration_held, false);
});

test("body-facts-only reads retain local facts without claiming that their independent state directory was loaded", () => {
  const city = page(CITY, [entity(BOARD)], { fields: [{ entity_id: BOARD, field: "name", value: "Council" }] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY], bodyFactsOnly: true }, [city]);
  assert.equal(entries(result.fields)[0]!.value, "Council");
  assert.equal(result.registry, null);
  assert.equal(result.registration_held, false);
  assert.deepEqual(result.divisions, []);
  assert.deepEqual(result.governments, []);
});

test("a board folded into a board that was itself folded resolves to the last, keeping its sittings and seating each member once", () => {
  const WORKSHOP = `${CITY}#body:workshop`, MIDDLE = `${CITY}#governing`, LAST = `${CITY}#body:council`;
  const partition = (body: string, meetings: Row[]) => ({ scope: `source:legistar:body:${encodeURIComponent(body)}`, current_version_id: body, confirmation: null,
    payload: { formatVersion: 1, generatedAt: AT, meetings, agendaDocuments: [], sources: [] } });
  const city = page(CITY, [entity(MIDDLE), entity(LAST)], { body_aliases: { [WORKSHOP]: MIDDLE, [MIDDLE]: LAST },
    rosters: [{ body_id: MIDDLE, person_id: "ana", shown_id: "legistar:ana", body_name: "Council", person: { "term_start:old": 1 } },
      { body_id: LAST, person_id: "ana", shown_id: "legistar:ana", body_name: "Council" }],
    meeting_rows: [partition(WORKSHOP, [sitting("legistar:one", WORKSHOP)]), partition(MIDDLE, [sitting("legistar:one", MIDDLE)])] });
  const result = mergePlaceRows({ state: "AZ", divisionIds: [CITY] }, [city]);
  assert.deepEqual(entries(result.entities).map(body => body.id), [LAST]);
  assert.deepEqual(entries(result.rosters).map(row => [row.body_id, row.person_id]), [[LAST, "ana"]]);
  assert.deepEqual(entries(result.meeting_rows).map(row => entries(model(row.payload).meetings).map(meeting => meeting.bodyId)), [[LAST], [LAST]]);
});

test("saved current and history contexts keep meetings, agendas and members from folded calendar labels",async()=>{
  const alias=`${CITY}#body:city-council-special-meeting`;
  const full=(id:string,startsAt:string)=>({...sitting(id,alias),bodyName:'City Council Special Meeting',title:'Council sitting',startsAt,
    timeZone:'America/Phoenix',location:null,agendaUrl:null,jurisdiction:'Tucson',status:'SCHEDULED',
    provenance:{sourceUrl:'https://tucson.example.gov/calendar',sourceOrg:'City Council',collectedAt:AT,verifiedAt:AT}});
  const current=full('native:current','2026-10-26T18:00:00Z'),past=full('native:past','2020-01-01T18:00:00Z');
  for(const includeHistory of [false,true]) {
    const partition=family([current],[alias]);
    partition.payload.agendaDocuments=[{id:'current-agenda',meetingId:current.id,text:'Council agenda'}] as never;
    const source=page(CITY,[{...entity(BOARD),name:'City Council'}],{
      body_aliases:{[alias]:BOARD},meeting_rows:[partition],
      archived_meetings:includeHistory?[past]:[],archived_documents:includeHistory?[{id:'old-minutes',meetingId:past.id,text:'Council minutes'}]:[],
    });
    const input={state:'AZ',divisionIds:[CITY],includeAgenda:true,includeHistory};
    const merged=mergePlaceRows(input,[source]);
    const member=entries(model(entries(merged.meeting_rows)[0]!.payload).derivedMembers)[0]!;
    assert.equal(member.bodyId,BOARD);
    const decoded=await composePlaceRow(input,merged);
    assert.deepEqual(decoded.bodies.map(body=>body.id),[BOARD]);
    assert.deepEqual(decoded.meetings.map(meeting=>meeting.id).sort(),(includeHistory?[past.id,current.id]:[current.id]).sort());
    assert.ok(decoded.meetings.every(meeting=>meeting.bodyId===BOARD&&meeting.bodyName==='City Council'));
    assert.deepEqual(decoded.snapshot.agendaDocuments.map(document=>document.id).sort(),(includeHistory?['old-minutes','current-agenda']:['current-agenda']).sort());
  }
});
