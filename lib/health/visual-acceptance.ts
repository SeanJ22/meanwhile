/**
 * VISUAL ACCEPTANCE CHECKS — screenshot law as a typed artifact (Session A,
 * WS-CONTRACT).
 *
 * A VisualAcceptanceCheck is its own artifact type, separate from reader
 * questions: the reader contract asks whether a fact can be LEARNED from a
 * surface, this asks whether the surface LOOKS the way the owner accepted.
 *
 * The load-bearing rule is the property-kind → evidence-kind rule. DOM
 * presence proves semantics — the text is there, the rows are counted — and
 * proves nothing about pixels: this repo has photographed overlays while every
 * selector passed, read `naturalWidth 0` under a hidden pane, and watched a
 * dropped clip-path report FULL coverage. So a property that is inherently
 * visual (clipping, overlap, position, responsive hierarchy, prominence,
 * visibility, spacing) carries `IMAGE_EVALUATED` and requires a captured
 * render actually evaluated AS AN IMAGE; `validateVisualAcceptanceCheck`
 * refuses the DOM shortcut mechanically rather than by review.
 */

import { createWorkItem, type WorkItem } from "../control-plane/work-item.ts";

import {
  isFailureClass,
  type ApplicabilityWindow,
  type FailureClass,
  type InstanceStatus,
} from "./reader-question.ts";

/** Re-exported: the failure taxonomy is one vocabulary across both artifact types. */
export type { FailureClass } from "./reader-question.ts";

/* ------------------------------------------------------------- properties */

/** Properties the rendered DOM can certify. */
export const DOM_CERTIFIABLE_PROPERTIES = [
  "text_content",
  "element_presence",
  "element_count",
  "link_target",
  "stated_n_equals_rendered_rows",
] as const;

/** Properties that are inherently visual. DOM presence may not certify these. */
export const IMAGE_ONLY_PROPERTIES = [
  "clipping",
  "overlap",
  "position",
  "responsive_hierarchy",
  "visual_prominence",
  "visibility",
  "spacing",
  "image_level",
] as const;

export type DomCertifiableProperty = (typeof DOM_CERTIFIABLE_PROPERTIES)[number];
export type ImageOnlyProperty = (typeof IMAGE_ONLY_PROPERTIES)[number];
export type AssertedProperty = DomCertifiableProperty | ImageOnlyProperty;

export const EVIDENCE_KINDS = ["DOM_EVALUATED", "IMAGE_EVALUATED"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** The rule itself, as a function, so nothing re-derives it by hand. */
export function requiredEvidenceKind(property: AssertedProperty): EvidenceKind {
  return (IMAGE_ONLY_PROPERTIES as readonly string[]).includes(property)
    ? "IMAGE_EVALUATED"
    : "DOM_EVALUATED";
}

/* ---------------------------------------------------------------- the check */

/** The owner's stated expectation — an annotated capture, or written words. */
export type VisualExpectation =
  | { readonly kind: "ANNOTATED_SCREENSHOT"; readonly path: string }
  | { readonly kind: "WRITTEN_EXPECTATION"; readonly text: string };

export interface VisualAcceptanceCheck {
  readonly id: string;
  /** The surface under check — a route or a named component region. */
  readonly surface: string;
  readonly zip: string;
  readonly viewport: { readonly width: number; readonly height: number };
  /** Same retirement semantics as reader questions: recorded, never deleted. */
  readonly window: ApplicabilityWindow;
  readonly status: InstanceStatus;
  readonly expectation: VisualExpectation;
  readonly property: AssertedProperty;
  /** What the evidence for this check actually is. */
  readonly evidenceKind: EvidenceKind;
}

/**
 * Refuses, by name, a check whose evidence kind cannot certify its property.
 * The one-directional failure that matters: an image-only property with
 * DOM-only evidence is a pixel claim backed by a selector.
 */
export function validateVisualAcceptanceCheck(check: VisualAcceptanceCheck): string[] {
  const problems: string[] = [];
  const required = requiredEvidenceKind(check.property);
  if (required === "IMAGE_EVALUATED" && check.evidenceKind !== "IMAGE_EVALUATED") {
    problems.push(
      `property "${check.property}" is inherently visual and requires IMAGE_EVALUATED ` +
        `evidence — a captured render evaluated as an image. ${check.evidenceKind} cannot ` +
        "certify it: DOM presence has photographed overlays while every selector passed.",
    );
  }
  if (check.viewport.width <= 0 || check.viewport.height <= 0) {
    problems.push("viewport must have positive dimensions");
  }
  if (check.expectation.kind === "ANNOTATED_SCREENSHOT" && !check.expectation.path) {
    problems.push("annotated-screenshot expectation carries no path");
  }
  if (check.expectation.kind === "WRITTEN_EXPECTATION" && !check.expectation.text) {
    problems.push("written expectation carries no text");
  }
  return problems;
}

export function assertValidVisualAcceptanceCheck(check: VisualAcceptanceCheck): void {
  const problems = validateVisualAcceptanceCheck(check);
  if (problems.length > 0) {
    throw new Error(`visual acceptance check ${check.id} is invalid: ${problems.join("; ")}`);
  }
}

/* ------------------------------------------------------------- diagnostics */

/**
 * A visual failure produces a typed diagnostic WorkItem against the CLASS of
 * regression, not an instance patch: the obligation names the check and its
 * failure class, and the why says the fix is class-wide — one clipped card is
 * every card that clips under that condition.
 *
 * `failureClass` is required and validated for the same reason
 * `diagnosticWorkItemFor` requires it: red is diagnosed before it is worked.
 */
export function visualDiagnosticWorkItemFor(
  check: VisualAcceptanceCheck,
  failureClass: FailureClass,
  now: string,
): WorkItem {
  if (!isFailureClass(failureClass)) {
    throw new Error(
      `visualDiagnosticWorkItemFor requires one of the twelve failure classes; got ` +
        `${JSON.stringify(failureClass)}. There is no default class.`,
    );
  }
  return createWorkItem({
    project: "pilot-health",
    subject: check.surface,
    obligation: `visual-diagnostic:${failureClass}:${check.id}`,
    why:
      `Visual acceptance check ${check.id} on ${check.surface} (zip ${check.zip}, ` +
      `${check.viewport.width}x${check.viewport.height}) failed with class ` +
      `"${failureClass}". The fix is class-wide — the regression class, not this one ` +
      "instance — and the completion contract is the check passing on a fresh capture " +
      "evaluated with the evidence kind its property requires.",
    priority: "P1",
    now,
  });
}
