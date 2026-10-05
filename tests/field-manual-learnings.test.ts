import assert from "node:assert/strict";
import test from "node:test";

import {
  DETECTIVE_LEARNING_SOURCE,
  ENGINEERING_CANDIDATE_SOURCE,
  researchLearningEntries,
} from "../lib/control-plane/workers/field-manual-learnings.ts";
import { fieldManualEntryId } from "../lib/control-plane/field-manual.ts";
import type { FleetResult } from "../lib/control-plane/workers/types.ts";

/* ========================================================================== */
/* THE DETECTIVE AND ENGINEER WROTE INTO A LOG NOBODY READ. NOW IT IS A MANUAL */
/* ENTRY. This pins the mapping — including that proposed CODE never leaks in.  */
/* ========================================================================== */

const NOW = "2026-09-19T08:00:00.000Z";

function detective(overrides: Record<string, unknown>): FleetResult {
  return {
    role: "DETECTIVE",
    attemptId: "at-1",
    verdict: "SUPPORTED",
    question: {
      id: "q-morris-07866",
      text: "Does ZIP 07866 govern Rockaway Township in Morris County, NJ?",
      subjectId: "ocd-division/country:us/state:nj/place:rockaway",
      jurisdiction: "ocd-division/country:us/state:nj/county:morris",
      recordClass: "officials",
      kind: "IDENTITY",
      alternatives: [],
      authorities: [],
      falsificationCondition: "x",
      nextAction: "wire the roster route",
      populationDefinition: null,
      denominator: null,
    },
    conclusion: "07866 is Rockaway Township, Morris County, New Jersey.",
    identity: { state: "CANDIDATE", canonicalId: "ocd-division/country:us/state:nj/place:rockaway" },
    nextAction: "wire the roster route",
    learnedProcedure: {
      implementation: "bounded-authoritative-evidence-comparison/1",
      deterministic: true,
      testableQuestion: { id: "q-morris-07866" },
      promotion: "CANDIDATE_ONLY",
    },
    ...overrides,
  } as unknown as FleetResult;
}

test("a SUPPORTED detective conclusion becomes a SHARED, YIELDED resolution keyed by the question id", () => {
  const [entry, ...rest] = researchLearningEntries(detective({}), NOW);
  assert.equal(rest.length, 0, "one settled question is one entry");
  assert.equal(entry.role, "SHARED", "a settled jurisdiction fact is shared knowledge every role inherits");
  assert.equal(entry.kind, "DETECTIVE_RESOLUTION");
  assert.equal(entry.outcome, "YIELDED");
  assert.deepEqual([...entry.states], ["nj"], "the state comes from the OCD jurisdiction, not a guess");
  assert.deepEqual([...entry.recordClasses], ["officials"]);
  assert.equal(entry.observedAt, "2026-09-19");
  assert.equal(
    entry.id,
    fieldManualEntryId(DETECTIVE_LEARNING_SOURCE, "q-morris-07866"),
    "keyed by question id so a re-investigation refreshes one row, never forks it",
  );
  const payload = entry.payload as { conclusion?: string; learnedProcedure?: unknown; nextAction?: string };
  assert.match(payload.conclusion ?? "", /Rockaway Township/);
  assert.ok(payload.learnedProcedure, "the learnedProcedure that went nowhere is now carried in the entry");
  assert.equal(payload.nextAction, "wire the roster route");
});

test("an UNRESOLVED detective learning stays in the detective lane, as a reference", () => {
  const [entry] = researchLearningEntries(
    detective({ verdict: "UNRESOLVED", identity: { state: "UNRESOLVED", candidates: [] } }),
    NOW,
  );
  assert.equal(entry.role, "DETECTIVE", "an open question is not yet shared knowledge");
  assert.equal(entry.outcome, "REFERENCE");
});

test("a CONTRADICTED detective result is a dead door, kept as FAILED", () => {
  const [entry] = researchLearningEntries(
    detective({ verdict: "CONTRADICTED", identity: { state: "UNRESOLVED", candidates: [] } }),
    NOW,
  );
  assert.equal(entry.outcome, "FAILED");
});

function engineering(overrides: Record<string, unknown>): FleetResult {
  return {
    role: "ENGINEERING",
    attemptId: "at-2",
    schemaVersion: 1,
    implementation: "review-only-method-engineering",
    version: "1.0.0",
    verdict: "CANDIDATE_PROVED",
    findings: [],
    artifactIds: ["a1"],
    methodRouteId: "streamline-sitemap-is-a-dated-meeting-inventory",
    methodVersion: 3,
    methodContentHash: "h",
    validationResultId: "v1",
    affectedPaths: ["review-candidates/streamline-sitemap-inventory/inventory.mjs"],
    proposedFiles: [
      { path: "review-candidates/streamline-sitemap-inventory/inventory.mjs", kind: "IMPLEMENTATION", content: "UNIQUE_PROPOSED_SOURCE_BYTES_marker", contentHash: "hh" },
    ],
    learnedProcedure: ["read the vaulted sitemap", "reject unsupported XML"],
    reproducibility: { verdict: "PASS", isolatedExecutions: 2, cases: [], replayCommand: "node --test x" },
    unresolvedRisks: ["portability not proved"],
    adoption: "INTEGRATION_REVIEW_REQUIRED",
    ...overrides,
  } as unknown as FleetResult;
}

test("a proved engineering candidate becomes an ENGINEER pointer — the paths, never the file bytes", () => {
  const [entry, ...rest] = researchLearningEntries(engineering({}), NOW);
  assert.equal(rest.length, 0);
  assert.equal(entry.role, "ENGINEER");
  assert.equal(entry.kind, "ENGINEERING_CANDIDATE");
  assert.equal(entry.outcome, "REFERENCE", "a proved candidate is code under review, not a live door");
  assert.equal(entry.id, fieldManualEntryId(ENGINEERING_CANDIDATE_SOURCE, "streamline-sitemap-is-a-dated-meeting-inventory"));
  const payload = entry.payload as { affectedPaths?: string[] };
  assert.ok((payload.affectedPaths ?? []).length === 1, "the pointer carries the proposed paths");
  assert.ok(
    !JSON.stringify(entry).includes("UNIQUE_PROPOSED_SOURCE_BYTES_marker"),
    "the proposed file CONTENT must never enter the manual — the candidate store keeps the bytes",
  );
});

test("a failed engineering proof is a FAILED dead door, not silently dropped", () => {
  const [entry] = researchLearningEntries(engineering({ verdict: "PROOF_FAILED" }), NOW);
  assert.equal(entry.outcome, "FAILED");
});

test("a role that emits no learned artifact yields no entry", () => {
  const acquirer = { role: "ACQUIRER", attemptId: "at-3", verdict: "YIELDED" } as unknown as FleetResult;
  assert.deepEqual(researchLearningEntries(acquirer, NOW), []);
});
