import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import LegislaturePage from "../app/legislature/[state]/page.tsx";
import { TRIBAL_SEAT_REFERENCES } from "../lib/officials/tribal-seats.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";
import { publishReaderEdgeArtifacts, readerAuthorityEdge } from "../lib/meetings/edge-serving.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { settleStateLegislatorsRead } from "../lib/registry/server.ts";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";

const NOW = "2026-10-12T12:00:00.000Z";
const META = {sourceThrough:NOW,retrievedAt:NOW,promotedThrough:NOW};
const reference = TRIBAL_SEAT_REFERENCES[0];
const scope = `US-${reference.state}` as const;

function roster(): OfficialStateLegislatorReadModel {
  const id = `plural:${reference.state.toLowerCase()}:published-holder`;
  return {formatVersion:1,sourceId:"plural-openstates",jurisdiction:scope,term:"2025-2026",generatedAt:NOW,
    roster:{scope:reference.stateFips,generatedAt:NOW,divisions:[],unmatched:[],officeholders:[{
      id,name:"Published Tribal Holder",officeTitle:"State Representative",level:"STATE",termStart:"",termEnd:"",birthDate:null,
      partyLabel:null,websiteUrl:null,contactFormUrl:null,phone:null,email:null,campaignUrl:null,photo:null,state:reference.state,chamber:reference.chamber,
      memberships:[{id:`${id}:current`,personId:id,officeId:`${scope}:${reference.chamber}:${reference.district}`,jurisdiction:scope,
        chamber:reference.chamber,district:reference.district,current:true,sourceUrl:reference.officialRosterUrl}],
      provenance:{sourceUrl:reference.officialRosterUrl,sourceOrg:reference.sourceOrg ?? "State legislature",collectedAt:NOW,verifiedAt:null},
    }]}};
}

test("the actual legislature page reads the published state artifact and keeps unknown seats visible", async () => {
  const dir = mkdtempSync(join(tmpdir(),"legislature-reader-edge-"));
  const previous = process.env.WTP_READER_EDGE_DIR;
  try {
    const store = new LocalFileArtifactStore(dir);
    assert.equal((await publishReaderEdgeArtifacts(null,META,{store,stateLegislators:{[scope]:{versionId:"legislature-page-1",value:roster()}}})).status,"PUBLISHED");
    process.env.WTP_READER_EDGE_DIR = dir;
    const page = await LegislaturePage({params:Promise.resolve({state:reference.state.toLowerCase()})});
    const html = renderToStaticMarkup(page);
    assert.ok(html.includes("Published Tribal Holder"),"the route must use its published artifact rather than the database path");
    for (const seat of TRIBAL_SEAT_REFERENCES.filter(row => row.state === reference.state)) {
      assert.ok(html.includes(`data-tribal-seat="${seat.district}"`));
    }
    assert.ok(!html.includes("couldn&#x27;t load the current legislature roster"));
  } finally {
    if (previous === undefined) delete process.env.WTP_READER_EDGE_DIR;
    else process.env.WTP_READER_EDGE_DIR = previous;
    rmSync(dir,{recursive:true,force:true});
  }
});

test("state roster edges open only the requested state and preserve the missing-pointer disposition", async () => {
  const dir = mkdtempSync(join(tmpdir(),"legislature-state-scope-"));
  try {
    const store = new LocalFileArtifactStore(dir);
    await publishReaderEdgeArtifacts(null,META,{store,stateLegislators:{[scope]:{versionId:"legislature-scope-2",value:roster()},
      "US-NH":{versionId:"unrequested-state-1",value:{...roster(),jurisdiction:"US-NH"}}},
      authority:{"federal-directory":{versionId:"unrequested-federal-1",value:{}}}});
    const reads:string[] = [];
    const counting = new Proxy(store,{get(target,key){
      if(key === "readBytes") return async (path:string) => {reads.push(path);return target.readBytes(path);};
      const value = Reflect.get(target,key);return typeof value === "function" ? value.bind(target) : value;
    }});
    const manifest = (await store.readManifest())!.manifest;
    const edge = await readerAuthorityEdge(manifest,counting,["state-legislators"]);
    assert.deepEqual(reads,[],"entering the manifest must not open national, meeting-door or other-state artifacts");
    const read = await withReaderAuthorityEdge({...edge,edgeOnly:true},()=>settleStateLegislatorsRead(scope));
    assert.equal(read.kind,"BOOTSTRAP");
    assert.deepEqual(reads,[manifest.stateLegislators![scope].key]);
    const missing = await withReaderAuthorityEdge({...edge,edgeOnly:true},()=>settleStateLegislatorsRead("US-AL"));
    assert.equal(missing.kind,"NOT_RECORDED","absence in the manifest must remain distinct from store failure");
    assert.deepEqual(reads,[manifest.stateLegislators![scope].key],"an unpublished state must not fall through to the database");
  } finally {rmSync(dir,{recursive:true,force:true});}
});
