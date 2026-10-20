/** New native instructions for the body name on the genuine SCOUT's saved official Pima page. */
import { cp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import type { GeneralizedCivicExtractionContract, WorkerEvidence } from "../lib/control-plane/workers/types.ts";

globalThis.fetch = () => { throw Error("RH01_OFFLINE_SOURCE_PREPARATION_NETWORK_FORBIDDEN"); };
const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string) => { const value = option(name); if (!value) throw Error(`RH01 missing --${name}`); return resolve(value); };
const source = required("source"), directory = required("out"), codeRoot = required("code-root");
if (source === directory) throw Error("RH01 new source instructions require a separate local store");
const code = (file: string) => import(pathToFileURL(join(codeRoot, file)).href);
const [{ createFileRepositories }, { DurableEvidenceStore }, { researchVaultResolver }, { assertVaultedResearchEvidence },
  { inventoryRecordEvidence }, { createWorkItem }, { registerAutonomousPlan }, { enqueueWorkerTask }] = await Promise.all([
  code("lib/control-plane/repository/file-store.ts"), code("lib/control-plane/evidence/durable-store.ts"), code("lib/control-plane/workers/vault-object.ts"),
  code("lib/control-plane/workers/acquirer.ts"), code("lib/control-plane/workers/record-evidence.ts"), code("lib/control-plane/work-item.ts"),
  code("lib/control-plane/workers/coordinator.ts"), code("lib/control-plane/workers/runtime.ts"),
]);
const previous = JSON.parse(await readFile(join(source, "rh01-model-replay.json"), "utf8"));
const selected = previous.nativeHandoff.sourceArtifacts.find((row: { record: ArtifactRecord }) => row.record.canonicalUrl === "https://www.pima.gov/board-of-supervisors") as { record: ArtifactRecord; key: string } | undefined;
if (!selected) throw Error("RH01 genuine SCOUT government page is absent");
const held = await createFileRepositories(source), owner = await held.workItems.mustRead(selected.record.workItemId);
const captureTask = await held.routeTasks.mustRead(selected.record.routeTaskId!), captureAttempt = await held.attempts.mustRead(selected.record.attemptId);
if (owner.value.subject !== "ocd-division/country:us/state:az/county:pima" || captureTask.value.disposition?.attemptId !== captureAttempt.id ||
    captureAttempt.value.outcome !== "COMPLETED" || captureAttempt.value.worker.role !== "SCOUT") throw Error("RH01 source has no actual completed Pima SCOUT lineage");
const reading = await researchVaultResolver(held, new DurableEvidenceStore(join(source, "vault"), { remote: null }), owner.value.project)(selected.record.artifactId);
assertVaultedResearchEvidence(reading, selected.record.artifactId, owner.value.project);
const text = new TextDecoder().decode(reading.bytes), title = /<title>Board of Supervisors \| Pima County, AZ<\/title>/.exec(text);
if (!title || [...text.matchAll(/<title>/g)].length !== 1) throw Error("RH01 source does not establish one unambiguous official body title");
const at = new Date().toISOString(), subjectId = owner.value.subject, methodVersion = captureAttempt.value.methodVersion;
const contract: GeneralizedCivicExtractionContract = { schemaVersion: 2, recordClass: "OFFICIAL_BOARD_DIRECTORY", subjectId,
  requiredFields: ["bodyName"], identity: { namespace: `${subjectId}:official-body-title`, keyFields: ["bodyName"] },
  jurisdiction: { country: "US", state: "AZ", canonicalId: subjectId }, methodVersion,
  completenessScope: "Only the body name explicitly written in the official government page title. Body class, membership, offices and calendars remain open; this is not a complete directory.",
  expectedSourceDate: null, sourceScope: { sourceId: reading.artifact.sourceId, publisher: "Pima County government",
    routeIds: [reading.artifact.methodRouteId], canonicalUrls: [reading.artifact.canonicalUrl], observationArtifactIds: [reading.artifact.id] },
  extraction: { format: "TEXT_BLOCKS", recordStart: "<title>", recordEnd: " | Pima County, AZ</title>", fields: { bodyName: { source: "<title>", type: "STRING" } } },
  verification: { required: false, authorities: [] } };
const inventory = inventoryRecordEvidence({ ...reading.artifact, artifactId: reading.artifact.id, text } as WorkerEvidence, contract.extraction);
if (inventory.rows.length !== 1 || inventory.rows[0].bodyName.value !== "Board of Supervisors") throw Error("RH01 native mapping differs from the actual official title");
const observation = { artifactId: reading.artifact.id, contentHash: reading.artifact.contentHash, start: title.index,
  end: title.index + title[0].length, quote: title[0], offsetUnit: "UTF16_CODE_UNITS" as const };
const route = { id: reading.artifact.methodRouteId, subjectId, jurisdiction: "AZ", recordClass: contract.recordClass,
  sourceId: reading.artifact.sourceId, publisher: contract.sourceScope.publisher, url: reading.artifact.canonicalUrl, observedLocator: reading.artifact.canonicalUrl,
  observedAt: reading.artifact.retrievedAt, firstObservedAt: reading.artifact.retrievedAt, methodVersion, permission: reading.artifact.permission,
  observation, publisherSubjectEvidence: [observation], applicableBecause: "The actual completed Pima SCOUT saved this government page with the explicit Board of Supervisors title.",
  nextRouteIds: [], retrieval: "fetch_public" as const };
const plan: AutonomousWorkPlan = { version: 1, capability: "districts/geography", jurisdiction: "AZ", sourceRegistryReferences: [subjectId, reading.artifact.id],
  seedUrls: [reading.artifact.canonicalUrl], sources: [route], acquisition: [{ route, held: [] }], auditScope: "CAPTURED_ARTIFACT", contract };
// Preserve the source store and the failed API chain; only this new local copy gets the new instructions.
await cp(source, directory, { recursive: true, force: false, errorOnExist: true });
const repos = await createFileRepositories(directory);
const item = createWorkItem({ project: owner.value.project, subject: subjectId,
  obligation: "Verify the Board of Supervisors name published on Pima County's official government page",
  why: "The actual Pima SCOUT saved this official source. Confirm its explicit body name while leaving unverified fields open.",
  contract: { requiresValidation: true, requiresAudit: true }, now: at });
await repos.workItems.put(item.id, item, at); await registerAutonomousPlan(repos, item.id, plan, at);
const task = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ACQUIRER", artifactId: reading.artifact.id,
  contract, acquisition: { route, held: [] }, purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH-01:actual-official-body-title:${at}`, now: at });
if (task.state !== "PENDING" || task.attemptIds.length) throw Error("RH01 new official-source task is not untouched pending work");
const manifest = { format: 2, phase: "after", root: directory, codeRoot, preparedAt: at, productionQueries: 0, sourceGETs: 0, paidCalls: 0,
  nativeHandoff: { workItemId: item.id, acquirerTaskId: task.id, plan, sourceWorkItemIds: [owner.id, item.id],
    sourceRouteTaskIds: [captureTask.id, task.id], sourceAttemptIds: [captureAttempt.id], sourceArtifacts: [selected],
    parserExpectedFields: { bodyName: inventory.rows[0].bodyName.value }, mappedHeldRows: 1,
    note: "New county-subject official-body title instruction. No API event was relabeled; body class, members, offices and calendars stay open. Normal new acquisition remains pending." } };
await writeFile(join(directory, "rh01-model-replay.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`RH01_OFFICIAL_BODY_PREPARED ${JSON.stringify({ directory, subjectId, workItemId: item.id, taskId: task.id, bodyName: inventory.rows[0].bodyName.value,
  productionReadBytes: 0, sourceGETs: 0, paidCalls: 0 })}`);
