/** Native PostgreSQL reader protocol for the isolated replay; no HTTP/stdio JSON copies. */
import pg from "pg";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import type {ReadOnlyQuery} from "../../lib/control-plane/admin-view/promoted-slices.ts";

export async function localPostgresReader(directory:string,connectionFile:string,now:()=>number=Date.now){
  const url=new URL((await readFile(connectionFile,"utf8")).trim());
  if(url.protocol!=="postgresql:"||url.hostname!=="127.0.0.1"||url.username!=="src01_replay"||url.pathname!=="/postgres")throw Error("Native reader requires the isolated loopback src01_replay test server");
  const metadata=JSON.parse(await readFile(join(directory,"native-database.json"),"utf8")) as {database?:string};
  if(!metadata.database||!/^src01_[a-f0-9]{16}$/.test(metadata.database))throw Error("Native reader requires a generated local replay database");
  url.pathname=`/${metadata.database}`;
  const pool=new pg.Pool({connectionString:url.href,max:2,options:"-c default_transaction_read_only=on -c jit=off"});
  const metrics={requests:0,statements:0,elapsedMs:0,queries:[] as {rows:number;scopes:number;elapsedMs:number}[],transport:"native binary PostgreSQL protocol; two connections for two bounded batches (production maximum four); loopback substitutes for production WebSocket/TLS/network"};
  const query:ReadOnlyQuery=async statements=>{
    const started=performance.now(),client=await pool.connect();
    try{
      await client.query("BEGIN READ ONLY");
      await client.query("SELECT set_config('src01.replay_at',$1,true),set_config('src01.replay_started_real',statement_timestamp()::text,true)",[new Date(now()).toISOString()]);
      const rows=[];
      for(const statement of statements){
        const queryStarted=performance.now(),result=await client.query(statement.text,[...statement.params]);rows.push(result.rows);
        metrics.queries.push({rows:result.rows.length,scopes:Array.isArray(statement.params[0])?statement.params[0].length:0,elapsedMs:Math.round(performance.now()-queryStarted)});
      }
      await client.query("COMMIT");metrics.requests++;metrics.statements+=statements.length;
      return rows;
    }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
    finally{metrics.elapsedMs+=performance.now()-started;client.release();}
  };
  return {query,metrics,close:()=>pool.end()};
}
