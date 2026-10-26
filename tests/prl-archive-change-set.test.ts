import assert from "node:assert/strict";
import test from "node:test";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { prlArchiveCandidate, type PrlArchiveProjection } from "../lib/sources/prl/archive-publication.ts";
import { PRL_ARCHIVES } from "../lib/sources/prl/inventory.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "../lib/sources/prl/types.ts";
import type { PrlIngestReceipt } from "../lib/sources/prl/receipt.ts";

const dataset=PRL_ARCHIVES[0]!,at="2026-10-01T00:00:00.000Z",later="2026-10-02T00:00:00.000Z";
const receipt:PrlIngestReceipt={formatVersion:1,datasetId:dataset.id,scope:dataset.scope,title:dataset.title,target:dataset.target,
  sourceUrl:dataset.url,sourceSha256:"a".repeat(64),member:null,cursorField:null,fetchedAt:at,highWaterMark:null,previousMark:null,
  rowsSeen:3,rowsWritten:3,rowsAfterNow:0,rowsUnparseableCursor:0,coverageFrom:null,coverageThrough:null,objectStore:"local-file",
  objectRoot:`${dataset.id}/${"a".repeat(64)}/`,subjectCount:1,objectKeys:["held-person.json"],newObjectKeys:["held-person.json"],
  profileKind:null,profiles:null,attribution:PRL_RHETORIC_ATTRIBUTION};
const projection=(row:PrlIngestReceipt):PrlArchiveProjection=>({formatVersion:1,datasets:{[dataset.id]:row}});

test("a checked PRL release retains its full receipt without publishing write counters as new facts",()=>{
  const prior=projection(receipt),checked={...receipt,fetchedAt:later,rowsWritten:0,newObjectKeys:[]};
  const candidate=prlArchiveCandidate({projection:projection(checked),receipt:checked,checkedAt:later});
  assert.equal(candidateChangeSet(candidate,prior).outcome,"UNCHANGED");
  assert.equal((candidate.readModel as PrlArchiveProjection).datasets[dataset.id].fetchedAt,later);
  assert.deepEqual((candidate.readModel as PrlArchiveProjection).datasets[dataset.id].objectKeys,receipt.objectKeys);
  for(const changed of [{...checked,sourceSha256:"b".repeat(64)},{...checked,rowsSeen:4},
    {...checked,objectKeys:[...checked.objectKeys,"another-person.json"]}]){
    const next=prlArchiveCandidate({projection:projection(changed),receipt:changed,checkedAt:later});
    assert.equal(candidateChangeSet(next,prior).outcome,"CHANGED","source bytes, native objects and real coverage still change facts");
  }
});
