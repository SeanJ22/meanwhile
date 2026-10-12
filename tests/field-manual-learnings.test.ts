import assert from "node:assert/strict";
import test from "node:test";

import {
  DETECTIVE_LEARNING_SOURCE,
  researchLearningEntries,
} from "../lib/control-plane/workers/field-manual-learnings.ts";
import { fieldManualEntryId } from "../lib/control-plane/field-manual.ts";
import type { FleetResult } from "../lib/control-plane/workers/types.ts";

/** A detective learning becomes a field-manual entry. */

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

test("a role that emits no learned artifact yields no entry", () => {
  const acquirer = { role: "ACQUIRER", attemptId: "at-3", verdict: "YIELDED" } as unknown as FleetResult;
  assert.deepEqual(researchLearningEntries(acquirer, NOW), []);
});
