import assert from "node:assert/strict";
import test from "node:test";
import { acquirerFailureCause } from "../lib/control-plane/workers/known-door-failure.ts";
import type { AcquirerResult, EvidenceWalkStep, ResearchBlocker } from "../lib/control-plane/workers/research-types.ts";

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

test("a failed known-door read is classed in the round's own debt causes", () => {
  assert.equal(acquirerFailureCause(result({ codes: ["RATE_LIMITED"] })), "RATE_LIMITED");
  assert.equal(acquirerFailureCause(result({ codes: ["TRANSPORT_FAILED"], transport: "TIMEOUT" })), "TRANSPORT_FAILED");
  assert.equal(acquirerFailureCause(result({ codes: ["TRANSPORT_FAILED"], transport: "FAILED_AT_RUNG", observed: "HTTP 503" })), "UPSTREAM_ERROR");
  assert.equal(acquirerFailureCause(result({ codes: ["TRANSPORT_FAILED"], transport: "FAILED_AT_RUNG", observed: "HTTP 404" })), "EXTRACTION_FAILED");
  assert.equal(acquirerFailureCause(result({ codes: ["PUBLISHER_AUTHENTICATION"], transport: "CHALLENGED" })), "REFUSED_BY_HOST");
  assert.equal(acquirerFailureCause(result({ codes: ["DOCUMENT_INACCESSIBLE"], transport: "REACHABLE" })), "EXTRACTION_FAILED");
  assert.equal(acquirerFailureCause(result({ verdict: "EMPTY", transport: "REACHABLE" })), "EXTRACTION_FAILED");
});
