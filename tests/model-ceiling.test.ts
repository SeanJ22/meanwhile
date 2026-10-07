/**
 * Opus is the model ceiling, never Fable. The positive control: a planted map that points a class at a Fable, an
 * unrated model, or above Opus must throw.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MODELS } from "../lib/models.ts";

import {
  MODEL_CEILING,
  MODEL_CLASSES,
  MODEL_FOR_CLASS,
  ModelAboveCeiling,
  assertModelClassesWithinCeiling,
  modelCeilingViolation,
} from "../lib/control-plane/scheduler/model-routing.ts";

test("the ceiling is Opus", () => {
  assert.equal(MODEL_CEILING, "claude-opus-5-5");
});

test("every routable class is within the ceiling (and importing the module already proved it)", () => {
  assert.equal(MODEL_FOR_CLASS.haiku, MODELS.haiku.model);
  assert.equal(MODEL_FOR_CLASS.sonnet, MODELS.sonnet.model);
  assert.equal(MODEL_FOR_CLASS.frontier, MODELS.opus.model);
  // The module-load invariant ran at import above without throwing; re-assert explicitly.
  assert.doesNotThrow(() => assertModelClassesWithinCeiling());
  for (const cls of MODEL_CLASSES) {
    assert.equal(modelCeilingViolation(MODEL_FOR_CLASS[cls]), null, `${cls} (${MODEL_FOR_CLASS[cls]}) must be within the ceiling`);
  }
});

test("the ceiling model and the cheaper classes each pass; none is a Fable", () => {
  assert.equal(modelCeilingViolation("claude-opus-5-5"), null);
  assert.equal(modelCeilingViolation("claude-sonnet-5"), null);
  assert.equal(modelCeilingViolation("claude-sonnet-5-5"), null);
  assert.equal(modelCeilingViolation("claude-haiku-4-5"), null);
  for (const cls of MODEL_CLASSES) assert.doesNotMatch(MODEL_FOR_CLASS[cls], /fable/i);
});

test("legacy Opus 5 is now priced ABOVE the cheaper Opus 5.5 ceiling, so nothing may route to it", () => {
  // Opus 5.5 ($4/$20) is cheaper than legacy Opus 5 ($5/$25). The ceiling is
  // priced-above-frontier, so legacy Opus 5 is correctly refused for routing;
  // its rate row survives only to price historical billing accurately.
  assert.notEqual(modelCeilingViolation("claude-opus-5"), null);
  assert.match(String(modelCeilingViolation("claude-opus-5")), /priced above the ceiling/);
});

test("POSITIVE CONTROL — a Fable model is refused", () => {
  assert.notEqual(modelCeilingViolation("claude-fable-5-1"), null);
  assert.match(String(modelCeilingViolation("claude-fable-5-1")), /fable/i);
  assert.throws(
    () => assertModelClassesWithinCeiling({ haiku: "claude-haiku-4-5", sonnet: "claude-sonnet-5", frontier: "claude-fable-5-1" }),
    ModelAboveCeiling,
  );
});

test("POSITIVE CONTROL — an unrated (unapproved) model is refused", () => {
  assert.notEqual(modelCeilingViolation("claude-opus-9-ultra"), null);
  assert.throws(
    () => assertModelClassesWithinCeiling({ haiku: "claude-haiku-4-5", sonnet: "claude-opus-9-ultra", frontier: "claude-opus-5-5" }),
    ModelAboveCeiling,
  );
});
