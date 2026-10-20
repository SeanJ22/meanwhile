import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareMeasurementArtifacts } from "../scripts/rh01-local-artifacts.mts";

test("measurement artifact configuration gives native reader publication a fresh local store and keeps its key private", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-local-artifacts-"));
  try {
    const environment = await prepareMeasurementArtifacts(directory);
    assert.deepEqual(Object.keys(environment).sort(), ["WTP_READER_EDGE_DIR", "WTP_RH01_RESTRICTED_EVIDENCE_DIRECTORY"]);
    assert.equal(environment.WTP_READER_EDGE_DIR, join(directory, "reader-edge"));
    const privateRoot = environment.WTP_RH01_RESTRICTED_EVIDENCE_DIRECTORY;
    assert.equal((await stat(privateRoot)).mode & 0o077, 0);
    assert.equal((await stat(join(privateRoot, "key"))).mode & 0o077, 0);
    assert.equal((await readFile(join(privateRoot, "key"))).byteLength, 32);
    await assert.rejects(prepareMeasurementArtifacts(directory), /EEXIST/);
    const old = process.env.WTP_READER_EDGE_DIR;
    process.env.WTP_READER_EDGE_DIR = environment.WTP_READER_EDGE_DIR;
    try {
      const { resolveReaderArtifactWriteStore } = await import("../lib/meetings/edge-store.ts");
      const store = await resolveReaderArtifactWriteStore();
      assert.ok(store);
      assert.equal(store.kind, "local-file");
      const bytes = Buffer.from('{"actual":"native local artifact"}');
      const key = await store.putImmutable(bytes, "json");
      assert.deepEqual(Buffer.from((await store.readBytes(key))!), bytes);
    } finally { if (old === undefined) delete process.env.WTP_READER_EDGE_DIR; else process.env.WTP_READER_EDGE_DIR = old; }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the loader keeps restricted raw encrypted and custody-gated while native parser substitution and immutable identities remain intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-restricted-custody-"));
  const environment = await prepareMeasurementArtifacts(directory);
  const source = `
    import assert from 'node:assert/strict';
    import {readFile,readdir,writeFile,chmod} from 'node:fs/promises';
    import {join} from 'node:path';
    import {DurableEvidenceStore} from './lib/control-plane/evidence/durable-store.ts';
    import {recordAcquisition,deriveSanitized} from './lib/control-plane/evidence/artifact.ts';
    import {putArtifact,readArtifact,readForParser,objectKey} from './lib/control-plane/evidence/store.ts';
    const credential=['AI','za'].join('')+'SyD4mQ8vX1nR7pLbT2wCzE0jHfGuY5aKs_-3xNp'.slice(0,35);
    const body='<p>County Board public title</p><script>googleMapsApiKey="'+credential+'"</script>';
    const {artifact}=recordAcquisition({canonicalUrl:'https://example.gov/board',retrievedAt:'2026-10-20T12:00:00Z',httpStatus:200,
      contentType:'text/html',sourceId:'source-fixture',methodRouteId:'native-source',workItemId:'wi-native',attemptId:'at-native',
      permission:'ALLOWED',transport:'REACHABLE'},body);
    assert.equal(artifact.tier,'RESTRICTED_RAW');
    const store=new DurableEvidenceStore('this-requested-root-is-not-used');
    const report=await putArtifact(store,'freshness',artifact,Buffer.from(body));
    await putArtifact(store,'freshness',artifact,Buffer.from(body));
    assert.equal((await store.head(report.key)).custom.tier,'RESTRICTED_RAW');
    await assert.rejects(store.get(report.key),/BODY_IDENTITY_REQUIRED/);
    await assert.rejects(readArtifact(store,'freshness',artifact,'PARSER'),/PARSER/);
    await assert.rejects(readArtifact(store,'freshness',artifact,'PUBLISHER'),/PUBLISHER/);
    assert.equal((await readArtifact(store,'freshness',artifact,'AUDITOR')).text,body);
    const derived=deriveSanitized(artifact,body,'2026-10-20T12:00:01Z');
    await putArtifact(store,'freshness',derived.artifact,Buffer.from(derived.text));
    const parsed=await readForParser(store,'freshness',artifact,{derivatives:new Map([[artifact.id,derived.artifact]])});
    assert.equal(parsed.read.substitutedForArtifactId,artifact.id);
    assert.equal(parsed.input.text,derived.text); assert.equal(parsed.input.text.includes(credential),false);
    await assert.rejects(putArtifact(store,'freshness',{...artifact,tier:'RAW'},Buffer.from(body)),/tier/);
    const privateRoot=process.env.WTP_RH01_RESTRICTED_EVIDENCE_DIRECTORY;
    async function files(root){const out=[];for(const e of await readdir(root,{withFileTypes:true})){const p=join(root,e.name);if(e.isDirectory())out.push(...await files(p));else out.push(p);}return out;}
    const ciphertext=(await files(join(privateRoot,'objects'))).filter(p=>p.endsWith('.rh01-restricted'));
    assert.equal(ciphertext.length,1);
    assert.equal((await readFile(ciphertext[0])).includes(Buffer.from(credential)),false);
    const publicFiles=await files(join(process.env.WTP_RH01_SHARED_STATE_DIRECTORY,'vault'));
    for(const p of publicFiles)assert.equal((await readFile(p)).includes(Buffer.from(credential)),false);
    assert.deepEqual((await store.list('project/')).sort(),[report.key,objectKey('freshness',derived.artifact)].sort());
    await chmod(join(privateRoot,'key'),0o644);
    await assert.rejects(readArtifact(store,'freshness',artifact,'AUDITOR'),/PRIVATE_CUSTODY_REQUIRED/);
    await chmod(join(privateRoot,'key'),0o600);
    const tampered=await readFile(ciphertext[0]);tampered[tampered.length-1]^=1;await writeFile(ciphertext[0],tampered);
    await assert.rejects(readArtifact(store,'freshness',artifact,'AUDITOR'));
    process.stdout.write('RH01_LOCAL_CUSTODY_CHECKED\\n');
  `;
  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, ...environment,
    WTP_RH01_DIRECTORY: directory, WTP_RH01_SHARED_STATE_DIRECTORY: directory,
    WTP_RH01_CODE_ROOT: process.cwd(), WTP_RH01_HARNESS_ROOT: process.cwd(), NODE_OPTIONS: "" };
  for (const key of Object.keys(childEnvironment)) if (/DATABASE|TOKEN|SECRET|ANTHROPIC|OPENAI/.test(key)) delete childEnvironment[key];
  try {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--import", "./scripts/rh01-loader.mjs",
      "--input-type=module", "-e", source], { cwd: process.cwd(), env: childEnvironment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", value => { stdout += value; }); child.stderr.on("data", value => { stderr += value; });
    const [code] = await once(child, "close");
    assert.equal(code, 0, stderr); assert.match(stdout, /RH01_LOCAL_CUSTODY_CHECKED/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
