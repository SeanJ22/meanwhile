import assert from "node:assert/strict";
import test from "node:test";

import type { FixMapRow } from "../lib/method/fix-map.ts";
import { studyLosses, type PlaceTraits } from "../lib/method/study-losses.ts";

const row = (methodId: string, placeId: string, state: FixMapRow["state"]): FixMapRow =>
  ({ methodId, placeId, state, triedAt: "2026-10-04T00:00:00Z", attemptId: `${methodId}-${placeId}`, cause: state === "FAILS" ? "x" : null, updatedAt: "2026-10-04T00:00:00Z" });

const traits: Record<string, PlaceTraits> = {
  a: { platform: "Civicplus", platformVersion: "2", state: "az", agendasAsImages: true, bodySize: 800, postsAheadDays: 2 },
  b: { platform: "civicplus", platformVersion: "2", state: "nh", agendasAsImages: true, bodySize: 4000, postsAheadDays: 5 },
  c: { platform: "legistar", state: "az", agendasAsImages: false, bodySize: 90_000, postsAheadDays: 7 },
  d: { platform: "civicplus", platformVersion: "3", state: "nj", agendasAsImages: false, bodySize: 3000 },
};

test("a trait every failing place states and no working place has is named", () => {
  const [study] = studyLosses([row("m", "a", "FAILS"), row("m", "b", "FAILS"), row("m", "c", "WORKS"), row("m", "d", "WORKS")], traits);
  const names = study!.shared.map((s) => `${s.trait}=${s.value}`);
  assert.deepEqual(names, ["agendas posted as images=yes", "platform version=civicplus 2"]);
  assert.match(study!.says, /2 places where it fails share: agendas posted as images \(yes\); platform version \(civicplus 2\), and none of the 2 where it works do/);
});

test("a trait a working place also has is not what sets the failures apart", () => {
  const [study] = studyLosses([row("m", "a", "FAILS"), row("m", "b", "FAILS"), row("m", "d", "WORKS")], traits);
  assert.equal(study!.shared.some((s) => s.trait === "platform"), false, "civicplus works at d");
});

test("two failures with nothing in common say so, and a method with one failure is not studied", () => {
  const apart = { ...traits, e: { platform: "iqm2", state: "nj", agendasAsImages: false, bodySize: 60_000, postsAheadDays: 30 } };
  const out = studyLosses([row("m", "a", "FAILS"), row("m", "e", "FAILS"), row("solo", "a", "FAILS"), row("solo", "b", "WORKS")], apart);
  assert.equal(out.length, 1);
  assert.deepEqual([out[0]!.methodId, out[0]!.says], ["m", "nothing shared"]);
});

test("a trait one failing place does not state is not shared, and unknown places say nothing", () => {
  const out = studyLosses([row("m", "a", "FAILS"), row("m", "nobody", "FAILS"), row("m", "c", "WORKS")], traits);
  assert.deepEqual(out[0]!.shared, []);
  assert.equal(studyLosses([], traits).length, 0);
});

test("bands group sizes and how far ahead a body posts", () => {
  const t = { a: { bodySize: 900, postsAheadDays: 1 }, b: { bodySize: 100, postsAheadDays: 2 }, c: { bodySize: 70_000, postsAheadDays: 60 } };
  const [study] = studyLosses([row("m", "a", "FAILS"), row("m", "b", "FAILS"), row("m", "c", "WORKS")], t);
  assert.deepEqual(study!.shared.map((s) => `${s.trait}=${s.value}`), ["body size=under 1,000", "how far ahead it posts=under 3 days"]);
});
