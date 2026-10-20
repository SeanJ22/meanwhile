import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import manifest from "./fixtures/sl-03/manifest.json" with { type: "json" };
import { readHtmlEvidenceFile } from "../lib/sources/html-evidence-file.ts";
import { parseStatewideAssociation, parseStatewideAssociationBlock } from "../lib/sources/statewide/parse.ts";
import { STATEWIDE_REFERENCE_SOURCES } from "../lib/sources/statewide/reference.ts";

test("streamed national directory cards preserve every applicable real source lead",async()=>{
  const capture=manifest.captures.find(row=>row.name==="nass-membership")!;
  const path=fileURLToPath(new URL(`./fixtures/sl-03/${capture.file}`,import.meta.url)),source=STATEWIDE_REFERENCE_SOURCES.find(row=>row.id==="nass")!;
  const full=await readFile(path,"utf8");
  for(const state of ["az","me","wi"]){
    const expected=parseStatewideAssociation(full,source,capture.finalUrl,capture.retrievedAt,state).leads;
    const actual=new Map<string,readonly string[]>();
    for await(const block of readHtmlEvidenceFile(path)){
      assert.ok(block.html.length<=16000);
      if(block.kind!=="BLOCK")continue;
      for(const lead of parseStatewideAssociationBlock(block.html,source,capture.finalUrl,capture.retrievedAt,state).leads)actual.set(lead.name,lead.profileUrls);
    }
    assert.deepEqual([...actual],expected.map(lead=>[lead.name,lead.profileUrls]));
  }
});
