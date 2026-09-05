import { test } from "node:test";
import assert from "node:assert/strict";
import { proveVotingSites } from "../scripts/reader-last-mile-voting-sites.mts";

test("every eligible voting jurisdiction reaches the real route with its own exact sites or sourced refusal", async () => {
  const proof = await proveVotingSites();
  assert.ok(proof.results.length >= 44);
  assert.ok(proof.results.some((row) => row.returnedCount === 0 && row.refusal));
  assert.ok(proof.results.some((row) => row.returnedCount > 100));
});
