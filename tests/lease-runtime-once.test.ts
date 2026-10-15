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
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { installRegistryRuntime } from "./helpers/promoted-fixtures.ts";

await installRegistryRuntime();

test("a lease worker builds its runtime once per process; the old per-task build stays behind its switch", async () => {
  const source = await readFile(new URL("../lib/control-plane/workers/lease-worker.ts", import.meta.url), "utf8");
  assert.equal(source.match(/autonomousStandingRuntime\(/g)?.length, 1, "one construction site");
  assert.match(source, /shared \?\?= await buildRuntime\(null\)/);
  assert.match(source, /WTP_LEASE_RUNTIME_PER_TASK/);
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


test("Box preparation replays the place's durable Scout findings without resetting a completed build", async t => {
  const h = await autonomousHarness({ response: { transportError: "socket timeout" } });
  const root = await mkdtemp(join(tmpdir(), "box-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const method: MethodKnowledge = { version: 56, updatedOn: "2026-09-03", routes: [] };
  await writeFieldManual(h.repos, [...knowledgeEntries(method), methodVersionEntry(method)], h.now());
  const scout: ScoutResult = {
    formatVersion: 1, attemptId: "box-scout", obligationId: "box-obligation", routeTaskId: "box-task",
    workItemId: h.item.id, subjectId: h.item.subject, routeId: null, recordClass: "meetings", providerId: null,
    reason: "saved finding", outcome: "EVIDENCE_FOUND", stoppedBy: "MODEL", rungs: [], distinctEvidenceRungs: 0,
    candidates: [], findings: [{ kind: "RECORD", summary: "Clerk", exactQuote: "Alice Adams is Clerk",
      sourceUrl: "https://example.gov/roster", subjectId: "person:alice", artifactIds: ["saved-artifact"] }],
    nextRungs: [], unverified: [], narrative: "", worker: { provider: "anthropic", model: "fixture", modelReported: null },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 1, toolCalls: 1 },
    usd: 0, elapsedMs: 1, artifactIds: ["saved-artifact"], methodCandidateIds: [], refusal: null,
    startedAt: h.now(), recordedAt: h.now(),
  };
  await h.repos.scoutResults.append(scout.obligationId, scout.attemptId, scout, scout.recordedAt);
  const start = async () => {
    const runtime = await autonomousStandingRuntime({ root, repos: h.repos, now: h.now,auditCeilingUsd:1,environment:{NODE_ENV:"test"} });
    await runtime.prepareWorkItem!(h.item);
  };
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
