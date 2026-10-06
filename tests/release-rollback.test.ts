import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { appendReceipt, findReceipt } from "../lib/control-plane/gateway/receipts.ts";
import type { ActionReceipt } from "../lib/control-plane/gateway/contract.ts";
import { releaseRollbackAction } from "../lib/control-plane/gateway/release-rollback-action.ts";
import { executeQueuedRollback, rollbackCompatibility, rollbackView, type RollbackAdapter, type RollbackMigration } from "../lib/ops/release-rollback.ts";
import { netlifyRollbackAdapter, readRollbackCatalog } from "../lib/ops/release-rollback-netlify.ts";

const sha = "a".repeat(40), olderSha = "b".repeat(40), h = "c".repeat(64), h2 = "d".repeat(64);
const current = { id: "current-deploy", sha, publishedAt: "2026-10-06T00:00:00Z" };
const earlier = { id: "earlier-deploy", sha: olderSha, publishedAt: "2026-10-05T00:00:00Z" };
const expand: RollbackMigration = { when: 1, tag: "0000_expand", hash: h, phase: "expand" };
const contract: RollbackMigration = { when: 2, tag: "0001_contract", hash: h2, phase: "contract" };
const view = () => rollbackView({ current, applied: [{ when: 1, hash: h }], catalog: [expand], candidates: [{ deploy: earlier, catalog: [expand] }] });
const now = () => "2026-10-06T00:01:00Z";
const request: ActionReceipt = { formatVersion: 1, receiptId: "release.rollback:one", idempotencyKey: "one", type: "release.rollback", label: "Restore an earlier release",
  authority: "OWNER_DECISION_REQUIRED", subjectKind: "production release", subject: earlier.id, inputDigest: h, caller: "OWNER_SESSION", actorRef: "session:owner",
  stateVersion: null, codeSha: sha, startedAt: now(), completedAt: now(), outcome: "QUEUED", says: "Queued", refusal: null, openedWork: [], readBackAt: "/admin?view=queue", undo: null,
  change: { before: current.id, after: earlier.sha } };

test("DB-47 offers only code retaining every applied contract, with exact immutable bytes", () => {
  const applied = [{ when: 1, hash: h }, { when: 2, hash: h2 }];
  assert.equal(rollbackCompatibility(applied,[expand,contract],[expand,contract]),null);
  assert.match(rollbackCompatibility(applied,[expand,contract],[expand])!,/predates.*contract/);
  assert.match(rollbackCompatibility(applied,[expand,contract],[expand,{...contract,hash:h}])!,/predates.*contract/);
  assert.match(rollbackCompatibility([{when:9,hash:h}],[expand],[expand])!,/cannot be matched/);
  assert.match(rollbackCompatibility([{when:1,hash:h}],[expand],[expand,contract])!,/absent or changed/);
  assert.match(rollbackCompatibility([{when:1,hash:h},{when:1,hash:h}],[expand],[expand])!,/contradictory/);
});

test("DB-47 normal Send queues an exact compatible request; stale migration or release views refuse", async () => {
  const action = releaseRollbackAction(async () => view());
  const validated = action.validate({deployId:earlier.id,sha:olderSha,expectedVersion:view().version});assert.ok(validated.ok);
  const context = { request: {} as never, receiptId: request.receiptId, at: now() };
  const deps = {repos:createMemoryRepositories(),now,currentStateVersion:null,codeSha:sha};
  const result = await action.execute(deps,context,validated.value);
  assert.ok(result.ok);assert.equal(result.outcome,"QUEUED");assert.deepEqual(result.change,{before:current.id,after:olderSha});
  const stale = await action.execute(deps,context,{...validated.value,expectedVersion:h});assert.ok(!stale.ok);assert.equal(stale.refusal,"STALE_STATE");
  assert.equal(action.validate({deployId:"../../wrong",sha:olderSha,expectedVersion:h}).ok,false);
  const unread = releaseRollbackAction(async () => ({current:null,version:null,choices:[],says:"Unavailable"}));
  const refusal = await unread.execute(deps,context,validated.value);assert.ok(!refusal.ok);assert.equal(refusal.refusal,"DOWNSTREAM_REFUSED");
});

test("DB-47 concurrent runner calls restore once and read the result from the standard receipt history", async () => {
  const repos = createMemoryRepositories();assert.ok((await appendReceipt(repos,request,now())).ok);
  let posts=0, live=current;
  const adapter: RollbackAdapter = {read:async()=>view(),confirm:async()=>true,published:async()=>live,restore:async()=>{posts++;live=earlier;return "accepted";}};
  const results = await Promise.all([executeQueuedRollback(repos,request.receiptId,adapter,now),executeQueuedRollback(repos,request.receiptId,adapter,now)]);
  assert.equal(posts,1);assert.ok(results.some(row=>row.state==="DONE"));
  assert.equal((await executeQueuedRollback(repos,request.receiptId,adapter,now)).state,"DONE");assert.equal(posts,1);
  assert.equal((await findReceipt(repos,`${request.receiptId}:rollback-result`))?.change?.after,olderSha);
});

test("DB-47 an applied contract arriving after Send or a moving publication pointer makes no restore request", async () => {
  for (const changed of ["schema","publication"]) {
    const repos=createMemoryRepositories();await appendReceipt(repos,request,now());let posts=0;
    const changedView=rollbackView({current,applied:[{when:1,hash:h},{when:2,hash:h2}],catalog:[expand,contract],candidates:[{deploy:earlier,catalog:[expand]}]});
    const adapter:RollbackAdapter={read:async()=>changed==="schema"?changedView:view(),confirm:async()=>true,published:async()=>({...current,id:"new-publication"}),restore:async()=>{posts++;return "accepted";}};
    assert.equal((await executeQueuedRollback(repos,request.receiptId,adapter,now)).state,"REFUSED");assert.equal(posts,0);
  }
});

test("DB-47 the final fresh-journal confirmation refuses a contract applied during the history reading", async () => {
  const repos=createMemoryRepositories();await appendReceipt(repos,request,now());let posts=0,reads=0;
  const record={id:current.id,commit_ref:sha,published_at:current.publishedAt,context:"production",branch:"main",state:"ready"};
  const fetchImpl:typeof fetch=async(input,init)=>{
    if(init?.method==="POST"){posts++;return new Response("{}",{status:201});}
    return new Response(JSON.stringify(String(input).includes("/deploys?")?[{...record,id:earlier.id,commit_ref:olderSha,published_at:earlier.publishedAt}]:{published_deploy:record}));
  };
  const adapter=netlifyRollbackAdapter({env:{NETLIFY_TOKEN:"existing-token"},fetchImpl,
    readCatalog:async code=>code===sha?[expand,contract]:[expand],
    readApplied:async()=>++reads===1?[{when:1,hash:h}]:[{when:1,hash:h},{when:2,hash:h2}]});
  assert.equal((await executeQueuedRollback(repos,request.receiptId,adapter,now)).state,"REFUSED");assert.equal(reads,2);assert.equal(posts,0);
});

test("DB-47 lost restore response is confirmed from publication when possible, otherwise remains unknown without resubmission", async () => {
  for (const confirmed of [true,false]) {
    const repos=createMemoryRepositories();await appendReceipt(repos,request,now());let posts=0,live=current;
    const adapter:RollbackAdapter={read:async()=>view(),confirm:async()=>true,published:async()=>live,restore:async()=>{posts++;if(confirmed)live=earlier;return "unknown";}};
    const expected=confirmed?"DONE":"UNKNOWN";
    assert.equal((await executeQueuedRollback(repos,request.receiptId,adapter,now)).state,expected);
    assert.equal((await executeQueuedRollback(repos,request.receiptId,adapter,now)).state,expected);assert.equal(posts,1);
  }
});

test("DB-47 no stored owner receipt, unreadable store or failed execution claim cannot reach the provider", async () => {
  const repos=createMemoryRepositories();let posts=0;
  const adapter:RollbackAdapter={read:async()=>view(),confirm:async()=>true,published:async()=>current,restore:async()=>{posts++;return "accepted";}};
  assert.equal((await executeQueuedRollback(repos,request.receiptId,adapter,now)).state,"REFUSED");
  await appendReceipt(repos,request,now());
  const failed={...repos,adminReceipts:{...repos.adminReceipts,append:async()=>{throw new Error("unreachable private credential");}}};
  assert.equal((await executeQueuedRollback(failed,request.receiptId,adapter,now)).state,"CLAIMED");assert.equal(posts,0);
  const unread={...repos,adminReceipts:{...repos.adminReceipts,readWhere:async()=>{throw new Error("unavailable");}}};
  await assert.rejects(executeQueuedRollback(unread,request.receiptId,adapter,now));assert.equal(posts,0);
});

test("DB-47 a failed result write preserves the execution claim and never repeats a successful restore", async () => {
  const base=createMemoryRepositories();await appendReceipt(base,request,now());let posts=0,live=current;
  const repos={...base,adminReceipts:{...base.adminReceipts,append:async(...args:Parameters<typeof base.adminReceipts.append>)=>{
    if(args[1].endsWith(":rollback-result"))throw new Error("unavailable");
    return base.adminReceipts.append(...args);
  }}};
  const adapter:RollbackAdapter={read:async()=>view(),confirm:async()=>true,published:async()=>live,restore:async()=>{posts++;live=earlier;return "accepted";}};
  const result=await executeQueuedRollback(repos,request.receiptId,adapter,now);
  assert.equal(result.state,"DONE");assert.equal(result.recorded,false);
  assert.equal((await executeQueuedRollback(repos,request.receiptId,adapter,now)).state,"CLAIMED");assert.equal(posts,1);
});

test("DB-47 exact-commit catalog reads derive phases from SQL and preserve the applied byte hashes", async () => {
  const sql="ALTER TABLE example DROP COLUMN old;\n";
  const mocked:typeof fetch=async input=>new Response(String(input).endsWith("_journal.json")?JSON.stringify({entries:[{when:2,tag:"0001_contract"}]}):sql);
  const catalog=await readRollbackCatalog(olderSha,mocked);
  assert.deepEqual(catalog,[{when:2,tag:"0001_contract",phase:"contract",hash:createHash("sha256").update(sql).digest("hex")}]);
  assert.equal(await readRollbackCatalog(olderSha,async()=>new Response("no",{status:404})),null);
  assert.equal(await readRollbackCatalog(olderSha,async()=>new Response(JSON.stringify({entries:[{when:2,tag:"../../wrong"}]}))),null);
});

test("DB-47 production adapter uses the existing credential, ignores previews/unpublished builds and makes only the documented restore POST", async () => {
  let posts=0;
  const record=(row:typeof current)=>({id:row.id,commit_ref:row.sha,published_at:row.publishedAt,context:"production",branch:"main",state:"ready"});
  const mocked:typeof fetch=async(input,init)=>{
    assert.equal(new Headers(init?.headers).get("authorization"),"Bearer existing-token");
    const url=String(input);
    if(init?.method==="POST"){assert.equal(url,"https://api.netlify.com/api/v1/sites/production-site/deploys/earlier-deploy/restore");posts++;return new Response("{}",{status:201});}
    return new Response(JSON.stringify(url.includes("/deploys?")?[record(current),record(earlier),{...record(earlier),id:"preview",context:"deploy-preview"},{...record(earlier),id:"unpublished",published_at:null}]:{published_deploy:record(current)}));
  };
  const adapter=netlifyRollbackAdapter({env:{NETLIFY_AUTH_TOKEN:"existing-token",NETLIFY_SITE_ID:"production-site"},fetchImpl:mocked,readApplied:async()=>[{when:1,hash:h}],readCatalog:async()=>[expand]});
  const reading=await adapter.read();assert.deepEqual(reading.choices.map(row=>row.id),[earlier.id]);assert.equal(posts,0);
  assert.equal(await adapter.restore(earlier.id),"accepted");assert.equal(posts,1);
  const denied=netlifyRollbackAdapter({env:{NETLIFY_TOKEN:"existing-token"},fetchImpl:async()=>new Response("private response",{status:403})});
  assert.equal(await denied.restore(earlier.id),"denied");assert.deepEqual((await denied.read()).choices,[]);
  const missing=netlifyRollbackAdapter({env:{},fetchImpl:async()=>{throw new Error("must not call");}});
  assert.match((await missing.read()).says,/not configured/);
});
