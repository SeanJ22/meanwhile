import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { BallotSet, BallotSourceCorpusReference, MeasureSourceReference } from "../lib/ballot/types.ts";
import { checkedEvidenceBody, type EvidenceStore, type ObjectMeta } from "../lib/control-plane/evidence/store.ts";
import type { BallotSourceCorpusEntry } from "../lib/ballot/source-corpus.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { parseCsv } from "../lib/reference/csv.ts";
import type { ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";

const option = (name: string) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = option("mode"), directory = resolve(option("directory") ?? ".scratch/measure-scale");
const transfer = resolve(option("transfer") ?? "/workspace/shared/ms01-vault-transfer");
const started = performance.now(), at = "2026-10-15T19:00:00.000Z";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const nationalStates = US_JURISDICTIONS.filter(state => state.prefix !== "territory");
const statistics = { vaultReads: 0, vaultBytes: 0, maximumVaultDocumentBytes: 0 };
type CatalogObject = { key: string; path: string; meta: ObjectMeta };
type Government = { id: string; state: string; name: string; type: string; dependent: boolean };

async function catalogObject(key: string): Promise<CatalogObject | null> {
  try { return JSON.parse(await readFile(join(directory, "catalog", `${digest(key)}.json`), "utf8")) as CatalogObject; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function fileVault(): EvidenceStore {
  return {
    put: async () => { throw new Error("The scale replay is read only."); },
    get: async () => { throw new Error("The measure worker must stream source bytes."); },
    head: async key => (await catalogObject(key))?.meta ?? null,
    list: async () => { throw new Error("The measure worker must read exact source keys."); },
    stream: async key => {
      const object = await catalogObject(key);
      if (!object) return null;
      statistics.vaultReads++;
      statistics.maximumVaultDocumentBytes = Math.max(statistics.maximumVaultDocumentBytes, object.meta.byteLength);
      const body = Readable.toWeb(createReadStream(object.path, { highWaterMark: 64 * 1024 })) as ReadableStream<Uint8Array>;
      return { key, meta: object.meta, body: checkedEvidenceBody(key, body, object.meta, object.meta.contentHash).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { statistics.vaultBytes += chunk.byteLength; controller.enqueue(chunk); },
      })) };
    },
  };
}

async function saveCatalog(object: CatalogObject) {
  await writeFile(join(directory, "catalog", `${digest(object.key)}.json`), JSON.stringify(object));
}

async function* csvRecords(path: string) {
  let headers: string[] | undefined, pending = "";
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    pending += `${line}\n`;
    if ((pending.match(/"/g)?.length ?? 0) % 2) continue;
    const cells = parseCsv(pending)[0]; pending = "";
    if (!headers) { headers = cells; continue; }
    yield Object.fromEntries(headers.map((field, index) => [field, cells[index] ?? ""]));
  }
  assert.equal(pending.trim(), "");
}

async function prepare() {
  await mkdir(join(directory, "catalog"), { recursive: true });
  await mkdir(join(directory, "governments"), { recursive: true });
  const objects = JSON.parse(await readFile(join(transfer, "objects.json"), "utf8")) as CatalogObject[];
  for (const object of objects) await saveCatalog({ ...object, path: join(transfer, object.path) });
  const files = new Map(nationalStates.map(state => [state.usps, createWriteStream(join(directory, "governments", `${state.usps}.jsonl`))]));
  const counts: Record<string, number> = {}, kinds: Record<string, number> = {}, identities = new Set<string>();
  try {
    for (const dependent of [false, true]) {
      for await (const row of csvRecords(join(process.cwd(), "data/reference", dependent ? "census_govt_units_2022_dependent_school_systems.csv" : "census_govt_units_2022.csv"))) {
        const state = nationalStates.find(state => state.fips === row.fips_state.padStart(2, "0"));
        assert.ok(state, `Unknown Census FIPS ${row.fips_state}`);
        const id = row.census_id_pid6.trim();
        assert.match(id, /^\d{6}$/);
        assert.ok(!identities.has(id), `Duplicate Census identity ${id}`); identities.add(id);
        const government: Government = { id, state: state.usps, name: row.unit_name, type: row.gov_type, dependent };
        const file = files.get(state.usps)!;
        if (!file.write(`${JSON.stringify(government)}\n`)) await once(file, "drain");
        counts[state.usps] = (counts[state.usps] ?? 0) + 1;
        kinds[row.gov_type] = (kinds[row.gov_type] ?? 0) + 1;
      }
    }
  } finally { await Promise.all([...files.values()].map(async file => { file.end(); await once(file, "finish"); })); }
  assert.equal(identities.size, 92_150);
  const result = { objects: objects.length, states: nationalStates.length, units: identities.size, joinKey: "census_id_pid6", counts, kinds };
  await writeFile(join(directory, "prepared.json"), JSON.stringify(result, null, 2));
  return result;
}

async function verifyHeld() {
  const { validateBallotMeasureEvidence } = await import("../lib/ballot/measure-evidence.ts");
  const vault = fileVault();
  let measures = 0, ballots = 0, manifests = 0;
  const states: { state: string; measures: number; milliseconds: number; bytes: number; peakRssBytes: number }[] = [];
  for (const state of nationalStates.filter(state => !option("state") || state.usps === option("state"))) {
    const start = performance.now(), before = statistics.vaultBytes;
    let file: { ballots: Record<string, BallotSet> };
    try { file = JSON.parse(await readFile(join(process.cwd(), "data/ballot/2026-general", `${state.slug}.json`), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { states.push({ state: state.usps, measures: 0, milliseconds: performance.now() - start, bytes: 0, peakRssBytes: process.resourceUsage().maxRSS * 1024 }); continue; } throw error; }
    let count = 0;
    for (const ballot of Object.values(file.ballots)) {
      await validateBallotMeasureEvidence(ballot, vault);
      const reads = statistics.vaultReads;
      await validateBallotMeasureEvidence(ballot, vault, ballot);
      assert.equal(statistics.vaultReads, reads, "Current state evidence reread a source body.");
      count += ballot.measures.length; ballots++; manifests += Number(Boolean(ballot.sourceCorpus));
    }
    measures += count;
    states.push({ state: state.usps, measures: count, milliseconds: performance.now() - start, bytes: statistics.vaultBytes - before, peakRssBytes: process.resourceUsage().maxRSS * 1024 });
  }
  return { states, ballots, measures, manifests, currentReplaySourceReads: 0, databaseReadBytes: 0, databaseWriteBytes: 0 };
}

async function styles() {
  const count = Number(option("styles") ?? "20000");
  assert.ok(Number.isSafeInteger(count) && count > 0);
  const file = JSON.parse(await readFile(join(process.cwd(), "data/ballot/2026-general/de.json"), "utf8")) as { ballots: Record<string, BallotSet> };
  const ballot = Object.values(file.ballots)[0];
  const { readBallotSourceCorpus } = await import("../lib/ballot/source-corpus.ts");
  const { validateBallotMeasureEvidence } = await import("../lib/ballot/measure-evidence.ts");
  let sample: BallotSourceCorpusEntry | undefined;
  for await (const entry of readBallotSourceCorpus(fileVault(), ballot.sourceCorpus!)) {
    if (/\/\d+-\d+\.html$/.test(entry.source.sourceUrl) && (!sample || entry.source.vault.byteLength > sample.source.vault.byteLength)) sample = entry;
  }
  assert.ok(sample);
  const original = await catalogObject(sample.source.vault.key); assert.ok(original);
  const path = join(directory, `styles-${count}.ndjson`), output = createWriteStream(path), hash = createHash("sha256");
  let bytes = 0;
  for (let index = 0; index < count; index++) {
    const id = String(index).padStart(8, "0"), url = `https://ms01-benchmark.gov/ballot-style/${id}.html`;
    const source: MeasureSourceReference = { ...sample.source, sourceUrl: url, vault: { ...sample.source.vault,
      key: `project/freshness/source/ms01-benchmark.gov/2026/10/15/style-${id}/sha256-${sample.source.sourceHash}.html` } };
    await saveCatalog({ key: source.vault.key, path: original.path, meta: { ...original.meta, custom: { ...original.meta.custom, canonicalUrl: url } } });
    const entry = { source, receipt: { ...sample.receipt, requestedUrl: url, finalUrl: url } };
    const line = `${JSON.stringify(entry)}\n`; hash.update(line); bytes += Buffer.byteLength(line);
    if (!output.write(line)) await once(output, "drain");
  }
  output.end(); await once(output, "finish");
  const sourceHash = hash.digest("hex"), sourceCorpus: BallotSourceCorpusReference = { ...ballot.sourceCorpus!, sourceHash, documentCount: count,
    vault: { contentType: "application/x-ndjson", byteLength: bytes,
      key: `project/freshness/source/ballot-corpus-de/2026/10/15/ms01-scale/sha256-${sourceHash}.ndjson` } };
  await saveCatalog({ key: sourceCorpus.vault.key, path, meta: { contentType: sourceCorpus.vault.contentType, contentHash: `sha256-${sourceHash}`,
    byteLength: bytes, objectClass: "IMMUTABLE_BODY", custom: { format: sourceCorpus.format, state: sourceCorpus.state, electionId: sourceCorpus.electionId,
      reviewedAt: sourceCorpus.reviewedAt, reviewedBy: sourceCorpus.reviewedBy } } });
  Object.assign(statistics, { vaultReads: 0, vaultBytes: 0, maximumVaultDocumentBytes: 0 });
  const generated: BallotSet = { ...ballot, sourceCorpus }, start = performance.now();
  await validateBallotMeasureEvidence(generated, fileVault());
  const firstMilliseconds = performance.now() - start, reads = statistics.vaultReads, current = performance.now();
  await validateBallotMeasureEvidence(generated, fileVault(), generated);
  assert.equal(statistics.vaultReads, reads);
  return { state: "DE", styles: count, bytesPerStyle: original.meta.byteLength, manifestBytes: bytes,
    firstMilliseconds, currentMilliseconds: performance.now() - current, currentReplaySourceReads: 0,
    sourceSample: sample.source.sourceUrl, generatedSourceIdentities: true, databaseReadBytes: 0, databaseWriteBytes: 0 };
}

async function writer() {
  const { scaleDatabase } = await import("./measure-scale-database.mts");
  const database = await scaleDatabase(option("pg-driver") ?? "/tmp/ms01-benchmark-tools/node_modules/pg/lib/index.js");
  try {
    if (option("schema") === "create") await database.schema();
    const { createPgRepositories } = await import("../lib/control-plane/repository/pg-store.ts");
    const { createMemoryRepositories } = await import("../lib/control-plane/repository/memory.ts");
    const { PLAYBOOK_SEED_ROWS } = await import("../lib/control-plane/playbook-seed.ts");
    const { PostgresRoutineDataStore } = await import("../lib/civic-data/store.ts");
    const { runNationalMeasureTranslations } = await import("../lib/translate/national.ts");
    const { manualProjectionCandidate } = await import("../lib/civic-data/manual-projections.ts");
    const { processRegisteredManualCandidate } = await import("../lib/civic-data/promotion.ts");
    const { publishRoutineReaderEdgeOutcome } = await import("../lib/civic-data/reader-edge-publication.ts");
    const { publishPlaceReaderEdgeOutcome } = await import("../lib/civic-data/place-edge-publication.ts");
    const { LocalFileArtifactStore } = await import("../lib/meetings/edge-store.ts");
    const { ensureReaderAuthorityEdge } = await import("../lib/meetings/edge-serving.ts");
    const repos = await createPgRepositories(process.env.DATABASE_URL!, at, { skipBootstrap: true });
    const testRepos = { ...repos, locks: createMemoryRepositories().locks };
    for (const row of PLAYBOOK_SEED_ROWS.filter(row => row.role === "MEASURE_WRITER" || row.role === "MEASURE_CHECKER")) {
      if (!await repos.fieldManual.read(row.id)) await repos.fieldManual.put(row.id, row, at);
    }
    const state = option("state") ?? "CO", limit = Number(option("places") ?? "1"), perPlace = Number(option("measures") ?? "1");
    const phase = option("phase") ?? "both", publishInputs = option("publish-inputs") === "1";
    const jurisdiction = nationalStates.find(row => row.usps === state); assert.ok(jurisdiction);
    const statements = { whatItDoes: "The levy funds library services.", yesMeans: "A YES vote adopts the levy.", noMeans: "A NO vote keeps the current levy." };
    const sourceText = `${Object.values(statements).join(" ")}\n${"The library provides books and public services.\n".repeat(5700)}${option("source-revision") ?? ""}`;
    const prefix = option("prefix") ?? "benchmark";
    assert.match(prefix, /^[a-z0-9-]+$/);
    const sourceHash = digest(sourceText), sourcePath = join(directory, `generated-law-${state}-${prefix}-${sourceHash}.txt`); await writeFile(sourcePath, sourceText);
    const sourceBytes = Buffer.byteLength(sourceText);
    let requests = 0, sourceReads = 0, measureCount = 0, rawPlaces = 0;
    const edgeBytes = { readBytes: 0, writtenBytes: 0, immutableWrites: 0, manifestWrites: 0, readerRequests: 0 };
    const databaseUrl = new URL(process.env.DATABASE_URL!);
    assert.ok(["postgres:", "postgresql:"].includes(databaseUrl.protocol));
    const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
    assert.match(databaseName, /^[a-z][a-z0-9_]*$/);
    const artifacts = new LocalFileArtifactStore(join(directory, "reader-artifacts", databaseName, state));
    const artifactStore = new Proxy(artifacts, { get(target, name) {
      if (name === "readManifest") return async (...args: Parameters<typeof artifacts.readManifest>) => {
        const value = await target.readManifest(...args); if (value) edgeBytes.readBytes += Buffer.byteLength(JSON.stringify(value.manifest)); return value;
      };
      if (name === "readBytes") return async (key: string) => { const value = await target.readBytes(key); edgeBytes.readBytes += value?.byteLength ?? 0; return value; };
      if (name === "putImmutable") return async (...args: Parameters<typeof artifacts.putImmutable>) => {
        const value = await target.putImmutable(...args); edgeBytes.writtenBytes += args[0].byteLength; edgeBytes.immutableWrites++; return value;
      };
      if (name === "writeManifest") return async (...args: Parameters<typeof artifacts.writeManifest>) => {
        const value = await target.writeManifest(...args); if (value.modified) { edgeBytes.writtenBytes += Buffer.byteLength(JSON.stringify(args[0])); edgeBytes.manifestWrites++; } return value;
      };
      const value = Reflect.get(target, name); return typeof value === "function" ? value.bind(target) : value;
    } });
    const rawStore = new PostgresRoutineDataStore();
    const transport: ModelTransport = async request => {
      requests++;
      const payload = JSON.parse(request.messages[0].content as string);
      const sentences = Object.entries(statements).map(([field, text]) => ({ field, text, quote: text }));
      const result = request.tools[0].name === "write_measure_translation" ? {
        measure: { contestId: payload.subject.contestId, ...statements, parts: [], sourceUrl: payload.sourceUrl,
          sourceHash: payload.sourceHash, writtenAt: payload.writtenAt }, sentences,
      } : { checked: payload.proposal.sentences.map((row: { field: string; text: string }) => ({ ...row, supported: true })) };
      return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "scale-fixture", name: request.tools[0].name, input: result }],
        usage: { input_tokens: 100, output_tokens: 50 } };
    };
    const readPlaces = async function* () {
      let count = 0;
      for await (const line of createInterface({ input: createReadStream(join(directory, "governments", `${state}.jsonl`)), crlfDelay: Infinity })) {
        const government = JSON.parse(line) as Government;
        assert.match(government.id, /^\d{6}$/);
        const division = `ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}/special:${prefix}_${government.id}`;
        const sourceUrl = `https://ms01-benchmark.gov/${state}/${prefix}/${government.id}/law`;
        const source: MeasureSourceReference = { sourceUrl, sourceHash, retrievedAt: at, publisher: "Generated scale fixture",
          vault: { key: `project/freshness/source/ms01-benchmark.gov/2026/10/15/${prefix}-${government.id}/sha256-${sourceHash}.txt`, byteLength: sourceBytes, contentType: "text/plain" } };
        await saveCatalog({ key: source.vault.key, path: sourcePath, meta: { contentType: "text/plain", contentHash: `sha256-${sourceHash}`, byteLength: sourceBytes,
          objectClass: "IMMUTABLE_BODY", custom: { canonicalUrl: sourceUrl, tier: "RAW" } } });
        const election = { id: `${state.toLowerCase()}-scale`, state, name: "Generated scale election", date: "2026-11-03" };
        const provenance = { sourceUrl, sourceOrg: "Generated scale fixture", collectedAt: at, verifiedAt: at };
        const ids = Array.from({ length: perPlace }, (_, index) => `${prefix}:${government.id}:${index}`);
        const ballot: BallotSet = { election, contests: ids.map(id => ({ id, electionId: election.id, type: "MEASURE", title: "Library levy", ocdId: division,
          divisionVintage: "Generated scale fixture", measureTextUrl: sourceUrl, provenance, voteFor: null, termYears: null, scopeNote: null })),
          measures: ids.map(contestId => ({ id: `${contestId}#question`, contestId, questionText: "Shall the levy be adopted?", officialStatement: null, officialText: source, provenance })),
          measureRecords: ids.map(contestId => ({ contestId, ...statements, parts: [], sourceUrl, sourceHash, writtenAt: at })), candidacies: [], absences: [] };
        let sourceBallot: { scope: string; versionId: string } | undefined;
        if (publishInputs) {
          const candidate = manualProjectionCandidate({ contractId: "ballot-measures", version: "ms01-generated-scale", sourceThrough: at,
            sourceReceipt: { contractVersion: 1, reviewedAt: at, reviewedBy: "Generated scale fixture", sources: [{ requestedUrl: sourceUrl,
              finalUrl: sourceUrl, retrievedAt: at, httpStatus: 200, rawHash: sourceHash, publisher: "Generated scale fixture",
              sourceClass: "OFFICIAL_PUBLISHER", reviewedEvidence: "Generated isolated benchmark source and reference." }] },
            payload: { kind: "ballot-measures", ocdId: division, ballots: { [`${state}:${election.id}`]: ballot } } });
          process.env.WTP_RUNTIME_AUTHORITY_CONTRACT = "ballot-measures";
          try {
            const publication = await processRegisteredManualCandidate(rawStore, "ballot-measures", candidate, at, undefined, { vault: fileVault() });
            assert.ok(publication.promoted && publication.readerReadback?.status === "PASS", JSON.stringify(publication)); rawPlaces++;
            sourceBallot = { scope: publication.promoted.scope, versionId: publication.promoted.versionId };
            assert.ok((await publishRoutineReaderEdgeOutcome(rawStore, new Date().toISOString(), [{ recordClass: publication.promoted.recordClass, scope: sourceBallot.scope }], { artifactStore })).ok);
          } finally { process.env.WTP_RUNTIME_AUTHORITY_CONTRACT = "plain-english-translations"; }
        }
        yield { division, ballots: [ballot], sourceBallot };
        if ((count + 1) % 100 === 0) process.stderr.write(`SCALE_PROGRESS=${JSON.stringify({ state, places: count + 1, elapsedMilliseconds: performance.now() - started, ...process.memoryUsage(), database: database.bytes })}\n`);
        if (++count >= limit) break;
      }
    };
    const store = new PostgresRoutineDataStore(), vault = fileVault(), now = () => new Date().toISOString();
    database.reset();
    const firstStart = performance.now();
    const { armHunterLane, LaneOwnSpend, HUNTER_LANE_REFRESH_MS } = await import("../lib/control-plane/workers/hunter-lane-arming.ts");
    const { ModelProviderQueue } = await import("../lib/control-plane/scheduler/model-lane.ts");
    const { FleetPreSendRefusal, modelRequestWorstCaseUsd, modelResponseUsd } = await import("../lib/control-plane/fleet-safety.ts");
    const { SendBudgetRefusal } = await import("../lib/control-plane/expansion/spend-holds.ts");
    const { translationScope } = await import("../lib/translate/records.ts");
    const ownSpend = new LaneOwnSpend(), pendingCharges = new WeakMap<object, ReturnType<typeof ownSpend.begin>>();
    const batch = Object.assign(transport, { withJournal: () => batch });
    const providerQueue = new ModelProviderQueue({ requestsPerMinute: 1_000_000 });
    const arm = () => armHunterLane({ repos: testRepos, now, armingPath: resolve(option("arming") ?? join(directory, "arming-full.json")),
      messages: transport, batch, providerQueue, ownSpend, credentialConfigured: true, credentialVar: "ISOLATED_GENERATED_MODEL_FIXTURE",
      circuits: null, requestsPerMinute: 1_000_000, onCondition: line => process.stderr.write(`${line}\n`) });
    let armed = await arm();
    assert.equal(armed.closed, null, JSON.stringify(armed.closed));
    const startup = { milliseconds: performance.now() - firstStart, ...database.bytes };
    const input: Parameters<typeof runNationalMeasureTranslations>[0] = { state, readPlaces, publishPlace: async (division, currentIdentity) => {
      assert.ok((await publishPlaceReaderEdgeOutcome(store, now(), [{ recordClass: "CURATED_READER_RECORD", scope: translationScope(division), currentIdentity }], { artifactStore })).ok);
      const edge = await ensureReaderAuthorityEdge({}, artifactStore, []);
      assert.equal((await edge.translations?.load(division))?.kind, "PROMOTED");
      if (publishInputs) assert.equal((await edge.localMeasures?.load(division))?.kind, "PROMOTED");
      edgeBytes.readerRequests++;
    }, vault, store, repos: testRepos, now,
      slots: { acquire: async () => () => {} }, capacity: () => armed.guards?.paidWorkerCapacity() ?? 0,
      onCostRecorded: response => { const charge = pendingCharges.get(response); if (charge) ownSpend.recorded(charge); pendingCharges.delete(response); },
      transportFor: subject => async request => {
        if (Date.now() - Date.parse(armed.armedAt) >= HUNTER_LANE_REFRESH_MS) armed = await arm();
        assert.ok(armed.guards && !armed.closed, JSON.stringify(armed.closed));
        const charge = ownSpend.begin(translationScope(subject.ocdId), now(), modelRequestWorstCaseUsd(request) ?? 0);
        try {
          const response = await armed.guards.autonomousTransportFor(transport)({ ...subject, subjectId: subject.ocdId })(request);
          ownSpend.settle(charge, modelResponseUsd(response)); pendingCharges.set(response, charge); return response;
        } catch (error) {
          if (error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal) ownSpend.unsent(charge);
          else { ownSpend.settle(charge, null); ownSpend.finished(translationScope(subject.ocdId)); }
          throw error;
        }
      }, continueWork: () => !armed.closed, report: line => { if (!line.startsWith("RCD_PROGRESS=")) process.stderr.write(`${line}\n`); } };
    const first = phase === "current" ? [] : await runNationalMeasureTranslations(input);
    assert.ok((phase === "current" || first.length) && first.every(row => !row.error && !row.held && !row.deferred), JSON.stringify(first));
    assert.equal(ownSpend.usd(), 0, "Recorded model requests remained in the worker's pending spend.");
    measureCount = first.reduce((sum, row) => sum + row.published, 0);
    const initial = { milliseconds: performance.now() - firstStart, ...database.bytes, modelCalls: requests, vaultReads: statistics.vaultReads, edge: { ...edgeBytes } };
    assert.equal(requests, measureCount * 2);
    sourceReads = statistics.vaultReads;
    database.reset(); Object.assign(edgeBytes, { readBytes: 0, writtenBytes: 0, immutableWrites: 0, manifestWrites: 0, readerRequests: 0 }); const currentStart = performance.now();
    const current = phase === "initial" ? [] : await runNationalMeasureTranslations({ ...input,
      ...(publishInputs ? { readPlaces: undefined } : {}) });
    assert.ok(current.every(row => !row.error && !row.held && !row.deferred), JSON.stringify(current));
    if (phase === "both") assert.equal(current.reduce((sum, row) => sum + row.reused, 0), limit * perPlace);
    if (phase === "current") assert.equal(current.reduce((sum, row) => sum + row.reused, 0), limit * perPlace);
    assert.equal(statistics.vaultReads, sourceReads); assert.equal(requests, measureCount * 2);
    assert.equal(ownSpend.usd(), 0);
    return { state, places: limit, rawPlaces, phase, measuresPerPlace: perPlace, measureCount, reused: current.reduce((sum, row) => sum + row.reused, 0), sourceBytes, generatedModelResponses: true,
      startup, initial, current: { milliseconds: performance.now() - currentStart, ...database.bytes, modelCalls: 0, vaultReads: 0, edge: { ...edgeBytes } },
      databaseAccounting: "Decoded Neon HTTP request and response bodies for actual PostgreSQL18 queries; excludes TCP, WAL and physical disk bytes. Locks use an in-process test lock." };
  } finally { await database.close(); }
}

async function databaseSchema() {
  const { scaleDatabase } = await import("./measure-scale-database.mts");
  const database = await scaleDatabase(option("pg-driver") ?? "/tmp/ms01-benchmark-tools/node_modules/pg/lib/index.js");
  try {
    if (mode === "schema") await database.schema();
    const { createPgRepositories } = await import("../lib/control-plane/repository/pg-store.ts");
    const { PLAYBOOK_SEED_ROWS } = await import("../lib/control-plane/playbook-seed.ts");
    const repos = await createPgRepositories(process.env.DATABASE_URL!, at, { skipBootstrap: true });
    for (const row of PLAYBOOK_SEED_ROWS.filter(row => row.role === "MEASURE_WRITER" || row.role === "MEASURE_CHECKER")) {
      if (!await repos.fieldManual.read(row.id)) await repos.fieldManual.put(row.id, row, at);
    }
    return { schema: mode === "schema" ? "Created isolated civic and control-plane tables from repository migrations and bootstrap." : "Seeded isolated writer and checker playbooks." };
  }
  finally { await database.close(); }
}

if (!mode || !["prepare", "held", "styles", "writer", "schema", "seed"].includes(mode)) throw new Error("Pass --mode=prepare|held|styles|writer|schema|seed and --directory=<scratch path>.");
const result = mode === "prepare" ? await prepare() : mode === "held" ? await verifyHeld() : mode === "styles" ? await styles() : mode === "writer" ? await writer() : await databaseSchema();
const report = JSON.stringify({ mode, ...result, ...statistics, elapsedMilliseconds: performance.now() - started,
  peakRssBytes: process.resourceUsage().maxRSS * 1024, at, node: process.version }, null, 2);
if (option("output")) await writeFile(resolve(option("output")!), report);
console.log(report);
