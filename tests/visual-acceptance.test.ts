import assert from "node:assert/strict";
import test from "node:test";

import {
  assertValidVisualAcceptanceCheck,
  DOM_CERTIFIABLE_PROPERTIES,
  IMAGE_ONLY_PROPERTIES,
  requiredEvidenceKind,
  validateVisualAcceptanceCheck,
  type VisualAcceptanceCheck,
} from "../lib/health/visual-acceptance.ts";

/**
 * SCREENSHOT LAW AS A TYPE RULE (WS-CONTRACT): an inherently visual property
 * with DOM-only evidence is refused. This repo has photographed overlays
 * while every selector passed; DOM presence may not certify pixels.
 */

function check(overrides: Partial<VisualAcceptanceCheck>): VisualAcceptanceCheck {
  return {
    id: "vac:ballot-cards",
    surface: "/ballot",
    zip: "85701",
    viewport: { width: 390, height: 844 },
    window: { notBefore: null, notAfter: null },
    status: { state: "ACTIVE" },
    expectation: { kind: "WRITTEN_EXPECTATION", text: "no candidate card clips its text" },
    property: "clipping",
    evidenceKind: "IMAGE_EVALUATED",
    ...overrides,
  };
}

test("every inherently visual property requires IMAGE_EVALUATED evidence", () => {
  for (const property of IMAGE_ONLY_PROPERTIES) {
    assert.equal(requiredEvidenceKind(property), "IMAGE_EVALUATED");
    const problems = validateVisualAcceptanceCheck(
      check({ property, evidenceKind: "DOM_EVALUATED" }),
    );
    assert.ok(
      problems.length > 0,
      `property "${property}" with DOM-only evidence must be refused`,
    );
    assert.throws(
      () => assertValidVisualAcceptanceCheck(check({ property, evidenceKind: "DOM_EVALUATED" })),
      /IMAGE_EVALUATED/,
    );
    // The same property with image evidence is fine.
    assert.deepEqual(
      validateVisualAcceptanceCheck(check({ property, evidenceKind: "IMAGE_EVALUATED" })),
      [],
    );
  }
});

test("semantic properties are certifiable from the rendered DOM", () => {
  for (const property of DOM_CERTIFIABLE_PROPERTIES) {
    assert.equal(requiredEvidenceKind(property), "DOM_EVALUATED");
    assert.deepEqual(
      validateVisualAcceptanceCheck(check({ property, evidenceKind: "DOM_EVALUATED" })),
      [],
    );
  }
});

test("a malformed expectation or viewport is named, not passed", () => {
  const noPath = validateVisualAcceptanceCheck(
    check({ expectation: { kind: "ANNOTATED_SCREENSHOT", path: "" } }),
  );
  assert.ok(noPath.some((p) => p.includes("no path")));

  const badViewport = validateVisualAcceptanceCheck(
    check({ viewport: { width: 0, height: 844 } }),
  );
  assert.ok(badViewport.some((p) => p.includes("viewport")));
});

