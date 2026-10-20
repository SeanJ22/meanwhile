import { rmSync } from "node:fs";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import { fieldManualEntryId,type FieldManualEntry } from "../field-manual.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { openHistoryIndex,closeHistoryIndex,type HistoryIndex } from "./streamed-history.ts";
import { stratumOf } from "./audit-stratum.ts";
import type { StratumHistory } from "./audit-sampling.ts";

export type AuditHistoryRepositories=Pick<ControlPlaneRepositories,"workerResults">&Partial<Pick<ControlPlaneRepositories,"fieldManual">>;
type Statement=ReturnType<HistoryIndex["prepare"]>;
type Index=Awaited<ReturnType<typeof openHistoryIndex>>&{through:string|null;generation:number;queue:Promise<void>;statements:Map<string,Statement>};
const indexes=new WeakMap<AuditHistoryRepositories["workerResults"],Promise<Index>>(),openIndexes=new Set<Index>();
process.once("exit",()=>{for(const index of openIndexes){index.db.close();rmSync(temporaryPath(index.directory),{recursive:true,force:true});}});

async function indexFor(repos:AuditHistoryRepositories):Promise<Index>{
  let pending=indexes.get(repos.workerResults);
  if(!pending){
    pending=(async()=>{
      const index={...await openHistoryIndex(),through:null,generation:0,queue:Promise.resolve(),statements:new Map<string,Statement>()}as Index;
      try{index.db.exec(`CREATE TABLE results(log_key TEXT NOT NULL,position INTEGER NOT NULL,id TEXT NOT NULL,ended_at TEXT NOT NULL,role TEXT NOT NULL,stratum TEXT NOT NULL,verdict TEXT NOT NULL,modeled INTEGER NOT NULL,first_seen INTEGER NOT NULL,PRIMARY KEY(log_key,position));
        CREATE INDEX audit_stratum ON results(stratum,first_seen);CREATE INDEX parser_id ON results(id,role,first_seen);
        CREATE TABLE samplers(id TEXT PRIMARY KEY,generation INTEGER NOT NULL);
        CREATE TABLE histories(sampler TEXT NOT NULL,stratum TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(sampler,stratum));`);
      }catch(error){await closeHistoryIndex(index);throw error;}
      openIndexes.add(index);return index;
    })();indexes.set(repos.workerResults,pending);
  }
  return pending;
}

function statement(index:Index,sql:string):Statement{
  let held=index.statements.get(sql);if(!held){held=index.db.prepare(sql);index.statements.set(sql,held);}return held;
}

export async function closeAuditHistoryIndex(repos:AuditHistoryRepositories):Promise<void>{
  const pending=indexes.get(repos.workerResults);if(!pending)return;
  const index=await pending;await index.queue;indexes.delete(repos.workerResults);openIndexes.delete(index);await closeHistoryIndex(index);
}

async function refresh(index:Index,repos:AuditHistoryRepositories):Promise<void>{
  const generation=index.generation+1,insert=statement(index,"INSERT INTO results VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(log_key,position) DO NOTHING");
  const since=index.through===null?null:new Date(Date.parse(index.through)-10*60_000).toISOString();
  const changed=await repos.workerResults.readChangedSince(since,undefined,{projection:{id:true,endedAt:true,result:["role","verdict"],modelParse:[],modelReview:[],
    completion:{completedTask:{workerTask:{contract:{schemaVersion:true,recordClass:true,publisherSlug:true,sourceScope:["publisher","canonicalUrls"]}}}}},page:rows=>{
    for(const {key,position,record}of rows){
      const role=record.result.role;
      if(role!=="PARSER"&&role!=="ADVERSARIAL_AUDITOR")continue;
      const contract=record.completion?.completedTask?.workerTask?.contract;
      if(role==="ADVERSARIAL_AUDITOR"&&!contract)continue;
      insert.run(key,position,record.id,record.endedAt??"",role,contract?stratumOf(contract):"",String(record.result.verdict),
        (role==="PARSER"?record.modelParse!==undefined:record.modelReview!==undefined)?1:0,generation);
    }
  }});
  index.through=changed.through;index.generation=generation;
}

type HistoryRow={id:string;ended_at:string;log_key:string;position:string;verdict:string;modeled:string};
function compare(a:HistoryRow,b:HistoryRow):number{return a.ended_at.localeCompare(b.ended_at)||a.id.localeCompare(b.id)||
  (a.log_key<b.log_key?-1:a.log_key>b.log_key?1:Number(a.position)-Number(b.position));}

function durableHistory(index:Index,stratum:string,generation:number):StratumHistory|undefined{
  const rows=()=>statement(index,"SELECT id,ended_at,log_key,position,verdict,modeled FROM results WHERE role='ADVERSARIAL_AUDITOR' AND stratum=? AND first_seen<=?").iterate(stratum,generation)as Iterable<HistoryRow>;
  let reviewed=0,found=false,lastBreak:HistoryRow|undefined;
  for(const row of rows()){found=true;reviewed+=Number(row.modeled);if(row.verdict==="BROKE"&&(!lastBreak||compare(row,lastBreak)>0))lastBreak=row;}
  if(!found)return undefined;
  let survivedSinceBreak=0;
  for(const row of rows())if(row.verdict==="SURVIVED"&&(!lastBreak||compare(row,lastBreak)>0))survivedSinceBreak++;
  return{reviewed,survivedSinceBreak,everBroken:lastBreak!==undefined};
}

async function manualHistory(repos:AuditHistoryRepositories,stratum:string):Promise<StratumHistory|undefined>{
  if(!repos.fieldManual)return undefined;
  const row=await repos.fieldManual.readNarrowed(fieldManualEntryId("auditor-learning",`stratum|${stratum}`),{kind:true,outcome:true,payload:["recordClass","host","modelReviewed"]});
  if(!row)return undefined;
  const entry=row.value as Pick<FieldManualEntry,"kind"|"outcome"|"payload">,payload=(entry.payload??{})as Record<string,unknown>;
  if(entry.kind!=="AUDIT_STRATUM"||typeof payload.recordClass!=="string"||typeof payload.host!=="string"||`${payload.recordClass}|${payload.host}`!==stratum)return undefined;
  return{reviewed:payload.modelReviewed===true?1:0,survivedSinceBreak:entry.outcome==="YIELDED"?1:0,everBroken:entry.outcome==="FAILED"};
}

/** A sampler's first durable snapshot and its burst counts live on disk, shared across all host workers. */
export async function withIndexedAuditSample<T>(repos:AuditHistoryRepositories,input:{readonly samplerId:string;readonly stratum:string;readonly producerResultId:string|null|undefined},
  decide:(history:StratumHistory|undefined,quoted:boolean)=>{readonly value:T;readonly count:boolean}):Promise<T>{
  const index=await indexFor(repos);
  const pending=index.queue.then(async()=>{
    let snapshot=statement(index,"SELECT generation FROM samplers WHERE id=?").get(input.samplerId);
    if(!snapshot){await refresh(index,repos);statement(index,"INSERT INTO samplers VALUES(?,?)").run(input.samplerId,index.generation);snapshot={generation:String(index.generation)};}
    const generation=Number(snapshot.generation),saved=statement(index,"SELECT body FROM histories WHERE sampler=? AND stratum=?").get(input.samplerId,input.stratum);
    const history=saved?(JSON.parse(saved.body)as StratumHistory|null)??undefined:durableHistory(index,input.stratum,generation)??await manualHistory(repos,input.stratum);
    const quoted=statement(index,"SELECT modeled FROM results WHERE role='PARSER' AND id=? AND first_seen<=? ORDER BY log_key DESC,position DESC LIMIT 1").get(input.producerResultId??"",generation)?.modeled;
    const decision=decide(history,Number(quoted??0)>0),next=decision.count?{reviewed:(history?.reviewed??0)+1,survivedSinceBreak:history?.survivedSinceBreak??0,everBroken:history?.everBroken??false}:history;
    statement(index,"INSERT INTO histories VALUES(?,?,?) ON CONFLICT(sampler,stratum) DO UPDATE SET body=excluded.body").run(input.samplerId,input.stratum,JSON.stringify(next??null));
    return decision.value;
  });
  index.queue=pending.then(()=>undefined,()=>undefined);return pending;
}
