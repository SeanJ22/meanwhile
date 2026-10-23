import test from 'node:test';
import assert from 'node:assert/strict';
import {withSourceCheckFailures,readSourceCheckFailures} from '../lib/facts/detective.ts';
import {blankFingerprint} from '../lib/hunt/packet.ts';
import {packetDue} from '../lib/hunt/packet-due.ts';
import {huntBrief} from '../lib/hunt/brief.ts';
const failure={governmentId:'ocd-division/country:us/state:az/place:tucson',entityId:'person',label:'A member',field:'phone',reason:'CHECK_FAILED:QUOTE_NOT_ON_SAVED_COPY',detail:JSON.stringify({sourceUrl:'https://clerk.example.gov',value:'555-123-4567',quote:'Call this number'})};

test('a check failure reaches a detective with the rejected value, quote and reason; unchanged failure does not resend it',()=>{
 const packet=withSourceCheckFailures({governmentId:failure.governmentId,label:'City',blanks:[],held:[]},[failure]);
 assert.equal(packet.blanks.length,1);assert.match(huntBrief(packet,{role:'DETECTIVE',tried:[]}),/555-123-4567/);
 const context={packet,last:null,orderedAt:null,shutDoors:[],now:'2026-10-20T06:45:00Z',maxWaitMs:5*86400000};
 assert.deepEqual(packetDue(context),{due:true,role:'DETECTIVE',why:'first hunt: 1 open blank(s)'});
 assert.equal(packetDue({...context,last:{recordedAt:context.now,blankFingerprint:blankFingerprint(packet),blankDigests:[]}}).due,false);
 assert.notEqual(blankFingerprint(packet),blankFingerprint(withSourceCheckFailures({...packet,sourceFailures:[]},[{...failure,detail:'A different saved copy'}])));
});

test('failure reads bind the selected governments at the database instead of loading the whole blank table',async()=>{
 let params:readonly unknown[]|undefined;
 const rows=await readSourceCheckFailures(async(sql,p)=>{assert.match(sql,/ep.place_id=ANY\(\$1::text\[\]\)/);params=p;return[];},[failure.governmentId]);
 assert.deepEqual(params,[[failure.governmentId]]);assert.deepEqual(rows,[]);
});
