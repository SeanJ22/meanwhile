import assert from "node:assert/strict";
import test from "node:test";

import { searchChecklistDefinitions, ChecklistDefinitionQueryError } from "../lib/control-plane/admin-view/checklist-definition-search.ts";
import { CHECKLIST_PROFILE } from "../lib/control-plane/readiness/checklist-score.ts";

const query = (over: Partial<Parameters<typeof searchChecklistDefinitions>[0]> = {}) =>
  ({ q: "", group: null, id: null, limit: 25, cursor: null, ...over });

test("every adopted definition appears exactly once across stable, bounded national pages", () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = searchChecklistDefinitions(query({ cursor }));
    assert.equal(page.definitionsTotal, CHECKLIST_PROFILE.definitionCount);
    assert.equal(page.matchedTotal, CHECKLIST_PROFILE.definitionCount);
    assert.equal(page.profile, CHECKLIST_PROFILE.version);
    assert.equal(page.sourceSha256, CHECKLIST_PROFILE.sourceSha256);
    assert.ok(page.rows.length <= 25);
    seen.push(...page.rows.map(row => row.id));
    cursor = page.nextCursor;
    assert.ok(seen.length <= CHECKLIST_PROFILE.definitionCount, "paging repeated or expanded the fixed profile");
  } while (cursor);
  assert.equal(seen.length, 325);
  assert.equal(new Set(seen).size, 325);
  assert.deepEqual(seen, CHECKLIST_PROFILE.definitions.map(row => row.id).sort());
});

test("exact requirement detail preserves complete adopted wording while instance facts remain unknown", () => {
  const expected = CHECKLIST_PROFILE.definitions.find(row => row.id === "MTG-15");
  assert.ok(expected);
  const page = searchChecklistDefinitions(query({ id: "mtg-15" }));
  assert.equal(page.matchedTotal, 1);
  assert.deepEqual(page.rows, [expected]);
  assert.equal(page.instances.state, "NOT_READ_BY_THIS_ENDPOINT");
  assert.equal(page.instances.total, null);
  assert.equal(page.instances.applicable, null);
  assert.equal(page.instances.unresolvedApplicability, null);
  assert.equal(page.instances.periods, null);
  assert.equal(page.nextCursor, null);
});

test("search covers the full profile, treats wildcard text literally, and binds cursors to filters and version", () => {
  const first = searchChecklistDefinitions(query({ q: "meeting", limit: 2 }));
  assert.ok(first.matchedTotal > first.rows.length);
  assert.ok(first.nextCursor);
  const second = searchChecklistDefinitions(query({ q: "meeting", limit: 2, cursor: first.nextCursor }));
  assert.notEqual(first.rows[0]?.id, second.rows[0]?.id);
  assert.throws(() => searchChecklistDefinitions(query({ q: "meeting", group: "OFF", cursor: first.nextCursor })),
    (error: unknown) => error instanceof ChecklistDefinitionQueryError && error.code === "INVALID_CURSOR");
  assert.throws(() => searchChecklistDefinitions(query({ q: "meeting", cursor: "bad***" })),
    (error: unknown) => error instanceof ChecklistDefinitionQueryError && error.code === "INVALID_CURSOR");
  assert.equal(searchChecklistDefinitions(query({ q: "%_" })).matchedTotal,
    CHECKLIST_PROFILE.definitions.filter(row => `${row.id} ${row.group} ${row.requirement} ${row.canonicalPredicate} ${row.owner}`.toLowerCase().includes("%_")).length);
  assert.throws(() => searchChecklistDefinitions(query({ limit: 51 })), ChecklistDefinitionQueryError);
  assert.throws(() => searchChecklistDefinitions(query({ q: "x".repeat(101) })), ChecklistDefinitionQueryError);
});
