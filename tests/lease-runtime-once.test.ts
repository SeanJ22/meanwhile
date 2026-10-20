import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";
import { writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { knowledgeEntries, methodVersionEntry } from "./method-store-fixture.ts";
import type { MethodKnowledge } from "../lib/method/knowledge.ts";
import { finishBoxFinding, takeBoxFinding } from "../lib/control-plane/box.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { autonomousStandingRuntime, maintainAutonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { registryTransferImport } from "./helpers/promoted-fixtures.ts";
import { registryJurisdictions } from "../lib/civic-data/state-scopes.ts";
import { installPromotedValue } from "./helpers/promoted-fixtures.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { installFactReader } from "../lib/facts/db.ts";
import { rosterFactReader } from "./helpers/roster-fact-reader.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";

function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

function registryFixtureForState(state: string, value: RegistryRuntimeReadModel = registryTransferImport().projection.payload): RegistryRuntimeReadModel {
  const own = (id: string | null) => registryJurisdictions(id).includes(state.toUpperCase());
  const bodies = value.registry.bodies.filter(row => own(row.id) || own(row.ocdId) || row.alsoServesOcdIds?.some(own));
  const bodyIds = new Set(bodies.map(row => row.id));
  const bodyRosters = value.bodyRosters.filter(row => bodyIds.has(row.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => own(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(own));
  const holders = new Set([...bodyRosters.flatMap(row => row.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...value, registry: { ...value.registry, bodies,
    divisions: value.registry.divisions.filter(row => row.ocdId === "ocd-division/country:us" || own(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id) || own(id))),
    rosterReaderDispositions: value.rosterReaderDispositions.filter(row => own(row.sourceId) || holders.has(row.sourceId) || (row.canonicalId !== null && holders.has(row.canonicalId)) ||
      [...holders].some(id => id.startsWith("roster:") && id.split("#")[0] === row.sourceId.split("#")[0])) };
}

async function installRegistryRuntime(states?: readonly string[]): Promise<{ readonly value: RegistryRuntimeReadModel; readonly versionId: string }> {
  const { projection } = registryTransferImport();
  const selected = states ?? [...new Set(projection.payload.registry.divisions.flatMap(row => registryJurisdictions(row.ocdId)))];
  for (const state of selected) installPromotedValue({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(state),
    sourceId: projection.sourceId, versionId: `${projection.versionId}:${state}`, value: registryFixtureForState(state) });
  installFactReader(rosterFactReader(projection.payload.bodyRosters));
  const value = served(await readRegistryRuntimeProjection(selected), "Registry runtime");
  return { value, versionId: selected.map(state => `${projection.versionId}:${state}`).join("|") };
}



await installRegistryRuntime();

test("a lease worker builds one runtime per process with the current task's website guard", async () => {
  const source = await readFile(new URL("../lib/control-plane/workers/lease-worker.ts", import.meta.url), "utf8");
  assert.equal(source.match(/autonomousStandingRuntime\(/g)?.length, 1, "one construction site");
  assert.match(source, /shared \?\?= await buildRuntime\(\)/);
  assert.doesNotMatch(source, /WTP_LEASE_RUNTIME_PER_TASK/);
  assert.match(source, /openBytesFor: s => safety\.guardedOpenBytes\("public-web", s\)/, "the website guard follows each task's subject");
});

test("beginTask refreshes one task's worker history on a runtime that serves many tasks", async t => {
  const h = await autonomousHarness({ response: { transportError: "socket timeout" } });
  const root = await mkdtemp(join(tmpdir(), "lease-runtime-once-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const method: MethodKnowledge = { version: 56, updatedOn: "2026-09-03", routes: [] };
  await writeFieldManual(h.repos, [...knowledgeEntries(method), methodVersionEntry(method)], h.now());
  const runtime = await autonomousStandingRuntime({ root, repos: h.repos, now: h.now, auditCeilingUsd: 1 });
  const tasks = await h.repos.routeTasks.list();
  assert.ok(typeof runtime.beginTask === "function");
  for (const row of tasks) await runtime.beginTask!(row.value);
  assert.ok(runtime.repos === h.repos, "same stores across tasks");
});


test("round upkeep replays durable Scout findings once without resetting a completed build", async t => {
  const h = await autonomousHarness({ response: { transportError: "socket timeout" } });
  const root = await mkdtemp(join(tmpdir(), "box-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const method: MethodKnowledge = { version: 56, updatedOn: "2026-09-03", routes: [] };
  await writeFieldManual(h.repos, [...knowledgeEntries(method), methodVersionEntry(method)], h.now());
  const scout: ScoutResult = {
    formatVersion: 1, attemptId: "box-scout", obligationId: "box-obligation", routeTaskId: "box-task",
    workItemId: "box-send", subjectId: "body:example", routeId: null, recordClass: "meetings", providerId: null,
    reason: "saved finding", outcome: "EVIDENCE_FOUND", stoppedBy: "MODEL", rungs: [], distinctEvidenceRungs: 0,
    candidates: [], findings: [{ kind: "RECORD", summary: "Clerk", exactQuote: "Alice Adams is Clerk",
      sourceUrl: "https://example.gov/roster", subjectId: "person:alice", artifactIds: ["saved-artifact"] }],
    nextRungs: [], unverified: [], narrative: "", worker: { provider: "anthropic", model: "fixture", modelReported: null },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 1, toolCalls: 1 },
    usd: 0, elapsedMs: 1, artifactIds: ["saved-artifact"], methodCandidateIds: [], refusal: null,
    startedAt: h.now(), recordedAt: h.now(),
  };
  await h.repos.scoutResults.append(scout.obligationId, scout.attemptId, scout, scout.recordedAt);
  const start = () => maintainAutonomousStandingRuntime({ root, repos: h.repos, now: h.now,
    auditCeilingUsd: 1, environment: { NODE_ENV: "test" } });
  await start();
  const [row] = await h.repos.boxFindings.list();
  assert.equal(row.value.subjectId, "person:alice");
  assert.equal(row.value.origins[0].resultId, scout.attemptId);
  const end = new Date(Date.parse(h.now()) + 60_000).toISOString();
  const claim = (await takeBoxFinding(h.repos.boxFindings, row.id, "builder", h.now(), end))!;
  assert.equal(await finishBoxFinding(h.repos.boxFindings, row.id, claim.token, { state: "built", publicationId: "published" }, h.now()), true);
  await start();
  assert.equal((await h.repos.boxFindings.list()).length, 1);
  assert.equal((await h.repos.boxFindings.mustRead(row.id)).value.publicationId, "published");
});

test("standing upkeep projects method eligibility before opening one exact work item and rechecks a concurrent plan", async t => {
  const h = await autonomousHarness({ plan: plan => {
    assert.ok(plan.contract.schemaVersion === 2);
    return { ...plan, contract: { ...plan.contract, methodVersion: 0,
      extraction: { format: "UNSUPPORTED", mediaType: "application/json", fields: {}, reason: "The source shape remains owed" },
      sourceScope: { ...plan.contract.sourceScope, observationArtifactIds: [] } } };
  } });
  const root = await mkdtemp(join(tmpdir(), "standing-upkeep-projection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFieldManual(h.repos, [methodVersionEntry({ version: 72, updatedOn: "2026-10-20", routes: [] })], h.now());
  const race = createWorkItem({ project: h.item.project, subject: "fixture:nh:other", obligation: "Concurrent plan", why: "Preserve a new observation", now: h.now() });
  await h.repos.workItems.put(race.id, { ...race, autonomousPlan: h.item.autonomousPlan }, h.now());
  for (let index = 0; index < 125; index++) {
    const item = createWorkItem({ project: h.item.project, subject: `fixture:nh:country-${index}`, obligation: "Other work", why: "x".repeat(4000), now: h.now() });
    await h.repos.workItems.put(item.id, item, h.now());
  }
  let projectedPages = 0;
  const opened: string[] = [];
  const repos = { ...h.repos, workItems: { ...h.repos.workItems,
    listChangedSince: (...args: Parameters<NonNullable<typeof h.repos.workItems.listChangedSince>>) => {
      assert.deepEqual(args[2]?.projection, { autonomousPlan: { contract: { schemaVersion: true, methodVersion: true, extraction: ["format"], sourceScope: ["observationArtifactIds"] } } });
      projectedPages++; return h.repos.workItems.listChangedSince!(...args);
    },
    mustRead: async (id: string) => {
      assert.ok([h.item.id, race.id].includes(id), "another place's full work item never crosses the selection boundary");
      opened.push(id);
      if (id === race.id) {
        const current = await h.repos.workItems.mustRead(id), plan = current.value.autonomousPlan!;
        assert.ok(plan.contract.schemaVersion === 2);
        await h.repos.workItems.compareAndSet(id, current.revision, { ...current.value, autonomousPlan: { ...plan,
          contract: { ...plan.contract, methodVersion: 23 } } }, h.now());
      }
      return h.repos.workItems.mustRead(id);
    },
  } };
  await maintainAutonomousStandingRuntime({ root, repos, now: h.now });
  assert.equal(projectedPages, 1); assert.deepEqual(new Set(opened), new Set([h.item.id, race.id]));
  const current = (await h.repos.workItems.mustRead(h.item.id)).value;
  const initialized = current.autonomousPlan!.contract, raced = (await h.repos.workItems.mustRead(race.id)).value.autonomousPlan!.contract;
  assert.ok(initialized.schemaVersion === 2 && raced.schemaVersion === 2);
  assert.equal(initialized.methodVersion, 72);
  assert.equal(raced.methodVersion, 23, "the current observed plan is never overwritten from projected eligibility");
  assert.deepEqual({ ...current, autonomousPlan: h.item.autonomousPlan }, h.item, "method initialization preserves the rest of the work and its lifecycle");
});
