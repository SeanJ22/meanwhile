import test from "node:test";
import assert from "node:assert/strict";
import { publicationRecordChanges } from "../lib/civic-data/publication-record-changes.ts";

test("accepted-record changes distinguish facts from refreshed evidence and leave neighbours out", () => {
  const result = publicationRecordChanges({ previousVersionId: "good:prior", accepted: [
    { recordId: "new", readerId: "member:new", value: { name: "New member" } },
    { recordId: "update", readerId: "member:update", previous: { phone: "111" }, value: { phone: "222" } },
    { recordId: "same", readerId: "member:same", previous: { contact: { phone: "333", collectedAt: "yesterday" } },
      value: { contact: { phone: "333", collectedAt: "today" }, fieldSources: { phone: "fresh receipt" } } },
  ] });
  assert.deepEqual(result.records, { added: 1, changed: 1, reused: 1 });
  assert.equal(result.recordChanges.length, 3);
  assert.equal(result.recordChanges[2].previousFactsHash, result.recordChanges[2].factsHash);
  assert.ok(result.recordChanges.every(row => row.previousVersionId === "good:prior"));
});

test("actual event dates and source changes remain changed; missing prior authority and duplicate identities fail", () => {
  const changed = publicationRecordChanges({ previousVersionId: "good:prior", accepted: [{ recordId: "event", readerId: "event",
    previous: { date: "2026-09-27", sourceUrl: "https://a.gov" }, value: { date: "2026-09-28", sourceUrl: "https://b.gov" } }] });
  assert.equal(changed.recordChanges[0].change, "UPDATED");
  assert.throws(() => publicationRecordChanges({ previousVersionId: null, accepted: [{ recordId: "a", readerId: "a", value: {}, previous: {} }] }), /PRIOR_VERSION_MISSING/);
  assert.throws(() => publicationRecordChanges({ previousVersionId: "prior", accepted: [
    { recordId: "a", readerId: "a", value: {} }, { recordId: "b", readerId: "a", value: {} }] }), /IDENTITY_COLLISION/);
});

test("new native aliases retain reuse credit while changed people and civic facts remain distinct", () => {
  const previous = { id: "roster:one", name: "Ana Rivera", phone: "555-0100" };
  const bound = { ...previous, personId: "person:101", sourceRecordId: "https://example.gov/roster#101",
    nativeIds: { "https://example.gov/roster": ["101"] } };
  const result = publicationRecordChanges({ previousVersionId: "good:prior", accepted: [
    { recordId: "parser:reordered", readerId: previous.id, previous, value: bound },
    { recordId: "parser:updated", readerId: "roster:updated", previous, value: { ...bound, phone: "555-0200" } },
    { recordId: "parser:new-person", readerId: "roster:successor", value: { ...bound, id: "roster:successor", name: "Alex Rivera" } },
  ] });
  assert.deepEqual(result.records, { added: 1, changed: 1, reused: 1 });
  assert.equal(result.recordChanges[0].factsHash, result.recordChanges[0].previousFactsHash);
  assert.deepEqual(result.recordChanges.map(row => row.readerId), ["roster:one", "roster:updated", "roster:successor"]);
});
