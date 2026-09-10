import assert from "node:assert/strict";
import test from "node:test";

import { readerProofHead } from "../scripts/lib/reader-proof-head.mjs";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

function evidence(entries: Record<string, unknown>) {
  return (path: string): Buffer => {
    assert.ok(path in entries, `unexpected evidence read: ${path}`);
    return Buffer.from(JSON.stringify(entries[path]));
  };
}

test("an inherited Reader receipt keeps the invalidation report as its proof-head authority", () => {
  const receipt = {
    censusPath: "fresh-census.json",
    inheritance: { reportPath: "invalidation.json" },
  };
  const read = evidence({
    "invalidation.json": { currentReaderHead: HEAD_A },
    "fresh-census.json": { rows: [{ id: "must-not-be-read", eligibleRecordIds: ["record"], provedHead: HEAD_B }] },
  });

  assert.equal(readerProofHead(receipt, read), HEAD_A);
});

test("a fresh Reader receipt derives one exact head from every applicable census row", () => {
  const receipt = { censusPath: "fresh-census.json" };
  const read = evidence({
    "fresh-census.json": {
      rows: [
        { id: "projected", applicableEligibleRecordIds: ["record:a"], eligibleRecordIds: ["record:a"], provedHead: HEAD_A },
        { id: "eligible-fallback", eligibleRecordIds: ["record:b"], provedHead: HEAD_A },
        { id: "not-applicable", applicableEligibleRecordIds: [], eligibleRecordIds: ["record:c"], provedHead: null },
      ],
    },
  });

  assert.equal(readerProofHead(receipt, read), HEAD_A);
});

test("a fresh Reader receipt rejects an applicable row with no exact proof head", () => {
  const receipt = { censusPath: "fresh-census.json" };
  const read = evidence({
    "fresh-census.json": {
      rows: [{ id: "missing-head", applicableEligibleRecordIds: ["record:a"], provedHead: null }],
    },
  });

  assert.throws(() => readerProofHead(receipt, read), /missing-head.*exact executed head/);
});

test("a fresh Reader receipt rejects applicable rows proved at mixed heads", () => {
  const receipt = { censusPath: "fresh-census.json" };
  const read = evidence({
    "fresh-census.json": {
      rows: [
        { id: "first", applicableEligibleRecordIds: ["record:a"], provedHead: HEAD_A },
        { id: "second", applicableEligibleRecordIds: ["record:b"], provedHead: HEAD_B },
      ],
    },
  });

  assert.throws(() => readerProofHead(receipt, read), /multiple executed heads/);
});
