import { PLACE_CHECKS_SQL } from "../lib/reader/place-builder.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { mergeDuplicateSittingFields, mergeReaderSittings } from "../lib/meetings/sitting-merge.ts";
import { PLACE_PAGES_SQL, readPlacePackage } from "../lib/reader/place.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { PIMA } from "./helpers/meeting-body-fixtures.ts";
import { placePagesAnswer } from "./helpers/place-pages-answer.ts";
import { collapseDuplicateSittings } from "../lib/sources/composite/index.ts";
import { withSittingFacts } from "../lib/facts/meeting-read.ts";
const at = "2026-10-05T12:00:00Z";
const meeting = (id: string, extra: Partial<Meeting> = {}): Meeting => ({ id, bodyId: "body", bodyName: "Board", jurisdiction: "County", title: "Meeting", ocdId: "ocd-division/country:us/state:az/county:example", startsAt: "2026-10-06T18:00:00Z", timeZone: "UTC", location: null, agendaUrl: null, status: "SCHEDULED", provenance: { kind: "OFFICIAL", sourceUrl: `https://office.gov/${id}`, sourceOrg: "Clerk", collectedAt: at, verifiedAt: at }, ...extra });
test("CP-18: two doors with different times merge, retaining the official value, other useful fields, and the losing value", () => {
  const official = meeting("portal:1");
  const news = meeting("calendar:1", { startsAt: "2026-10-06T19:00:00Z", agendaUrl: "https://office.gov/agenda", provenance: { ...official.provenance, kind: "NEWS", collectedAt: "2026-10-05T13:00:00Z" } });
  const merged = mergeReaderSittings([official, news]);
  assert.equal(merged.rows.length, 1);
  assert.equal(merged.rows[0].startsAt, official.startsAt);
  assert.equal(merged.rows[0].agendaUrl, news.agendaUrl);
  assert.equal(merged.rows[0].fieldSources?.agendaUrl.kind, "NEWS");
  assert.ok(merged.conflicts.some(row => row.code === "CONFLICT_SUPERSEDED" && (row.record as { field: string }).field === "startsAt"));
  assert.deepEqual(mergeReaderSittings([news, official]), merged);
});
test("CP-18: a second same-day sitting stays distinct, and an exact cross-door match still merges", () => {
  const a = meeting("portal:1"), b = meeting("portal:2", { startsAt: "2026-10-06T20:00:00Z" });
  assert.equal(mergeReaderSittings([a, b, meeting("calendar:1", { startsAt: "2026-10-06T19:00:00Z" })]).rows.length, 3);
  assert.equal(mergeReaderSittings([a, b, meeting("calendar:1")]).rows.length, 2);
  assert.equal(mergeReaderSittings([a, meeting("calendar:1", { bodyId: "another-body" })]).rows.length, 2);
});
test("CP-18: a body's composition retains both source ids and an agenda belonging to the merged-away row", async () => {
  const owned = { bodyId: PIMA.bodyId, ocdId: PIMA.ocdId };
  const old = meeting("calendar:1", owned);
  const fresh = meeting("portal:1", { ...owned, startsAt: "2026-10-06T19:00:00Z", provenance: { ...old.provenance, collectedAt: "2026-10-05T13:00:00Z" } });
  const report = (source: string) => ({ source, ok: true, error: null, fetched: 1, normalized: 1, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } });
  const snapshot: MeetingsSnapshot = { formatVersion: 1, generatedAt: at, sources: [report("calendar"), report("portal")], counts: snapshotCounts([old, fresh], 0), meetings: [old, fresh], agendaDocuments: [{ id: "agenda", meetingId: old.id, ocdId: old.ocdId } as MeetingsSnapshot["agendaDocuments"][number]] };
  const held = await readPlacePackage({state:"AZ",divisionIds:[PIMA.ocdId!],bodyIds:[PIMA.bodyId],includeAgenda:true},async sql=>{
    if(sql===PLACE_CHECKS_SQL)return [];
    assert.equal(sql,PLACE_PAGES_SQL);
    return placePagesAnswer([{page_id:PIMA.bodyId,page_kind:"body",built_at:at,body_ids:[PIMA.bodyId],row:{
      division_ids:[PIMA.ocdId],entities:[{id:PIMA.bodyId,division:PIMA.ocdId}],fields:[],rosters:[],comments:[],sittings:[],
      meeting_rows:[{scope:PIMA.scope,payload:snapshot,current_version_id:"v-1",confirmation:null}],parts:{},governments:[],divisions:[],registration_held:false,
    }}]);
  });
  const result = held.snapshot;
  assert.equal(result.meetings.length, 1);
  assert.equal(result.meetings[0].startsAt, fresh.startsAt);
  assert.equal(result.agendaDocuments[0].meetingId, fresh.id);
  assert.deepEqual(result.meetings[0].mergedMeetingIds, [old.id, fresh.id]);
  const again = mergeReaderSittings(result.meetings);
  assert.deepEqual(again.rows, result.meetings);
});

test("CP-18: composite collapse keeps field winners, losing evidence and source aliases before day reconciliation", () => {
  const old = meeting("calendar:1", { location: { name: "Old Hall", address: "Old address", lat: 1, lng: 2 } });
  const fresh = meeting("portal:1", { agendaUrl: "https://office.gov/new-agenda", location: { name: "New Hall", address: "New address", lat: 1, lng: 2 }, provenance: { ...old.provenance, collectedAt: "2026-10-05T13:00:00Z" } });
  const exact = collapseDuplicateSittings([old, fresh], mergeDuplicateSittingFields);
  assert.equal(exact.collapsed, 1);
  assert.deepEqual(exact.dropped, [old]);
  const final = mergeReaderSittings(exact.rows);
  assert.equal(final.rows.length, 1);
  assert.equal(final.rows[0].location?.name, "New Hall");
  assert.equal(final.rows[0].agendaUrl, fresh.agendaUrl);
  assert.deepEqual(final.rows[0].mergedMeetingIds, [old.id, fresh.id]);
  assert.ok(final.rows[0].publicationConflicts?.some(row => (row.record as { field: string }).field === "location"));
  assert.equal(final.aliases.get(old.id), fresh.id);
});
test("CP-18: exact collapse never joins different canonical bodies or conceals a second sitting from one door", () => {
  const a = meeting("portal:1"), other = meeting("calendar:1", { bodyId: "other-body" });
  assert.equal(collapseDuplicateSittings([a, other], mergeDuplicateSittingFields).rows.length, 2);
  const b = meeting("portal:2", { startsAt: "2026-10-06T20:00:00Z" });
  const exact = collapseDuplicateSittings([a, meeting("calendar:1"), b], mergeDuplicateSittingFields);
  assert.equal(exact.rows.length, 2);
  assert.equal(mergeReaderSittings(exact.rows).rows.length, 2, "the first record still represents both doors; the later portal sitting stays separate");
  const sameInstant = collapseDuplicateSittings([a, meeting("calendar:1"), meeting("portal:2")], mergeDuplicateSittingFields);
  assert.equal(mergeReaderSittings(sameInstant.rows).rows.length, 2, "two catalogue entries from the same source remain distinct");
});

test("an empty newer calendar location cannot erase another door's published point or its source", () => {
  const location = {name:"Board Room",address:"2150 Webster Street, Oakland, CA 94612",lat:37.81,lng:-122.26};
  const placed = meeting("api:1",{location});
  for (const text of [null,"-","-   Boone NC 28607"]) {
    const empty = meeting("calendar:1",{provenance:{...placed.provenance,collectedAt:"2026-10-05T13:00:00Z"},
      venueGap:{kind:text===null?"NOT_STATED_BY_PUBLISHER":"STATED_NOT_PLACED",publishedText:text,publisher:"Clerk"}});
    const [read] = mergeReaderSittings([placed,empty]).rows;
    assert.deepEqual(read.location,location);
    assert.equal(read.fieldSources?.location.sourceUrl,placed.provenance.sourceUrl);
    assert.deepEqual(read.mergedMeetingIds,[placed.id,empty.id].sort());
    const [factRead] = withSittingFacts([read],[{meetingId:empty.id,field:"location",value:{name:text??"-",address:null},source:empty.provenance}]);
    assert.deepEqual(factRead.location,location);
    assert.equal(factRead.fieldSources?.location.sourceUrl,placed.provenance.sourceUrl);
  }
});

test("a repeated street keeps its point across abbreviation and missing ZIP, while changed streets and online attendance replace it", () => {
  const placed = meeting("api:1",{location:{name:"Town Council Chambers",address:"1500 Blowing Rock Road, Boone, NC",lat:36.2,lng:-81.66}});
  const source = {...placed.provenance,collectedAt:"2026-10-05T13:00:00Z"};
  const text = "Council Chambers - 1500 Blowing Rock Rd  Boone NC 28607";
  const fresh = meeting("calendar:1",{provenance:source,venueGap:{kind:"STATED_NOT_PLACED",publishedText:text,publisher:"Clerk"}});
  const [merged] = mergeReaderSittings([placed,fresh]).rows;
  assert.equal(merged.location?.lat,placed.location?.lat);
  assert.equal(merged.location?.address,text);
  assert.equal(merged.fieldSources?.location.collectedAt,source.collectedAt);
  const [factRead] = withSittingFacts([placed],[{meetingId:placed.id,field:"location",value:{name:text,address:null},source}]);
  assert.equal(factRead.location?.lat,placed.location?.lat);
  assert.equal(factRead.location?.name,text);
  for (const other of [text.replace("1500","1600"),text.replace("Boone NC","Boone CA")]) {
    const [changed] = mergeReaderSittings([placed,{...fresh,venueGap:{...fresh.venueGap!,publishedText:other}}]).rows;
    assert.equal(changed.location,null);
    assert.equal(changed.venueGap?.publishedText,other);
  }
  const [online] = mergeReaderSittings([placed,{...fresh,venueGap:undefined,online:{label:"Virtual",joinUrl:null}}]).rows;
  assert.equal(online.location,null);
  assert.equal(online.online?.label,"Virtual");
});

test("two routes returning the same source ID produce one target with the current time, retained point and all aliases",()=>{
  const prior = meeting("ical:board:1",{location:{name:"Council Room",address:"1500 Blowing Rock Road, Boone, NC",lat:36.2,lng:-81.66},
    agendaUrl:"https://office.gov/agenda",mergedMeetingIds:["ical:board:1","portal:board:1"]});
  const current = meeting(prior.id,{startsAt:"2026-10-07T19:00:00Z",title:"Rescheduled meeting",
    provenance:{...prior.provenance,collectedAt:"2026-10-05T14:00:00Z"},
    venueGap:{kind:"NOT_STATED_BY_PUBLISHER",publishedText:null,publisher:"Clerk"}});
  const merged = mergeReaderSittings([prior,current]);
  assert.equal(merged.rows.length,1);assert.equal(merged.collapsed,1);
  assert.equal(merged.rows[0].id,prior.id);assert.equal(merged.rows[0].startsAt,current.startsAt);
  assert.equal(merged.rows[0].agendaUrl,prior.agendaUrl);assert.deepEqual(merged.rows[0].location,prior.location);
  assert.deepEqual(merged.rows[0].mergedMeetingIds,prior.mergedMeetingIds);
  assert.equal(merged.aliases.get("portal:board:1"),prior.id);
  assert.deepEqual(mergeReaderSittings([current,prior]).rows,merged.rows);
  assert.equal(mergeReaderSittings([prior,{...current,id:"ical:board:2"}]).rows.length,2,"distinct source IDs remain separate sittings");
  assert.equal(mergeReaderSittings([prior,{...current,bodyId:"other-body"}]).rows.length,2,"another board never supplies the same target");
});
