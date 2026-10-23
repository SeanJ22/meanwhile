import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { feedDoorDrafts } from "../lib/doors/seed-feeds.ts";
import { normalizeSocrata, normalizeEcho, openDataReports, type GovernmentJoin } from "../lib/sources/open-data/normalize.ts";
import { parseCatalogPage, socrataPages, openDataFetch } from "../lib/sources/open-data/acquire.ts";
import { openDataCandidate, publishOpenData, readOpenDataProjection } from "../lib/sources/open-data/publication.ts";
import { readerOpenData } from "../lib/sources/open-data/reader.ts";
import { openDataEvidence, openDataText } from "../lib/ask/open-data.ts";
import { OPEN_DATA_CLOCKS, ECHO_EXPORT, divisionPartition, zipPartition, type OpenDataFact } from "../lib/sources/open-data/model.ts";
import { streamCsvObjects } from "../lib/sources/prl/streaming.ts";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
import { parseOpenDataArguments, openDataArchiveStore } from "../scripts/open-data-refresh.mts";
import { portalBindingsFromPage,stateDirectoryPage,stateGovernmentWebsite } from "../lib/sources/open-data/portals.ts";
import type { RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import { facilityCell,facilityPoint,nearbyFacilityCells,facilityNear } from "../lib/sources/open-data/geography.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { saveSocrataLeads } from "../lib/sources/open-data/leads.ts";
import { readFieldManual } from "../lib/control-plane/field-manual.ts";
import { readPublicKindOwed } from "../lib/coverage/public-kind-owed.ts";
import { openArchiveSource } from "../lib/sources/archive-download.ts";
import { saveOpenDataPartition } from "../lib/sources/open-data/artifacts.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { refreshSocrata, socrataStateDivisionId } from "../lib/sources/open-data/socrata.ts";
import type { OpenDataCapture } from "../lib/sources/open-data/publication.ts";
import type { OpenDataPartitionRef, OpenDataReport } from "../lib/sources/open-data/model.ts";

const NOW="2026-10-12T23:24:00.000Z", LATER="2026-10-12T23:25:00.000Z";
const fixture=(name:string)=>readFileSync(new URL(`./fixtures/src-so/${name}`,import.meta.url),"utf8");
const manifest=JSON.parse(fixture("manifest.json"));
const catalog=(state:string)=>parseCatalogPage(fixture(`socrata-${state}.json`));
async function echoRows(){const out:OpenDataFact[]=[];for await(const raw of streamCsvObjects((async function*(){yield fixture("echo-exporter-sample.csv");})()))out.push(normalizeEcho(raw,NOW,"2026-10-11T02:25:45.000Z"));return out;}
const echoCapture=(rows:readonly OpenDataFact[])=>({url:ECHO_EXPORT,retrievedAt:NOW,rawHash:manifest.samples.find((sample:{file:string})=>sample.file==="echo-exporter-sample.csv").archiveSha256,sourceRows:rows.map(r=>r.sourceRow)});
async function echoManifest(rows:readonly OpenDataFact[],vault:MemoryEvidenceStore) {
  const reference=await saveOpenDataPartition({source:"epa-echo",partition:`${zipPartition(rows[0].zip!)}:state:${rows[0].state}`,rows,captures:[echoCapture(rows)],now:NOW},vault);
  return {source:"epa-echo" as const,rows:[],reports:openDataReports(rows),partitions:[reference],captures:[echoCapture(rows)],now:NOW};
}

test("SRC-SO samples are real captured source excerpts with checked digests and preserved national totals",async()=>{
  for(const sample of manifest.samples){assert.equal(createHash("sha256").update(fixture(sample.file)).digest("hex"),sample.sha256);assert.equal(sample.complete,false);}
  for(const state of ["ny","tx","wa"]){const page=catalog(state);assert.equal(page.rows.length,2);assert.ok(page.total>page.rows.length);for(const raw of page.rows){const row=normalizeSocrata(raw,NOW);assert.equal(row.official,true);assert.ok(row.nativeIds.socrata_id);assert.ok(row.updatedAt);}}
  const rows=await echoRows();assert.deepEqual([...new Set(rows.map(r=>r.state))],["AZ","NY","TX"]);assert.equal(rows.length,9);
  for(const row of rows){assert.equal(row.official,true);assert.ok(row.fields.inspectionCount);assert.ok(row.fields.lastInspection);assert.equal(row.publishedAt,"2026-10-11T02:25:45.000Z");assert.deepEqual(row.divisionIds,[]);}
});
test("Two national contracts carry the source clocks, token reference, standing commands and reader consumers",()=>{
  for(const source of ["socrata-discovery","epa-echo"] as const){const contract=requiredRoutineContract(source);assert.equal(contract.fanOut,undefined);assert.equal(contract.cadence.defaultEveryMs,OPEN_DATA_CLOCKS[source]);assert.ok(contract.readerProjection?.consumers.includes("Ask"));assert.equal(routineTaskFromContract(contract).sourceId,source);assert.equal(parseOpenDataArguments(["--promote",`--source=${source}`]),source);}
  assert.equal(feedDoorDrafts().find(d=>d.doorId==="feed:socrata-discovery")?.config?.keyRef,"SOCRATA_APP_TOKEN");
  assert.equal(feedDoorDrafts().find(d=>d.doorId==="feed:epa-echo")?.config?.keyRef,undefined);
  assert.throws(()=>parseOpenDataArguments(["--promote","--source=legiscan"]));
});
test("Exact publisher FIPS joins keep every unjoined facility and report rows once",async()=>{
  const rows=await echoRows();const held:GovernmentJoin[]=[{divisionId:"ocd-division/country:us/state:az/county:maricopa",bodyIds:[],nativeIds:{county_fips:"04013"}}];
  const joined=rows.map(row=>normalizeEcho(row.sourceRow,NOW,row.publishedAt,held));
  assert.equal(joined.length,9);assert.equal(joined.filter(r=>r.divisionIds.length).length,2);
  assert.deepEqual(openDataReports(joined).map(({state,loaded,joined,unjoined})=>({state,loaded,joined,unjoined})),[
    {state:"AZ",loaded:3,joined:2,unjoined:1},{state:"NY",loaded:3,joined:0,unjoined:3},{state:"TX",loaded:3,joined:0,unjoined:3}]);
  assert.equal(joined[0].fields.quartersWithNoncompliance,"1");assert.equal(joined[0].sourceRow.FAC_3YR_COMPLIANCE_HISTORY,"_________V__");
});
test("A catalog publisher joins through its saved official government link, without matching names",()=>{
  const raw=catalog("ny").rows[0];const division="ocd-division/country:us/state:ny";
  const government={id:"government:US-NY:cog:state",nativeIds:{state_fips:"36"},bodyIds:[],associations:[{divisionId:division,geoid:"36",layer:"state",basis:"SOURCE_CODE"}],website:"https://www.ny.gov/"} as unknown as RegistrationGovernmentListing;
  const html='<a href="https://data.ny.gov/">Open data</a>';
  const bindings=portalBindingsFromPage(government,"https://www.ny.gov/",html,new Set(["data.ny.gov"]));
  const row=normalizeSocrata(raw,NOW,[],bindings);assert.deepEqual(row.divisionIds,[division]);assert.equal(row.state,"NY");
  assert.equal(normalizeSocrata(raw,NOW).state,null);assert.equal(portalBindingsFromPage(government,"https://example.com/",html,new Set(["data.ny.gov"])).length,0);
  const owned=portalBindingsFromPage(government,"https://www.ny.gov/","<p>State government</p>",new Set(["data.ny.gov","data.texas.gov"]));
  assert.deepEqual(owned.map(b=>b.domain),["data.ny.gov"]);
});
test("National Discovery uses native deep scrolling past the provider's offset limit",async()=>{
  const liveFirst=parseCatalogPage(fixture("socrata-scroll-first.json")),liveNext=parseCatalogPage(fixture("socrata-scroll-next.json"));
  assert.equal((liveFirst.rows.at(-1)!.resource as {id:string}).id,"222h-gz6m");
  assert.equal((liveNext.rows[0].resource as {id:string}).id,"222r-ymf3");
  const rows=[...catalog("ny").rows,...catalog("tx").rows];let calls=0;
  const acquire=(async(options:Record<string,unknown>)=>{const url=new URL(options.url as string),cursor=url.searchParams.get("scroll_id");assert.equal(url.searchParams.has("offset"),false);assert.equal(url.searchParams.has("order"),false);const offset=cursor?rows.findIndex(r=>(r.resource as {id:string}).id===cursor)+1:0;calls++;const body=JSON.stringify({results:rows.slice(offset,offset+2),resultSetSize:250000});return {bytes:new TextEncoder().encode(body),sha256:createHash("sha256").update(body).digest("hex"),requestedUrl:options.url,finalUrl:options.url,retrievedAt:NOW,checkedAt:NOW,lastCheckStatus:200};}) as unknown as NonNullable<Parameters<typeof socrataPages>[0]["acquire"]>;
  const found=[];for await(const page of socrataPages({signal:AbortSignal.timeout(1000),acquire,token:"fixture-token"}))found.push(...page.rows);
  assert.equal(calls,3);assert.equal(found.length,4);
  assert.throws(()=>parseCatalogPage('{"results":[],"resultSetSize":4,"warnings":["partial"]}'));
});
test("Provider Retry-After retries rate limits without a local website request cap",async()=>{
  let calls=0;const response=await openDataFetch(ECHO_EXPORT,{},(async()=>++calls===1?new Response("limited",{status:429,headers:{"Retry-After":"0"}}):new Response("ok")) as typeof fetch);
  assert.equal(calls,2);assert.equal(response.status,200);
});
test("Source-native unjoined rows publish through the canonical manifest and remain usable by Ask",async()=>{
  const row=(await echoRows())[0], store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const published=await publishOpenData({store,...await echoManifest([row],vault)});
  assert.ok(published.outcome.promoted);assert.equal(published.outcome.readerReadback?.status,"PASS",published.outcome.readerReadback?.detail);
  const reader=await readerOpenData({zip:row.zip},{store,vault,now:NOW,bypassCache:true});assert.equal(reader.records.length,1);
  assert.equal(reader.records[0].id,row.id);assert.deepEqual(reader.records[0].divisionIds,[]);
  const evidence=openDataEvidence(reader.records[0]);assert.equal(evidence.kind,"REGULATED_FACILITY");assert.equal(evidence.openData?.official,true);assert.equal(evidence.sourceUrl,row.sourceUrl);assert.match(evidence.text,/quarters with noncompliance: 1/);
  const foreign=await readerOpenData({zip:"00000"},{store,vault,now:NOW,bypassCache:true});assert.equal(foreign.records.length,0);assert.deepEqual(foreign.notHeld,[]);
  assert.equal(published.candidate.normalization.outputRecords,1);
});
test("Unchanged checks are successful confirmations, and a source outage keeps the last good native rows",async()=>{
  const row=(await echoRows())[0],store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const args={store,...await echoManifest([row],vault)};
  const first=await publishOpenData(args);const second=await publishOpenData({...args,now:LATER});
  assert.ok(first.outcome.promoted);assert.ok(second.outcome.confirmed);assert.equal(second.outcome.confirmed?.versionId,first.candidate.id);
  const failure=await recordRegisteredSourceAcquisitionFailure({store,contractId:"epa-echo",requestedUrl:ECHO_EXPORT,attemptedAt:LATER,failure:sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE","EPA proxy connection failed")});
  assert.equal(failure.outcome.candidate.state,"SOURCE_BLOCKED");assert.match(failure.outcome.candidate.failureDetail??"",/proxy connection failed/);
  const held=await readOpenDataProjection("epa-echo","national",{store,now:LATER,bypassCache:true});assert.equal(held.kind,"PROMOTED");assert.equal(held.metadata.versionId,first.candidate.id);
});
test("Equal state counts still publish changed source files, while unavailable accepted files are reported",async()=>{
  const row=(await echoRows())[0],store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore();
  const first=await publishOpenData({store,...await echoManifest([row],vault)});
  const updatedSource={...row.sourceRow,FAC_INSPECTION_COUNT:"2"};
  const updated=normalizeEcho(updatedSource,NOW,row.publishedAt);
  const second=await publishOpenData({store,...await echoManifest([updated],vault),now:LATER});
  assert.ok(second.outcome.promoted);assert.notEqual(second.candidate.id,first.candidate.id);
  const held=await readerOpenData({zip:row.zip},{store,vault,now:LATER,bypassCache:true});assert.equal(held.records[0].fields.inspectionCount,"2");
  const missing=await readerOpenData({zip:row.zip},{store,vault:new MemoryEvidenceStore(),now:LATER,bypassCache:true});
  assert.deepEqual(missing.unavailable,["epa-echo"]);assert.equal(missing.records.length,0);
});
test("Forged source values cannot move the canonical reader pointer",async()=>{
  const row=(await echoRows())[0], store=new MemoryRoutineDataStore();
  const candidate=openDataCandidate({source:"epa-echo",rows:[{...row,title:"invented facility"}],captures:[echoCapture([row])],now:NOW});
  const outcome=await processRegisteredRoutineCandidate(store,"epa-echo",candidate,NOW);assert.equal(outcome.promoted,null);
  const metric=openDataCandidate({source:"epa-echo",partition:zipPartition(row.zip!),rows:[{...row,fields:{...row.fields,inspectionCount:"1000"}}],captures:[echoCapture([row])],now:NOW});
  assert.equal(metric.normalization.succeeded,false);
});
test("Disk spool retains exact rows and captures while publishing one ZIP at a time",async()=>{
  const rows=await echoRows(),spool=await OpenDataSpool.create();
  try{for(const row of rows)await spool.append(zipPartition(row.zip!),row,echoCapture([row]));let count=0;for await(const p of spool.partitions()){count+=p.rows.length;assert.equal(p.partition,zipPartition(p.rows[0].zip!));assert.equal(p.rows[0].nativeIds.registry_id,p.rows[0].sourceRow.REGISTRY_ID);}assert.equal(count,9);}finally{await spool.dispose();}
});
test("The real Texas catalog Unicode line separator survives disk spooling exactly",async()=>{
  const raw=parseCatalogPage(fixture("socrata-texas-line-separator.json")).rows[0],row=normalizeSocrata(raw,NOW),spool=await OpenDataSpool.create();
  assert.ok(row.description.includes("\u2028"));
  try {
    await spool.append(`domain:${row.nativeIds.domain}`,row,{url:"https://api.us.socrata.com/api/catalog/v1?ids=25ut-iey2",retrievedAt:NOW,rawHash:createHash("sha256").update(fixture("socrata-texas-line-separator.json")).digest("hex")});
    const partitions=[];for await(const partition of spool.partitions())partitions.push(partition);
    assert.equal(partitions.length,1);assert.deepEqual(partitions[0].rows[0],row);assert.deepEqual(partitions[0].captures[0].sourceRows[0],raw);
  } finally {await spool.dispose();}
});
test("Catalog evidence carries metadata and dates while contents remain source leads",()=>{
  const row=normalizeSocrata(catalog("ny").rows[0],NOW);const evidence=openDataEvidence(row,"government-body");
  assert.equal(evidence.subjectId,"government-body");assert.equal(evidence.kind,"DATASET");assert.equal(evidence.occurredAt,row.publishedAt);assert.match(openDataText(row),/catalog entry/);
  assert.equal(divisionPartition("ocd-division/country:us/state:ny"),"division:ocd-division/country:us/state:ny");
});
test("Nearby ZIP queries use source coordinates, including facilities across a postal boundary",async()=>{
  const row=(await echoRows())[0],point=facilityPoint(row)!;
  assert.ok(nearbyFacilityCells(point).includes(facilityCell(point.lat,point.lng)));
  assert.equal(facilityNear(row,point),true);assert.equal(facilityNear(row,{lat:point.lat+2,lng:point.lng}),false);
  assert.equal(facilityPoint({...row,fields:{...row.fields,latitude:null}}),null);
});
test("Catalog datasets reach the same place's Scout manual and open standing public-record blanks",async()=>{
  const repos=createMemoryRepositories();const division="ocd-division/country:us/state:ny";
  const row={...normalizeSocrata(catalog("ny").rows[0],NOW),state:"NY",divisionIds:[division]};
  await saveSocrataLeads(repos,[row],NOW);
  const read=await readFieldManual(repos,{role:"SCOUT",ocdIds:[division]});
  assert.ok(read.store.entries.some(e=>e.kind==="SOURCE_LEAD"&&e.url===row.sourceUrl));
  const owed=await readPublicKindOwed(repos,[division]);assert.equal(owed.length,1);assert.equal(owed[0].sourceUrl,row.sourceUrl);
});
test("Catalog source leads insert in bulk and unchanged scheduled checks issue no per-row writes",async()=>{
  const repos=createMemoryRepositories(),manual=repos.fieldManual;let puts=0,updates=0,batches=0;
  const counted={...repos,fieldManual:{...manual,put:async(...args:Parameters<typeof manual.put>)=>{puts++;return manual.put(...args);},
    compareAndSet:async(...args:Parameters<typeof manual.compareAndSet>)=>{updates++;return manual.compareAndSet(...args);},
    insertNew:async(...args:Parameters<typeof manual.insertNew>)=>{batches++;return manual.insertNew(...args);}}};
  const rows=catalog("ny").rows.map(raw=>normalizeSocrata(raw,NOW));
  await saveSocrataLeads(counted,rows,NOW);assert.equal(batches,1);assert.equal(puts,0);assert.equal(updates,0);
  await saveSocrataLeads(counted,rows.map(row=>({...row,capturedAt:LATER})),LATER);assert.equal(puts,0);assert.equal(updates,0);
  const raw={...rows[0].sourceRow,resource:{...(rows[0].sourceRow.resource as object),name:"Updated catalog title"}};
  await saveSocrataLeads(counted,[normalizeSocrata(raw,LATER)],LATER);assert.equal(updates,1);
});
test("Statewide publisher discovery follows USA.gov's native postal IDs and captured government links",()=>{
  assert.equal(stateDirectoryPage(fixture("usa-state-ids.html"),"NY"),"https://www.usa.gov/states/new-york");
  assert.equal(stateDirectoryPage(fixture("usa-state-ids.html"),"TX"),"https://www.usa.gov/states/texas");
  assert.equal(stateGovernmentWebsite(fixture("usa-ny-government.html")),"https://www.ny.gov/");
  assert.equal(stateGovernmentWebsite(fixture("usa-tx-government.html")),"https://www.texas.gov/");
  assert.equal(stateDirectoryPage(fixture("usa-state-ids.html"),"AZ"),null);
});
test("Shared disk acquisition holds real raw fixture bytes and confirms a conditional source check unchanged",async()=>{
  const saved=new Map<string,Uint8Array>();
  const archive={get:async(key:string)=>saved.get(key)??null,head:async(key:string)=>saved.has(key)?{size:saved.get(key)!.length}:null,
    put:async(key:string,bytes:Uint8Array)=>{saved.set(key,bytes);}};
  const body=fixture("echo-exporter-sample.csv"),spec={id:"epa-echo-fixture",url:ECHO_EXPORT,file:"ECHO_EXPORTER.csv",format:"csv" as const};
  let requests=0;const fetchImpl=(async()=>++requests===1?new Response(body,{headers:{etag:'"fixture"',"last-modified":"Sun, 11 Oct 2026 02:25:45 GMT"}}):new Response(null,{status:304})) as typeof fetch;
  const first=await openArchiveSource(spec,fetchImpl,archive);
  try{let rows=0;for await(const _row of streamCsvObjects(first.textChunks))rows++;assert.equal(rows,9);await first.accept?.();assert.equal(first.publishedAt,"2026-10-11T02:25:45.000Z");}finally{await first.dispose();}
  const second=await openArchiveSource(spec,fetchImpl,archive,first.sourceSha256);try{assert.equal(second.unchanged,true);assert.equal(second.retrievedAt,first.retrievedAt);assert.equal(second.publishedAt,first.publishedAt);}finally{await second.dispose();}
});
test("EPA archive evidence gets a fresh key on the next scheduled run",async()=>{
  const vault=new MemoryEvidenceStore(),spec={id:"epa-echo",url:ECHO_EXPORT,file:"ECHO_EXPORTER.csv",format:"csv" as const};
  const firstBytes=fixture("echo-exporter-sample.csv"),secondBytes=firstBytes.replace("TITAN CLEANERS & LAUNDRY","TITAN CLEANERS & LAUNDRY UPDATED");
  assert.notEqual(firstBytes,secondBytes);
  for(const [run,body]of [["first-run",firstBytes],["next-run",secondBytes]]) {
    const source=await openArchiveSource(spec,(async()=>new Response(body,{headers:{etag:`"${run}"`}})) as typeof fetch,openDataArchiveStore(vault,run));
    try {for await(const _row of streamCsvObjects(source.textChunks)){}await source.accept?.();}
    finally {await source.dispose();}
  }
  const keys=await vault.list("project/freshness/source/src-so/archive/");
  assert.ok(keys.some(key=>key.includes("/first-run/epa-echo/source.json")));
  assert.ok(keys.some(key=>key.includes("/next-run/epa-echo/source.json")));
});
test("Socrata native facts reach the place reader before portal enrichment on consecutive scheduled runs",async()=>{
  const division="ocd-division/country:us/state:ny",store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore(),repos=createMemoryRepositories();
  const references=new Map<string,OpenDataPartitionRef>();
  const government={id:"government:US-NY:cog:state",nativeIds:{state_fips:"36"},bodyIds:[],associations:[{divisionId:division,geoid:"36",layer:"state",basis:"SOURCE_CODE"}],website:"https://www.ny.gov/"} as unknown as RegistrationGovernmentListing;
  const raw=catalog("ny").rows[0];let nativePublications=0,enrichmentReads=0,learningGaps=0;
  for(const now of [NOW,"2026-10-13T23:24:00.000Z"]) {
    const body=JSON.stringify({results:[raw],resultSetSize:1}),sha256=createHash("sha256").update(body).digest("hex");
    const pages=(async function*(){yield {rows:[raw],total:1,body,url:"https://api.us.socrata.com/api/catalog/v1?limit=1000&scroll_id=",retrievedAt:now,sha256,
      sourceCheck:{requestedUrl:"https://api.us.socrata.com/api/catalog/v1",finalUrl:"https://api.us.socrata.com/api/catalog/v1",httpStatus:200 as const,checkedAt:now,rawHash:sha256}};})();
    const states=(async function*(){yield {state:"NY",fips:"36",divisionId:division,governments:[government]};})();
    await refreshSocrata({pages,states,signal:AbortSignal.timeout(5000),gap:detail=>{if((detail as {work?:string})?.work)learningGaps++;},
      writePartition:async partition=>{const ref=await saveOpenDataPartition({source:"socrata-discovery",...partition,now},vault);references.set(ref.id,ref);},
      saveLeads:async rows=>{if(now!==NOW)throw Error("Learning store is unavailable");await saveSocrataLeads(repos,rows,now);},
      publish:async(reports,capture:OpenDataCapture)=>{
        const publication=await publishOpenData({store,source:"socrata-discovery",rows:[],reports,partitions:[...references.values()],captures:[capture],now,replace:true});
        assert.ok(publication.outcome.promoted || publication.outcome.confirmed);nativePublications++;
      },
      stateWebsite:async()=>null,
      discover:async()=>{
        enrichmentReads++;
        assert.equal(nativePublications,enrichmentReads,"portal requests must follow native publication");
        const read=await readerOpenData({divisionIds:[division]},{store,vault,now,bypassCache:true});
        assert.equal(read.records[0]?.nativeIds.socrata_id,(raw.resource as {id:string}).id);
        assert.equal(read.records[0].capturedAt,now);
        assert.match(openDataText(read.records[0]),/catalog entry/);
        return {bindings:[],gaps:[{governmentId:government.id,url:government.website,reason:"Government website unavailable"}]};
      }});
  }
  assert.equal(nativePublications,2);assert.equal(enrichmentReads,2);assert.equal(learningGaps,1);
});
test("Statewide Socrata publishers bind the exact state parent held by a local-only registration",()=>{
  const root="ocd-division/country:us/state:ct";
  assert.equal(socrataStateDivisionId([{ocdId:`${root}/county:capitol`,parentOcdId:root}],"CT"),root);
  assert.equal(socrataStateDivisionId([{ocdId:`${root}/county:capitol`,parentOcdId:root}],"NY"),undefined);
  assert.equal(socrataStateDivisionId([{ocdId:`${root}/county:capitol`,parentOcdId:null}],"CT"),undefined);
});
test("Portal enrichment moves unresolved catalog counts without deleting an open-set report",async()=>{
  const division="ocd-division/country:us/state:ny",store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore(),refs=new Map<string,OpenDataPartitionRef>();
  const raw=catalog("ny").rows[0],body=JSON.stringify({results:[raw],resultSetSize:1}),sha256=createHash("sha256").update(body).digest("hex");
  const captured:OpenDataReport[][]=[];
  await refreshSocrata({pages:(async function*(){yield {rows:[raw],total:1,body,url:"https://api.us.socrata.com/api/catalog/v1",retrievedAt:NOW,sha256,
    sourceCheck:{requestedUrl:"https://api.us.socrata.com/api/catalog/v1",finalUrl:"https://api.us.socrata.com/api/catalog/v1",httpStatus:200 as const,checkedAt:NOW,rawHash:sha256}};})(),
    states:(async function*(){yield {state:"NY",fips:"36",divisionId:division,governments:[]};})(),signal:AbortSignal.timeout(5000),gap:()=>{},saveLeads:async()=>{},
    writePartition:async partition=>{const ref=await saveOpenDataPartition({source:"socrata-discovery",...partition,now:NOW},vault);refs.set(ref.id,ref);},
    stateWebsite:async()=>"https://www.ny.gov/",
    discover:async(governments,domains)=>({bindings:portalBindingsFromPage(governments[0],"https://www.ny.gov/",'<a href="https://data.ny.gov/">Open data</a>',domains),gaps:[]}),
    publish:async(reports,capture)=>{const result=await publishOpenData({store,source:"socrata-discovery",rows:[],reports,partitions:[...refs.values()],captures:[capture],now:NOW,replace:true});assert.ok(result.outcome.promoted);captured.push(reports);}});
  assert.equal(captured.length,2);
  assert.equal(captured[0].find(row=>row.state==="UNRESOLVED")?.loaded,1);
  assert.equal(captured[1].find(row=>row.state==="UNRESOLVED")?.loaded,0);
  const read=await readerOpenData({divisionIds:[division]},{store,vault,now:NOW,bypassCache:true});assert.equal(read.records.length,1);
});
