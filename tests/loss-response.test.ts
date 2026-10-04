import assert from "node:assert/strict";
import test from "node:test";

import type { FixMapRow } from "../lib/method/fix-map.ts";
import { PREDICTED_FAIL_PREFIX, respondToLosses } from "../lib/method/loss-response.ts";
import type { PlaceTraits } from "../lib/method/study-losses.ts";

const now = "2026-10-04T12:00:00Z";
const row = (methodId: string, placeId: string, state: FixMapRow["state"]): FixMapRow =>
  ({ methodId, placeId, state, triedAt: now, attemptId: `${methodId}-${placeId}`, cause: state === "FAILS" ? "x" : null, updatedAt: now });
const traits: Record<string, PlaceTraits> = {
  a: { platform: "p1", agendasAsImages: true },
  b: { platform: "p2", agendasAsImages: true },
  c: { platform: "p3", agendasAsImages: false },
  u: { platform: "p4", agendasAsImages: true },
  v: { platform: "p4", agendasAsImages: false },
};

test("a shared trait gives a lesson, predicted-to-fail untried places, and one variant case", () => {
  const map = [row("m", "a", "FAILS"), row("m", "b", "FAILS"), row("m", "c", "WORKS")];
  const out = respondToLosses({ fixMap: map, placeTraits: traits, now });
  assert.equal(out.lessons.length, 1);
  assert.match(out.lessons[0]!.title, /fails where agendas posted as images \(yes\)/);
  assert.deepEqual(out.predictions.map((p) => p.placeId), ["u"], "only the untried place with the shared trait");
  assert.ok(out.predictions[0]!.cause!.startsWith(PREDICTED_FAIL_PREFIX));
  assert.equal(out.predictions[0]!.state, "UNTRIED");
  assert.equal(out.variantCases.length, 1);
  assert.deepEqual(out.variantCases[0]!.failingPlaceIds, ["a", "b"]);
  assert.deepEqual(out.engineerItems, []);
});

test("an open variant case is not opened twice, and the lesson id is stable across runs", () => {
  const map = [row("m", "a", "FAILS"), row("m", "b", "FAILS"), row("m", "c", "WORKS")];
  const first = respondToLosses({ fixMap: map, placeTraits: traits, now });
  const again = respondToLosses({ fixMap: map, placeTraits: traits, now, openVariantMethodIds: new Set(["m"]) });
  assert.equal(again.variantCases.length, 0);
  assert.equal(again.lessons[0]!.id, first.lessons[0]!.id);
});

test("failures that share nothing go to the engineers once", () => {
  const apart: Record<string, PlaceTraits> = { a: { platform: "p1", agendasAsImages: true }, b: { platform: "p2", agendasAsImages: false } };
  const map = [row("m", "a", "FAILS"), row("m", "b", "FAILS")];
  const out = respondToLosses({ fixMap: map, placeTraits: apart, now });
  assert.equal(out.engineerItems.length, 1);
  assert.equal(out.lessons.length + out.predictions.length + out.variantCases.length, 0);
  assert.equal(respondToLosses({ fixMap: map, placeTraits: apart, now, engineerMethodIds: new Set(["m"]) }).engineerItems.length, 0);
});

test("nothing is predicted for a place that already has a result", () => {
  const map = [row("m", "a", "FAILS"), row("m", "b", "FAILS"), row("m", "c", "WORKS"), row("m", "u", "WORKS")];
  const out = respondToLosses({ fixMap: map, placeTraits: traits, now });
  assert.equal(out.predictions.length, 0);
});
