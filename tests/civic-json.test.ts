import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalCivicDataHash, canonicalCivicDataJson, durableCivicDataHash } from "../lib/civic-data/changes.ts";
import { jsonSnapshot } from "../lib/civic-data/json-snapshot.ts";

test("incremental hashes retain the published canonical JSON digest", () => {
  const cases: [unknown, string][] = [
    [{ z: 2, a: [null, "🙂", { b: false }] }, '{"a":[null,"🙂",{"b":false}],"z":2}'],
    [{ missing: undefined, values: [undefined, 1] }, '{"missing":undefined,"values":[,1]}'],
    [[NaN, Infinity, -0, '"\\\n'], '[null,null,0,"\\\"\\\\\\n"]'],
    [[], "[]"], [null, "null"],
  ];
  for (const [value, canonical] of cases) {
    assert.equal(canonicalCivicDataJson(value), canonical);
    assert.equal(canonicalCivicDataHash(value), createHash("sha256").update(canonical).digest("hex"));
  }
  const rows = Array.from({ length: 500 }, (_, id) => ({ id, text: '"🙂\\'.repeat(100) }));
  assert.equal(canonicalCivicDataHash(rows), createHash("sha256").update(canonicalCivicDataJson(rows)).digest("hex"));
});

test("a durable snapshot detaches the adapter and shares its repeated JSON values", () => {
  const shared = { name: "Verified office", omitted: undefined, values: [undefined, NaN, Infinity, -0] };
  const input = { normalized: shared, reader: shared, records: [{ row: shared }], date: new Date("2026-10-15T00:00:00Z") };
  const snapshot = jsonSnapshot(input);
  assert.deepEqual(snapshot, JSON.parse(JSON.stringify(input)));
  assert.notEqual(snapshot.reader, shared);
  assert.equal(snapshot.normalized, snapshot.reader);
  assert.equal(snapshot.records[0].row, snapshot.reader);
  shared.name = "Changed after acquisition";
  assert.equal(snapshot.reader.name, "Verified office");
  const poisoned = JSON.parse('{"__proto__":{"published":true}}');
  assert.deepEqual(jsonSnapshot(poisoned), poisoned);
  assert.equal(Object.getPrototypeOf(jsonSnapshot(poisoned)), Object.prototype);
});

test("non-JSON roots, bigint and circular data are refused before any write", () => {
  assert.throws(() => jsonSnapshot(undefined), /JSON/);
  assert.throws(() => jsonSnapshot(BigInt(1)), /BigInt/);
  const cycle: { value?: unknown } = {}; cycle.value = cycle;
  assert.throws(() => jsonSnapshot(cycle), /Circular/);
});

test("durability checks reject values that JSONB would change without cloning valid payloads", () => {
  for (const value of [{ missing: undefined }, [undefined], { ignored() {} }, new Date("2026-10-15"), Object(BigInt(1))]) {
    assert.throws(() => durableCivicDataHash(value));
  }
  for (const value of [{ text: "Verified", values: [NaN, Infinity, -0] }, new Map(), { a: [1, 2] }]) {
    assert.equal(durableCivicDataHash(value), canonicalCivicDataHash(JSON.parse(JSON.stringify(value))));
  }
});
