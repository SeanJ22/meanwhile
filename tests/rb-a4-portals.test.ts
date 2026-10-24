import assert from 'node:assert/strict';
import test from 'node:test';
import {migratedReaderDb} from './helpers/migrated-reader-db.ts';
import {BOOTSTRAP_DDL} from '../lib/control-plane/repository/pg-schema.ts';
import {withdrawPlatformPublication} from '../lib/facts/portal-publication.ts';
import {platformWiringDoors} from '../lib/doors/platform-census.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {upsertDerivedDoor} from '../lib/doors/registry.ts';
import {meetingPartitionOfId} from '../lib/civic-data/meeting-partitions.ts';
import {readPlacePackage} from '../lib/reader/place.ts';
import {resolveId} from '../lib/core/resolve.ts';
import type {FactDb} from '../lib/facts/publish.ts';

test('withdrawing an unconfirmed portal removes its calendar and facts, preserves independent facts and every identity, and is retryable',async()=>{
  const {pg,publish}=await migratedReaderDb();
  const repos=createMemoryRepositories();
  const query=async(sql:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(sql,[...params])).rows;
  const division='ocd-division/country:us/state:or/county:multnomah',body='or:special:metro#governing',portal='https://metro.legistar.com/Calendar.aspx',at='2026-10-24T00:00:00.000Z';
  try {
    await pg.exec(BOOTSTRAP_DDL.find(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS cp_work_items ('))!);
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Multnomah','OR'),($2,'body','Metro','OR'),('meeting:permanent','meeting','Metro meeting','OR')",[division,body]);
    await query("UPDATE entity SET parent_id=$1 WHERE id='meeting:permanent'",[body]);
    await query('INSERT INTO entity_place(entity_id,place_id,boundary_year) VALUES($1,$2,2022)',[body,division]);
    await query("INSERT INTO entity_external_id VALUES($1,'body-alias','old-metro-id')",[body]);
    for(const [id,url] of [[1,portal],[2,'https://oregonmetro.gov/council']] as const) await query('INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES($1,$2,$2,$3,$4,$5)',[id,url,at,'a'.repeat(64),`copy-${id}`]);
    for(const [field,value,copy] of [['office_phone','503-555-0100',2],['agenda_url',portal,1]] as const)
      await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
        VALUES($1,$2,to_jsonb($3::text),$3,'live','OFFICIAL',$4,'saved source',$5,'fixture')`,[body,field,value,copy,at]);
    const draft=platformWiringDoors({bodyId:body,ocdId:division,bodyName:'Metro',kind:'LEGISTAR',route:portal,officialHost:'oregonmetro.gov',
      jurisdictionId:'or:special:metro',state:'US-OR',publishingOrg:'Metro',timeZone:'America/Los_Angeles',config:{slug:'metro',bodyName:'Metro',sourceRoutes:'legistar',eventBodyId:'138'},
      crosswalkRowId:'held-source',reviewedAt:at,verifiedAt:at})[0]!;
    await upsertDerivedDoor(repos.doors,draft,at,at);
    const door=(await repos.doors.mustRead(draft.doorId)).value,partition=meetingPartitionOfId(door.doorId)!;
    await publish({id:'portal-calendar',recordClass:'MEETING',scope:partition.scope,sourceId:'fixture',at,
      value:{formatVersion:1,generatedAt:at,meetings:[{id:'portal:event',bodyId:body,bodyName:'Metro',ocdId:division,title:'Meeting',startsAt:at,timeZone:'America/Los_Angeles',location:null,agendaUrl:null,jurisdiction:'Local',status:'SCHEDULED',provenance:{sourceUrl:portal,sourceOrg:'Metro',collectedAt:at,verifiedAt:at}}],agendaDocuments:[],sources:[],counts:{}}});
    assert.equal((await readPlacePackage({state:'OR',divisionIds:[division]},query)).meetings.length,1);
    const db:FactDb={transaction:work=>pg.transaction(tx=>work(async(sql,params=[]) => (await tx.query<Record<string,unknown>>(sql,[...params])).rows))};
    for(let run=0;run<2;run++) {
      await withdrawPlatformPublication(db,door,portal,async()=>({purged:true}));
      const page=await readPlacePackage({state:'OR',divisionIds:[division]},query);
      assert.equal(page.meetings.length,0);
      assert.equal(page.bodies.find(b=>b.id===body)?.fields.officePhone,'503-555-0100');
      assert.equal((await query("SELECT status FROM fact WHERE entity_id=$1 AND field='agenda_url'",[body]))[0]!.status,'pulled');
      for(const id of [body,'old-metro-id','meeting:permanent']) assert.ok(await resolveId(id,query));
    }
  } finally {await pg.close();}
});
