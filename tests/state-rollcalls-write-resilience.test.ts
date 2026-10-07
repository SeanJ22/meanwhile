import assert from "node:assert/strict";
import test from "node:test";

import {
  durableWriteFailureDiagnostic,
  persistAcquiredStateRollCall,
} from "../scripts/state-rollcalls.mts";
import { officialStateRollCallHorizonRefusalCandidate } from "../lib/civic-data/candidate-builders.ts";
import { officialStateRollCallTargetByState } from "../lib/state-rollcalls/authority.ts";
import type { RoutineDataStore } from "../lib/civic-data/store.ts";

/**
 * NO uncaught crash on a write failure, for ANY state: the persistence seam
 * catches any durable write/transport error and returns an honest,
 * source-neutral held failure.
 */

const AZ = officialStateRollCallTargetByState("AZ")!;

function acquiredCandidate() {
  // A real, small, contract-valid acquired candidate for the AZ contract, so the
  // seam is exercised on an acquired source rather than an acquisition failure.
  return officialStateRollCallHorizonRefusalCandidate({
    sourceId: AZ.sourceId,
    jurisdiction: AZ.jurisdiction,
    requestedUrl: AZ.probeUrl,
    finalUrl: AZ.probeUrl,
    httpStatus: 200,
    retrievedAt: "2026-09-18T00:00:00.000Z",
    rawBody: "official landing page",
    detail: "The complete official House and Senate roll horizon is not established.",
  });
}

/** A store whose every durable operation fails the way an over-limit Neon HTTP
 *  write does: a transport error whose server-side fields are undefined. */
function neonFailingStore(): RoutineDataStore {
  const neonError = Object.assign(new Error("Error connecting to database: fetch failed"), {
    sourceError: new Error("write EPROTO"),
    severity: undefined,
    code: undefined,
    dataType: undefined,
    constraint: undefined,
    file: undefined,
    line: undefined,
    routine: undefined,
  });
  return new Proxy(
    {},
    {
      get() {
        return async () => {
          throw neonError;
        };
      },
    },
  ) as unknown as RoutineDataStore;
}

test("a durable write/transport failure is caught as a source-neutral held failure, never an uncaught crash", async () => {
  // If persistence let the error escape, this await would reject and fail the
  // test — which is exactly the crash we are proving cannot happen.
  const result = await persistAcquiredStateRollCall(
    neonFailingStore(),
    AZ.contractId,
    acquiredCandidate(),
    "2026-09-18T00:00:00.000Z",
  );
  assert.equal(result.kind, "WRITE_FAILED");
  if (result.kind !== "WRITE_FAILED") return;
  assert.ok(result.diagnostic.includes(AZ.contractId), "the diagnostic names the exact contract");
  assert.match(result.diagnostic, /DURABLE_PERSISTENCE_FAILED/);
  assert.match(result.diagnostic, /failure on our side/i);
  assert.match(result.diagnostic, /not source unavailability/i);
});

test("durableWriteFailureDiagnostic names our gap, carries the cause, and never blames the source", () => {
  const line = durableWriteFailureDiagnostic("nh-state-rollcalls", new Error("507 payload too large"));
  assert.ok(line.includes("nh-state-rollcalls"));
  assert.match(line, /failure on our side/i);
  assert.match(line, /not source unavailability/i);
  assert.match(line, /507 payload too large/);
  // It must not assert the source was blocked or unavailable — that would name
  // the wrong party's gap when the fault is entirely ours.
  assert.doesNotMatch(line, /source (?:blocked|failed|unavailable)/i);
  assert.doesNotMatch(line, /\bblocked\b/i);
});
