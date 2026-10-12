import assert from "node:assert/strict";
import { test } from "node:test";

import {
  directOfficialActionTargetPlan,
  settleOfficialActionHoldingAnswer,
  type OfficialActionHoldingReaders,
  type OfficialActionTargetPlan,
} from "../app/api/official-actions/[subject]/holdings.ts";
import type { ReaderOfficialActions } from "../lib/officials/reader-actions.ts";

const answer = (subjectId: string): ReaderOfficialActions => ({
  subjectId,
  officialIds: ["statewide:az/governor"],
  resolvedTargetId: "statewide:az/governor",
  status: "RESOLVED",
  withheldRecords: [],
  count: 1,
  records: [{
    id: "action-1",
    officialId: "statewide:az/governor",
    kind: "EXECUTIVE_ORDER",
    text: "Executive Order 1.",
    sourceUrl: "https://azgovernor.gov/action-1",
    documentUrl: null,
    sourceOrg: "Arizona Governor",
    collectedAt: "2026-09-09T00:00:00.000Z",
  }],
});

function readers(plan: OfficialActionTargetPlan, overrides: Partial<OfficialActionHoldingReaders> = {}) {
  const calls: string[] = [];
  const value: OfficialActionHoldingReaders = {
    identityPlan: async () => { calls.push("identity"); return plan; },
    actions: async () => { calls.push("actions"); },
    azIdentity: async () => { calls.push("az-identity"); },
    answer: (subject) => { calls.push("answer"); return answer(subject); },
    ...overrides,
  };
  return { calls, value };
}

test("non-AZ ballot target never opens the AZ action or AZ identity authorities", async () => {
  const fixture = readers({ applies: false, azIdentity: false });
  const result = await settleOfficialActionHoldingAnswer("ballot-nj-morris:governor:test", fixture.value);
  assert.equal(result.kind, "ANSWER");
  assert.deepEqual(fixture.calls, ["identity"]);
  if (result.kind === "ANSWER") assert.equal(result.answer.status, "NO_APPLICABLE_OFFICIAL");
});

test("AZ official target reads actions without opening candidate identity", async () => {
  assert.deepEqual(directOfficialActionTargetPlan("statewide:az/governor"), { applies: true, azIdentity: false });
  const fixture = readers({ applies: true, azIdentity: false });
  const result = await settleOfficialActionHoldingAnswer("statewide:az/governor", fixture.value);
  assert.equal(result.kind, "ANSWER");
  assert.deepEqual(fixture.calls, ["identity", "actions", "answer"]);
});

test("AZ display-key target requires its exact identity holding and fails explicitly", async () => {
  const fixture = readers({ applies: true, azIdentity: true }, {
    azIdentity: async () => { throw new Error("planted AZ candidacy-identity failure"); },
  });
  const result = await settleOfficialActionHoldingAnswer("ballot-az-pima:governor|Katie Hobbs", fixture.value);
  assert.deepEqual(result, {
    kind: "HOLDING_UNAVAILABLE",
    unavailableAuthorities: ["AZ_CANDIDACY_IDENTITY"],
  });
});

test("AZ action-store failure is explicit and cannot become an empty action answer", async () => {
  const fixture = readers({ applies: true, azIdentity: false }, {
    actions: async () => { throw new Error("planted AZ action failure"); },
  });
  const result = await settleOfficialActionHoldingAnswer("statewide:az/governor", fixture.value);
  assert.deepEqual(result, {
    kind: "HOLDING_UNAVAILABLE",
    unavailableAuthorities: ["AZ_OFFICIAL_ACTION"],
  });
});

test("ambiguous official target fails closed when person identity is unavailable", async () => {
  const fixture = readers({ applies: false, azIdentity: false }, {
    identityPlan: async () => { throw new Error("planted registry failure"); },
  });
  const result = await settleOfficialActionHoldingAnswer("congress:B001302", fixture.value);
  assert.deepEqual(result, {
    kind: "HOLDING_UNAVAILABLE",
    unavailableAuthorities: ["PERSON_IDENTITY"],
  });
});
