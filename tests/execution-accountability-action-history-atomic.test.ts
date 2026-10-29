import assert from "node:assert/strict";
import test from "node:test";

import { prepareActionHistoryProjection } from "../lib/control-plane/admin-view/action-history-projection.ts";
import type { ActionReceipt } from "../lib/control-plane/gateway/contract.ts";
import { appendActionReceiptWithHistoryAtomic, ATOMIC_ACTION_HISTORY_INSERT_SQL,
  AtomicActionHistoryUnconfirmed } from "../lib/control-plane/repository/action-history-atomic.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { PGlite } from "@electric-sql/pglite";
import { BOOTSTRAP_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { readActionHistoryPage } from "../lib/control-plane/repository/action-history-atomic.ts";

const at = "2026-09-28T20:00:00.000Z";
const receipt: ActionReceipt = {
  formatVersion: 1, receiptId: "runner.pause:once-only", idempotencyKey: "once-only", type: "runner.pause",
  label: "Pause the runner", authority: "REVERSIBLE_NONPRODUCTION", subjectKind: "the standing runner",
  subject: "intent-1", inputDigest: "sha256-input", caller: "OWNER_SESSION", actorRef: "owner-test",
  stateVersion: null, codeSha: null, startedAt: at, completedAt: at, outcome: "QUEUED",
  says: "Asked to pause.", refusal: null, openedWork: [], readBackAt: "/admin", undo: "Resume the runner.",
};
const validatedAction = { kind: "GLOBAL_RUNNER" as const, type: "runner.pause" as const };
function readback(position = 7) {
  const p = prepareActionHistoryProjection({ receipt, sourcePosition: position, sourceRecordedAt: at, validatedAction });
  return { position, recorded_at: at, record: receipt, projection_version: 1,
    gateway_type: p.gatewayType, idempotency_key: p.idempotencyKey, source_position: position,
    source_recorded_at: at, source_hash: p.sourceHash, mapping_state: "MAPPED", action_kind: p.actionKind,
    unmapped_reason: null, target_ref: p.targetRef, target_label: p.targetLabel,
    scope_key: "us", instruction_receipt_id: null, scope_kind: "GLOBAL" };
}
function fake(outcomes: readonly (readonly Record<string, unknown>[] | Error)[]) {
  const calls: string[] = [];
  let next=0;
  const sql: Sql = { async query(text) {
    calls.push(text);
    const versionRead=/ AS id,concat\(/.test(text);
    const outcome = outcomes[versionRead?next:next++];
    if (outcome instanceof Error) throw outcome;
    return (outcome??[]).map(row=>{
      if(!Object.hasOwn(row,"record"))return row;
      const key=JSON.stringify([row.position,row.scope_key??null]);
      return versionRead?{id:key,revision:"held-1"}:{...row,__key:key,__revision:"held-1"};
    });
  } };
  return { sql, calls };
}

test("one SQL statement owns receipt, companion, scope and readiness invalidation", async () => {
  assert.match(ATOMIC_ACTION_HISTORY_INSERT_SQL, /WITH allocated AS/);
  assert.match(ATOMIC_ACTION_HISTORY_INSERT_SQL, /receipt_insert AS/);
  assert.match(ATOMIC_ACTION_HISTORY_INSERT_SQL, /FROM receipt_insert r/);
  assert.match(ATOMIC_ACTION_HISTORY_INSERT_SQL, /FROM projected p/);
  assert.match(ATOMIC_ACTION_HISTORY_INSERT_SQL, /SET status = 'INCOMPLETE'/);
  const f = fake([[{ position: 7, projected_count: "1", scoped_count: "1" }], [readback()]]);
  const result = await appendActionReceiptWithHistoryAtomic({ sql: f.sql, receipt, sourceRecordedAt: at, validatedAction });
  assert.deepEqual(result, { state: "APPENDED", position: 7 });
  assert.equal(f.calls.length, 3, "one mutation, joined row versions, and changed readback bodies; no follow-up append");
  assert.match(f.calls[1], /^\s*SELECT/);
});

test("an ambiguous transport failure is read back once and never blindly retried", async () => {
  const committed = fake([new Error("transport lost after commit"), [readback()]]);
  assert.deepEqual(await appendActionReceiptWithHistoryAtomic({ sql: committed.sql, receipt, sourceRecordedAt: at,
    validatedAction }), { state: "REPLAYED", position: 7 });
  assert.equal(committed.calls.filter(q => q.includes("WITH allocated AS")).length, 1);
  const replay = fake([[], [readback()]]);
  assert.deepEqual(await appendActionReceiptWithHistoryAtomic({ sql: replay.sql, receipt,
    sourceRecordedAt: "2026-09-29T20:00:00.000Z", validatedAction }), { state: "REPLAYED", position: 7 },
    "an identical replay retains the original append timestamp");
  const missing = fake([new Error("transport unknown"), []]);
  await assert.rejects(appendActionReceiptWithHistoryAtomic({ sql: missing.sql, receipt, sourceRecordedAt: at,
    validatedAction }), AtomicActionHistoryUnconfirmed);
  assert.equal(missing.calls.filter(q => q.includes("WITH allocated AS")).length, 1);
});

test("a legacy receipt without companion is disclosed, never retroactively labeled", async () => {
  const held = { ...readback(), projection_version: null, gateway_type: null, source_hash: null, scope_key: null };
  const f = fake([[], [held]]);
  assert.deepEqual(await appendActionReceiptWithHistoryAtomic({ sql: f.sql, receipt, sourceRecordedAt: at,
    validatedAction }), { state: "LEGACY_UNPROJECTED", position: 7 });
});

test("mismatched canonical or companion evidence refuses confirmation", async () => {
  const wrongReceipt = fake([[{ position: 7, projected_count: 1, scoped_count: 1 }],
    [{ ...readback(), record: { ...receipt, says: "Different saved action" } }]]);
  await assert.rejects(appendActionReceiptWithHistoryAtomic({ sql: wrongReceipt.sql, receipt, sourceRecordedAt: at,
    validatedAction }), AtomicActionHistoryUnconfirmed);
  const wrongScope = fake([[{ position: 7, projected_count: 1, scoped_count: 1 }],
    [{ ...readback(), scope_key: "zcta:2020/85635" }]]);
  await assert.rejects(appendActionReceiptWithHistoryAtomic({ sql: wrongScope.sql, receipt, sourceRecordedAt: at,
    validatedAction }), AtomicActionHistoryUnconfirmed);
});

test("native receipt joins reuse unchanged bodies and observe changes in every joined row",async()=>{
  const pg=new PGlite();
  try {
    await pg.exec(`CREATE TABLE cp_log_heads(log_table text,log_key text,next_position bigint,PRIMARY KEY(log_table,log_key));
      CREATE TABLE cp_log_admin_receipts(log_key text,record_id text,position bigint,recorded_at timestamptz,record jsonb,
        changed_at timestamptz DEFAULT now(),PRIMARY KEY(log_key,record_id),UNIQUE(log_key,position));`);
    for(const ddl of BOOTSTRAP_DDL.filter(ddl=>/^CREATE TABLE IF NOT EXISTS cp_admin_action_history_/.test(ddl.trim())))await pg.exec(ddl);
    let readbackBodies=0,pageBodies=0;
    const sql:Sql={query:async(text,params=[])=>{
      if(/SELECT a\.position, a\.recorded_at, a\.record,/.test(text))readbackBodies++;
      if(/\bAS record\b/.test(text)&&text.includes("FROM cp_log_admin_receipts"))pageBodies++;
      return (await pg.query<Record<string,unknown>>(text,[...params])).rows;
    }};
    assert.equal((await appendActionReceiptWithHistoryAtomic({sql,receipt,sourceRecordedAt:at,validatedAction})).state,"APPENDED");
    assert.equal(readbackBodies,1);
    assert.equal((await appendActionReceiptWithHistoryAtomic({sql,receipt,sourceRecordedAt:at,validatedAction})).state,"REPLAYED");
    assert.equal(readbackBodies,1,"an identical replay confirms joined versions without downloading the receipt again");
    await pg.query(`UPDATE cp_admin_action_history_scope_ref SET scope_key='st:az',scope_kind='INSTRUCTION',instruction_receipt_id=$1`,[receipt.receiptId]);
    await assert.rejects(appendActionReceiptWithHistoryAtomic({sql,receipt,sourceRecordedAt:at,validatedAction}),AtomicActionHistoryUnconfirmed);
    assert.equal(readbackBodies,2,"a changed scope invalidates the joined readback while the receipt row itself is unchanged");
    await pg.query("UPDATE cp_admin_action_history_projection SET target_label='Changed stored projection'");
    await assert.rejects(appendActionReceiptWithHistoryAtomic({sql,receipt,sourceRecordedAt:at,validatedAction}),AtomicActionHistoryUnconfirmed);
    assert.equal(readbackBodies,3,"a changed projection invalidates the joined readback while receipt and scope rows are unchanged");
    const page=await readActionHistoryPage(sql,{scope:"us",limit:10});
    assert.equal(page[0].receipt.says,receipt.says);
    assert.deepEqual(await readActionHistoryPage(sql,{scope:"us",limit:10}),page);
    assert.equal(pageBodies,1,"receipt pages share the same changed-row mechanism");
    await pg.query("UPDATE cp_log_admin_receipts SET record=record||$1::jsonb",[JSON.stringify({says:"Changed stored receipt"})]);
    assert.equal((await readActionHistoryPage(sql,{scope:"us",limit:10}))[0].receipt.says,"Changed stored receipt");
    assert.equal(pageBodies,2,"the next page read observes a changed stored row");
  }finally{await pg.close();}
});
