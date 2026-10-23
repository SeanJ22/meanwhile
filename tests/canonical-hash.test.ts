import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalCivicDataHash, durableCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";

test("incremental hashing preserves canonical ballot hashes including optional and numeric JSON values", () => {
  const sparse: unknown[] = []; sparse[2] = { optional: undefined };
  for (const value of [null, true, "李José", 0, -0, NaN, Infinity, 1e21, [], sparse,
    { z: undefined, a: [undefined, null, 0, -0, NaN], nested: { Z: "z", a: "a", Á: "á" } },
    { analysis: "Long official wording 李 ".repeat(10_000), rows: Array.from({ length: 200 }, (_, id) => ({ id, absent: undefined })) }]) {
    assert.equal(canonicalCivicDataHash(value), createHash("sha256").update(canonicalCivicDataJson(value)).digest("hex"));
  }
  assert.throws(() => canonicalCivicDataHash(undefined), TypeError);
  assert.throws(() => canonicalCivicDataHash(BigInt(1)), TypeError);
});

test("durable canonical hashes match JSON persistence without copying nested evidence", () => {
  const keyed = { toJSON(key: string) { return { key, keep: true, omitted: undefined }; } };
  const callable = Object.assign(() => 1, { toJSON: (key: string) => ({ key }) });
  for (const value of [
    { missing: undefined, nested: { present: 3, missing: undefined }, array: [undefined, , null, NaN, Infinity, -Infinity] },
    { date: new Date("2026-10-01T12:34:56.789Z"), custom: keyed, array: [keyed] },
    keyed, { numbers: new Number(3), text: new String("saved"), flag: new Boolean(false) },
    { callable, array: [callable], omitted: { toJSON: () => undefined } },
    { ignored: () => 1, symbol: Symbol("ignored"), array: [() => 1, Symbol("null")] },
  ]) {
    const durable = JSON.parse(JSON.stringify(value));
    assert.equal(canonicalCivicDataHash(value, { durable: true }), createHash("sha256").update(canonicalCivicDataJson(durable)).digest("hex"));
  }
  for (const value of [undefined, () => 1, Symbol("omitted"), BigInt(1), Object(BigInt(1))]) assert.throws(() => canonicalCivicDataHash(value, { durable: true }), TypeError);
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalCivicDataHash(cyclic, { durable: true }), TypeError);
});

test("streamed round-trip proofs preserve acceptance and refusal for durable JSON values", () => {
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  const sparse: unknown[] = []; sparse[2] = "present";
  for (const value of [null, false, "李José", 0, -0, NaN, Infinity, { rows: [{ id: 1, label: "held" }] },
    undefined, BigInt(1), cyclic, sparse, { omitted: undefined }, new Date("2026-10-01T00:00:00Z"),
    { custom: { toJSON() { return { changed: true }; } } }, { boxed: new Number(3) }]) {
    let previous: string | null = null;
    try {
      const durable = JSON.parse(JSON.stringify(value));
      const before = canonicalCivicDataJson(value), after = canonicalCivicDataJson(durable);
      if (before === after) previous = createHash("sha256").update(after).digest("hex");
    } catch { /* These values had no durable projection proof. */ }
    assert.equal(durableCivicDataHash(value), previous);
  }
});
