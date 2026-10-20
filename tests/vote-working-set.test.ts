import assert from "node:assert/strict";
import test from "node:test";
import { withVoteWorkingSet } from "../lib/votes/working-set.ts";
import { partyBreakdownFor } from "../lib/votes/party-breakdown.ts";

test("a vote pass visits members and native rolls separately while its country joins stay on disk",async()=>{
  await withVoteWorkingSet(async working=>{
    for(let n=1;n<=2000;n++) {
      const id=`A${String(n).padStart(6,"0")}`;
      working.identity(id,n<100?`S${n}`:null,n%2?"Democrat":"Republican");
      for(let roll=1;roll<=12;roll++) working.position(`congress:${id}`,`roll:${roll}`,n%2?"YES":"NO");
    }
    assert.equal(working.positionCount,24000);
    assert.equal(working.bioguideForLis("S3"),"A000003");
    assert.equal(working.hasBioguide("A999999"),false);
    let members=0;
    for(const id of working.members()) {
      const rows=working.positionsForMember(id);
      assert.equal(rows.length,12); assert.ok(rows.every(row=>row.officeholderId===id));members++;
    }
    assert.equal(members,2000);
    const roll=working.positionsForRoll("roll:3");
    assert.equal(roll.length,2000);assert.ok(roll.every(row=>row.voteId==="roll:3"));
    assert.deepEqual(partyBreakdownFor("roll:3","Passed 1000–1000",roll,new Map(roll.map(row=>[row.officeholderId,working.party(row.officeholderId)]))),[
      {party:"Democrats",yes:1000,no:0},{party:"Republicans",yes:0,no:1000},
    ]);
  });
});
