import assert from "node:assert/strict";
import test from "node:test";
import { openDataCaptures,openDataSourceContentHash,type OpenDataCapture } from "../lib/sources/open-data/publication.ts";

const at="2026-10-01T00:00:00.000Z",later="2026-10-02T00:00:00.000Z",url="https://echo.epa.gov/files/echodownloads/echo_exporter.zip";
const first:OpenDataCapture={url,retrievedAt:at,rawHash:"a".repeat(64),sourceRows:[{id:"one",name:"One"}],archive:{sha256:"a".repeat(64),member:"ECHO_EXPORTER.csv",publishedAt:null}};

test("identical source checks stay one capture and one source digest while retaining every referenced excerpt",()=>{
  const next={...first,retrievedAt:later,sourceRows:[{id:"two",name:"Two"}],
    sourceCheck:{requestedUrl:url,finalUrl:url,httpStatus:304 as const,rawHash:first.rawHash,checkedAt:later}};
  const held=openDataCaptures([first,next,next]);
  assert.equal(held.length,1);assert.equal(held[0].retrievedAt,later);assert.equal(held[0].sourceCheck?.checkedAt,later);
  assert.deepEqual(held[0].sourceRows.map(row=>row.id).sort(),["one","two"]);
  assert.equal(openDataSourceContentHash([first]),openDataSourceContentHash([first,next,next]));
});

test("changed source bytes and different native archive members remain independently held",()=>{
  const changed={...first,rawHash:"b".repeat(64)},member={...first,archive:{...first.archive!,member:"OTHER.csv"}};
  assert.equal(openDataCaptures([first,changed,member]).length,3);
  assert.notEqual(openDataSourceContentHash([first]),openDataSourceContentHash([changed]));
  assert.notEqual(openDataSourceContentHash([first]),openDataSourceContentHash([member]));
  assert.equal(openDataSourceContentHash([first,changed,member]),openDataSourceContentHash([member,first,changed]));
});
