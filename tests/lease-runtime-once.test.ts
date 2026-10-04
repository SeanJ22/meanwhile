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
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";

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
