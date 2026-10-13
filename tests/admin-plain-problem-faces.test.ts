import test from "node:test";
import assert from "node:assert/strict";
import { causeOf, type StuckRowLike } from "../lib/control-plane/admin-view/blocker-causes.ts";
import { stuckViews } from "../lib/control-plane/admin-view/v6-stuck-read.ts";
import { hasTechnicalText, UNKNOWN_PROBLEM } from "../lib/control-plane/admin-view/plain-words.ts";
import { recordUndescribedCauses } from "../lib/control-plane/admin-view/undescribed-causes.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
const row=(blocker:string):StuckRowLike=>({id:"wi-aabbccdd",blocker,state:"BLOCKED",lane:"data",owner:"RUNNER",label:"Membership list",subjectName:null,stateCode:"az",overdue:false,band:null,waitingSince:null,eligibleAt:null,lastActivityAt:null,nextAction:"SCOUT_POLICY_DENIED",assignmentKeys:[]});
test("photographed code names and raw errors stay out of stuck faces, with their originals retained",()=>{
  for (const code of ["DIRECTORY_NO_READABLE_SAVED_PAGE","ELECTION_OFFICE_NOT_ON_SAVED_PAGES","ROSTER_NO_READABLE_SAVED_PAGE","MANUAL_PROMOTION_BASE_PROOF_INVALID","SCOUT_POLICY_DENIED","BRAND_NEW_FAILURE: TypeError: undefined"]) {
    const r=row(code); const item=stuckViews([r],"us","2026-10-05T00:00:00Z").items[0];
    for (const text of [item.title,item.cause,item.tried,item.next,item.owner]) assert.equal(hasTechnicalText(text),false,text);
    assert.ok(item.technical?.includes(code));
    assert.ok(causeOf(r).next.length);
  }
  assert.equal(causeOf(row("BRAND_NEW_FAILURE")).words,UNKNOWN_PROBLEM);
});
test("unknown descriptions become a single durable team repair per cause, not a dispatch",async()=>{
  const repos=createMemoryRepositories(); const r=row("BRAND_NEW_FAILURE");
  await recordUndescribedCauses(repos,[r,r],"2026-10-05T00:00:00Z");
  await recordUndescribedCauses(repos,[r],"2026-10-05T00:01:00Z");
  const fixes=(await repos.adminConfig.mustRead("current")).value.fixList!;
  assert.equal(fixes.length,1); assert.equal(fixes[0].state,"OPEN"); assert.equal(fixes[0].dispatch,undefined);
  assert.equal(hasTechnicalText(fixes[0].says),false); assert.ok(fixes[0].technical?.includes("BRAND_NEW_FAILURE"));
});
