/** Optional native engine for isolated source replay databases. Never accepts a remote or production role. */
import pg from "pg";
import { createHash } from "node:crypto";
import { existsSync,mkdirSync,readFileSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Results } from "@electric-sql/pglite";
type NativeReplayDatabase={serializers:Record<number,(value:unknown)=>string>;query:<T=unknown[]>(text:string,params?:unknown[],options?:unknown)=>Promise<Results<T>>;
  exec:(text:string)=>Promise<void>;transaction:<T>(read:(connection:NativeReplayDatabase)=>Promise<T>)=>Promise<T>;close:()=>Promise<void>};

export async function localPostgresReplay(directory:string,connectionFile:string,initialAt:number){
  const connection=readFileSync(connectionFile,"utf8").trim(),url=new URL(connection);
  if(url.protocol!=="postgresql:"||url.hostname!=="127.0.0.1"||url.username!=="src01_replay"||url.pathname!=="/postgres")throw Error("Native replay requires the isolated loopback src01_replay test server");
  const database=`src01_${createHash("sha256").update(directory).digest("hex").slice(0,16)}`;
  const admin=new pg.Client({connectionString:connection});await admin.connect();
  try{
    const exists=(await admin.query("SELECT 1 FROM pg_database WHERE datname=$1",[database])).rows.length>0;
    if(exists&&!existsSync(join(directory,"native-database.json")))await admin.query(`DROP DATABASE "${database}"`);
    if(!exists||!existsSync(join(directory,"native-database.json")))await admin.query(`CREATE DATABASE "${database}"`);
  }finally{await admin.end();}
  mkdirSync(directory,{recursive:true});writeFileSync(join(directory,"native-database.json"),JSON.stringify({engine:"native PostgreSQL",database}));
  url.pathname=`/${database}`;const client=new pg.Client({connectionString:url.href});await client.connect();
  const clock=async(at:number)=>{await client.query("SELECT set_config('src01.replay_at',$1,false),set_config('src01.replay_started_real',statement_timestamp()::text,false)",[new Date(at).toISOString()]);};
  await clock(initialAt);
  // The isolated database observes the same explicit synthetic time as the PGlite host Date proxy.
  // Candidate/history validation functions and their five-minute checks remain unchanged.
  await client.query(`CREATE OR REPLACE FUNCTION pg_catalog.clock_timestamp() RETURNS timestamptz LANGUAGE sql VOLATILE AS
    $$ SELECT current_setting('src01.replay_at')::timestamptz + (statement_timestamp()-current_setting('src01.replay_started_real')::timestamptz) $$`);
  let peakRssBytes=0;
  const db:NativeReplayDatabase={
    serializers:{} as Record<number,(value:unknown)=>string>,
    async query<T=unknown[]>(text:string,params:unknown[]=[],options?:unknown):Promise<Results<T>>{
      const result=(options as {rowMode?:string}|undefined)?.rowMode==="array"
        ?await client.query<unknown[],unknown[]>({text,values:params,rowMode:"array"})
        :await client.query<Record<string,unknown>,unknown[]>({text,values:params});
      return {rows:result.rows as T[],fields:result.fields,affectedRows:result.rowCount??undefined};
    },
    async exec(text:string){await client.query(text);},
    async transaction<T>(read:(connection:NativeReplayDatabase)=>Promise<T>):Promise<T>{
      await client.query("BEGIN");try{const value=await read(db);await client.query("COMMIT");return value;}
      catch(error){await client.query("ROLLBACK");throw error;}
    },
    async close(){
      const result=await client.query("SELECT pg_read_file('/proc/'||pg_backend_pid()||'/status') AS status");
      peakRssBytes=Number(/^VmHWM:\s+(\d+)\s+kB/m.exec(String(result.rows[0]?.status))?.[1]??0)*1024;
      await client.end();
    },
  };
  const drop=async()=>{const cleanup=new pg.Client({connectionString:connection});await cleanup.connect();try{await cleanup.query(`DROP DATABASE "${database}"`);}finally{await cleanup.end();}};
  return {db,clock,drop,peakRssBytes:()=>peakRssBytes};
}
