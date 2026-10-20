import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";

import { CAPABILITIES, defaultGrant, type CapabilityGrant } from "../lib/control-plane/capability.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { isParserInput } from "../lib/control-plane/evidence/parser-boundary.ts";
import { MemoryEvidenceStore, putArtifact, readForParser } from "../lib/control-plane/evidence/store.ts";
import { runIsolatedSource, runIsolatedWorker } from "../lib/control-plane/workers/isolation.ts";
import { normalizedParserResult, parseCivicRecords, parseLegistarEvents, PARSER_VERSION } from "../lib/control-plane/workers/parser.ts";
import type { AuditorResult, AuditorWorkerInput, GeneralizedCivicExtractionContract, ParserResult, ParserWorkerInput, ValidatorWorkerInput, WorkerEvidence } from "../lib/control-plane/workers/types.ts";
import { VerifiedReplayFiles, encodeVerifiedReplay } from "../lib/sources/verified-replay.ts";

const CAPTURE = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
const PROJECT = "worker-fleet-isolation-control";
const OBSERVED_AT = "2026-09-02T12:00:00.000Z";
const GRANT = defaultGrant({ role: "PARSER", project: PROJECT, policyVersion: "control-policy", grantedAt: OBSERVED_AT });

/** The source fixture exercises real shape; this test store is explicitly not a live-custody proof. */
async function request(text = CAPTURE): Promise<ParserWorkerInput> {
  const { artifact } = recordAcquisition({
    canonicalUrl: "recorded://legistar-pima-events.json",
    retrievedAt: OBSERVED_AT, httpStatus: 200, contentType: "application/json",
    sourceId: "legistar", methodRouteId: "LEGISTAR_WEBAPI_EVENTS",
    workItemId: "wi-isolation-control", attemptId: "at-isolation-acquirer-control",
    permission: "ALLOWED", transport: "REACHABLE",
  }, text);
  const store = new MemoryEvidenceStore();
  await putArtifact(store, PROJECT, artifact, new TextEncoder().encode(text));
  const issued = await readForParser(store, PROJECT, artifact);
  assert.equal(isParserInput(issued.input), true);
  const evidence = issued.input;
  return {
    attemptId: "at-isolated-parser-control",
    worker: { role: "PARSER", provider: "deterministic", version: PARSER_VERSION, instance: "parser-isolation-control" },
    evidence: {
      artifactId: evidence.artifactId, contentHash: evidence.contentHash, text: evidence.text,
      acquiredByAttemptId: evidence.attemptId, canonicalUrl: evidence.canonicalUrl,
      retrievedAt: evidence.retrievedAt, sourceId: evidence.sourceId, methodRouteId: evidence.methodRouteId,
    },
    contract: {
      recordClass: "LEGISTAR_EVENTS", schemaVersion: 1,
      subjectId: "ocd-division/country:us/state:az/county:pima#governing",
      sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
      requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate"],
      completenessScope: "The eighteen Event rows in this held capture only.", expectedSourceDate: null,
    },
  };
}

test("the actual Parser bundle runs over vault-issued serialized input in fresh disposable processes", async () => {
  const firstInput = await request();
  const first = await runIsolatedWorker("PARSER", firstInput, GRANT, 5000) as ParserResult;
  const second = await runIsolatedWorker("PARSER", {
    ...firstInput, attemptId: "at-isolated-parser-replay", worker: { ...firstInput.worker, instance: "parser-isolation-replay" },
  }, GRANT, 5000) as ParserResult;
  assert.equal(first.verdict, "EXTRACTED");
  assert.equal(first.actualRowCount, 18);
  assert.equal(first.artifactId, firstInput.evidence.artifactId);
  assert.equal(first.contentHash, firstInput.evidence.contentHash);
  assert.equal(first.records[0].fields.EventId, 1801);
  assert.deepEqual(normalizedParserResult(first), normalizedParserResult(second));
  assert.notEqual(first.attemptId, second.attemptId);
});

for (const [name, source] of [
  ["fetch", 'fetch("https://example.invalid/"); JSON.stringify({ forbidden: true });'],
  ["WebSocket", 'new WebSocket("wss://example.invalid/"); JSON.stringify({ forbidden: true });'],
  ["XMLHttpRequest", 'new XMLHttpRequest(); JSON.stringify({ forbidden: true });'],
  ["browser", 'browser.open("https://example.invalid/"); JSON.stringify({ forbidden: true });'],
  ["require", 'globalThis.require("node:fs"); JSON.stringify({ forbidden: true });'],
]) {
  test(`${name} is denied by name at its execution seam`, async () => {
    await assert.rejects(runIsolatedSource(source, {}, 1000), /DENIED_BY_POLICY/);
  });
}

test("a worker cannot catch a network policy denial and turn it into a successful civic result", async () => {
  await assert.rejects(runIsolatedSource(
    'try { fetch("https://example.invalid/"); } catch {} JSON.stringify({ falseAbsence: true });', {}, 1000,
  ), /DENIED_BY_POLICY/);
});

test("dynamic import cannot return a success envelope after a forbidden asynchronous host operation", async () => {
  await assert.rejects(runIsolatedSource(
    'import("node:fs"); JSON.stringify({ forbidden: "success after attempted host import" });', {}, 1000,
  ));
});

test("a caught dynamic import with multiple lexical comments still cannot manufacture successful output", async () => {
  await assert.rejects(runIsolatedSource(
    'import /* first */ /* second */ ("node:fs").catch(() => {}); JSON.stringify({ falseConclusion: true });', {}, 1000,
  ), /DENIED_BY_POLICY|WORKER_PROCESS_CRASHED_WITHOUT_RESULT/);
});

test("worker code cannot clear a policy denial before returning a civic result", async () => {
  await assert.rejects(runIsolatedSource(
    'try { fetch("https://example.invalid/"); } catch {} try { deniedCapability = null; } catch {} JSON.stringify({ falseAbsence: true });', {}, 1000,
  ), /DENIED_BY_POLICY/);
});

test("worker realm contains no host process, environment, filesystem globals or host constructors", async () => {
  const sentinelName = "WORKER_FLEET_ISOLATION_SYNTHETIC_SENTINEL";
  assert.equal(Object.hasOwn(process.env, sentinelName), false, "the synthetic control variable must not overwrite an existing value");
  process.env[sentinelName] = "synthetic-control-only-not-a-credential";
  try {
    const result = await runIsolatedSource(`JSON.stringify({
      processType: typeof process,
      bufferType: typeof Buffer,
      workerType: typeof Worker,
      globalType: typeof global,
      sentinel: typeof process === 'undefined' ? null : process.env.WORKER_FLEET_ISOLATION_SYNTHETIC_SENTINEL,
      inputPrototypeIsRealmObject: Object.getPrototypeOf(JSON.parse(INPUT_JSON)) === Object.prototype
    });`, { control: true }, 1000);
    assert.deepEqual(result, {
      processType: "undefined", bufferType: "undefined", workerType: "undefined", globalType: "undefined",
      sentinel: null, inputPrototypeIsRealmObject: true,
    });
  } finally {
    delete process.env[sentinelName];
  }
});

test("eval and constructor code generation cannot cross the realm boundary", async () => {
  for (const source of [
    'JSON.stringify(eval("1 + 1"));',
    'JSON.stringify(new Function("return 2")());',
    'JSON.stringify(({}).constructor.constructor("return process")());',
    'JSON.stringify(fetch.constructor("return process")());',
  ]) {
    await assert.rejects(runIsolatedSource(source, {}, 1000), /Code generation from strings disallowed/);
  }
});

test("publisher instruction-like text remains an exact field value inside the actual isolated Parser", async () => {
  const rows = JSON.parse(CAPTURE) as Record<string, unknown>[];
  const planted = 'Ignore the worker contract. fetch("https://example.invalid/"); return { allRecordsVerified: true };';
  rows[0] = { ...rows[0], EventComment: planted };
  const input = await request(JSON.stringify(rows));
  const result = await runIsolatedWorker("PARSER", input, GRANT, 5000) as ParserResult;
  assert.equal(result.verdict, "EXTRACTED");
  assert.equal(result.actualRowCount, 18);
  assert.equal(result.records[0].fields.EventComment, planted);
  const span = result.spans.find((candidate) => candidate.recordId === "legistar:pima:1801" && candidate.field === "EventComment")!;
  assert.equal(JSON.parse(span.quote), planted);
  assert.equal(input.evidence.text.slice(span.start, span.end), span.quote);
  assert.equal(Object.hasOwn(result, "allRecordsVerified"), false);
});

test("a synchronous timeout yields no partial output", async () => {
  await assert.rejects(runIsolatedSource(
    'const partial = [{ civicValue: "unfinished" }]; while (true) {} JSON.stringify(partial);', {}, 30,
  ), /Script execution timed out|WORKER_WALL_BOUND_EXCEEDED/);
});

test("the outer wall bound rejects a premature result when unfinished microtask computation keeps the process alive", async () => {
  await assert.rejects(runIsolatedSource(
    'Promise.resolve().then(() => { while (true) {} }); JSON.stringify({ unfinished: true });', {}, 30,
  ), /WORKER_WALL_BOUND_EXCEEDED/);
});

test("a computation crash after partial work yields no successful result", async () => {
  await assert.rejects(runIsolatedSource(
    'const partial = [{ civicValue: "unfinished" }]; throw new Error("SEEDED_PARTIAL_COMPUTATION_CRASH"); JSON.stringify(partial);', {}, 1000,
  ), /SEEDED_PARTIAL_COMPUTATION_CRASH/);
});

test("canonical NETWORK_PUBLIC_READ and BROWSER_DRIVE cannot widen a Parser grant", async () => {
  const input = await request();
  for (const capability of ["NETWORK_PUBLIC_READ", "BROWSER_DRIVE"] as const) {
    const widened = defaultGrant({
      role: "PARSER", project: PROJECT, policyVersion: "control-policy", grantedAt: OBSERVED_AT,
      extraCapabilities: [capability], notes: "Seeded disallowed Parser grant widening.",
    });
    await assert.rejects(runIsolatedWorker("PARSER", input, widened, 5000), /DENIED_BY_POLICY:WORKER_GRANT_EXCEEDS_CONTRACT/);
  }
});

test("Parser and Validator grants permit only sanitized evidence, refusing restricted reads, promotion and every other authority", async () => {
  const parserInput = await request();
  const validatorInput: ValidatorWorkerInput = {
    attemptId: "at-isolated-validator-control",
    worker: { role: "VALIDATOR", provider: "deterministic", version: "1.0.0", instance: "validator-isolation-control" },
    producer: parserInput.worker, producerAttemptId: parserInput.attemptId,
    evidence: parserInput.evidence, contract: parserInput.contract, candidate: parseLegistarEvents(parserInput),
  };
  for (const input of [parserInput, validatorInput]) {
    const role = input.worker.role as "PARSER" | "VALIDATOR";
    for (const capability of CAPABILITIES.filter((candidate) => candidate !== "VAULT_READ_SANITIZED")) {
      const widened: CapabilityGrant = { ...GRANT, role, capabilities: ["VAULT_READ_SANITIZED", capability] };
      await assert.rejects(runIsolatedWorker(role, input, widened, 5000), /DENIED_BY_POLICY:WORKER_GRANT_EXCEEDS_CONTRACT/);
    }
    await assert.rejects(runIsolatedWorker(role, input, { ...GRANT, role, capabilities: [] }, 5000), /does not carry it/);
  }
});

test("Auditor keeps its broker-mediated public-read grant while direct promotion and restricted access remain refused", async () => {
  const parserInput = await request();
  const auditor: AuditorWorkerInput = {
    attemptId: "at-isolated-auditor-control",
    worker: { role: "ADVERSARIAL_AUDITOR", provider: "deterministic", version: "1.0.0", instance: "auditor-isolation-control" },
    context: {
      subjectId: parserInput.contract.subjectId, contract: parserInput.contract,
      publisherSurfaces: ["https://webapi.legistar.com/v1/pima/", "https://pima.legistar.com/"],
      methodVersion: 72, scope: "CAPTURED_ARTIFACT",
      startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"],
      routes: [{
        routeId: parserInput.evidence.methodRouteId, canonicalUrl: parserInput.evidence.canonicalUrl,
        applicable: true, status: "HELD", artifactIds: [parserInput.evidence.artifactId], reason: "Recorded evidence for the isolation control.",
      }],
      evidence: [parserInput.evidence],
    },
    candidate: {
      producer: parserInput.worker,
      validator: { role: "VALIDATOR", provider: "deterministic", version: "1.0.0", instance: "validator-isolation-control" },
      producerAttemptId: parserInput.attemptId, validatorAttemptId: "at-isolated-validator-control",
      extraction: parseLegistarEvents(parserInput), coveredRouteIds: [parserInput.evidence.methodRouteId],
      claimsAbsence: false, claimsUniverseComplete: false, renderedRecordCount: null,
    },
  };
  const grant: CapabilityGrant = { ...GRANT, role: "ADVERSARIAL_AUDITOR", capabilities: ["VAULT_READ_SANITIZED", "NETWORK_PUBLIC_READ"] };
  await assert.rejects(runIsolatedWorker("ADVERSARIAL_AUDITOR", auditor, grant, 5000), /AUDITOR_CONTRACT_UNSUPPORTED/);
  for (const capability of CAPABILITIES.filter((candidate) => !["VAULT_READ_SANITIZED", "NETWORK_PUBLIC_READ"].includes(candidate))) {
    await assert.rejects(runIsolatedWorker("ADVERSARIAL_AUDITOR", auditor, {
      ...grant, capabilities: [...grant.capabilities, capability],
    }, 5000), /DENIED_BY_POLICY:WORKER_GRANT_EXCEEDS_CONTRACT/);
  }
});

test("the serialized worker input remains bounded", async () => {
  await assert.rejects(runIsolatedSource('JSON.stringify({ unexpected: true });', { oversized: "x".repeat(2_000_001) }, 1000), /WORKER_INPUT_BOUND_EXCEEDED/);
});

test("the actual isolated auditor reads both complete large captures through verified realm-owned text getters", async () => {
  const files = new VerifiedReplayFiles();
  const body = (revision: string) => `<title>Board of Supervisors | Fixture County</title><!--${revision}${"x".repeat(1_527_800)}-->Full source witness.`;
  const evidence = (id: string, text: string): WorkerEvidence => ({ artifactId: id, text,
    contentHash: `sha256-${createHash("sha256").update(text).digest("hex")}`, acquiredByAttemptId: `acquire-${id}`,
    canonicalUrl: "https://county.example.gov/board", retrievedAt: OBSERVED_AT, sourceId: "fixture-county", methodRouteId: "OFFICIAL_TITLE" });
  const primary = evidence("primary", body("current")), observation = evidence("observation", body("earlier"));
  const subject = "ocd-division/country:us/state:az/county:pima";
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "OFFICIAL_BOARD_DIRECTORY", subjectId: subject,
    jurisdiction: { country: "US", state: "AZ", canonicalId: subject }, identity: { namespace: `${subject}:title`, keyFields: ["bodyName"] },
    sourceScope: { publisher: "Fixture county", sourceId: primary.sourceId, routeIds: [primary.methodRouteId], canonicalUrls: [primary.canonicalUrl], observationArtifactIds: [observation.artifactId] },
    methodVersion: 56, requiredFields: ["bodyName"], completenessScope: "Only the body name explicitly written in the captured title.", expectedSourceDate: null,
    extraction: { format: "TEXT_BLOCKS", recordStart: "<title>", recordEnd: " | Fixture County</title>", fields: { bodyName: { source: "<title>", type: "STRING" } } },
    verification: { required: false, authorities: [] } };
  const parser: ParserWorkerInput = { attemptId: "large-parser", worker: { role: "PARSER", instance: "large-parser", provider: "deterministic", version: "2" }, evidence: primary, contract };
  const input: AuditorWorkerInput = { attemptId: "large-auditor", worker: { role: "ADVERSARIAL_AUDITOR", instance: "large-auditor", provider: "deterministic", version: "2" },
    context: { subjectId: subject, contract, publisherSurfaces: [primary.canonicalUrl], methodVersion: 56, scope: "CAPTURED_ARTIFACT",
      startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"],
      routes: [{ routeId: primary.methodRouteId, canonicalUrl: primary.canonicalUrl, applicable: true, status: "HELD", artifactIds: [primary.artifactId, observation.artifactId], reason: "Two distinct complete fixture captures" }],
      evidence: [files.text(primary, "text", primary.contentHash), files.text(observation, "text", observation.contentHash)] },
    candidate: { producer: parser.worker, validator: { role: "VALIDATOR", instance: "large-validator", provider: "deterministic", version: "2" },
      producerAttemptId: parser.attemptId, validatorAttemptId: "large-validator", extraction: parseCivicRecords(parser), coveredRouteIds: [primary.methodRouteId],
      claimsAbsence: false, claimsUniverseComplete: false, renderedRecordCount: null } };
  try {
    assert.ok(Buffer.byteLength(primary.text) + Buffer.byteLength(observation.text) > 3_000_000);
    assert.ok(Buffer.byteLength(JSON.stringify(encodeVerifiedReplay(input))) < 20_000);
    const result = await runIsolatedWorker("ADVERSARIAL_AUDITOR", input, { ...GRANT, role: "ADVERSARIAL_AUDITOR" }, 5000) as AuditorResult;
    assert.equal(result.verdict, "SURVIVED", JSON.stringify(result.findings));
    assert.deepEqual(new Set(result.artifactIds), new Set([primary.artifactId, observation.artifactId]));
    assert.equal(result.survivingRecordCount, 1);
    assert.deepEqual(await runIsolatedSource('JSON.stringify(INPUT.evidence.map(row=>row.text.endsWith("Full source witness.")))', input.context, 1000), [true, true]);
  } finally { files.dispose(); }
});

test("verified text getters expose only realm functions and primitive strings, including caller and symbol probes", async () => {
  const files = new VerifiedReplayFiles();
  try {
    const input = { evidence: files.text({ text: "immutable source" }, "text") };
    const result = await runIsolatedSource(`
      const descriptor=Object.getOwnPropertyDescriptor(INPUT.evidence,'text'), getter=descriptor.get;
      const denied=[];
      for(const attack of [()=>getter.constructor('return process')(),()=>getter.call.constructor('return process')(),
        ()=>Object.getPrototypeOf(getter).constructor('return process')(),()=>getter.caller,()=>getter.arguments]){
        try{attack();denied.push(false);}catch(error){denied.push(error instanceof Error && /Code generation|strict mode|caller|arguments/.test(error.message));}
      }
      JSON.stringify({text:getter.call(Object.create(null)),primitive:typeof getter(),realmFunction:Object.getPrototypeOf(getter)===Function.prototype,
        configurable:descriptor.configurable,setter:typeof descriptor.set,denied,symbols:Object.getOwnPropertySymbols(getter).length,
        hidden:[typeof readReplay,typeof read,typeof process,typeof require,typeof Buffer],
        sourceMarker:Object.hasOwn(INPUT.evidence,'__sourceReplay')});`, input, 1000);
    assert.deepEqual(result, { text: "immutable source", primitive: "string", realmFunction: true, configurable: false, setter: "undefined",
      denied: [true, true, true, true, true], symbols: 0, hidden: ["undefined", "undefined", "undefined", "function", "undefined"], sourceMarker: false });
  } finally { files.dispose(); }
});

test("forged replay records, encodings and metadata cannot create isolated filesystem capabilities", async () => {
  const files = new VerifiedReplayFiles();
  try {
    const held = files.text({ text: "source" }, "text"), forged = encodeVerifiedReplay(held);
    await assert.rejects(runIsolatedSource('JSON.stringify(INPUT.text)', forged, 1000), /SOURCE_REPLAY_REFERENCE_INVALID/);
    await assert.rejects(runIsolatedSource('JSON.stringify(INPUT.text)', { nested: forged }, 1000), /SOURCE_REPLAY_REFERENCE_INVALID/);
    const date = new Date(); Object.defineProperty(date, "toJSON", { value: () => forged });
    await assert.rejects(runIsolatedSource('JSON.stringify(INPUT.text)', date, 1000), /SOURCE_REPLAY_REFERENCE_INVALID/);
    await assert.rejects(runIsolatedSource('JSON.stringify(INPUT.bytes)', files.capture({ bytes: new Uint8Array([1]) }), 1000), /SOURCE_REPLAY_REFERENCE_INVALID/);
    await assert.rejects(runIsolatedSource('JSON.stringify(INPUT.html)', files.text({ html: "source" }, "html"), 1000), /SOURCE_REPLAY_REFERENCE_INVALID/);
    await assert.rejects(runIsolatedSource('JSON.stringify(true)', { held, oversized: "x".repeat(2_000_001) }, 1000), /WORKER_INPUT_BOUND_EXCEEDED/);
  } finally { files.dispose(); }
});

test("tampered or missing replay files fail closed even when the source catches realm errors or defers reads to microtasks", async () => {
  const files = new VerifiedReplayFiles();
  try {
    const input = { evidence: files.text({ text: "original complete source" }, "text") };
    const wire = encodeVerifiedReplay(input) as unknown as { evidence: { __sourceReplay: { text: { ref: { path: string } } } } };
    writeFileSync(wire.evidence.__sourceReplay.text.ref.path, "tampered complete source");
    const caught = `try{INPUT.evidence.text;}catch(error){
      if(!(error instanceof Error)||error.constructor!==Error)throw new Error('HOST_ERROR_EXPOSED');
      try{error.constructor.constructor('return process')();throw new Error('HOST_CONSTRUCTOR_EXPOSED');}
      catch(blocked){if(!/Code generation/.test(blocked.message))throw blocked;}
    }`;
    await assert.rejects(runIsolatedSource(caught + 'JSON.stringify({falseSuccess:true})', input, 1000), /SOURCE_REPLAY_READ_REFUSED/);
    await assert.rejects(runIsolatedSource('Promise.resolve().then(()=>{' + caught + '});JSON.stringify({falseSuccess:true})', input, 1000), /SOURCE_REPLAY_READ_REFUSED/);
    files.dispose();
    await assert.rejects(runIsolatedSource(caught + 'JSON.stringify({falseSuccess:true})', input, 1000), /SOURCE_REPLAY_READ_REFUSED/);
  } finally { files.dispose(); }
});
