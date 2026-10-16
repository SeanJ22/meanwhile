import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { admittedRuntimeChildEnvironment } from "../lib/civic-data/runtime-authority.ts";

const script = resolve("scripts/restore-state-buckets.mts");
function environment(contract: string) {
  const parentEnv = { ...process.env, WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", WTP_VITAL_SIGNS_REPORT: "1",
    DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control" };
  return admittedRuntimeChildEnvironment({ parentEnv, capability: "MANUAL_CONTRACT", contract });
}

test("the prepare child writes a scalar manifest and makes only source reads", t => {
  const directory = mkdtempSync(join(tmpdir(), "state-bucket-cli-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const preload = join(directory, "transport.mjs"), queries = join(directory, "queries.jsonl"), output = join(directory, "units");
  writeFileSync(preload, `import {Client} from ${JSON.stringify(import.meta.resolve("@neondatabase/serverless"))};
import {appendFileSync} from 'node:fs';
Client.prototype.connect=async()=>{};
Client.prototype.end=async()=>{};
Client.prototype.query=async (query,params)=>{
 appendFileSync(${JSON.stringify(queries)},JSON.stringify({query,params})+'\\n');
 if (!/^select\\b/i.test(query)&&!['BEGIN READ ONLY','ROLLBACK'].includes(query)) throw new Error('Preparation attempted a write');
 return {rows:[]};
};`);
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload, script, `--prepare=${output}`], {
    env: environment("registry-runtime-bindings"), encoding: "utf8", timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const receipts = run.stdout.split(/\r?\n/).filter(line => line.startsWith("STATE_BUCKET_PREPARED="));
  assert.equal(receipts.length, 1);
  assert.deepEqual(JSON.parse(receipts[0].slice("STATE_BUCKET_PREPARED=".length)),
    { manifestPath: join(output, "manifest.json"), unitCount: 0, unassignedCount: 0, missingOriginCount: 6 });
  assert.deepEqual(JSON.parse(readFileSync(join(output, "manifest.json"), "utf8")), { origins: [], units: [], unassigned: [],
    missingOrigins: ["ballot-contests", "candidate-profiles", "candidate-corpus", "voting-sites", "candidate-campaign-sites-derived", "registry-runtime"], operationalAssignments: [] });
  const captured = readFileSync(queries, "utf8").trim().split("\n").map(line => JSON.parse(line) as { query: string });
  assert.equal(captured.filter(row => /^select\b/i.test(row.query)).length, 7);
  assert.deepEqual(captured.filter(row => !/^select\b/i.test(row.query)).map(row => row.query), ["BEGIN READ ONLY", "ROLLBACK"]);
  const manifest = join(output, "manifest.json"), before = statSync(manifest, { bigint: true });
  const unchanged = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload, script, `--prepare=${output}`], {
    env: environment("registry-runtime-bindings"), encoding: "utf8", timeout: 30_000,
  });
  assert.equal(unchanged.status, 0, unchanged.stderr);
  const after = statSync(manifest, { bigint: true });
  assert.equal(after.ino, before.ino, "an unchanged plan must not replace its manifest file");
  assert.equal(after.mtimeNs, before.mtimeNs, "an unchanged plan must not rewrite its manifest");
  const unchangedQueries = readFileSync(queries, "utf8").trim().split("\n").slice(captured.length).map(line => JSON.parse(line) as { query: string });
  assert.equal(unchangedQueries.filter(row => /^select\b/i.test(row.query)).length, 6);
  assert.ok(unchangedQueries.every(row => !/p\.payload|c\.candidate|payload_parts/i.test(row.query)));
});

test("a changed unit is rejected before any database or write authority is used", t => {
  const directory = mkdtempSync(join(tmpdir(), "state-bucket-tamper-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "unit.json");
  const bytes = JSON.stringify({ family: "registry-runtime", state: "PR", payload: { bodies: Array.from({ length: 20_000 }, (_, id) => ({ id, name: `Body ${id} 🗳️` })) } });
  const sha = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(file, bytes.replace('"state":"PR"', '"state":"VI"'));
  const run = spawnSync(process.execPath, ["--experimental-strip-types", script, `--unit=${file}`, `--sha256=${sha}`, "--contract=registry-runtime:PR"], {
    env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", timeout: 30_000,
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /STATE_BUCKET_FILE_HASH_MISMATCH/);
  assert.doesNotMatch(run.stdout, /STATE_BUCKET_RESULT=/);
});

test("a verified unit still requires the sanctioned write handle", t => {
  const directory = mkdtempSync(join(tmpdir(), "state-bucket-write-guard-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "unit.json"), bytes = '{"family":"registry-runtime","state":"PR"}';
  writeFileSync(file, bytes);
  const run = spawnSync(process.execPath, ["--experimental-strip-types", script, `--unit=${file}`,
    `--sha256=${createHash("sha256").update(bytes).digest("hex")}`, "--contract=registry-runtime:PR"], {
    env: { PATH: process.env.PATH, NODE_ENV: "test", WTP_PRODUCTION_DATABASE_URL_READONLY: "postgresql://readonly:private@production.invalid/reader" },
    encoding: "utf8", timeout: 30_000,
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /WTP_PRODUCTION_DATABASE_URL_WRITE is not set/);
  assert.doesNotMatch(run.stderr, /postgresql:|private@/);
  assert.doesNotMatch(run.stdout, /STATE_BUCKET_RESULT=/);
});

test("restore units bind their declared contract to the verified family and state", t => {
  const directory = mkdtempSync(join(tmpdir(), "state-bucket-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "unit.json"), bytes = '{"family":"registry-runtime","state":"PR"}';
  writeFileSync(file, bytes);
  const unitArgs = [`--unit=${file}`, `--sha256=${createHash("sha256").update(bytes).digest("hex")}`];
  for (const [args, error] of [
    [unitArgs, "STATE_BUCKET_ARGUMENTS_INVALID"],
    [[...unitArgs, "--contract=registry-runtime:VI"], "STATE_BUCKET_CONTRACT_MISMATCH"],
    [[...unitArgs, "--contract=ballot-contests:PR"], "STATE_BUCKET_CONTRACT_MISMATCH"],
    [[`--prepare=${directory}`, "--contract=registry-runtime:PR"], "STATE_BUCKET_ARGUMENTS_INVALID"],
  ] as const) {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], {
      env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, new RegExp(error));
    assert.doesNotMatch(run.stderr, /WTP_PRODUCTION_DATABASE_URL_WRITE/);
    assert.doesNotMatch(run.stdout, /STATE_BUCKET_RESULT=|STATE_BUCKET_PREPARED=/);
  }
});

test("a verified unit uses its admitted state and returns unchanged without reading a payload or writing", t => {
  const directory = mkdtempSync(join(tmpdir(), "state-bucket-current-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "unit.json"), preload = join(directory, "transport.mjs"), queries = join(directory, "queries.jsonl");
  const scope = "US-PR:reader-registry-runtime", originScope = "US:reader-registry-runtime-bindings", inputHash = "a".repeat(64);
  const source = { family: "registry-runtime", state: "PR", inputHash, originId: "national-v1", originScope,
    originReadModelHash: "b".repeat(64), promotedAt: "2026-10-16T12:00:00.000Z",
    candidate: { id: "national-v1", scope: originScope, recordClass: "REGISTRY_RUNTIME_BINDING", sourceId: "registry-runtime-bindings" },
    receipt: { candidateId: "national-v1", scope: originScope, recordClass: "REGISTRY_RUNTIME_BINDING",
      sourceId: "registry-runtime-bindings", decision: "GOOD", checks: [{ verdict: "PASS" }], excludedFacts: [] },
    payload: { registry: { divisions: [{ ocdId: "ocd-division/country:us/territory:pr" }], bodies: [] } }, normalizedMetadata: {}, events: [] };
  const bytes = JSON.stringify(source);
  writeFileSync(file, bytes);
  const trace = "STATE_BUCKET_RESTORE_V1 " + JSON.stringify({ recordClass: "REGISTRY_RUNTIME_BINDING", scope, inputHash });
  writeFileSync(preload, `import {neonConfig} from ${JSON.stringify(import.meta.resolve("@neondatabase/serverless"))};
import {appendFileSync} from 'node:fs';
neonConfig.fetchFunction=async (_url,init)=>{
 const body=JSON.parse(String(init.body));
 appendFileSync(${JSON.stringify(queries)},JSON.stringify(body)+'\\n');
 let names,values;
 if(body.query.includes('STATE_BUCKET_ORIGIN_GUARD')){names=['id'];values=['national-v1'];}
 else if(body.query.includes('STATE_BUCKET_CURRENT')&&body.params[1]===${JSON.stringify(scope)}){names=['version_id','detail'];values=['pr-v1',${JSON.stringify(trace)}];}
 else throw new Error('Unexpected state read or write');
 return new Response(JSON.stringify({command:'SELECT',rowCount:1,rowAsArray:true,fields:names.map(name=>({name,dataTypeID:25})),rows:[values]}));
};`);
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload, script, `--unit=${file}`,
    `--sha256=${createHash("sha256").update(bytes).digest("hex")}`, "--contract=registry-runtime:PR"], {
    env: environment("registry-runtime:PR"), encoding: "utf8", timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const receipt = run.stdout.split(/\r?\n/).find(line => line.startsWith("STATE_BUCKET_RESULT="));
  assert.ok(receipt);
  assert.deepEqual(JSON.parse(receipt.slice("STATE_BUCKET_RESULT=".length)),
    { status: "UNCHANGED", state: "PR", family: "registry-runtime", versionId: "pr-v1" });
  const captured = readFileSync(queries, "utf8").trim().split("\n").map(line => JSON.parse(line) as { query: string });
  assert.equal(captured.length, 2);
  assert.ok(captured.every(row => /^select\b/i.test(row.query)));
  assert.ok(captured.every(row => !/SELECT\s+(?:c\.)?candidate\b|SELECT\s+(?:p\.)?payload\b/i.test(row.query)));
});
