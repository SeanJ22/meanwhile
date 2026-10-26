import assert from "node:assert/strict";
import test from "node:test";
import {PGlite} from "@electric-sql/pglite";
import {readDerivedMeetingBodyRows,derivedBodyScope} from "../lib/civic-data/derived-meeting-body.ts";
import {derivedMeetingBodyContract,derivedMeetingBodyForScope,requiredMeetingPartitionContract} from "../lib/civic-data/meeting-partitions.ts";
import {canonicalCivicDataHash} from "../lib/civic-data/canonical-hash.ts";
import {partitionCivicPayload} from "../lib/civic-data/payload-codec.ts";
import {routineDataStoreCandidateAuthorityIssue} from "../lib/civic-data/store.ts";
import {installKeyedRows} from "./helpers/keyed-rows.ts";

const BODY="ocd-division/country:us/state:az/place:sample#governing",OTHER="ocd-division/country:us/state:az/place:other#governing",AT="2026-10-20T00:00:00Z";
test("derived body bridge preserves exact held meeting/agenda facts and the whole legacy input hash through independent pointer moves",async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,last_known_good_version_id text,source_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,state text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,candidate jsonb,validation_receipt jsonb);`);
  await installKeyedRows(pg);
  const meeting=(id:string,bodyId:string)=>({id,bodyId,ocdId:bodyId.split("#")[0],title:id,startsAt:"2026-10-22T14:00:00Z",provenance:{sourceUrl:"https://sample.gov/calendar",collectedAt:AT}});
  const own=meeting("ical:held",BODY),other={...meeting("ical:elsewhere",OTHER),unused:"x".repeat(200_000)};
  const source={source:"ical",ok:true,error:null,fetched:2,normalized:2,drops:{placeless:0,unknownVenue:0,unplaceableInTime:0,notConfigured:0},acquisitions:[{unused:"z".repeat(200_000)}]};
  const members=[{id:"ical:sample",source:"ical",bodyId:BODY,status:"ACTIVE",outcome:"FRESH"},{id:"ical:other",source:"ical",bodyId:OTHER,status:"ACTIVE",outcome:"FRESH"}];
  const document={id:"doc:own",meetingId:own.id,documentUrl:"https://sample.gov/agenda",text:"All agenda words α𐐀",provenance:{sourceUrl:"https://sample.gov/agenda"}};
  const snapshot={formatVersion:1,generatedAt:AT,meetings:[own,other],agendaDocuments:[document,{id:"doc:other",meetingId:other.id,text:"y".repeat(200_000)}],sources:[source],derivedMembers:members,counts:{fresh:2,carried:0,total:2}};
  let serial=0;
  const put=async(scope:string,value:unknown)=>{
    const id=`version-${++serial}`,hash=canonicalCivicDataHash(value),encoded=partitionCivicPayload(value),sourceId="meetings-derived-routes",receipt={decision:"GOOD",candidateId:id,recordClass:"MEETING",scope,sourceId};
    await pg.transaction(async tx=>{
      for(const part of encoded.parts)await tx.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
      await tx.query("INSERT INTO civic_data_candidates VALUES($1,'MEETING',$2,$3,'PROMOTED',true,$1,$1,$4,$5::jsonb,$6::jsonb)",[id,scope,sourceId,hash,JSON.stringify({readModel:encoded.value,normalization:{normalizedHash:hash}}),JSON.stringify(receipt)]);
      await tx.query(`INSERT INTO civic_data_promotions VALUES($1,'MEETING',$2,$3,$3,$4,$5,$6::jsonb,$7::jsonb)
        ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,last_known_good_version_id=excluded.last_known_good_version_id,payload=excluded.payload,validation_receipt=excluded.validation_receipt`,
      [`MEETING:${scope}`,scope,id,sourceId,AT,JSON.stringify(encoded.value),JSON.stringify(receipt)]);
    });return id;
  };
  const family="source:derived:family:US-AZ",legacy=await put(family,snapshot);
  let bytes=0;
  const query=async(text:string,params:readonly unknown[]=[])=>{const rows=(await pg.query<Record<string,unknown>>(text,[...params])).rows;bytes+=JSON.stringify(rows).length;return rows;};
  const selected=await readDerivedMeetingBodyRows(query,"US-AZ",BODY);
  assert.equal(selected?.expectedBaseVersionId,null,"first body publication still compares against no pointer in its own scope");
  assert.deepEqual(selected?.snapshot.meetings,[own]);assert.deepEqual(selected?.snapshot.agendaDocuments,[document]);assert.deepEqual(selected?.snapshot.derivedMembers,[members[0]]);
  assert.deepEqual(selected?.snapshot.counts,{fresh:1,carried:0,total:1,duplicatesCollapsed:0});
  assert.equal(selected?.input.versionId,legacy);assert.equal(selected?.input.scope,family);
  assert.equal(selected?.input.readModelSha256,canonicalCivicDataHash(snapshot),"retained evidence cites the actual complete immutable source, not a made-up subset hash");
  assert.ok(bytes<6_000,`${bytes} bytes excludes other body meetings/documents and shared acquisitions`);
  const nativeSnapshot={...selected!.snapshot,meetings:[{...own,title:"Changed held title"}]};
  const native=await put(derivedBodyScope(BODY),nativeSnapshot);
  assert.equal((await readDerivedMeetingBodyRows(query,"US-AZ",BODY))?.expectedBaseVersionId,native);
  assert.deepEqual((await readDerivedMeetingBodyRows(query,"US-AZ",BODY))?.snapshot,nativeSnapshot);
  assert.deepEqual((await readDerivedMeetingBodyRows(query,"US-AZ",OTHER))?.snapshot.meetings,[other],"unmoved body stays on its exact legacy records");
  await put(derivedBodyScope(BODY),{...nativeSnapshot,meetings:[],agendaDocuments:[],counts:{fresh:0,carried:0,total:0}});
  assert.deepEqual((await readDerivedMeetingBodyRows(query,"US-AZ",BODY))?.snapshot.meetings,[],"an existing empty body pointer does not resurrect legacy rows");
  await put(derivedBodyScope(BODY),{...nativeSnapshot,meetings:[other]});
  await assert.rejects(readDerivedMeetingBodyRows(query,"US-AZ",BODY),/DERIVED_MEETING_BODY_FOREIGN_ROWS/);
});

test("one body's existing family authority remains scoped to that same state, including history",()=>{
  const family=requiredMeetingPartitionContract("meetings:derived:US-AZ"),body=derivedMeetingBodyContract(family,BODY);
  assert.equal(body.scope,derivedBodyScope(BODY));assert.equal(body.derivedParentId,family.id);
  assert.equal(derivedMeetingBodyForScope(body.scope)?.id,body.id);
  const candidate={id:"body-version",sourceId:"meetings-derived-routes",recordClass:"MEETING" as const,scope:body.scope};
  const authority={repo:"fixture",sha:"a".repeat(40),capability:"ROUTINE_CONTRACT" as const,contract:family.id,parentPid:1,nonce:"fixture"};
  assert.equal(routineDataStoreCandidateAuthorityIssue(candidate,authority,"candidate"),null);
  assert.match(routineDataStoreCandidateAuthorityIssue(candidate,{...authority,contract:"meetings:derived:US-NH"},"candidate")!,/cannot mutate/);
  assert.equal(routineDataStoreCandidateAuthorityIssue({...candidate,sourceId:"meetings-history",scope:`${body.scope}:history`},authority,"candidate"),null);
  assert.throws(()=>derivedMeetingBodyContract(family,"ocd-division/country:us/state:nh/place:elsewhere#governing"),/STATE_MISMATCH/);
});
