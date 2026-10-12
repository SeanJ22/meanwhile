import assert from "node:assert/strict";
import test from "node:test";
import { manualSourceUrls, mergeManualSourceCopies } from "../lib/civic-data/manual-source-urls.ts";
import { manualSourceReceiptStructureIssue } from "../lib/civic-data/source-authority.ts";
import { reconcileSourceScopedMembers } from "../lib/civic-data/manual-source-isolation.ts";
import type { ManualSourceReview } from "../lib/civic-data/types.ts";

const sha="a".repeat(40), at="2026-10-01T00:00:00Z";
const archive=`https://codeload.github.com/openstates/people/zip/${sha}`;
const source:ManualSourceReview={requestedUrl:archive,finalUrl:archive,publisher:"Open States",sourceClass:"REFERENCE_PUBLISHER",
  retrievedAt:at,httpStatus:200,rawHash:"b".repeat(64),reviewedEvidence:"Validated archive member bytes",extractedMembers:[{path:"data/az/legislature/Person.yml",sha256:"c".repeat(64)}]};
const receipt=(sources:readonly ManualSourceReview[])=>({contractVersion:1 as const,reviewedAt:at,reviewedBy:"test",sources});

test("an archive member citation is exact to its pinned source path and cannot claim another file or revision",()=>{
  const url=`https://raw.githubusercontent.com/openstates/people/${sha}/data/az/legislature/Person.yml`;
  assert.deepEqual(manualSourceUrls(source),[archive,url]);
  const result=reconcileSourceScopedMembers({current:[{key:"one",record:{sourceUrl:url}},
    {key:"wrong-person",record:{sourceUrl:url.replace("Person.yml","Neighbor.yml")}},
    {key:"wrong-revision",record:{sourceUrl:url.replace(sha,"d".repeat(40))}}],currentReceipt:receipt([source])});
  assert.deepEqual(result.members.map(row=>row.key),["one"]);
  assert.equal(result.excludedFacts.length,2);
  assert.equal(result.promotionReceipt.sources[0].finalUrl,archive);
  assert.equal(result.promotionReceipt.sources[0].rawHash,"b".repeat(64));
  for(const path of ["data/az/legislature/../Person.yml","data/az/legislature/%2e%2e/Person.yml"])
    assert.equal(manualSourceReceiptStructureIssue(receipt([{...source,extractedMembers:[{path,sha256:"c".repeat(64)}]}]))?.code,"MANUAL_SOURCE_EXTRACTION_INVALID");
});

test("separate states retain all cited members when they reuse one archive",()=>{
  const merged=mergeManualSourceCopies(source,{...source,extractedMembers:[{path:"data/nh/legislature/Neighbor.yml",sha256:"d".repeat(64)}]});
  assert.equal(merged.extractedMembers?.length,2);
  assert.equal(manualSourceReceiptStructureIssue(receipt([merged])),null);
});
