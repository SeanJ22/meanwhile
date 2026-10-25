import { requireBallotState } from '../civic-data/state-scopes.ts';
import { runtimeCivicReadCache, type CivicReadCache } from '../db/civic-read-cache.ts';
import { placeReadConnection, readDatabaseIdentity } from '../control-plane/repository/pg-store.ts';
import { UnknownAggregate,jsonTextAtPath,projectAggregate,type ControlPlaneRepositories,type Persisted } from '../control-plane/repository/types.ts';
import type { DoorRecord,DoorRepository } from './registry.ts';

type Repositories=Pick<ControlPlaneRepositories,'doors'>;

/** Each run asks for this state's current IDs/revisions. Only changed door values leave Neon. */
export async function readVotingDoorState(repos:Repositories,state:string,cache:CivicReadCache|null=runtimeCivicReadCache()):Promise<readonly Persisted<DoorRecord>[]> {
  const code=requireBallotState(state),field=`votingState_${code}`;
  const sql=placeReadConnection(repos as ControlPlaneRepositories),database=readDatabaseIdentity(repos);
  if(!sql||!database)return repos.doors.listWhere(['config',field],'true');
  const versions=await sql.query(`SELECT id,revision FROM cp_doors WHERE value #>> '{config,${field}}'='true' ORDER BY id`) as {id:string;revision:number}[];
  const values=async(ids:readonly string[])=>{
    const rows=await sql.query('SELECT id,revision,updated_at,value FROM cp_doors WHERE id=ANY($1::text[]) ORDER BY id',[ids]) as {id:string;revision:number;updated_at:string;value:DoorRecord}[];
    return rows.map(row=>({id:row.id,revision:Number(row.revision),updatedAt:new Date(row.updated_at).toISOString(),value:row.value}));
  };
  const keys=versions.map(row=>row.id);
  const rows=cache?await cache.rows({namespace:`cp-doors:${database}`,keys,versions:async ids=>versions.filter(row=>ids.includes(row.id)).map(row=>({key:row.id,etag:String(row.revision)})),
    values,keyOf:row=>row.id,etagOf:row=>String(row.revision)}):keys.length?await values(keys):[];
  return rows.filter(row=>jsonTextAtPath(row.value,['config',field])==='true');
}

/** One state's snapshot is shared by registration, ordering and all outcome writes in this run.
 * CAS conflicts discard the held row before retrying; another process's newer data is never overwritten.
 */
export async function doorRepositoryForRun(repos:Repositories,state:string,cache?:CivicReadCache|null):Promise<DoorRepository> {
  const code=requireBallotState(state),field=`votingState_${code}`,base=repos.doors;
  const rows=new Map((await readVotingDoorState(repos,code,cache)).map(row=>[row.id,row]));
  const absent=new Set<string>(),queries=new Map<string,Promise<void>>();
  let refresh=false;
  const remember=(row:Persisted<DoorRecord>)=>{if(row.revision>=(rows.get(row.id)?.revision??0))rows.set(row.id,structuredClone(row));absent.delete(row.id);};
  const read=async(id:string):Promise<Persisted<DoorRecord>|null>=>{
    if(rows.has(id))return structuredClone(rows.get(id)!);
    if(absent.has(id))return null;
    const row=await base.read(id);if(row)remember(row);else absent.add(id);return row;
  };
  const list=async()=>[...rows.values()].filter(row=>jsonTextAtPath(row.value,['config',field])==='true').sort((a,b)=>a.id.localeCompare(b.id)).map(row=>structuredClone(row));
  const listWhere=async(path:readonly string[],value:string)=>{
    const own=path.join('.')===`config.${field}`&&value==='true';
    const key=JSON.stringify([path,value]);
    if(!own&&!queries.has(key)){
      const known=!refresh&&path.join('.')==='config.url'&&[...rows.values()].some(row=>jsonTextAtPath(row.value,path)===value);
      const query=known?Promise.resolve():base.listWhere(path,value).then(found=>{for(const row of found)remember(row);refresh=false;});
      queries.set(key,query.catch(error=>{queries.delete(key);throw error;}));
    }
    if(queries.has(key))await queries.get(key);
    return [...rows.values()].filter(row=>jsonTextAtPath(row.value,path)===value).sort((a,b)=>a.id.localeCompare(b.id)).map(row=>structuredClone(row));
  };
  const repo:DoorRepository={...base,read,list,listWhere,
    async mustRead(id){const row=await read(id);if(!row)throw new UnknownAggregate('Door',id);return row;},
    async readNarrowed(id,projection){const row=await read(id);return row?{...row,value:projectAggregate(row.value,projection)}:null;},
    async listNarrowed(projection){return (await list()).map(row=>({...row,value:projectAggregate(row.value,projection)}));},
    async listWhereNarrowed(path,value,projection){return (await listWhere(path,value)).map(row=>({...row,value:projectAggregate(row.value,projection)}));},
    async put(id,value,at){try{const result=await base.put(id,value,at);remember(result.persisted);return result;}
      catch(error){rows.delete(id);absent.delete(id);queries.clear();refresh=true;throw error;}},
    async compareAndSet(id,revision,value,at){try{const row=await base.compareAndSet(id,revision,value,at);remember(row);return row;}
      catch(error){rows.delete(id);absent.delete(id);queries.clear();refresh=true;throw error;}},
    async readMany(ids){const out=await Promise.all([...new Set(ids)].map(read));return out.filter((row):row is Persisted<DoorRecord>=>row!==null);},
  };
  return repo;
}
