import type { Sql } from '../repository/pg-store.ts';
import { boundedQuery } from '../repository/request-bounds.ts';
import { WORKER_ROLES } from '../attempt.ts';
import { keeperState } from './state.ts';
import type { Problem } from './model.ts';
import type { LinkCount } from './links.ts';

export interface JobClock {readonly id:string;readonly kind:string;readonly subject:string;readonly state:string;readonly active:boolean;readonly due:string|null;readonly lastRun:string|null;readonly opened:number;readonly occurrence:string|null}
export interface Inventory {readonly jobs:Readonly<Record<string,JobClock>>;readonly workers:Readonly<Record<string,string>>}
export const JOBS_SQL=`SELECT id,value->>'recordClass' kind,value->>'subjectId' subject,value->'scopeDivisions' divisions,
 value->>'active' active,value->>'nextDueAt' due,value->>'lastWorkedAt' last_run,
 value->>'occurrenceCount' opened,value->>'openOccurrenceId' occurrence FROM cp_obligations
 WHERE changed_at >= $1::timestamptz AND changed_at <= greatest($2::timestamptz,statement_timestamp())`;
export const JOBS_SEED_SQL=JOBS_SQL.replace(' WHERE changed_at >= $1::timestamptz AND changed_at <= greatest($2::timestamptz,statement_timestamp())','');
export const WORKERS_SQL=`SELECT role,max(at) at FROM (
 SELECT record->'worker'->>'role' role,recorded_at at FROM cp_log_worker_results
 WHERE recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz
 UNION ALL SELECT value->'worker'->>'role',(value->>'startedAt')::timestamptz FROM cp_attempts
 WHERE changed_at >= $1::timestamptz AND changed_at <= greatest($2::timestamptz,statement_timestamp())
 UNION ALL SELECT record->>'role',recorded_at FROM cp_log_costs
 WHERE recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz AND record->'nonProduction' IS NULL) runs GROUP BY role`;
export const WORKERS_SEED_SQL=WORKERS_SQL.replaceAll('recorded_at >= $1::timestamptz AND recorded_at < $2::timestamptz','true').replace('changed_at >= $1::timestamptz AND changed_at <= greatest($2::timestamptz,statement_timestamp())','true');
export async function readInventory(sql:Sql,from:string,through:string,initialize=false) {
  const args=initialize?[]:[from,through];
  const [jobs,workers]=await Promise.all([
    boundedQuery(sql,{operation:`line-keeper.${initialize?'initialize-':''}jobs`,callClass:'PAGE'},initialize?JOBS_SEED_SQL:JOBS_SQL,args),
    boundedQuery(sql,{operation:`line-keeper.${initialize?'initialize-':''}workers`,callClass:'PAGE'},initialize?WORKERS_SEED_SQL:WORKERS_SQL,args),
  ]) as [Record<string,unknown>[],Record<string,unknown>[]];
  return {jobs:jobs.map((r):JobClock=>({id:String(r.id),kind:String(r.kind),subject:String(r.subject),
    state:keeperState(String(r.subject),String(r.divisions??''))?.toUpperCase()??'US',active:r.active==='true',due:r.due as string|null,
    lastRun:r.last_run as string|null,opened:Number(r.opened??0),occurrence:r.occurrence as string|null})),workers};
}
export function foldInventory(held:Inventory|undefined,delta:Awaited<ReturnType<typeof readInventory>>):Inventory {
  return {jobs:{...held?.jobs,...Object.fromEntries(delta.jobs.map(j=>[j.id,j]))},
    workers:{...held?.workers,...Object.fromEntries(delta.workers.filter(w=>typeof w.role==='string').map(w=>[String(w.role),new Date(String(w.at)).toISOString()]))}};
}
export function inventoryProblems(inventory:Inventory|undefined,links:readonly LinkCount[],at:string):readonly Problem[] {
  if(!inventory)return [{key:'inventory-unread',where:'Scheduled jobs and workers',says:'The compact job and worker inventory is unavailable.',owner:'River',next:'Initialize the inventory and verify the next hourly check.'}];
  const groups=new Map<string,JobClock[]>();
  for(const job of Object.values(inventory.jobs)){
    if(!job.active||job.due&&job.due>at)continue;
    if(job.due===null||!job.lastRun||Date.parse(at)-Date.parse(job.due!)>3_600_000){const key=`${job.state}:${job.kind}`;groups.set(key,[...groups.get(key)??[],job]);}
  }
  const problems:Problem[]=[...groups].map(([key,jobs])=>({key:`job-clock:${key}`,where:`${jobs[0].state} · ${jobs[0].kind}`,
    says:`${jobs.length} active scheduled jobs are overdue or have no clock; ${jobs.filter(j=>j.opened===0).length} have never been dispatched.`,owner:'the runner',
    next:'Restore dispatch and useful output for these jobs, then verify the facts on the live page.',technical:jobs.slice(0,8).map(j=>`${j.id}: ${j.subject}; due ${j.due??'not scheduled'}; last worked ${j.lastRun??'never'}`)}));
  for(const role of WORKER_ROLES){
    const last=inventory.workers[role],waiting=links.some(l=>l.link==='Worker'&&l.kind===role&&l.incoming>0&&l.outgoing===0);
    if(!last||waiting&&Date.parse(at)-Date.parse(last)>3_600_000)problems.push({key:`worker-clock:${role}`,where:'Workers',
      says:last?`${role} has work arriving but has not run within the last hour.`:`The registered ${role} worker has never recorded a run.`,
      owner:['SCOUT','ACQUIRER','DISCOVERY_SEARCH'].includes(role)?'hunters':role==='DETECTIVE'?'diggers':['ENGINEERING','RELEASE_ORCHESTRATOR'].includes(role)?'River':'the runner',next:'Connect this worker to its work and verify useful output through to the live page.'});
  }
  return problems;
}
