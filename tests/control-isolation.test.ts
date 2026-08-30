import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleWorkerItem,
  CONTROL_ONLY_KEYS,
  WORKER_VISIBLE_KEYS,
} from "../lib/health/control-fact.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";

/**
 * LABEL ISOLATION IS LOAD-BEARING (WS-CONTRACT, the seeded isolation failure).
 *
 * A control fact only measures anything if the worker being measured cannot
 * tell it is a control. `assembleWorkerItem` is the one context-assembly
 * boundary, and this file proves the two properties that make it a boundary
 * rather than a convention:
 *
 *   (a) a control-carrying item assembles to EXACTLY an ordinary item's shape
 *       — deep key comparison, no control marker anywhere in the output;
 *   (b) the seeded failure: any path by which a control-only field would
 *       reach worker context THROWS. That includes the allowlist itself being
 *       widened onto a control-only key, so a later session that adds one to
 *       `WORKER_VISIBLE_KEYS` fails here before it ships an open-book exam.
 */

const NOW = "2026-08-30T00:00:00.000Z";

function ordinaryItem() {
  return createWorkItem({
    project: "pilot-health",
    subject: "zip:03255",
    obligation: "answer a reader question",
    why: "an ordinary, non-control item",
    now: NOW,
  });
}

function controlCarryingItem(): Record<string, unknown> {
  return {
    ...createWorkItem({
      project: "pilot-health",
      subject: "zip:03255",
      obligation: "answer a control question",
      why: "a control item, labelled only outside the boundary",
      now: NOW,
    }),
    // The control identity the harness holds and the worker must never see.
    fact_class: "known_absence",
    expected_truth: { kind: "proposition", proposition: "no such filing exists" },
    verification_source: "the county filing index",
    verified_by: "the owner",
    verified_date: "2026-08-29",
  };
}

/** Every key path in a value, so shape comparison is deep, not top-level. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    // Array INDEXES are not shape; the element shapes are.
    return value.flatMap((entry) => keyPaths(entry, `${prefix}[]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
    `${prefix}.${k}`,
    ...keyPaths(v, `${prefix}.${k}`),
  ]);
}

test("the allowlist and the control-only key set never intersect", () => {
  const visible = new Set<string>(WORKER_VISIBLE_KEYS);
  for (const key of CONTROL_ONLY_KEYS) {
    assert.ok(
      !visible.has(key),
      `control-only key "${key}" is on the worker-visible allowlist. Adding a control-only ` +
        "key to WORKER_VISIBLE_KEYS hands the worker its own grading sheet; this test exists " +
        "to fail that change.",
    );
  }
});

test("a control-carrying item assembles to exactly the ordinary shape", () => {
  const worker = assembleWorkerItem(controlCarryingItem());
  const ordinary = ordinaryItem();

  // Deep key comparison: the assembled shape IS the ordinary shape.
  assert.deepEqual(
    new Set(keyPaths(worker, "item")),
    new Set(keyPaths(ordinary, "item")),
    "the worker-visible shape of a control item must be indistinguishable from an ordinary item",
  );

  // And no control marker survives anywhere, including as a serialized key.
  const serialized = JSON.stringify(worker);
  for (const key of CONTROL_ONLY_KEYS) {
    assert.ok(
      !serialized.includes(`"${key}"`),
      `control marker "${key}" survived into worker-visible context`,
    );
  }
});

test("an ordinary item passes the boundary unchanged in shape", () => {
  const ordinary = ordinaryItem();
  const worker = assembleWorkerItem(ordinary as unknown as Record<string, unknown>);
  assert.deepEqual(worker, ordinary);
});

test("SEEDED FAILURE: a control-only key nested inside a worker-visible value throws", () => {
  const smuggling = controlCarryingItem();
  // The smuggle: control identity riding INSIDE an allowlisted field, where a
  // top-level allowlist copy would carry it straight into worker context.
  smuggling.contract = {
    ...(smuggling.contract as Record<string, unknown>),
    fact_class: "known_present",
  };
  assert.throws(
    () => assembleWorkerItem(smuggling),
    /control marker/i,
    "a control-only key nested inside a worker-visible value must be refused, not stripped",
  );
});

test("SEEDED FAILURE: widening the allowlist onto a control-only key is refused at every call", () => {
  // Simulate the future defect this test exists to catch: someone adds a
  // control-only key to the worker allowlist. The boundary must refuse to
  // assemble ANY context while the allowlist is in that state.
  const mutable = WORKER_VISIBLE_KEYS as unknown as string[];
  mutable.push("fact_class");
  try {
    assert.throws(
      () => assembleWorkerItem(controlCarryingItem()),
      /allowlist contains control-only key/i,
      "an allowlist widened onto control identity must refuse all assembly",
    );
    assert.throws(
      () => assembleWorkerItem(ordinaryItem() as unknown as Record<string, unknown>),
      /allowlist contains control-only key/i,
      "the refusal is unconditional — ordinary items are refused too while the allowlist is wrong",
    );
  } finally {
    mutable.pop();
  }
  // And the boundary works again once the allowlist is honest.
  assert.ok(assembleWorkerItem(controlCarryingItem()));
});
