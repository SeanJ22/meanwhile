import assert from "node:assert/strict";
import test from "node:test";
import { heldZipStates } from "../lib/geo/zip-division-shards.ts";

test("raw ZIP state reads retain real cross-state memberships without a Census publication", async () => {
  assert.deepEqual(await heldZipStates("03579"), ["ME", "NH"]);
  assert.deepEqual(await heldZipStates("42223"), ["KY", "TN"]);
  assert.deepEqual(await heldZipStates("03255"), ["NH"]);
  assert.deepEqual(await heldZipStates("85701"), ["AZ"]);
});

test("invalid and unheld ZIP state memberships remain unknown", async () => {
  for (const zip of ["", "1234", "00000", "not a ZIP"]) assert.equal(await heldZipStates(zip), null);
});
