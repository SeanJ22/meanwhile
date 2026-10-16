import assert from "node:assert/strict";
import { runBallotPublication } from "../../scripts/assemble-ballot-package.mts";
import { stateBallotScope } from "../../lib/ballot/state-scopes.ts";
import type { GenericBallotProjection } from "../../lib/ballot/generic-projection.ts";
import { MemoryRoutineDataStore } from "../../lib/civic-data/store.ts";

export async function runBallotState(options: Parameters<typeof runBallotPublication>[0]) {
  const environment = { WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control", WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" };
  const prior = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try { return await runBallotPublication(options); }
  finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

export async function publishBallotState(options: Parameters<typeof runBallotPublication>[0]) {
  const store = options.store ?? new MemoryRoutineDataStore();
  const result = await runBallotState({ ...options, store });
  assert.equal(result.report.status, "PUBLISHED", result.report.reason ?? JSON.stringify(result.receipt));
  const pointer = await store.readPromotion<GenericBallotProjection>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", options.state));
  assert.ok(pointer);
  assert.equal(pointer.versionId, result.report.versionId);
  const saved = await store.readCandidate(pointer.versionId);
  assert.ok(saved);
  const sourceReceipt = saved.candidate.retrieval.manualSourceReceipt;
  assert.ok(sourceReceipt);
  return { ...result.report, heldContests: result.report.heldContests ?? [], payload: pointer.payload, candidate: saved.candidate, sourceReceipt };
}
