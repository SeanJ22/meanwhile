import assert from "node:assert/strict";
import test from "node:test";
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
