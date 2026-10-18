import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readStateAuthorityProjection,currentStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { authorityPointerKey,ensureReaderAuthorityEdge,holdReaderAuthorityEdge,prepareStateAuthorityArtifact,stateFactsPointerKey } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { stateAuthorityPointers, readStateAuthorityEntry } from "../lib/civic-data/state-reader.ts";
import { STATE_AUTHORITY_FAMILIES } from "../lib/meetings/edge-artifacts.ts";
import { neonConfig } from "@neondatabase/serverless";
import { readRegistrationProjection } from "../lib/registration/reader.ts";

const state="AZ",family="registry-runtime",scope="US-AZ:reader-registry-runtime",recordClass="REGISTRY_RUNTIME_BINDING";
const payload={registry:{bodies:[{id:"az-body",name:"Held Arizona body"}]}},versionId="az-v1",at="2026-10-16T10:00:00Z";
function fixture(){
  const receipt={contractVersion:2,decision:"GOOD",candidateId:versionId,sourceId:"registry-reviewed-bindings",recordClass,scope,validatedAt:at,
    checks:VALIDATION_CHECKS.map(check=>({check,verdict:"PASS",code:"VERIFIED",detail:"Verified source"})),excludedFacts:[]};
  const projection={key:`${recordClass}:${scope}`,scope,recordClass,sourceId:receipt.sourceId,versionId,lastKnownGoodVersionId:versionId,promotedAt:at,receipt,payload};
  const candidate={candidate:{id:versionId,sourceId:receipt.sourceId,recordClass,scope,retrieval:{succeeded:true,retrievedAt:at},
    temporal:{version:"2026",sourceThrough:"2026-10-16",staleAtRetrieval:false},normalization:{succeeded:true,normalizedHash:canonicalCivicDataHash(payload)}},
    state:"PROMOTED",acquisitionSucceeded:true,promotedVersion:versionId,lastKnownGoodVersion:versionId,failureCode:null,failureDetail:null};
  const entry={kind:"PROMOTED",projection,attested:{recordClass,scope,versionId,payloadSha256:canonicalCivicDataHash(payload),retrievedAt:at,
    staleAtRetrieval:false,version:"2026",sourceThrough:"2026-10-16"}};
  return {row:{roots:{projection,candidate},proof_valid:true,parts:{},confirmation:null},entry};
}

test("every state authority pointer can fall back to its held database record", async t => {
  t.mock.method(console, "warn", () => {});
  for (const family of STATE_AUTHORITY_FAMILIES) for (const { recordClass, scope } of stateAuthorityPointers(family, state)) {
    const conditions = ["missing", "broken", "invalid-proof", "malformed", ...(recordClass === "FEDERAL_DIRECTORY" ? ["absent"] : [])];
    for (const condition of conditions) {
      await withReaderAuthorityEdge({ stateAuthorities: { families: new Set([family]), load: async () => {
        if (condition === "missing") return null;
        if (condition === "broken") throw new Error("STATE_ARTIFACT_BYTES_MISSING");
        if (condition === "malformed") return { kind: "PROMOTED_POINTERS", entries: [null] } as never;
        const entry = condition === "absent" ? { kind: "NOT_RECORDED", recordClass, scope }
          : { ...fixture().entry, attested: { ...fixture().entry.attested, payloadSha256: "0".repeat(64) }, projection: { ...fixture().entry.projection, recordClass, scope, key: `${recordClass}:${scope}` } };
        return { kind: "PROMOTED_POINTERS", entries: [entry] } as never;
      } } }, async () => {
        let calls = 0;
        const read = await readStateAuthorityEntry(family, state, recordClass, scope, async (_sql, params) => {
          calls++;
          assert.deepEqual(params, [`${recordClass}:${scope}`]);
          const row = fixture().row;
          Object.assign(row.roots.projection, { recordClass, scope, key: `${recordClass}:${scope}` });
          Object.assign(row.roots.projection.receipt, { recordClass, scope });
          return [row];
        });
        assert.equal(read.source, "DATABASE", `${family}: ${condition}`);
        assert.equal(read.result.kind, "PROMOTED", `${family}: ${condition}`);
        assert.deepEqual(read.result.value, payload);
        assert.equal(calls, 1);
      });
    }
  }
});

test("a registration copy miss reads the exact state once without the recursive place slicer", async t => {
  const previous = { database: process.env.DATABASE_URL, report: process.env.WTP_VITAL_SIGNS_REPORT, fetch: neonConfig.fetchFunction };
  t.after(() => {
    for (const [key, value] of [["DATABASE_URL", previous.database], ["WTP_VITAL_SIGNS_REPORT", previous.report]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    neonConfig.fetchFunction = previous.fetch;
  });
  process.env.DATABASE_URL = "postgresql://reader:test@ep-sh01-test.us-east-2.aws.neon.tech/neondb";
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  let calls = 0;
  neonConfig.fetchFunction = async (_url: string | URL | Request, init?: RequestInit) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.queries.length, 1);
    assert.match(body.queries[0].query, /WHERE p\.key=\$1/);
    assert.doesNotMatch(body.queries[0].query, /reader_place_payload/);
    assert.deepEqual(body.queries[0].params, ["REGISTRATION:US-AZ:registration:v1"]);
    const row = fixture().row;
    Object.assign(row.roots.projection, { recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", key: "REGISTRATION:US-AZ:registration:v1" });
    Object.assign(row.roots.projection.receipt, { recordClass: "REGISTRATION", scope: "US-AZ:registration:v1" });
    return Response.json({ results: [{ command: "SELECT", rowCount: 1, rowAsArray: true,
      fields: [{ name: "roots", dataTypeID: 3802 }, { name: "proof_valid", dataTypeID: 16 }, { name: "parts", dataTypeID: 3802 }, { name: "confirmation", dataTypeID: 25 }],
      rows: [[JSON.stringify(row.roots), "t", "{}", null]],
    }] });
  };
  for (let request = 0; request < 2; request++) await withReaderSelection({ states: [state], keys: new Set(["state:AZ"]) }, async () => {
    const [first, second] = await Promise.all([readRegistrationProjection(state), readRegistrationProjection(state)]);
    assert.equal(first.kind, "PROMOTED");
    assert.deepEqual(first.value, payload);
    assert.deepEqual(second, first);
  });
  assert.equal(calls, 2, "share the state record inside each request, and read it anew on the next request");
});

test("real state edge reads make zero SQL calls and reuse the verified entry within a request",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"state-reader-edge-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=new LocalFileArtifactStore(directory),{entry}=fixture();
  const published=await prepareStateAuthorityArtifact(family,state,{versionId,value:{kind:"PROMOTED_POINTERS",entries:[entry]}} as never,store,at);
  await store.writeJsonPointer(authorityPointerKey(family,state),published.artifact,null);
  const edge=await ensureReaderAuthorityEdge(null,store,[family]);
  let bytesReads=0;const realRead=store.readBytes.bind(store);t.mock.method(store,"readBytes",async(key:string)=>{bytesReads++;return realRead(key);});
  await withReaderAuthorityEdge(edge,async()=>{
    const query=async()=>{assert.fail("edge hit must not read SQL");};
    const [first,second]=await Promise.all([readStateAuthorityProjection(family,state,query),readStateAuthorityProjection(family,state,query)]);
    assert.equal(first.source,"EDGE");assert.equal(first.result.kind,"PROMOTED");assert.deepEqual(first.result.value,payload);
    assert.equal(first,second);assert.equal(currentStateAuthorityProjection(family,state),first);
    assert.equal(await readPromotedCivicData(recordClass,scope),first.result);
    assert.equal((await readPromotedCivicData("VOTING_SITE",scope)).kind,"STORE_UNREACHABLE");
  });
  assert.equal(bytesReads,1);
});

test("a forced artifact miss reads one exact state row, shares the result, and logs one miss",async t=>{
  const directory=mkdtempSync(join(tmpdir(),"state-reader-miss-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const store=new LocalFileArtifactStore(directory),warnings:unknown[][]=[];t.mock.method(console,"warn",(...args:unknown[])=>warnings.push(args));
  await store.writeJsonPointer(authorityPointerKey(family,state),{key:"missing.json.gz",version:versionId,sha:"a".repeat(64)},null);
  const edge=await ensureReaderAuthorityEdge(null,store,[family]);
  let calls=0;
  await withReaderAuthorityEdge(edge,async()=>{
    const query=async(_sql:string,params:readonly unknown[])=>{calls++;assert.deepEqual(params,[`${recordClass}:${scope}`]);return [fixture().row];};
    const first=await readStateAuthorityProjection(family,state,query),second=await readStateAuthorityProjection(family,state,query);
    assert.equal(first.source,"DATABASE");assert.equal(first.result.kind,"PROMOTED");assert.deepEqual(first.result.value,payload);assert.equal(first,second);
  });
  assert.equal(calls,1);assert.deepEqual(warnings,[["READER_STATE_ARTIFACT_MISS",{family,state,key:"missing.json.gz",error:"STATE_ARTIFACT_BYTES_MISSING"}]]);
  await withReaderAuthorityEdge({},async()=>{
    assert.equal(currentStateAuthorityProjection(family,state),null);
    await readStateAuthorityProjection(family,state,async()=>{calls++;return [fixture().row];});
  });
  assert.equal(calls,2,"another request must not inherit the previous state payload");
});

test("a corrupt referenced payload becomes a named state failure without another SQL read",async t=>{
  const warnings:unknown[][]=[];t.mock.method(console,"warn",(...args:unknown[])=>warnings.push(args));
  let calls=0;
  await withReaderAuthorityEdge({},async()=>{
    const row=fixture().row;row.roots.projection.payload={registry:{bodies:[{id:"changed",name:"Tampered"}]}};
    const read=await readStateAuthorityProjection(family,state,async()=>{calls++;return [row];});
    assert.equal(read.result.kind,"STORE_UNREACHABLE");assert.equal(read.result.value,null);
  });
  assert.equal(calls,1);assert.deepEqual(warnings,[["READER_STATE_ARTIFACT_MISS",{family,state,key:null,error:"STATE_ARTIFACT_REFERENCE_MISSING"}],["READER_STATE_DATABASE_MISS",{family,state,key:`${recordClass}:${scope}`,error:"STATE_READER_PAYLOAD_HASH_MISMATCH"}]]);
});


test("an unexpected authority setup failure logs its exact scoped key once through both holding catches", async t => {
  const warnings: unknown[][] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
  const key = authorityPointerKey(family, state), failure = new Error("Authority setup failed at https://private.example.gov?token=secret");
  const store = { kind: "local-file", readJsonPointer: async () => { throw failure; } } as unknown as ReaderArtifactStore;
  const families = [family, "campaign-sites"] as const;
  const read = () => ensureReaderAuthorityEdge(null, store, families).catch(error => holdReaderAuthorityEdge(error, families));
  const request = () => withReaderSelection({ states: ["AZ"], keys: new Set(["state:AZ"]) }, async () => {
    assert.equal(await read(), null);
    await withReaderAuthorityEdge({}, async () => assert.equal(await read(), null));
  });
  await request();
  assert.deepEqual(warnings, [["READER_STATE_ARTIFACT_MISS", { family, state, key, error: "Authority setup failed at [url-redacted]" }]]);
  await request();
  assert.equal(warnings.length, 2, "another request must report its own failure");
});

test("missing same-state fact bytes log their artifact key once without opening a database", async t => {
  const directory = mkdtempSync(join(tmpdir(), "state-facts-miss-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory), warnings: unknown[][] = [], key = "reader/artifacts/az-facts-missing.json.gz";
  t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
  await store.writeJsonPointer(stateFactsPointerKey("AZ"), { state: "AZ", versionId: "facts-miss-v1", buckets: [{ key, version: "facts-miss-v1", sha: "a".repeat(64) }] }, null);
  const edge = (await ensureReaderAuthorityEdge(null, store, [family]))!;
  await withReaderSelection({ states: ["AZ"], keys: new Set(["state:AZ"]) }, () => withReaderAuthorityEdge(edge, async () => {
    assert.equal(await edge.stateRegistryFacts!.load("AZ"), null);
    assert.equal(await edge.stateRegistryFacts!.load("AZ"), null);
  }));
  assert.deepEqual(warnings, [["READER_STATE_ARTIFACT_MISS", { family: "fact-bucket", state, key, error: "STATE_ARTIFACT_BYTES_MISSING" }]]);
});

test("an unexpected fact overlay failure preserves the verified registry and reports once per request", async t => {
  const warnings: unknown[][] = [], key = "reader/artifacts/az-facts-error.json.gz";
  t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
  await withReaderSelection({ states: ["AZ"], keys: new Set(["state:AZ"]) }, () => withReaderAuthorityEdge({
    stateAuthorities: { families: new Set([family]), load: async () => ({ kind: "PROMOTED_POINTERS", entries: [fixture().entry] }) as never },
    stateRegistryFacts: { key: () => key, load: async () => { throw new Error("FACT_OVERLAY_UNAVAILABLE"); } },
  }, async () => {
    const first = await readRegistryRuntimeProjection([state]);
    assert.equal(first.kind, "PROMOTED");
    assert.deepEqual(first.value?.registry.bodies, payload.registry.bodies);
    assert.equal((await readRegistryRuntimeProjection([state], { bypassCache: true })).kind, "PROMOTED");
  }));
  assert.deepEqual(warnings, [["READER_STATE_ARTIFACT_MISS", { family: "state-facts", state, key, error: "FACT_OVERLAY_UNAVAILABLE" }]]);
});
