import assert from "node:assert/strict";
import { test } from "node:test";
import { actionText, executiveActionStore } from "../lib/officials/executive-actions.ts";
import { officialActionsForTarget } from "../lib/officials/reader-actions.ts";
import { STATEWIDE_EXECUTIVES } from "../lib/officials/statewide-executives.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

test("all42 held official actions reach map and canonical ballot projection with Ask parity", () => {
  const held = executiveActionStore()!.actions;
  assert.equal(held.length, 42);
  const map = officialActionsForTarget("statewide:az/governor");
  const ballot = officialActionsForTarget("ballot-az-pima:governor:hobbs-katie");
  assert.equal(map.count, held.length);
  assert.equal(map.status, "RESOLVED");
  assert.deepEqual(ballot.records, map.records);
  const certified = officialActionsForTarget("ballot-az-pima:governor|Katie Hobbs");
  assert.equal(certified.resolvedTargetId, "ballot-az-pima:governor:hobbs-katie");
  assert.deepEqual(certified.records, map.records);
  for (const action of held) {
    const projected = map.records.find(row => row.id === action.id)!;
    assert.equal(projected.text, actionText(action));
    assert.equal(projected.sourceUrl, action.sourceUrl);
    assert.equal(projected.documentUrl, action.documentUrl);
    assert.equal(projected.officialId, action.officeholderId);
  }
  assert.match(map.records.find(row => row.kind === "BILL_LETTER_UNREAD")!.text, /have not read it yet/);
});

test("unresolved certified identity is explicit and never becomes an absence", () => {
  const result = officialActionsForTarget("ballot-az-pima:governor|Unresolved Person");
  assert.equal(result.status, "IDENTITY_UNRESOLVED");
  assert.equal(result.resolvedTargetId, null);
  assert.equal(result.count, 0);
  assert.equal(officialActionsForTarget("statewide:nh/governor").status, "NOT_HELD");
  assert.equal(officialActionsForTarget("Unknown Person").status, "NO_APPLICABLE_OFFICIAL");
});

test("official actions never attach by display name, wrong candidacy, or another governor", () => {
  for (const subject of ["Katie Hobbs", "ballot-az-pima:governor:biggs-andy", "statewide:nh/governor", "statewide:nj/governor", "statewide:az/attorney-general", "ballot-nh-merrimack:governor:ayotte-kelly"]) {
    assert.equal(officialActionsForTarget(subject).count, 0, subject);
  }
});

test("a reused officeholder slot preserves unresolved identity on both official and candidacy surfaces", () => {
  const holder = STATEWIDE_EXECUTIVES.find(row => row.holder.id === "statewide:az/governor")!.holder;
  const originalName = holder.name;
  try {
    holder.name = "A Different Officeholder";
    for (const subject of ["statewide:az/governor", "ballot-az-pima:governor:hobbs-katie"]) {
      const answer = officialActionsForTarget(subject);
      assert.equal(answer.status, "IDENTITY_UNRESOLVED");
      assert.equal(answer.count, 0);
    }
  } finally { holder.name = originalName; }
});
