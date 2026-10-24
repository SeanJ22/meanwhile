/** Reconstruct only disposable spool metadata from a closed, held EPA source run. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile,readdir,stat,mkdir,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { streamCsvObjects } from "../../lib/sources/prl/streaming.ts";
import { normalizeEcho } from "../../lib/sources/open-data/normalize.ts";
import { facilityCell,facilityPoint } from "../../lib/sources/open-data/geography.ts";
import { zipPartition,type OpenDataPartitionRef,type OpenDataReport } from "../../lib/sources/open-data/model.ts";
import type { OpenDataCapture } from "../../lib/sources/open-data/publication.ts";
import { decodeOpenDataSpoolFact,type OpenDataSpoolPartition,type OpenDataSpoolSchema,type OpenDataSpoolCaptureMetadata } from "../../lib/sources/open-data/spool-reader.ts";
import { US_JURISDICTIONS } from "../../lib/coverage/states.ts";
import { readRegistrationProjection } from "../../lib/registration/reader.ts";
import type { RoutineDataStore } from "../../lib/civic-data/store.ts";
import { DurableEvidenceStore } from "../../lib/control-plane/evidence/durable-store.ts";
import type { EvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import { compressedReplayVault } from "./open-data-replay-vault.mts";

export interface EpaBaselineState {
  state:string;
  result:{state:string;status:string;sourceRows:number;verifiedRows:number;report:OpenDataReport;registration:{kind:string;version?:string};registrationReadMs?:number;materializeMs:number;elapsedMs:number;rejectedRows:number;rejectedExamples:{sourceRow:Record<string,unknown>}[]};
  references:OpenDataPartitionRef[];
  capture:OpenDataCapture;
  vaultRoot:string;
}
export interface EpaHeldSpoolMetadata {
  snapshot:{source:string;target:string;bytes:number;sourceSha256:string;sourceRows:number;spoolSha256:string};
  schemas:OpenDataSpoolSchema[];
  sinks:OpenDataSpoolPartition[];
  metadataById:OpenDataSpoolCaptureMetadata[];
  facts:number;members:number;
  elapsedMs:number;cpuMs:number;
}
export async function readEpaBaselineStates(cache:string,vaultRoot:string):Promise<EpaBaselineState[]> {
  const states:EpaBaselineState[]=[];
  for(const file of await readdir(cache))if(/^reader-state-[0-9a-f]{16}\.json$/.test(file)) {
    const value=JSON.parse(await readFile(join(cache,file),"utf8")) as EpaBaselineState;
    if(value.vaultRoot===vaultRoot)states.push(value);
  }
  states.sort((a,b)=>(a.state==="UNRESOLVED"?"":a.state).localeCompare(b.state==="UNRESOLVED"?"":b.state));
  assert.equal(states.length,90);assert.equal(states.reduce((n,state)=>n+state.result.verifiedRows,0),3_229_294);
  assert.equal(states.reduce((n,state)=>n+state.references.length,0),55_806);
  const capture=JSON.stringify(states[0].capture);
  for(const state of states){assert.equal(state.result.status,"MATERIALIZED");assert.equal(JSON.stringify(state.capture),capture);}
  return states;
}
export async function reconstructEpaHeldSpoolMetadata(snapshotFile:string,distributionFile:string,capture:OpenDataCapture,baseline:readonly EpaBaselineState[]):Promise<EpaHeldSpoolMetadata> {
  const started=performance.now(),cpu=process.cpuUsage();
  const snapshot=JSON.parse(await readFile(snapshotFile,"utf8")) as EpaHeldSpoolMetadata["snapshot"];
  await assert.rejects(stat(snapshot.source),{code:"ENOENT"});
  assert.equal((await stat(snapshot.target)).size,snapshot.bytes);assert.equal(snapshot.sourceSha256,capture.rawHash);
  const distribution=JSON.parse(await readFile(distributionFile,"utf8")) as {archiveHash:string;header:string[]};
  assert.equal(distribution.archiveHash,snapshot.sourceSha256);assert.equal(distribution.header.length,133);
  // The normalizer supplies its exact key layout; the source's saved header supplies all native column names.
  const fixture=await readFile(new URL("../../tests/fixtures/src-so/echo-exporter-sample.csv",import.meta.url),"utf8");
  let sample:ReturnType<typeof normalizeEcho>|undefined;
  for await(const raw of streamCsvObjects((async function*(){yield fixture;})())){sample=normalizeEcho(raw,capture.retrievedAt,capture.archive!.publishedAt);break;}
  assert.ok(sample);const {fields,sourceRow:_sourceRow,...head}=sample;
  const schemas=[Object.keys(head),Object.keys(fields),distribution.header].map(keys=>({keys,keyBytes:keys.reduce((n,key)=>n+Buffer.byteLength(JSON.stringify(key))+1,0)}));
  const sinks=new Map<string,OpenDataSpoolPartition>(),database=new DatabaseSync(snapshot.target,{readOnly:true});
  let facts=0,members=0;
  try {
    database.exec("PRAGMA query_only=ON; PRAGMA cache_size=-32768");
    assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='members_identity'").get());
    let after=0;
    for(;;){
      // Only the first member of each state/location is decoded. Its preceding native reference distinguishes ZIP from cell.
      const batch=database.prepare(`SELECT m.partition_id,m.row_id,m.capture_id,
        (SELECT row_id FROM members prior WHERE prior.sequence=m.sequence-1) AS previous_row_id,f.body
        FROM (SELECT partition_id,min(sequence) AS first_sequence FROM members WHERE partition_id>? GROUP BY partition_id ORDER BY partition_id LIMIT 1000) p
        JOIN members m ON m.sequence=p.first_sequence JOIN facts f ON f.id=m.row_id ORDER BY m.partition_id`).all(after) as unknown as {partition_id:number;row_id:number;capture_id:number;previous_row_id:number|null;body:Uint8Array}[];
      if(!batch.length)break;
      for(const member of batch){
        assert.equal(member.capture_id,0);
        const row=decodeOpenDataSpoolFact(member.body,schemas),state=row.state??"UNRESOLVED";
        assert.equal(row.capturedAt,capture.retrievedAt);assert.equal(row.publishedAt,capture.archive!.publishedAt);
        let partition:string;
        if(member.previous_row_id!==member.row_id)partition=row.zip?`${zipPartition(row.zip)}:state:${state}`:`unlocated:${state}`;
        else {const point=facilityPoint(row);assert.ok(point);partition=`${facilityCell(point.lat,point.lng)}:state:${state}`;}
        const key=JSON.stringify([row.state,partition]);assert.equal(sinks.has(key),false);
        sinks.set(key,{id:member.partition_id,partition,state:row.state});after=member.partition_id;
      }
    }
    facts=Number(database.prepare("SELECT count(*) AS n FROM facts").get()!.n);members=Number(database.prepare("SELECT count(*) AS n FROM members").get()!.n);
    assert.equal(facts,baseline.reduce((n,state)=>n+state.result.verifiedRows,0));
  }finally{database.close();}
  const expected=new Set(baseline.flatMap(state=>state.references.map(reference=>reference.id.replace(/:part:\d+$/,""))));
  assert.equal(sinks.size,expected.size);for(const sink of sinks.values())assert.ok(expected.has(sink.partition));
  const {sourceRows:_rows,...metadata}=capture;
  return {snapshot,schemas,sinks:[...sinks.values()],metadataById:[metadata],facts,members,elapsedMs:performance.now()-started,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000};
}
export const epaMetadataSha256=(metadata:EpaHeldSpoolMetadata)=>createHash("sha256").update(JSON.stringify(metadata)).digest("hex");

export async function cacheEpaBaselineRegistrations(states:readonly EpaBaselineState[],root:string,store:RoutineDataStore):Promise<{states:number;fetched:number;elapsedMs:number}> {
  const started=performance.now();let fetched=0;
  await mkdir(root,{recursive:true,mode:0o700});
  for(const jurisdiction of US_JURISDICTIONS){
    const baseline=states.find(state=>state.state===jurisdiction.usps);assert.ok(baseline);assert.equal(baseline.result.registration.kind,"PROMOTED");
    const file=join(root,`${jurisdiction.usps}.json`);
    let projection:Awaited<ReturnType<typeof readRegistrationProjection>>;
    try{projection=JSON.parse(await readFile(file,"utf8")) as typeof projection;}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;projection=await readRegistrationProjection(jurisdiction.usps,{store,bypassCache:true});fetched++;}
    assert.equal(projection.kind,"PROMOTED",jurisdiction.usps);if(projection.kind!=="PROMOTED")throw Error(`Missing ${jurisdiction.usps} registration.`);
    assert.equal(projection.metadata.versionId,baseline.result.registration.version,`${jurisdiction.usps} registration changed since the full source replay.`);
    await writeFile(file,JSON.stringify(projection),{mode:0o600});
    console.log(JSON.stringify({stage:"held-registration",state:jurisdiction.usps,version:projection.metadata.versionId}));
  }
  return {states:US_JURISDICTIONS.length,fetched,elapsedMs:performance.now()-started};
}

export function epaReplayShard(key:string):0|1 {const digest=/\/([0-9a-f]{64})\.json$/.exec(key)?.[1];assert.ok(digest);return parseInt(digest[0],16)<10?0:1;}
/** Proof storage only: both shards retain every logical byte and its original metadata. */
export function createEpaReplayVault(roots:readonly [string,string],encoding:"raw"|"gzip-level1",timing:{compressionMs:number;decodeAndHashMs?:number}={compressionMs:0}):EvidenceStore {
  const stores=roots.map(root=>encoding==="gzip-level1"?compressedReplayVault(root,timing):new DurableEvidenceStore(root,{remote:null}));
  const store=(key:string)=>stores[epaReplayShard(key)];
  return {
    put:(key,bytes,meta)=>store(key).put(key,bytes,meta),
    get:key=>store(key).get(key),head:key=>store(key).head(key),
    list:async prefix=>[...new Set((await Promise.all(stores.map(value=>value.list(prefix)))).flat())].sort(),
  };
}
