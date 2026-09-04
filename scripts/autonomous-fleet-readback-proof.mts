import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { readAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { today } from "./doc-dates.mjs";

const root = resolve(import.meta.dirname, "..");
const connection = controlPlaneUrlFromEnv(); if (!connection) throw new Error("FLEET_READBACK_NOT_CONFIGURED");
const repos = await createPgRepositories(connection);
const observedAt = new Date().toISOString();
const selected = ["wi-6de0185c52067ad3c8ad51c2", "wi-ea789908da1237c753bd85c7", "wi-8ca51c26000d9c9ddf5ee16b", "wi-b700859dbe00f81ad334a570",
  "wi-5758d45fa0620d0d86a1941e", "wi-f861b9f35191b13d48cc08d3", "wi-d6ea857aba2a10922c139047", "wi-955de2bee189d6518766fe27"];
const activity = await readAutonomousActivity(repos, selected, { observedAt });
const allAttempts = activity.flatMap(a => a.facts.attempts);
const allScouts = activity.flatMap(a => a.facts.scouts);
const roles = [...new Set(allAttempts.map(a => a.worker.role))].map(role => {
  const attempts = allAttempts.filter(a => a.worker.role === role);
  const modeled = attempts.filter(a => a.worker.provider === "anthropic");
  return { role, attempts: attempts.length, modelInvocations: modeled.reduce((n, a) => n + (role === "SCOUT" ? allScouts.find(s => s.attemptId === a.id)?.usage.turns ?? 0 : a.cost.requestCount ?? 0), 0),
    providerModels: [...new Set(modeled.map(a => `${a.worker.provider}:${a.worker.version}`))],
    measuredModelUsd: modeled.length ? modeled.reduce((n, a) => n + (a.cost.usd ?? 0), 0) : 0,
    unmeasuredModelAttemptIds: modeled.filter(a => a.cost.usd === null).map(a => a.id),
    nonCompletedAttemptIds: attempts.filter(a => a.outcome !== "COMPLETED").map(a => a.id) };
});
const summary = activity.map(a => ({ workItemId: a.workItem.id, subject: a.workItem.subject, jurisdiction: a.jurisdiction,
  capability: a.capability, recordClass: a.recordClass, workItemState: a.workItem.state, walkState: a.walk.state,
  attemptCount: a.facts.attempts.length, terminalAttemptCount: a.accounting.terminalAttemptIds.length,
  artifactIds: [...new Set(a.facts.artifacts.map(r => r.artifactId))], sourceRouteIds: a.facts.routeTasks.map(t => t.routeId),
  workerResults: a.facts.workers.map(r => ({ id: r.id, role: r.result.role, verdict: r.result.verdict, attemptId: r.attemptId,
    sourceGrounding: r.result.role === "ACQUIRER" ? r.result.sourceGrounding ?? null : null,
    actualRowCount: r.result.role === "PARSER" ? r.result.actualRowCount : null,
    extractionVerdict: r.result.role === "VALIDATOR" ? r.result.extractionVerdict ?? null : null,
    externalVerifications: r.result.role === "VALIDATOR" ? r.result.externalVerifications ?? null : null })),
  scouts: a.facts.scouts.map(s => ({ attemptId: s.attemptId, outcome: s.outcome, refusal: s.refusal, model: s.worker.model,
    usd: s.usd, usage: s.usage, nextRungs: s.nextRungs })), evidenceGaps: a.evidenceGaps }));
const proof = { formatVersion: 1, observedAt, source: repos.describe(), selectedWorkItemIds: selected, roles, summary, activity,
  promotion: "OFF", boundaries: "No reader/Ask state written. Acquired raw documents and extraction-validated candidate rows remain pending real external authority verification; no civic absence asserted.",
  newHampshireScope: "The Springfield /wp-json/wp/v2/board response is a ten-row mixed publisher directory, including multiple boards and an Emergency Operations Plan. It is not ten Select Board records. Per-row canonical identities, pagination completeness, and an external population denominator remain unresolved; the later Detective result preserves this finding without rewriting prior Attempts or results.",
  preservedFailure: "Corona's first parser result wr-c0a4bf8aadbf73f936f745f4 remains FAILED/SOURCE_SCOPE_MISMATCH. Its later corrected plan includes the actually vaulted scout:fetch_public method route; no prior result was rewritten." };
const dir = join(root, "data/health/autonomous-agent-fleet"); mkdirSync(dir, { recursive: true });
const path = join(dir, `${today()}-lifecycle-readback.json`); writeFileSync(path, JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ path, roles, summary }, null, 2));
