import test from "node:test";
import assert from "node:assert/strict";
import { SOURCE_KINDS, sourceKindLabel } from "../lib/corpus/source-kinds.ts";

test("every source kind has a distinct reader label", () => {
  const labels = SOURCE_KINDS.map((k) => k.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(SOURCE_KINDS.length, 9);
});

test("candidate-corpus official site reads as an official page", () => {
  assert.equal(sourceKindLabel("OFFICIAL_SITE"), "official page");
  assert.equal(sourceKindLabel("SOCIAL_POST"), "social post");
  assert.equal(sourceKindLabel("CAMPAIGN_SITE"), "campaign site");
});
