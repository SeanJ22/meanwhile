import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/admin/v6/checklist/route.ts";
import { CHECKLIST_ALL_DEFINITIONS_PAGE_SQL, CHECKLIST_SCOPE_HEAD_SQL, ChecklistInstanceIndexError,
  readIndexedChecklistAllDefinitions } from "../lib/control-plane/admin-view/checklist-instance-index-read.ts";
import { v6ChecklistAllDefinitionsSection } from "../lib/control-plane/admin-view/v6-checklist-section.ts";
import { CHECKLIST_PROFILE, checklistObligationKey, type ChecklistInstance } from "../lib/control-plane/readiness/checklist-score.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const scopeId="zcta:2020/85635";
const receipt="expansion.scope.set:scope:85635:1yfuc2c:pgfomast";
const projectionId=`cpidx-${"a".repeat(64)}`;
const counts=Object.fromEntries(CHECKLIST_PROFILE.definitions.map(definition=>[definition.id,
  definition.id==="OFF-01"?2:definition.id==="OFF-02"?1:0]));
const head={projection_id:projectionId,source_snapshot_revision:3,current_snapshot_revision:3,
  snapshot_published_at:"2026-09-28T12:00:00Z",scope_revision:"scope:one",
  observed_at:"2026-09-28T11:59:00Z",profile:CHECKLIST_PROFILE.version,
  inventory_complete:false,reads_complete:false,captured_counts:counts};
function instance(definitionId:string,objectId:string):ChecklistInstance {
  return {obligationKey:checklistObligationKey(definitionId,objectId,scopeId,"period-unresolved"),
    definitionIds:[definitionId],predicateKey:definitionId,objectId,jurisdictionId:scopeId,
    period:"period-unresolved",scopeRevision:"scope:one",
    applicability:{state:"UNRESOLVED",reason:"No period witness",evidenceIds:[receipt]},
    due:{state:"UNRESOLVED",at:null,evidenceIds:[receipt]},
    predicate:{kind:"POSSESSION",requiredClauses:[`${CHECKLIST_PROFILE.version}:${definitionId}`],contractVersion:"checklist-field-contract/1"},
    workIds:[],requiredSurfaces:[],requiresFreshness:true,owner:"Lead",blocker:"No witness",
    nextAction:"Read source",failureKind:"DISCONNECTED_CAPABILITY"};
}
const records=[instance("OFF-01","a"),instance("OFF-01","b"),instance("OFF-02","c")]
  .map((item,index)=>({definition_id:item.definitionIds[0],obligation_key:item.obligationKey,ordinal:index+1,instance:item}))
  .sort((a,b)=>a.definition_id.localeCompare(b.definition_id)||a.obligation_key.localeCompare(b.obligation_key)||a.ordinal-b.ordinal);
const query={scopeId,instructionReceipt:receipt,limit:2,cursor:null};

test("all-definition cursor follows the projection primary key across definition boundaries",async()=>{
  assert.match(CHECKLIST_ALL_DEFINITIONS_PAGE_SQL,/ORDER BY definition_id, obligation_key, ordinal LIMIT/);
  assert.doesNotMatch(CHECKLIST_ALL_DEFINITIONS_PAGE_SQL,/cp_owner_snapshots|jsonb_array_elements/);
  const calls:readonly unknown[][]=[];
  const sql={query:async(text:string,params?:readonly unknown[])=>{
    if(text===CHECKLIST_SCOPE_HEAD_SQL)return [head];
    assert.equal(text,CHECKLIST_ALL_DEFINITIONS_PAGE_SQL);
    (calls as unknown[][]).push([...(params??[])]);
    const after=params?.[1]===null?null:[String(params?.[1]),String(params?.[2]),Number(params?.[3])] as const;
    return records.filter(row=>after===null||row.definition_id>after[0]||row.definition_id===after[0]&&
      (row.obligation_key>after[1]||row.obligation_key===after[1]&&row.ordinal>after[2])).slice(0,Number(params?.[4]));
  }};
  const first=await readIndexedChecklistAllDefinitions(sql,query);
  assert.equal(first.state,"CURRENT_SNAPSHOT_CAPTURED_INSTANCES");
  if(first.state!=="CURRENT_SNAPSHOT_CAPTURED_INSTANCES")return;
  assert.equal(first.rows.length,2);
  assert.equal(first.matchedCapturedCount,3);
  assert.ok(first.nextCursor);
  const second=await readIndexedChecklistAllDefinitions(sql,{...query,cursor:first.nextCursor});
  assert.equal(second.state,"CURRENT_SNAPSHOT_CAPTURED_INSTANCES");
  if(second.state!=="CURRENT_SNAPSHOT_CAPTURED_INSTANCES")return;
  assert.deepEqual([...first.rows,...second.rows].map(row=>row.definitionId),["OFF-01","OFF-01","OFF-02"]);
  assert.equal(second.nextCursor,null);
  assert.deepEqual(calls[0],[projectionId,null,null,null,3]);
  const section=v6ChecklistAllDefinitionsSection({scope:scopeId,read:first,readAt:"2026-09-28T12:05:00Z"});
  assert.equal(section.data.definitions.length,325);
  assert.equal(section.page.total,3);
  assert.equal(section.data.items?.length,2);
  assert.ok(section.data.items?.every(item=>item.status==="unsure"));
  assert.ok(section.missingParts.some(part=>/national totals.*unknown/.test(part)));
});

test("all-definition read refuses incomplete counts, changed revision and forged cursor",async()=>{
  await assert.rejects(readIndexedChecklistAllDefinitions({query:async(text:string)=>text===CHECKLIST_SCOPE_HEAD_SQL?
    [{...head,captured_counts:{"OFF-01":2}}]:records},query),
  (error:unknown)=>error instanceof ChecklistInstanceIndexError&&error.code==="CORRUPT_INDEX");
  const stale=await readIndexedChecklistAllDefinitions({query:async()=>[{...head,current_snapshot_revision:4}]},query);
  assert.equal(stale.state,"INDEX_STALE");
  assert.equal(stale.rows,null);
  await assert.rejects(readIndexedChecklistAllDefinitions({query:async()=>[head]},
    {...query,cursor:"bad***"}),
  (error:unknown)=>error instanceof ChecklistInstanceIndexError&&error.code==="INVALID_CURSOR");
  const sql={query:async(text:string,params?:readonly unknown[])=>text===CHECKLIST_SCOPE_HEAD_SQL?[head]:
    records.slice(0,Number(params?.[4]))};
  const first=await readIndexedChecklistAllDefinitions(sql,query);
  assert.equal(first.state,"CURRENT_SNAPSHOT_CAPTURED_INSTANCES");
  if(first.state!=="CURRENT_SNAPSHOT_CAPTURED_INSTANCES")return;
  assert.ok(first.nextCursor);
  await assert.rejects(readIndexedChecklistAllDefinitions({query:async()=>[{...head,
    projection_id:`cpidx-${"b".repeat(64)}`}]},{...query,cursor:first.nextCursor}),
  (error:unknown)=>error instanceof ChecklistInstanceIndexError&&error.code==="STALE_CURSOR");
  await assert.rejects(readIndexedChecklistAllDefinitions(sql,{...query,scopeId:"zcta:2020/other",cursor:first.nextCursor}),
  (error:unknown)=>error instanceof ChecklistInstanceIndexError&&error.code==="INVALID_CURSOR");
});

