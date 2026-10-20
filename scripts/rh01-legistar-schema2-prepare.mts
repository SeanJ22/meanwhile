/** Offline native v2 instructions grounded in the held Pima API and genuine SCOUT publisher page. */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { GeneralizedCivicExtractionContract, WorkerEvidence } from "../lib/control-plane/workers/types.ts";

// Preparation copies only already-held objects. Even an accidental native read cannot send a request.
globalThis.fetch = () => { throw Error("RH01_OFFLINE_SOURCE_PREPARATION_NETWORK_FORBIDDEN"); };
const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string) => { const value = option(name); if (!value) throw Error(`RH01 missing --${name}`); return resolve(value); };
const source = required("source-held"), scoutSource = required("source-scout"), directory = required("out"), codeRoot = required("code-root");
const code = (file: string) => import(pathToFileURL(join(codeRoot, file)).href);
const [{ createFileRepositories }, { DurableEvidenceStore }, { researchVaultResolver }, { assertVaultedResearchEvidence },
  { inventoryRecordEvidence }, { registerAutonomousPlan }, { enqueueWorkerTask }, { canonicalJson }] = await Promise.all([
  code("lib/control-plane/repository/file-store.ts"), code("lib/control-plane/evidence/durable-store.ts"), code("lib/control-plane/workers/vault-object.ts"),
  code("lib/control-plane/workers/acquirer.ts"), code("lib/control-plane/workers/record-evidence.ts"), code("lib/control-plane/workers/coordinator.ts"),
  code("lib/control-plane/workers/runtime.ts"), code("lib/control-plane/repository/types.ts"),
]);
const heldManifest = JSON.parse(await readFile(join(source, "rh01-held-replay.json"), "utf8"));
const scoutManifest = JSON.parse(await readFile(join(scoutSource, "rh01-model-replay.json"), "utf8"));
const held = await createFileRepositories(source), scout = await createFileRepositories(scoutSource);
const item = await held.workItems.mustRead(heldManifest.workItemId);
if (item.value.autonomousPlan) throw Error("RH01 original source already has immutable work instructions");
const primaryRows = (await held.artifacts.read(item.id) as ArtifactRecord[]).filter(row => row.artifactId === heldManifest.artifactId);
if (primaryRows.length !== 1) throw Error("RH01 held API identity is absent or ambiguous");
const primaryRow = primaryRows[0], primaryAttempt = await held.attempts.mustRead(primaryRow.attemptId);
const primaryTask = await held.routeTasks.mustRead(primaryRow.routeTaskId);
if (primaryAttempt.value.outcome !== "COMPLETED" || primaryAttempt.value.worker.role !== "ACQUIRER") throw Error("RH01 held API lacks its actual completed acquisition");
const primary = await researchVaultResolver(held, new DurableEvidenceStore(join(source, "vault"), { remote: null }), item.value.project)(primaryRow.artifactId);
assertVaultedResearchEvidence(primary, primaryRow.artifactId, item.value.project);
const text = new TextDecoder().decode(primary.bytes), rows: unknown = JSON.parse(text);
const subjectId = "ocd-division/country:us/state:az/county:pima#governing";
if (item.value.subject !== subjectId || !Array.isArray(rows) || !rows.length || rows.some(row => row?.EventBodyId !== 138 || row.EventBodyName !== "Board of Supervisors"))
  throw Error("RH01 source does not bind only the actual Pima Board of Supervisors");
const apiUrl = primary.artifact.canonicalUrl;
if (!decodeURIComponent(apiUrl).includes("EventBodyId eq 138")) throw Error("RH01 API URL has no exact body 138 filter");
const scoutTask = await scout.routeTasks.mustRead(scoutManifest.tasks.SCOUT), scoutItem = await scout.workItems.mustRead(scoutTask.value.workItemId);
if (scoutTask.value.state !== "DISPOSED" || scoutTask.value.attemptIds.length !== 1) throw Error("RH01 actual SCOUT has not completed");
const scoutAttempt = await scout.attempts.mustRead(scoutTask.value.attemptIds[0]);
if (scoutAttempt.value.outcome !== "COMPLETED") throw Error("RH01 SCOUT's publisher evidence has no completed Attempt");
const publisherRows = (await scout.artifacts.read(scoutItem.id) as ArtifactRecord[]).filter(row => row.canonicalUrl === "https://www.pima.gov/board-of-supervisors" && !row.partial);
if (publisherRows.length !== 1) throw Error("RH01 SCOUT's actual government publisher page is absent or ambiguous");
const publisherRow = publisherRows[0];
const publisher = await researchVaultResolver(scout, new DurableEvidenceStore(join(scoutSource, "vault"), { remote: null }), scoutItem.value.project)(publisherRow.artifactId);
assertVaultedResearchEvidence(publisher, publisherRow.artifactId, item.value.project);
const publisherText = new TextDecoder().decode(publisher.bytes), vendor = "https://pima.legistar.com/Calendar.aspx", vendorAt = publisherText.indexOf(vendor);
const publisherTitle = /<title[^>]*>([^<]+)<\/title\s*>/i.exec(publisherText);
if (vendorAt < 0 || !publisherTitle || !/Board of Supervisors/i.test(publisherTitle[1]) || !/Pima County/i.test(publisherTitle[1]))
  throw Error("RH01 actual first-party page does not establish this board and its Legistar link");
const titleAt = publisherTitle.index + publisherTitle[0].indexOf(">") + 1;
const span = (reading: typeof primary, start: number, quote: string) => ({ artifactId: reading.artifact.id, contentHash: reading.artifact.contentHash,
  start, end: start + quote.length, quote, offsetUnit: "UTF16_CODE_UNITS" });
const bodyQuote = '"Board of Supervisors"', bodyAt = text.indexOf(bodyQuote);
if (bodyAt < 0) throw Error("RH01 exact body-name observation is absent");
const at = new Date().toISOString(), methodVersion = primaryAttempt.value.methodVersion;
const fields = { EventId: { source: "/EventId", type: "NUMBER" }, EventBodyId: { source: "/EventBodyId", type: "NUMBER" },
  EventBodyName: { source: "/EventBodyName", type: "STRING" }, EventDate: { source: "/EventDate", type: "STRING" }, EventTime: { source: "/EventTime", type: "STRING" } } as const;
const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "LEGISTAR_EVENTS", subjectId,
  requiredFields: Object.keys(fields), identity: { namespace: "legistar:pima:body:138", keyFields: ["EventId"] },
  jurisdiction: { country: "US", state: "AZ", canonicalId: "ocd-division/country:us/state:az/county:pima" }, methodVersion,
  completenessScope: "Every body 138 event row in this exact captured API URL and its encoded date window. This is not all past or future board meetings.", expectedSourceDate: null,
  sourceScope: { sourceId: "webapi.legistar.com", publisher: "Pima County Board of Supervisors", routeIds: ["scout:fetch_public"],
    canonicalUrls: [apiUrl], observationArtifactIds: [primary.artifact.id, publisher.artifact.id] },
  extraction: { format: "JSON_RECORDS", rowsPointer: "", fields }, verification: { required: false, authorities: [] } };
const inventory = inventoryRecordEvidence({ ...primary.artifact, artifactId: primary.artifact.id, text } as WorkerEvidence, contract.extraction);
if (inventory.rows.length !== rows.length) throw Error("RH01 native source mapping did not preserve every captured API event");
const route = { id: "scout:fetch_public", subjectId, jurisdiction: "AZ", recordClass: contract.recordClass, sourceId: contract.sourceScope.sourceId,
  publisher: contract.sourceScope.publisher, url: apiUrl, observedLocator: apiUrl,
  observedAt: publisher.artifact.retrievedAt, firstObservedAt: primary.artifact.retrievedAt, methodVersion, permission: primary.artifact.permission,
  observation: span(primary, bodyAt, bodyQuote), publisherSubjectEvidence: [span(publisher, titleAt, publisherTitle[1]), span(publisher, vendorAt, vendor)],
  applicableBecause: "The immutable API capture contains only body 138 Board of Supervisors rows; the completed actual SCOUT saved the official Pima County board page and its explicit Legistar link.",
  nextRouteIds: [], retrieval: "fetch_public" };
const plan = { version: 1, capability: "meetings", jurisdiction: "AZ", sourceRegistryReferences: [subjectId, primary.artifact.id, publisher.artifact.id],
  seedUrls: [apiUrl, publisher.artifact.canonicalUrl], sources: [route], acquisition: [{ route, held: [] }], auditScope: "CAPTURED_ARTIFACT", contract };
await mkdir(directory, { recursive: false });
// Preserve the actual held method floor for the later standalone File worker,
// copying files without materializing the country's manual in this process.
await mkdir(join(directory, "aggregates"));
await cp(join(source, "aggregates/field-manual-entries"), join(directory, "aggregates/field-manual-entries"),
  { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
const repos = await createFileRepositories(directory), vault = new DurableEvidenceStore(join(directory, "vault"), { remote: null });
for (const row of [item, scoutItem]) await repos.workItems.put(row.id, row.value, row.updatedAt);
for (const row of [primaryTask, scoutTask]) await repos.routeTasks.put(row.id, row.value, row.updatedAt);
for (const row of [primaryAttempt, scoutAttempt]) await repos.attempts.put(row.id, row.value, row.updatedAt);
for (const [row, reading, root] of [[primaryRow, primary, source], [publisherRow, publisher, scoutSource]] as const) {
  await repos.artifacts.append(row.workItemId, row.artifactId, row, row.recordedAt);
  const meta = JSON.parse(await readFile(join(root, "vault", reading.key + ".meta.json"), "utf8")).meta;
  await vault.put(reading.key, reading.bytes, meta);
}
await registerAutonomousPlan(repos, item.id, plan, at);
const task = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId: primary.artifact.id, contract,
  acquisition: { route, held: [] }, purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH-01:v2-actual-Pima-API:${at}`, now: at });
if (task.state !== "PENDING" || task.attemptIds.length) throw Error("RH01 new native v2 acquisition is not untouched pending work");
const manifest = { format: 2, phase: "after", root: directory, codeRoot, preparedAt: at, productionQueries: 0, sourceGETs: 0, paidCalls: 0,
  methodKnowledgeSource: join(source, "aggregates/field-manual-entries"),
  nativeHandoff: { workItemId: item.id, acquirerTaskId: task.id, plan, sourceWorkItemIds: [item.id, scoutItem.id],
    sourceRouteTaskIds: [primaryTask.id, scoutTask.id, task.id], sourceAttemptIds: [primaryAttempt.id, scoutAttempt.id],
    sourceArtifacts: [{ record: primaryRow, key: primary.key }, { record: publisherRow, key: publisher.key }],
    mappedHeldRows: inventory.rows.length, officeOrOtherBodyClaims: false,
    note: "New native v2 instructions. Old v1 tasks/results are unchanged. Mutable API capture was five days old, so no future cache expiry is invented; the pending ACQUIRER must do its normal free read." },
  originalTaskProof: { id: primaryTask.id, value: canonicalJson(primaryTask.value) } };
await writeFile(join(directory, "rh01-model-replay.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
console.log(`RH01_SCHEMA2_PREPARED ${JSON.stringify({ directory, subjectId, taskId: task.id, pending: true, rows: inventory.rows.length, productionReadBytes: 0, sourceGETs: 0, paidCalls: 0 })}`);
