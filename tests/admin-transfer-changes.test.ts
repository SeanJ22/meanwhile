import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { adminChangesFetch } from "../lib/db/admin-changes.ts";
import { withReaderRoute } from "../lib/db/reader-route.ts";
import { currentReaderRoute } from "../lib/db/reader-route.ts";
import { adminRead } from "../lib/control-plane/admin-read.ts";

test('Admin attribution follows asynchronous reads and the visible screen',async()=>{
  const read=adminRead(async(request:Request,context:{id:string})=>{
    await Promise.resolve();return {route:currentReaderRoute(),id:context.id};
  });
  assert.deepEqual(await read(new Request('https://admin.example/api/admin/v6/doors',{headers:{'x-admin-screen':'workers'}}),{id:'one'}),
    {route:'admin:workers:/api/admin/v6/doors',id:'one'});
  assert.equal((await read(new Request('https://admin.example/api/admin/v6/brief',{headers:{referer:'https://admin.example/admin?view=reports'}}),{id:'two'})).route,
    'admin:brief:/api/admin/v6/brief');
});

test("Admin changed reads preserve types, order, changed parameters, removals and failed reads", async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE records(id text PRIMARY KEY,n bigint,value jsonb,flag boolean);
    INSERT INTO records VALUES ('a',9007199254740993,'{"note":"first"}',true),('b',2,'{"note":"second"}',false);`);
  const wire: { query:string; bytes:number; delta:unknown }[] = [];
  const underlying: typeof fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    const run = async ({query,params=[]}:{query:string;params?:unknown[]}) => {
      const result = await db.query(query,params,{parsers:{16:v=>v,20:v=>v,114:v=>v,3802:v=>v}});
      return { command:"SELECT",rowCount:result.rows.length,fields:result.fields,
        rows:result.rows.map(row=>result.fields.map(field=>{
          const value=(row as Record<string,unknown>)[field.name];
          return value===null?null:String(value);
        })) };
    };
    try {
      const result = request.queries ? {results:await Promise.all(request.queries.map(run))} : await run(request);
      const body = JSON.stringify(result);
      wire.push({query:request.query,bytes:Buffer.byteLength(body),delta:'rows' in result&&request.query.includes('__mw_admin_index')?JSON.parse(result.rows[0][0]!):null});
      return new Response(body,{headers:{'content-type':'application/json'}});
    } catch(error) { return new Response(JSON.stringify({message:String(error)}),{status:400}); }
  };
  const changed = adminChangesFetch(underlying);
  assert.equal(adminChangesFetch(changed),changed,'server bundles share one changed-read transport');
  const headers={'neon-raw-text-output':'true','neon-array-mode':'true','neon-connection-string':'postgres://local.invalid/testing'};
  const read = (query:string,params:unknown[]=[]) => withReaderRoute('admin:now:test',async()=>{
    const response=await changed('https://db.invalid/sql',{headers,body:JSON.stringify({query,params})});
    assert.equal(response.status,200);
    return response.json();
  });
  const query='SELECT id,n,value,flag FROM records WHERE id >= $1 ORDER BY id';
  const before = await read(query,['a']);
  const again = await read(query,['a']);
  assert.deepEqual(again,before);
  assert.deepEqual((wire.at(-1)!.delta as {changed:unknown[]}).changed,[]);
  await db.exec(`UPDATE records SET value='{"note":"changed é"}' WHERE id='b'`);
  const updated=await read(query,['a']);
  assert.equal(JSON.parse(updated.rows[1][2]).note,'changed é');
  assert.equal((wire.at(-1)!.delta as {changed:unknown[]}).changed.length,1);
  assert.equal(updated.rows[0][1],'9007199254740993');
  assert.equal(updated.rows[0][3],'t');
  const narrowed=await read(query,['b']);
  assert.deepEqual(narrowed.rows,[updated.rows[1]],'changed filters remove rows from the answer');
  await db.exec("DELETE FROM records WHERE id='b'");
  assert.deepEqual((await read(query,['a'])).rows,[before.rows[0]]);
  await db.exec("ALTER TABLE records RENAME TO unavailable");
  const failed=await withReaderRoute('admin:now:test',()=>changed('https://db.invalid/sql',{headers,body:JSON.stringify({query,params:['a']})}));
  assert.equal(failed.status,400,'a failed current read never substitutes the held result');
  await db.close();
});

test("unchanged wide rows never cross the wire again, with screen and database isolation",async()=>{
  const db=new PGlite();
  await db.exec("CREATE TABLE rows(id text,value text); INSERT INTO rows VALUES('a',repeat('a',100000)),('b',repeat('b',100000))");
  const sizes:number[]=[];
  const fetcher=adminChangesFetch(async(_input,init)=>{
    const {query,params}=JSON.parse(String(init?.body));const r=await db.query(query,params);
    const body=JSON.stringify({command:'SELECT',rowCount:r.rows.length,fields:r.fields,rows:r.rows.map(row=>r.fields.map(f=>{
      const value=(row as Record<string,unknown>)[f.name];return typeof value==='object'?JSON.stringify(value):String(value);
    }))});sizes.push(Buffer.byteLength(body));return new Response(body);
  });
  const read=(screen:string,database='one')=>withReaderRoute(`admin:${screen}:rows`,async()=>{
    return (await fetcher('https://db.invalid/sql',{headers:{'neon-raw-text-output':'true','neon-array-mode':'true','neon-connection-string':database},body:JSON.stringify({query:'SELECT id,value FROM rows ORDER BY id',params:[]})})).json();
  });
  const first=await read('now');assert.deepEqual(await read('now'),first);
  assert.ok(sizes[0]>200000);assert.ok(sizes[1]<500,`actual unchanged response: ${sizes[1]} bytes`);
  await read('money');assert.ok(sizes[2]>200000);
  await read('now','two');assert.ok(sizes[3]>200000);
  await db.close();
});
