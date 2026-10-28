import assert from 'node:assert/strict';
import test from 'node:test';
import {migratedReaderDb} from './helpers/migrated-reader-db.ts';
import {withdrawPlatformPublication,confirmPlatformPublication} from '../lib/facts/portal-publication.ts';
import {platformWiringDoors} from '../lib/doors/platform-census.ts';
import {createMemoryRepositories} from '../lib/control-plane/repository/memory.ts';
import {upsertDerivedDoor} from '../lib/doors/registry.ts';
import {meetingPartitionOfId} from '../lib/civic-data/meeting-partitions.ts';
import {readPlacePackage} from '../lib/reader/place.ts';
import {resolveId} from '../lib/core/resolve.ts';
import type {FactDb} from '../lib/facts/publish.ts';
import {readPlatformGovernment} from '../lib/control-plane/discovery/platform-government.ts';
import {platformRegistrationNeed,platformRegistrationBinding,type PlatformRegistrationPage} from '../lib/control-plane/discovery/platform-registration.ts';
import {seedPlacePages} from './helpers/place-pages.ts';
import {readReaderEdgeMeetings} from '../lib/meetings/edge-serving.ts';

test('an unconfirmed portal keeps every verified fact, host, calendar and agenda while its CHECK retry stays open',async()=>{
  const {pg,publish}=await migratedReaderDb();
  const repos=createMemoryRepositories();
  const query=async(sql:string,params:readonly unknown[]=[]) => (await pg.query<Record<string,unknown>>(sql,[...params])).rows;
  const division='ocd-division/country:us/state:or/county:multnomah',body='or:special:metro#governing',portal='https://metro.legistar.com/Calendar.aspx',at='2026-10-24T00:00:00.000Z';
  try {
    await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Multnomah','OR'),($2,'body','Metro','OR'),('meeting:permanent','meeting','Metro meeting','OR')",[division,body]);
    await query("UPDATE entity SET parent_id=$1 WHERE id='meeting:permanent'",[body]);
    await query('INSERT INTO entity_place(entity_id,place_id,boundary_year) VALUES($1,$2,2022)',[body,division]);
    await query("INSERT INTO entity_external_id VALUES($1,'body-alias','old-metro-id')",[body]);
    for(const [id,url] of [[1,portal],[2,'https://oregonmetro.gov/council']] as const) await query('INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES($1,$2,$2,$3,$4,$5)',[id,url,at,'a'.repeat(64),`copy-${id}`]);
    for(const [field,value,copy] of [['office_phone','503-555-0100',2],['agenda_url',portal,1]] as const)
      await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
        VALUES($1,$2,to_jsonb($3::text),$3,'live','OFFICIAL',$4,'saved source',$5,'fixture')`,[body,field,value,copy,at]);
    await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
      VALUES('meeting:permanent','title','"Verified meeting title"','Verified meeting title','live','OFFICIAL',1,'saved calendar',$1,'fixture')`,[at]);
    await query("INSERT INTO entity_host(entity_id,host) VALUES($1,'metro.legistar.com'),($1,'oregonmetro.gov')",[body]);
    const draft=platformWiringDoors({bodyId:body,ocdId:division,bodyName:'Metro',kind:'LEGISTAR',route:portal,officialHost:'oregonmetro.gov',
      jurisdictionId:'or:special:metro',state:'US-OR',publishingOrg:'Metro',timeZone:'America/Los_Angeles',config:{slug:'metro',bodyName:'Metro',sourceRoutes:'legistar',eventBodyId:'138'},
      crosswalkRowId:'held-source',reviewedAt:at,verifiedAt:at})[0]!;
    await upsertDerivedDoor(repos.doors,draft,at,at);
    const door=(await repos.doors.mustRead(draft.doorId)).value,partition=meetingPartitionOfId(door.doorId)!;
    const sitting=(id:string,startsAt:string,sourceUrl=portal)=>({id,bodyId:body,bodyName:'Metro',ocdId:division,title:`Meeting ${id}`,startsAt,timeZone:'America/Los_Angeles',location:null,
      agendaUrl:`${sourceUrl}/agenda/${id}`,jurisdiction:'Local',status:'SCHEDULED',provenance:{sourceUrl,sourceOrg:'Metro',collectedAt:at,verifiedAt:at}});
    const save=async(id:string,scope:string,row:ReturnType<typeof sitting>,retrievedAt=at)=>publish({id,recordClass:'MEETING',scope,sourceId:'fixture',at:retrievedAt,
      value:{formatVersion:1,generatedAt:retrievedAt,meetings:[row],agendaDocuments:[{id:`document:${row.id}`,meetingId:row.id,documentUrl:row.agendaUrl,text:`Exact text ${row.id}`}],sources:[],counts:{}}});
    await save('portal-archived',partition.scope,sitting('portal:archived','2020-01-01T18:00:00.000Z'),'2020-01-01T00:00:00.000Z');
    await save('portal-history',`${partition.scope}:history`,sitting('portal:history','2020-02-01T18:00:00.000Z'));
    await save('portal-calendar',partition.scope,sitting('portal:event',at));
    await save('independent-calendar',`source:independent:body:${encodeURIComponent(body)}`,sitting('independent:event','2026-10-25T18:00:00.000Z','https://oregonmetro.gov/council'));
    const input={state:'OR',divisionIds:[division],includeHistory:true,includeAgenda:true};
    const page=async(history=true)=>{
      const selected={...input,includeHistory:history};
      await seedPlacePages(query,selected);
      await seedPlacePages(query,{state:'OR',divisionIds:[],bodyIds:['old-metro-id'],neighbors:true});
      return readPlacePackage(selected,query);
    };
    const currentBefore=await page(false);
    assert.deepEqual(currentBefore.meetings.map(row=>row.id).sort(),['independent:event','portal:event']);
    const before=await page();
    assert.deepEqual(before.meetings.map(row=>row.id).sort(),['independent:event','portal:archived','portal:event','portal:history']);
    assert.deepEqual(before.snapshot.agendaDocuments.map(row=>row.id).sort(),before.meetings.map(row=>`document:${row.id}`).sort());
    const db:FactDb={transaction:work=>pg.transaction(tx=>work(async(sql,params=[]) => (await tx.query<Record<string,unknown>>(sql,[...params])).rows))};
    const readerRows=async()=>({
      facts:await query('SELECT * FROM fact ORDER BY id'),
      hosts:await query('SELECT * FROM entity_host ORDER BY entity_id,host'),
      identities:await query('SELECT * FROM entity ORDER BY id'),
      aliases:await query('SELECT * FROM entity_external_id ORDER BY entity_id,scheme,value'),
      pointers:await query('SELECT * FROM civic_data_promotions ORDER BY key'),
      versions:await query('SELECT * FROM civic_data_candidates ORDER BY id'),
      copies:await query('SELECT * FROM source_copy ORDER BY id'),
    });
    const savedRows=await readerRows();
    await query('DELETE FROM rebuild_queue');
    let purges=0;
    const purge=async()=>{purges++;return {purged:true};};
    for(let run=0;run<2;run++) {
      await withdrawPlatformPublication(db,door,portal,purge);
      assert.equal(purges,0,'a CHECK-only retry never purges the unchanged page');
      assert.deepEqual(await query('SELECT place_id FROM rebuild_queue'),[],'a CHECK-only retry never queues an unchanged page');
      const blanks=await query("SELECT field,stage,reason,detail,attempts,next_try_at FROM blank WHERE entity_id=$1 ORDER BY field",[body]);
      assert.deepEqual(blanks.map(({field,stage,reason,detail,attempts})=>({field,stage,reason,detail,attempts})),
        [partition.scope,`${partition.scope}:history`].map(scope=>({field:`calendar:${scope}`,stage:'CHECK',reason:'PORTAL_AUTHORITY_UNCONFIRMED',detail:portal,attempts:run+1})));
      assert.ok(blanks.every(row=>new Date(row.next_try_at as string).getTime()>Date.now()),'the source has a scheduled retry');
      assert.deepEqual(await readerRows(),savedRows,'lack of a backlink changes no verified fact status, host filing, source pointer, version JSON or permanent ID');
      const held=await page();
      assert.deepEqual(held,before,'current, historical and archived reader data retain their exact JSON');
      assert.deepEqual(await page(false),currentBefore);
      const opened=await readReaderEdgeMeetings({states:['OR'],bodyIds:['old-metro-id'],neighbors:true,window:'HELD',meetingIds:['portal:archived'],includeAgenda:true,query,now:at});
      assert.equal(opened.kind,'PROMOTED',JSON.stringify(opened));
      if(opened.kind==='PROMOTED') {
        assert.deepEqual(opened.value.meetings,before.meetings);
        assert.deepEqual(opened.value.agendaDocuments,before.snapshot.agendaDocuments);
      }
      assert.equal(held.bodies.find(b=>b.id===body)?.fields.officePhone,'503-555-0100');
      assert.equal((await query("SELECT status FROM fact WHERE entity_id=$1 AND field='agenda_url'",[body]))[0]!.status,'live');
      for(const id of [body,'old-metro-id','meeting:permanent']) assert.ok(await resolveId(id,query));
    }
    await confirmPlatformPublication(db,door,purge);
    assert.deepEqual(await query('SELECT * FROM blank WHERE entity_id=$1',[body]),[],'the observed government link closes the standing check');
    assert.equal(purges,0);
    assert.deepEqual(await query('SELECT place_id FROM rebuild_queue'),[]);
    assert.deepEqual(await readerRows(),savedRows);
    const restored=await page();
    assert.deepEqual(restored,before,'closing the check leaves every held source and agenda unchanged');
  } finally {await pg.close();}
});

test('a transient own-site failure retains acquisition, a gone own site pauses its door, and a later observed link resumes it',async()=>{
  const repos=createMemoryRepositories(),at='2026-10-24T00:00:00.000Z',body='or:special:metro#governing';
  const website='https://oregonmetro.gov/',portal='https://metro.legistar.com/Calendar.aspx';
  const page:PlatformRegistrationPage={versionId:'registration',promotedAt:at,readModelHash:'a'.repeat(64),government:{
    id:'government:US-OR:cog:155003',jurisdictionId:'or:special:metro',state:'OR',name:'Metro',kind:'GOVERNMENT',governmentClass:'SPECIAL_DISTRICT',
    nativeIds:{census_pid6:'155003'},status:'Y',sourceVintage:'2022',website,officePhone:null,officeAddress:null,countyFips:'41051',bodyIds:[body],aliases:[],
    associations:[{divisionId:'ocd-division/country:us/state:or/county:multnomah',layer:'county',geoid:'41051',basis:'SOURCE_CODE'}],
    provenance:{sourceUrl:'https://census.gov/',sourceOrg:'Census',collectedAt:at,verifiedAt:at}}};
  const draft=platformWiringDoors({bodyId:body,ocdId:'ocd-division/country:us/state:or/county:multnomah',bodyName:'Metro',kind:'LEGISTAR',route:portal,
    officialHost:'oregonmetro.gov',jurisdictionId:'or:special:metro',state:'US-OR',publishingOrg:'Metro',timeZone:'America/Los_Angeles',
    config:{slug:'metro',sourceRoutes:'legistar',eventBodyId:'138',governmentId:'or:special:metro',platformPublisherUrl:portal,crosswalkRowId:'held'},
    crosswalkRowId:'held',reviewedAt:at,verifiedAt:at})[0]!;
  await upsertDerivedDoor(repos.doors,draft,at,at);
  let status=503,withdrawn=0,confirmed=0,clock=at;
  const input={repos,need:platformRegistrationNeed(page)!,registered:platformRegistrationBinding(page),reviewer:'auto-crosswalk-reviewer@0123456789ab',
    query:async()=>[page as unknown as Record<string,unknown>],tenant:{platform:'legistar',url:portal,name:'Metro',state:'OR',source:'held door'},
    withdraw:async()=>{withdrawn++;},confirm:async()=>{confirmed++;},
    runtime:{now:()=>clock,budget:{spent:()=>false},spaceOut:async()=>{},vault:async()=>({stored:true,where:'fixture',why:'saved'}),
      open:async()=>({status,body:status===200?`<title>Metro</title><a href="${portal}">Meeting calendar</a>`:'',bytes:100,contentType:'text/html',location:null,transportError:null})}};
  await readPlatformGovernment(input);
  assert.equal((await repos.doors.mustRead(draft.doorId)).value.status,'OPEN');assert.equal(withdrawn,0);
  status=404;clock='2026-10-24T12:00:00.000Z';await readPlatformGovernment(input);
  assert.equal((await repos.doors.mustRead(draft.doorId)).value.status,'SUSPENDED');assert.equal(withdrawn,1);
  status=200;clock='2026-10-25T00:00:00.000Z';await readPlatformGovernment(input);
  assert.equal((await repos.doors.mustRead(draft.doorId)).value.status,'OPEN');assert.equal(confirmed,1);
});
