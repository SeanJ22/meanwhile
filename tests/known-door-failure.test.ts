import assert from "node:assert/strict";
import test from "node:test";
import { acquirerFailureCause, knownDoorRetry } from "../lib/control-plane/workers/known-door-failure.ts";
import type { AcquirerResult, EvidenceWalkStep, ResearchBlocker } from "../lib/control-plane/workers/research-types.ts";
import type { FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";

const NOW = "2026-10-06T19:10:00.000Z";
const result = (input: { verdict?: AcquirerResult["verdict"]; codes?: ResearchBlocker["code"][]; transport?: EvidenceWalkStep["transport"]; observed?: string }): AcquirerResult => ({
  role: "ACQUIRER", attemptId: "a", verdict: input.verdict ?? "BLOCKED", source: {} as AcquirerResult["source"], artifacts: [], artifactIds: [], findings: [],
  blockers: (input.codes ?? []).map(code => ({ code, description: "", worker: {} as ResearchBlocker["worker"], attemptId: "a", observedAt: NOW, artifactIds: [], retryable: true, anotherRouteRemains: false, operatorDecisionRequired: false })),
  walk: [
    { rung: "permission", transport: "REACHABLE", observed: "robots read" },
    { rung: "fetch_public", transport: input.transport ?? "TIMEOUT", observed: input.observed ?? "" },
  ].map((step, sequence) => ({ ...step, sequence } as unknown as EvidenceWalkStep)),
  walkState: { state: "OPEN", nextRouteIds: [] }, requestCount: 1, bytesFetched: 0,
});
const debt = (cause: FreshnessDebt["cause"], consecutiveFailures: number, retryAt: string): FreshnessDebt =>
  ({ obligationId: "o", cause, detail: "", target: "https://example.gov", dueAt: NOW, firstFailedAt: NOW, lastFailedAt: NOW, consecutiveFailures, retryAt });

test("a failed known-door read is classed in the round's own debt causes", () => {
  assert.equal(acquirerFailureCause(result({ codes: ["RATE_LIMITED"] })), "RATE_LIMITED");
  assert.equal(acquirerFailureCause(result({ codes: ["TRANSPORT_FAILED"], transport: "TIMEOUT" })), "TRANSPORT_FAILED");
  assert.equal(acquirerFailureCause(result({ codes: ["TRANSPORT_FAILED"], transport: "FAILED_AT_RUNG", observed: "HTTP 503" })), "UPSTREAM_ERROR");
  assert.equal(acquirerFailureCause(result({ codes: ["TRANSPORT_FAILED"], transport: "FAILED_AT_RUNG", observed: "HTTP 404" })), "EXTRACTION_FAILED");
  assert.equal(acquirerFailureCause(result({ codes: ["PUBLISHER_AUTHENTICATION"], transport: "CHALLENGED" })), "REFUSED_BY_HOST");
  assert.equal(acquirerFailureCause(result({ codes: ["DOCUMENT_INACCESSIBLE"], transport: "REACHABLE" })), "EXTRACTION_FAILED");
  assert.equal(acquirerFailureCause(result({ verdict: "EMPTY", transport: "REACHABLE" })), "EXTRACTION_FAILED");
});

test("one hunter path: a passing outage is a free plain retry when due, and waits without a paid walk until then", () => {
  const base = { now: NOW, scoutTriedAfterFailure: false, shutThreshold: 3, oneHunterPath: true };
  assert.deepEqual(knownDoorRetry({ ...base, debt: debt("UPSTREAM_ERROR", 1, "2026-10-06T19:00:00.000Z") }), { kind: "PLAIN_RETRY" });
  assert.deepEqual(knownDoorRetry({ ...base, debt: debt("RATE_LIMITED", 2, "2026-10-06T19:30:00.000Z") }), { kind: "OUTAGE_WAIT", retryAt: "2026-10-06T19:30:00.000Z" });
});

test("one hunter path: a shut door goes to its investigation, with a plain re-read in alternate hourly slots", () => {
  const due = "2026-10-06T19:00:00.000Z";
  const even = "2026-10-06T18:10:00.000Z", odd = "2026-10-06T19:10:00.000Z";
  assert.equal(Math.floor(Date.parse(odd) / 3_600_000) % 2, 1);
  const base = { scoutTriedAfterFailure: false, shutThreshold: 3, oneHunterPath: true };
  assert.equal(knownDoorRetry({ ...base, now: odd, debt: debt("TRANSPORT_FAILED", 3, due) }).kind, "PLAIN_RETRY");
  assert.equal(knownDoorRetry({ ...base, now: even, debt: debt("TRANSPORT_FAILED", 3, "2026-10-06T18:00:00.000Z") }).kind, "INVESTIGATE");
  assert.equal(knownDoorRetry({ ...base, now: odd, debt: debt("REFUSED_BY_HOST", 1, due) }).kind, "INVESTIGATE", "a refusal goes to a detective at once");
  assert.equal(knownDoorRetry({ ...base, now: even, scoutTriedAfterFailure: true, debt: debt("TRANSPORT_FAILED", 3, "2026-10-06T18:00:00.000Z") }).kind, "PLAIN_RETRY");
  assert.equal(knownDoorRetry({ ...base, now: odd, shutThreshold: 5, debt: debt("TRANSPORT_FAILED", 3, due) }).kind, "PLAIN_RETRY", "Admin's higher threshold keeps it a passing outage");
});

test("switch off: the old rule stands (a retry only once a Scout has tried since the failure)", () => {
  const base = { now: NOW, shutThreshold: 3, oneHunterPath: false, debt: debt("TRANSPORT_FAILED", 1, "2026-10-06T19:00:00.000Z") };
  assert.equal(knownDoorRetry({ ...base, scoutTriedAfterFailure: false }).kind, "INVESTIGATE");
  assert.equal(knownDoorRetry({ ...base, scoutTriedAfterFailure: true }).kind, "PLAIN_RETRY");
});
