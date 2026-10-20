/** A fresh exact-011443f source/body chain. Run only in the controlled quiet window. */
import { cp, open, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { GeneralizedCivicExtractionContract } from "../lib/control-plane/workers/types.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string) => { const value = option(name); if (!value) throw Error(`RH01 missing --${name}`); return resolve(value); };
const source = required("source"), directory = required("out"), codeRoot = required("code-root");
const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registryCache = required("registry-cache");
let operationalCache = option("operational-cache") ? resolve(option("operational-cache")!) : null;
const baseline = "011443fad6cfca5bb943f5c307925808fc8974c4", county = "ocd-division/country:us/state:az/county:pima";
if (source === directory || directory.startsWith(source + "/") || source.startsWith(directory + "/")) throw Error("RH01 before preparation needs a separate untouched output store");
if (process.env.WTP_RH01_FACTS_URL || process.env.WTP_RH01_MODEL_BROKER || process.env.NODE_OPTIONS?.includes("rh01-"))
  throw Error("RH01 before preparation must start without an active shared overlay or model broker");
const { stdout: revision } = await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: codeRoot });
if (revision.trim() !== baseline) throw Error("RH01 before preparation requires exact native 011443f");
if (!operationalCache) {
  if (!process.argv.includes("--fetch-operational-reference")) throw Error("RH01 requires a saved --operational-cache or the explicitly allowed --fetch-operational-reference exact AZ read");
  const connection = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if (!connection || decodeURIComponent(new URL(connection).username) !== "readonly" || !process.env.WTP_RH01_PRODUCTION_READ_LEDGER || !process.env.WTP_RH01_RUN_ID)
    throw Error("RH01 exact AZ reference copy requires the production readonly handle and existing physical-read ledger/run identity");
  operationalCache = directory + "-operational-input.sqlite";
  const reserved = await open(operationalCache, "wx"); await reserved.close();
  // A separate process keeps the before-native reader module unmodified and
  // avoids caching it before the parent installs the local publication adapter.
  const fetchSource = `import{DatabaseSync}from'node:sqlite';
    import{installMeasurementNetworkBoundary,enableProductionReadAccounting}from${JSON.stringify(pathToFileURL(join(harnessRoot, "scripts/rh01-network.mjs")).href)};
    process.env.WTP_RH01_CODE_ROOT=${JSON.stringify(codeRoot)};process.env.DATABASE_URL=process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
    installMeasurementNetworkBoundary();enableProductionReadAccounting('before-body-preparation');
    const{PostgresRoutineDataStore}=await import(${JSON.stringify(pathToFileURL(join(codeRoot, "lib/civic-data/store.ts")).href)});
    const store=new PostgresRoutineDataStore(),scope='US-AZ:covered-jurisdiction-routing:v1';
    const pointer=await store.readPromotion('OPERATIONAL_REFERENCE',scope);
    if(!pointer||pointer.recordClass!=='OPERATIONAL_REFERENCE'||pointer.scope!==scope)throw Error('RH01 genuine exact AZ reference is not promoted');
    const candidate=await store.readCandidate(pointer.versionId);
    if(!candidate||candidate.candidate.recordClass!=='OPERATIONAL_REFERENCE'||candidate.candidate.scope!==scope)throw Error('RH01 exact AZ candidate identity differs');
    const db=new DatabaseSync(${JSON.stringify(operationalCache)});
    try{db.exec('CREATE TABLE held(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id))');
      const put=db.prepare('INSERT INTO held VALUES(?,?,?)');put.run('promotions',pointer.key,JSON.stringify(pointer));put.run('candidates',pointer.versionId,JSON.stringify(candidate));
    }finally{db.close();}
    console.log('RH01_EXACT_AZ_REFERENCE_COPIED '+JSON.stringify({scope,versionId:pointer.versionId,productionWrites:0}));`;
  const copied = await promisify(execFile)(process.execPath, ["--experimental-strip-types", "--import", join(codeRoot, "scripts/register-test-loader.mjs"), "--input-type=module", "-e", fetchSource],
    { cwd: codeRoot, env: { ...process.env, NODE_OPTIONS: "", WTP_RH01_PHASE: "before", WTP_RH01_CODE_ROOT: codeRoot,
      WTP_RH01_JOB_ID: "before-body-preparation:AZ-reference" }, maxBuffer: 1024 * 1024 });
  process.stdout.write(copied.stdout); process.stderr.write(copied.stderr);
}

interface SavedPointer { key: string; recordClass: string; scope: string; versionId: string; payload: Record<string, unknown> }
function cachedPromotion(path: string, keys: readonly string[]) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    for (const key of keys) {
      const row = db.prepare("SELECT value FROM held WHERE kind='promotions' AND id=?").get(key);
      if (!row) continue;
      const serialized = String(row.value), pointer = JSON.parse(serialized) as SavedPointer;
      if (pointer.key !== key || !pointer.versionId || !pointer.payload) throw Error("RH01 saved publication identity is invalid");
      return { pointer, serialized, cache: path, sha256: createHash("sha256").update(serialized).digest("hex") };
    }
  } finally { db.close(); }
  throw Error(`RH01 required genuine saved publication is absent: ${keys.join(",")}`);
}
const registry = cachedPromotion(registryCache, ["REGISTRY_RUNTIME_BINDING:US-AZ:reader-registry-runtime"]);
const operational = cachedPromotion(operationalCache, ["OPERATIONAL_REFERENCE:US-AZ:covered-jurisdiction-routing:v1"]);
const bodies = (registry.pointer.payload.registry as { bodies?: { id: string; ocdId: string | null; homepageUrl: string | null }[] })?.bodies;
const body = bodies?.find(row => row.id === county + "#governing" && row.ocdId === county && new URL(row.homepageUrl ?? "https://invalid.example").hostname.replace(/^www\./, "") === "pima.gov");
if (!body) throw Error("RH01 actual Pima governing body is absent from the genuine saved AZ publication");
await cp(source, directory, { recursive: true, errorOnExist: true, force: false });
process.env.WTP_RH01_PHASE = "before";
process.env.WTP_RH01_CODE_ROOT = codeRoot;
process.env.WTP_RH01_HARNESS_ROOT = harnessRoot;
process.env.WTP_RH01_DIRECTORY = directory;
process.env.WTP_RH01_SHARED_STATE_DIRECTORY = directory;
process.env.WTP_RH01_HELD_VAULT_DIRECTORY = join(directory, "vault");
delete process.env.DATABASE_URL; delete process.env.WTP_CONTROL_PLANE_DATABASE_URL;
// Seed the exact saved pointer/candidate/proof rows needed by native readers.
// No source publication, original fixture or production row is changed.
const db = new DatabaseSync(join(directory, "routine.sqlite"));
db.exec("CREATE TABLE IF NOT EXISTS held(kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id))");
const save = db.prepare("INSERT INTO held VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value");
for (const held of [registry, operational]) {
  const input = new DatabaseSync(held.cache, { readOnly: true });
  try {
    for (const row of input.prepare("SELECT kind,id,value FROM held WHERE (kind='promotions' AND id=?) OR id=?").iterate(held.pointer.key, held.pointer.versionId))
      save.run(String(row.kind), String(row.id), String(row.value));
  } finally { input.close(); }
}
db.close();
await import("./rh01-loader.mjs");
const boundedFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) &&
      (url.origin !== "https://www.pima.gov" || !["GET", "HEAD"].includes(method))) throw Error("RH01 before source preparation permits only its native official Pima GET");
  return boundedFetch(input, init);
};
const code = (file: string) => import(pathToFileURL(join(codeRoot, file)).href);
const [{ createFileRepositories }, { DurableEvidenceStore }, { researchVaultResolver }, { assertVaultedResearchEvidence }, { inventoryRecordEvidence },
  { createWorkItem }, { registerAutonomousPlan, dispatchAutonomousTask }, { enqueueWorkerTask }, { standingFleetRuntime }, { researchRoleExecutor },
  { readMethodKnowledge }, { hostSpacer }, { preloadAzOperationalReferenceBundle }, { fingerprint },
  { readRegistryRuntimeProjection }, { PostgresRoutineDataStore }] = await Promise.all([
  code("lib/control-plane/repository/file-store.ts"), code("lib/control-plane/evidence/durable-store.ts"), code("lib/control-plane/workers/vault-object.ts"),
  code("lib/control-plane/workers/acquirer.ts"), code("lib/control-plane/workers/record-evidence.ts"), code("lib/control-plane/work-item.ts"),
  code("lib/control-plane/workers/coordinator.ts"), code("lib/control-plane/workers/runtime.ts"), code("lib/control-plane/workers/standing.ts"),
  code("lib/control-plane/workers/research-runtime.ts"), code("lib/method/manual-bridge.ts"), code("lib/control-plane/scheduler/http-executor.ts"),
  code("lib/civic-data/operational-references.ts"), code("lib/control-plane/ids.ts"), code("lib/registry/runtime-read-model.ts"), code("lib/civic-data/store.ts"),
]);
const now = () => new Date().toISOString(), repos = await createFileRepositories(directory), store = new DurableEvidenceStore(join(directory, "vault"), { remote: null });
const manifest = JSON.parse(await readFile(join(source, "rh01-model-replay.json"), "utf8"));
const heldCapture = resolve(option("place-capture") ?? manifest.inputs?.heldCapture ?? join(harnessRoot, ".scratch/rh01/native-scout-prepared/actual-held-place-capture.json"));
JSON.parse(await readFile(heldCapture, "utf8"));
const original = manifest.nativeHandoff.sourceArtifacts.find((row: { record: ArtifactRecord }) => row.record.canonicalUrl === "https://www.pima.gov/board-of-supervisors") as { record: ArtifactRecord } | undefined;
if (!original) throw Error("RH01 genuine original county source observation is absent");
const originalOwner = await repos.workItems.mustRead(original.record.workItemId), originalAttempt = await repos.attempts.mustRead(original.record.attemptId);
if (originalOwner.value.subject !== county || originalAttempt.value.outcome !== "COMPLETED" || originalAttempt.value.worker.role !== "SCOUT")
  throw Error("RH01 source observation is not the genuine completed county SCOUT acquisition");
const readVault = researchVaultResolver(repos, store, originalOwner.value.project), observation = await readVault(original.record.artifactId);
assertVaultedResearchEvidence(observation, original.record.artifactId, originalOwner.value.project);
const method = await readMethodKnowledge(repos);
await preloadAzOperationalReferenceBundle({ store: new PostgresRoutineDataStore(), bypassCache: true });
const nativeRegistry = await readRegistryRuntimeProjection(["az"], { store: new PostgresRoutineDataStore(), bypassCache: true });
if (nativeRegistry.kind !== "PROMOTED" || nativeRegistry.metadata.versionId !== registry.pointer.versionId)
  throw Error("RH01 exact-before reader did not accept the genuine saved AZ registry publication");
const mapping = { format: "TEXT_BLOCKS" as const, recordStart: "<title>", recordEnd: " | Pima County, AZ</title>", fields: { bodyName: { source: "<title>", type: "STRING" as const } } };
function instructions(artifact: typeof observation.artifact, bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes), title = /<title>Board of Supervisors \| Pima County, AZ<\/title>/.exec(text);
  if (!title || [...text.matchAll(/<title>/g)].length !== 1) throw Error("RH01 official source does not establish exactly the requested body title");
  const span = { artifactId: artifact.id, contentHash: artifact.contentHash, start: title.index, end: title.index + title[0].length,
    quote: title[0], offsetUnit: "UTF16_CODE_UNITS" as const };
  const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "OFFICIAL_BOARD_DIRECTORY", subjectId: body!.id,
    requiredFields: ["bodyName"], identity: { namespace: `${body!.id}:official-body-title`, keyFields: ["bodyName"] },
    jurisdiction: { country: "US", state: "AZ", canonicalId: county }, methodVersion: method.version,
    completenessScope: "Only the body name explicitly written in the official government page title; members, offices, calendars and directory completeness remain open.",
    expectedSourceDate: null, sourceScope: { sourceId: artifact.sourceId, publisher: "Pima County government", routeIds: [artifact.methodRouteId],
      canonicalUrls: [artifact.canonicalUrl], observationArtifactIds: [artifact.id] }, extraction: mapping, verification: { required: false, authorities: [] } };
  const route = { id: artifact.methodRouteId, subjectId: body!.id, jurisdiction: "AZ", recordClass: contract.recordClass, sourceId: artifact.sourceId,
    publisher: contract.sourceScope.publisher, url: artifact.canonicalUrl, observedLocator: artifact.canonicalUrl, observedAt: artifact.retrievedAt,
    firstObservedAt: artifact.retrievedAt, methodVersion: method.version, permission: artifact.permission, observation: span, publisherSubjectEvidence: [span],
    applicableBecause: "The genuine official Pima County source explicitly names the Board of Supervisors; the saved registry identifies its governing body.", nextRouteIds: [], retrieval: "fetch_public" as const };
  return { contract, route };
}
const initial = instructions(observation.artifact, observation.bytes), at = now();
const item = createWorkItem({ project: originalOwner.value.project, subject: body.id, obligation: "Verify the official Pima governing body's published title from a fresh exact-before source acquisition",
  why: "Native 011443f owns a new source capture for this registered body; no original county artifact or failed API claim is relabeled.", contract: { requiresValidation: true, requiresAudit: true }, now: at });
await repos.workItems.put(item.id, item, at);
const runtime = standingFleetRuntime({ root: codeRoot, vaultRoot: join(directory, "vault"), repos, method, now, scopedReads: true });
const tools = { repos, store, now, spaceOut: hostSpacer() };
runtime.roleExecutor = (task: Parameters<typeof researchRoleExecutor>[2], holder: string) => researchRoleExecutor(runtime, tools, task, holder, codeRoot);
async function execute(task: Awaited<ReturnType<typeof enqueueWorkerTask>>, role: string, verdict: string) {
  const dispatched = await dispatchAutonomousTask(runtime, task);
  if (!dispatched.claimed || dispatched.outcome !== "WORKED" || !dispatched.attemptId) throw Error(`RH01 native ${role} did not complete: ${JSON.stringify(dispatched)}`);
  const records = await repos.workerResults.read(item.id), result = records.find((row: { id: string }) => row.id === `wr-${fingerprint([dispatched.attemptId])}`);
  if (!result || result.result.role !== role || result.result.verdict !== verdict || result.completion.closedAttempt.outcome !== "COMPLETED")
    throw Error(`RH01 native ${role} did not produce the requested completed result`);
  return result;
}
// ACQUIRER can use a genuine foreign observation to locate its GET, while its
// newly captured bytes and all subsequent instructions belong to this body.
const acquisitionTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId: observation.artifact.id,
  contract: initial.contract, acquisition: { route: initial.route, held: [] }, purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH01:before:fresh-body:${at}`, now: at });
const acquired = await execute(acquisitionTask, "ACQUIRER", "ACQUIRED");
const primary = acquired.result.artifacts.filter((row: { completeness: string; canonicalUrl: string }) => row.completeness === "COMPLETE" && row.canonicalUrl === initial.route.url);
if (primary.length !== 1 || primary[0].reused || acquired.result.requestCount === 0) throw Error("RH01 exact-before acquisition did not capture one fresh official source body");
const fresh = await readVault(primary[0].artifactId);
assertVaultedResearchEvidence(fresh, primary[0].artifactId, item.project);
if (fresh.artifact.workItemId !== item.id) throw Error("RH01 fresh native capture ownership differs");
const { contract, route } = instructions(fresh.artifact, fresh.bytes);
const inventory = inventoryRecordEvidence({ ...fresh.artifact, artifactId: fresh.artifact.id, text: new TextDecoder().decode(fresh.bytes) }, mapping);
if (inventory.rows.length !== 1 || inventory.rows[0].bodyName.value !== "Board of Supervisors") throw Error("RH01 native source inventory differs from the genuine body title");
const plan: AutonomousWorkPlan = { version: 1, capability: "districts/geography", jurisdiction: "AZ", sourceRegistryReferences: [body.id, registry.pointer.versionId],
  seedUrls: [route.url], sources: [route], acquisition: [{ route, held: [] }], auditScope: "CAPTURED_ARTIFACT", contract };
await registerAutonomousPlan(repos, item.id, plan, now());
const parserTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "PARSER", artifactId: fresh.artifact.id, contract, purpose: "DIAGNOSTIC_REPLAY", now: now() });
const parsed = await execute(parserTask, "PARSER", "EXTRACTED");
const validatorTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "VALIDATOR", artifactId: fresh.artifact.id, contract, producerResultId: parsed.id,
  purpose: "DIAGNOSTIC_REPLAY", now: now() });
const validated = await execute(validatorTask, "VALIDATOR", "PASS");
const audit = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ADVERSARIAL_AUDITOR", artifactId: fresh.artifact.id, contract,
  producerResultId: parsed.id, validatorResultId: validated.id, purpose: "DIAGNOSTIC_REPLAY", now: now() });
const context = await runtime.independentContext({ artifactId: fresh.artifact.id, contract, auditScope: "CAPTURED_ARTIFACT", methodVersion: runtime.methodVersion, workItemId: item.id });
const result = { phase: "before", codeRoot, nativeSha: baseline, source, directory, preparedAt: now(), tasks: { ADVERSARIAL_AUDITOR: audit.id },
  inputs: { heldCapture, subjectId: body.id, canonicalCounty: county, beforeBodyContext: { state: "AZ", subjectId: body.id,
    operationalVersionId: operational.pointer.versionId, registryVersionId: registry.pointer.versionId } }, methodVersion: method.version,
  sourceObservation: original.record, freshCapture: fresh.artifact, nativeResults: { ACQUIRER: acquired.id, PARSER: parsed.id, VALIDATOR: validated.id },
  registry: { key: registry.pointer.key, versionId: registry.pointer.versionId, sha256: registry.sha256 },
  operational: { key: operational.pointer.key, versionId: operational.pointer.versionId, sha256: operational.sha256 },
  independentContextBytes: Buffer.byteLength(JSON.stringify(context)), paidCalls: 0,
  note: "Preparation only: three genuine exact-before bodies ran with native lifecycle commits and a fresh source GET; Auditor remains pending. Original captures and failed schema1 evidence are untouched." };
await writeFile(join(directory, "rh01-model-replay.json"), JSON.stringify(result, null, 2) + "\n");
await writeFile(join(directory, "before-body-preparation-proof.json"), JSON.stringify(result, null, 2) + "\n");
console.log("RH01_BEFORE_BODY_PREPARED " + JSON.stringify(result));
