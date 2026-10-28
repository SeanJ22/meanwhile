import assert from "node:assert/strict";
import test from "node:test";
import { candidateChangeSet, civicRecordFacts } from "../lib/civic-data/changes.ts";
import type { RoutineCandidate, RoutineRecordClass } from "../lib/civic-data/types.ts";

test("registration and registry facts ignore only source observations while retaining names, source URLs and original metadata", () => {
  const at = "2026-10-26T12:00:00.000Z", later = "2026-10-26T13:00:00.000Z";
  const source = { sourceUrl: "https://example.gov/governments", sourceOrg: "Official source", rawHash: "a".repeat(64),
    checkedAt: at, collectedAt: at, verifiedAt: null };
  const nextSource = { ...source, rawHash: "b".repeat(64), checkedAt: later, collectedAt: later, verifiedAt: later };
  const previous = { id: "government:one", name: "Example governing board", establishedOn: "2020-01-01", provenance: source,
    fieldSources: { name: source }, additionalSources: [source], holder: { name: "Jane Example", provenance: source } };
  const refreshed = { ...previous, provenance: nextSource, fieldSources: { name: nextSource }, additionalSources: [nextSource],
    holder: { ...previous.holder, provenance: nextSource } };
  const original = structuredClone(previous), refreshedOriginal = structuredClone(refreshed);
  const cases: { recordClass: RoutineRecordClass; scope: string; key: string; payload: (row: unknown) => unknown }[] = [
    { recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", key: "government:government:one", payload: row => ({ governments: [row] }) },
    { recordClass: "REGISTRY_RUNTIME_BINDING", scope: "US-AZ:reader-registry-runtime", key: "body:government:one", payload: row => ({ registry: { bodies: [row], divisions: [] } }) },
  ];
  for (const { recordClass, scope, key, payload } of cases) {
    const facts = (row: unknown) => civicRecordFacts(recordClass, { key, record: row });
    assert.deepEqual(facts(refreshed), facts(previous), recordClass);
    const changes = (row: unknown) => candidateChangeSet({ recordClass, scope, readModel: payload(row) } as RoutineCandidate, payload(previous));
    assert.equal(changes(refreshed).changed.length, 0, recordClass);
    assert.equal(changes({ ...refreshed, name: "Renamed governing board" }).changed.length, 1, `${recordClass}: actual name changes remain facts`);
    assert.equal(changes({ ...refreshed, provenance: { ...nextSource, sourceUrl: "https://other.example.gov/governments" } }).changed.length, 1,
      `${recordClass}: actual source URL changes remain facts`);
    assert.equal(changes({ ...refreshed, establishedOn: "2021-01-01" }).changed.length, 1, `${recordClass}: actual event dates remain facts`);
  }
  assert.deepEqual(previous, original);
  assert.deepEqual(refreshed, refreshedOriginal);
  assert.equal(previous.provenance.rawHash, "a".repeat(64));
  assert.equal(refreshed.holder.provenance.checkedAt, later);
});
