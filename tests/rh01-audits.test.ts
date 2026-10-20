import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { measuredCompletion } from "../scripts/rh01-completion.mts";

test("look completion requires every real target, retained screenshots and durable local publication, and names an absent reviewer", () => {
  const receipt = { sha: "a".repeat(40), runId: "actual-browser-run", durable: true, exactTargets: true,
    expectedScreens: 8, screens: 8, shots: 8, reviewer: "NOT_RUN", reviewerSays: "no model", red: 0, green: 0, notReviewed: 8 };
  const check = (row: typeof receipt | null) => measuredCompletion({ script: "scripts/look-pass.mts", code: 0, timedOut: false,
    stdout: row ? `RH01_LOOK_RESULT ${JSON.stringify(row)}` : "look pass: deploy aaaaaaaa is not reviewed", stderr: "" });
  assert.equal(check(receipt).complete, true);
  assert.equal(check(receipt).successful, false);
  assert.match(check(receipt).reason, /reviewer NOT_RUN/);
  assert.equal(check(null).complete, false);
  for (const partial of [{ durable: false }, { exactTargets: false }, { expectedScreens: 0 }, { screens: 7 }, { shots: 7 }])
    assert.equal(check({ ...receipt, ...partial }).complete, false);
});

test("native look and claim scheduling markers and screenshots stay local while other history and owner controls remain production reads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-audit-local-")), root = process.cwd();
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await symlink(join(root, "node_modules"), join(directory, "node_modules"), "dir");
    const preload = join(directory, "production-fixture.mjs");
    await writeFile(preload, `import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';
      import {pathToFileURL} from 'node:url';import {join} from 'node:path';
      const code=file=>import(pathToFileURL(join(${JSON.stringify(root)},file)).href);
      const [{defaultAdminConfig,ADMIN_CONFIG_ID},{weekOf},{shadowRead}]=await Promise.all([
        code('lib/control-plane/gateway/admin-config.ts'),code('lib/control-plane/workers/claim-audit.ts'),code('scripts/rh01-sql.mts')]);
      const db=new PGlite(),now=new Date().toISOString(),week=weekOf(now),priorWeek=weekOf(new Date(Date.parse(now)-7*86400000).toISOString());
      await db.exec('CREATE TABLE cp_log_heads(log_table text,log_key text,next_position bigint,PRIMARY KEY(log_table,log_key)); CREATE TABLE cp_log_live_audits(log_key text,record_id text,position bigint,recorded_at timestamptz,record jsonb,changed_at timestamptz DEFAULT now(),PRIMARY KEY(log_key,record_id)); CREATE TABLE cp_admin_config(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz DEFAULT now())');
      const config=defaultAdminConfig(now);config.updates=[{id:'fix-status:held-method:proven:'+now,what:'The recorded method worked in zero places.',at:now,label:'PROVEN',evidenceHref:null,before:null,after:null,shownAt:null,claim:{kind:'FIX_PROVEN',methodId:'held-method',works:0,failed:0}}];
      await db.query('INSERT INTO cp_admin_config VALUES($1,19,$2,$3::jsonb,now())',[ADMIN_CONFIG_ID,now,JSON.stringify(config)]);
      const add=async(key,id,record)=>db.query('INSERT INTO cp_log_live_audits VALUES($1,$2,0,$3,$4::jsonb,now())',[key,id,now,JSON.stringify(record)]);
      for(const selected of [week,priorWeek])await add('claims:'+selected,'existing-claims:'+selected,{kind:'CLAIMS',pass:{at:now,week:selected,checks:[],synthetic:false}});
      for(const sha of ['a'.repeat(40),'b'.repeat(40)])await add('looked','existing-look:'+sha,{kind:'LOOKED',sha,at:now,verdict:'green'});
      await db.query('INSERT INTO cp_log_heads VALUES($1,$2,37),($1,$3,41),($1,$4,43)',['cp_log_live_audits','claims:'+week,'looked','look:'+'a'.repeat(40)]);
      const snapshot=async()=>JSON.stringify((await db.query('SELECT record FROM cp_log_live_audits ORDER BY log_key,record_id')).rows)+JSON.stringify((await db.query('SELECT * FROM cp_log_heads ORDER BY log_key')).rows)+JSON.stringify((await db.query('SELECT * FROM cp_admin_config')).rows);
      const before=await snapshot();
      globalThis.fetch=async(url,init)=>{
        assert.equal(String(url).startsWith('https://api.'),true,'unexpected non-database request');
        const body=JSON.parse(init.body);shadowRead(body.query,body.params,[]);
        const result=await db.query(body.query,body.params);assert.equal(await snapshot(),before,'production fixture mutated');
        return Response.json({command:'SELECT',rowCount:result.rows.length,fields:result.fields,
          rows:result.rows.map(row=>result.fields.map(field=>field.dataTypeID===3802?JSON.stringify(row[field.name]):row[field.name]))});
      };`);
    server = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--import", preload, "scripts/rh01-facts-server.mts"], {
      cwd: root, env: { NODE_ENV: "test", PATH: process.env.PATH, WTP_RH01_CODE_ROOT: root, WTP_RH01_DIRECTORY: directory,
        WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:fixture@ep-control.neon.invalid/db",
        WTP_PRODUCTION_DATABASE_URL_READONLY: "postgresql://readonly:fixture@ep-reader.neon.invalid/db" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let serverError = ""; server.stderr!.on("data", data => { serverError += data; });
    const endpoint = await new Promise<string>((accept, reject) => {
      let output = "";
      server!.stdout!.on("data", data => { output += data; const line = output.split("\n").find(value => value.startsWith("RH01_FACTS_READY ")); if (line) accept(JSON.parse(line.slice(17)).url); });
      server!.once("exit", code => reject(Error(`fixture coordinator exited ${code}: ${serverError}`)));
    });
    const source = `import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
      const root=${JSON.stringify(root)},code=file=>import(pathToFileURL(join(root,file)).href),now=new Date().toISOString();
      const [{createPgRepositories},{auditDueRepositories},{recordLookPass,hasLookedCommit,readRecentClaimPasses},{lookTargets,lookPass,lookShotKey},{storeRunScreenshot},{weekOf,runClaimAuditWeek},{ADMIN_CONFIG_ID}]=await Promise.all([
        code('lib/control-plane/repository/pg-store.ts'),code('scripts/rh01-readonly-runtime.mts'),code('lib/control-plane/live-audit-log.ts'),code('lib/frontend/look-pass.ts'),code('lib/photos/store.ts'),code('lib/control-plane/workers/claim-audit.ts'),code('lib/control-plane/gateway/admin-config.ts')]);
      const repos=await createPgRepositories(process.env.WTP_CONTROL_PLANE_DATABASE_URL,now,{skipBootstrap:true}),sha='a'.repeat(40),other='b'.repeat(40);
      process.argv=[process.execPath,join(root,'scripts/look-pass.mts')];
      assert.equal(await hasLookedCommit(repos,sha),true);
      const lookRepos=auditDueRepositories(repos,{kind:'LOOK',sha});
      assert.equal(await hasLookedCommit(lookRepos,sha),false);assert.equal(await hasLookedCommit(lookRepos,other),true);
      assert.deepEqual((await lookRepos.liveAudits.read('looked')).filter(row=>row.kind==='LOOKED').map(row=>row.sha),[other]);
      const shots=[];for(const target of lookTargets(['85701'])){
        const shot=lookShotKey(sha,now,target);await storeRunScreenshot(shot,new Uint8Array([1,2,3]));
        await storeRunScreenshot(shot,new Uint8Array([9]));assert.deepEqual([...await readFile(join(process.env.WTP_RH01_DIRECTORY,'screenshots',shot))],[1,2,3]);
        shots.push({target,shot,issues:{},issueLines:[],failed:null});
      }
      await assert.rejects(storeRunScreenshot('resident-tasks/../../escape',new Uint8Array([1])),/OUTSIDE_PREFIX/);
      await assert.rejects(storeRunScreenshot('resident-tasks/../escape',new Uint8Array([1])),/OUTSIDE_PREFIX/);
      const pass=lookPass({sha,at:now,runId:'native-look-fixture',shots,reviewed:shots,outcome:{kind:'NOT_RUN',why:'no-model'}});
      await recordLookPass(repos,pass);assert.equal(await hasLookedCommit(lookRepos,sha),true);
      process.argv=[process.execPath,join(root,'scripts/claim-audit-pass.mts')];
      const week=weekOf(now),priorWeek=weekOf(new Date(Date.parse(now)-7*86400000).toISOString());
      assert.equal((await readRecentClaimPasses(repos,[week])).length,0);assert.equal((await readRecentClaimPasses(repos,[priorWeek])).length,1);
      const controls=await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID,{apiFallback:true,settings:true,updates:true});
      let reads=0;const fixMap={forMethod:async id=>{assert.equal(id,'held-method');reads++;return [];}};
      const first=await runClaimAuditWeek(repos,fixMap,now);assert.equal(first.ran,true);assert.deepEqual(first.pass.checks.map(check=>check.verdict),['CONFIRMED']);assert.equal(reads,1);
      assert.equal((await runClaimAuditWeek(repos,fixMap,now)).ran,false);assert.equal((await readRecentClaimPasses(repos,[priorWeek])).length,1);
      assert.deepEqual(await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID,{apiFallback:true,settings:true,updates:true}),controls);
      console.log('native-audit-local-lifecycle-complete');`;
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--import", "./scripts/rh01-loader.mjs", "--input-type=module", "-e", source], {
      cwd: root, env: { NODE_ENV: "test", PATH: process.env.PATH, NODE_OPTIONS: "", WTP_RH01_DIRECTORY: directory, WTP_RH01_CODE_ROOT: root,
        WTP_RH01_HARNESS_ROOT: root, WTP_RH01_FACTS_URL: endpoint,
        WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://wtp_cp_release_readonly:local-only@127.0.0.1:1/rh01",
        WTP_PRODUCTION_DATABASE_URL_READONLY: "postgresql://readonly:fixture@ep-reader.neon.invalid/db" }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = ""; child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    const [status] = await once(child, "close"); assert.equal(status, 0, stderr + serverError + stdout);
    assert.match(stdout, /native-audit-local-lifecycle-complete/);
    const completion = measuredCompletion({ script: "scripts/look-pass.mts", code: 0, timedOut: false, stdout, stderr });
    assert.equal(completion.complete, true, completion.reason); assert.equal(completion.successful, false); assert.match(completion.reason, /reviewer NOT_RUN/);
    assert.equal((await readFile(join(directory, "screenshots", "resident-tasks", "look", new Date().toISOString().slice(0, 10), "a".repeat(12), "home-85701-phone.png"))).length, 3);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const closed = once(server, "close"); server.kill("SIGTERM"); await closed; }
    await rm(directory, { recursive: true, force: true });
  }
});
