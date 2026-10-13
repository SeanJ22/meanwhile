import test from "node:test";
import assert from "node:assert/strict";
import { askedPlace, readPlaceStuck } from "../lib/control-plane/operator-chat/place-stuck.ts";
import { classify } from "../lib/control-plane/operator-chat/router.ts";
import { requiredReads } from "../lib/control-plane/operator-chat/context.ts";
import { answerFor } from "../lib/control-plane/operator-chat/read-models.ts";
test("named districts and selected places route to the bounded live reads",()=>{
  assert.equal(askedPlace("Why is AZ-06 stuck?","/admin"),"geo:az.congressional_district.0406");
  assert.equal(askedPlace("Why is New Jersey district 3 stuck?","/admin"),"geo:nj.congressional_district.3403");
  assert.equal(askedPlace("Why is this place stuck?","/admin?scope=st:az"),"st:az");
  assert.equal(askedPlace("Why is Atlantis stuck?","/admin?scope=st:az"),null);
  assert.equal(classify("Why is AZ-06 stuck?",[]).kind,"TOPIC");
  assert.deepEqual(requiredReads("PLACE_STUCK"),["placeStuck"]);
});
test("the live read answers one line and links to the selected work view; unread is unknown",async()=>{
  const reading = await readPlaceStuck("Why is this place stuck?","/admin?scope=st:az","2026-10-05T00:00:00Z",{
    stuck:async()=>({state:"READ",rows:[],publishedAt:null}),
    owed:async key=>({state:"READ",placeKey:key,label:"Arizona",covers:"State",divisions:[],rows:[],observedAt:"2026-10-05T00:00:00Z",readMs:{geography:0,held:0}}),
  });
  assert.ok(reading);
  const answer=answerFor("PLACE_STUCK",{from:"/admin",nowIso:"2026-10-05T00:00:00Z",stateVersion:null,placeStuck:{kind:"HELD",value:reading}},"",null);
  assert.equal(answer.says.length,1);
  assert.equal(answer.readBackAt,"/admin?view=work&scope=st%3Aaz");
  assert.equal(answerFor("PLACE_STUCK",{from:"/admin",nowIso:"",stateVersion:null},"",null).denominator.held,false);
});
