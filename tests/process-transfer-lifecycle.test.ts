import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { collectProcessTransfers } from "../lib/db/transfer-journal.ts";
import { databaseAddress } from "../lib/db/read-target.ts";

const args = ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e"];

test("SIGKILL after the first chunk preserves its bytes before any response completion or child report", async () => {
  const dir = mkdtempSync(join(tmpdir(), "db03-killed-meter-"));
  const script = `
    import {databaseTransferFetch,countNeonBytes} from './lib/db/transfer-by-caller.ts';
    const response = await databaseTransferFetch(async()=>new Response(new ReadableStream({
      pull(c) { c.enqueue(new Uint8Array(8192)); return new Promise(()=>{}); }
    },{highWaterMark:0})),row=>countNeonBytes(row.database,row.responseBytes,Date.now(),{requests:row.requests,bytes:row.requestBytes},undefined,'sample'))
      ('https://db.invalid/sql',{headers:{'neon-connection-string':process.env.DATABASE_URL},body:'select 1'});
    await response.body.getReader().read();
    console.log('CHUNK_COUNTED');
    setInterval(()=>{},1000);
  `;
  const child = spawn(process.execPath, [...args, script], { cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: "postgres://readonly:test@ep-killed.invalid/test", WTP_DATABASE_TRANSFER_DIR: dir, WTP_DATABASE_JOB: "killed-session" },
    stdio: ["ignore", "pipe", "pipe"] });
  let output = "", errors = "";
  child.stderr.on("data", chunk => { errors += chunk; });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error(`child did not read its chunk: ${errors}`)), 20_000);
      child.stdout.on("data", chunk => { output += chunk; if (output.includes("CHUNK_COUNTED")) { clearTimeout(timer); resolve(); } });
      child.once("exit", code => { clearTimeout(timer); reject(Error(`child exited ${code}: ${errors}`)); });
    });
    const ended = once(child, "exit"); child.kill("SIGKILL"); await ended;
    const parts = collectProcessTransfers(dir);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].bytes.reader, 8192);
    assert.equal(parts[0].sent!.reader.requests, 1);
    assert.equal(Object.values(parts[0].reads!).reduce((sum, row) => sum + row[2], 0), 8192);
    assert.equal(output.includes("vital-signs-bytes"), false, "no once-a-minute or exit report rescued these bytes");
  } finally { child.kill("SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
});

test("an unmodified readonly-session client counts its response even when the metric database refuses its writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "db03-readonly-meter-"));
  const body = JSON.stringify({ command: "SELECT", rowCount: 1, fields: [{ name: "value", dataTypeID: 25 }], rows: [["é"]] });
  const script = `
    import {neon,neonConfig} from './lib/db/client.ts';
    neonConfig.fetchFunction=async(_input,init)=>{
      const request=JSON.parse(init.body);
      if(request.queries)return Response.json({message:'permission denied',code:'42501'},{status:403});
      return new Response(${JSON.stringify(body)});
    };
    console.log(JSON.stringify(await neon(process.env.DATABASE_URL).query('select 1')));
  `;
  try {
    const run = spawnSync(process.execPath, [...args, script], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
      env: { ...process.env, DATABASE_URL: "postgres://readonly:test@ep-readonly.invalid/test", WTP_DATABASE_TRANSFER_DIR: dir,
        WTP_DATABASE_JOB: "readonly-session", WTP_VITAL_SIGNS_REPORT: "0" } });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /é/);
    const parts = collectProcessTransfers(dir);
    assert.equal(parts.length, 1);
    assert.equal(parts[0].bytes.reader, Buffer.byteLength(body));
    assert.equal(parts[0].sent!.reader.requests, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("preview HTTP, Pool and Client construction makes zero remote database requests", () => {
  const script = `
    import {neon,neonConfig,Pool,Client} from './lib/db/client.ts';
    let requests=0;neonConfig.fetchFunction=async()=>{requests++;throw Error('network reached');};
    const connectionString='postgres://readonly:test@ep-production.invalid/test';
    let refused=0;
    for(const open of [()=>neon(connectionString),()=>new Pool({connectionString}),()=>new Client({connectionString})]){
      try{open();}catch(e){if(e.message.startsWith('PREVIEW_DATABASE_READ_REFUSED'))refused++;else throw e;}
    }
    console.log(JSON.stringify({requests,refused}));
  `;
  const run = spawnSync(process.execPath, [...args, script], { cwd: process.cwd(), encoding: "utf8", timeout: 20_000,
    env: { ...process.env, CONTEXT: "deploy-preview" } });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { requests: 0, refused: 3 });
});

test("readonly roles and pooled endpoints use the same database identity", () => {
  assert.equal(databaseAddress("postgres://readonly:secret@ep-reader-pooler.neon.tech/neondb"),
    databaseAddress("postgres://writer:other@ep-reader.neon.tech/neondb"));
  assert.notEqual(databaseAddress("postgres://readonly:secret@ep-reader.neon.tech/other"),
    databaseAddress("postgres://writer:other@ep-reader.neon.tech/neondb"));
});

test("separate server module instances share the Admin screen attribution", async () => {
  const original = await import("../lib/db/reader-route.ts");
  const bundled = await import(new URL("../lib/db/reader-route.ts?second-bundle", import.meta.url).href);
  await original.withReaderRoute("admin:now:/api/admin/v6/workers", async () => {
    await Promise.resolve();
    assert.equal(bundled.currentReaderRoute(), "admin:now:/api/admin/v6/workers");
  });
  assert.equal(bundled.currentReaderRoute(), "unattributed");
});
