import test from "node:test";
import assert from "node:assert/strict";
import { publicationHistoryRow, publicHistoryUrl, safePublicationDetail } from "../lib/control-plane/admin-view/publication-history.ts";
import { publicationHistoryPattern, readPublicationHistory } from "../lib/control-plane/admin-view/publication-history-read.ts";

test("publication history retains prior facts and scope without claiming a current public readback",()=>{
  const row=publicationHistoryRow({version:"v1",record_key:"person:1",record_class:"STATE_LEGISLATOR",scope:"US-AZ",recorded_at:"2026-09-01T00:00:00Z",current_version:false,query:"Adams",record:{id:"p1",name:"Jane Adams",office:"Senator",provenance:{sourceUrl:"https://official.example/members/1"}}});
  assert.equal(row.label,"Jane Adams");assert.equal(row.currentVersion,false);assert.equal(row.scope,"US-AZ");
  assert.ok(row.detail.includes('"office": "Senator"'));assert.ok(row.excerpt.includes("Adams"));
  assert.equal(row.sourceUrl,"https://official.example/members/1");
});

test("search treats wildcard characters as literal saved text",()=>{
  assert.equal(publicationHistoryPattern("50%_match\\path"),"%50\\%\\_match\\\\path%");
});

test("an unavailable index is unknown rather than an empty complete population",async()=>{
  const previous=process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result=await readPublicationHistory({query:"Sierra Vista",asOf:"2099-01-01",now:"2026-09-28T12:00:00.000Z"});
    assert.equal(result.state,"UNAVAILABLE");
    assert.equal(result.total,null);
    assert.equal(result.asOf,"2026-09-28T12:00:00.000Z");
  } finally { if(previous!==undefined) process.env.DATABASE_URL=previous; }
});
test("details and source links exclude credentials but retain public contact information",()=>{
  assert.equal(publicHistoryUrl("javascript:alert(1)"),null);
  assert.equal(publicHistoryUrl("https://user:password@example.org"),null);
  assert.equal(publicHistoryUrl("https://example.org/report?id=7&api_key=private"),"https://example.org/report?id=7");
  assert.equal(publicHistoryUrl("https://example.org/report?id=7&sig=private#access_token=private"),"https://example.org/report?id=7");
  assert.equal(safePublicationDetail("See https://example.org/report?id=7&code=private for evidence"),"See https://example.org/report?id=7 for evidence");
  const safe=safePublicationDetail({name:"Member",email:"office@example.gov",api_key:"not-public",nested:{authorization:"bearer private",url:"postgres://user:password@host/db"}});
  assert.deepEqual(safe,{name:"Member",email:"office@example.gov",api_key:"[redacted]",nested:{authorization:"[redacted]",url:"[private connection removed]"}});
});
test("a shortened preview has an exact full-record mode that preserves all saved text",()=>{
  const input={version:"v1",record_key:"legacy-document",record_class:"BALLOT_FILING",scope:"US-AZ",recorded_at:"2026-09-01",current_version:true,query:"last-entry",record:{names:"x".repeat(13000)+"last-entry"}};
  assert.equal(publicationHistoryRow(input).detailTruncated,true);
  assert.equal(publicationHistoryRow(input,true).detailTruncated,false);
  assert.ok(publicationHistoryRow(input).excerpt.includes("last-entry"));
  assert.ok(publicationHistoryRow(input,true).detail.includes("last-entry"));
});
