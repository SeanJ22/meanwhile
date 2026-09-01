/**
 * **EVALUATING A VISUAL CHECK AGAINST THE RENDERED DOM.** (Part C, 2026-08-31.)
 *
 * `visual-evaluation.ts` is the IMAGE half: it answers the properties that are
 * inherently visual from decoded pixels, because a bounding box is a DOM
 * measurement and this repository has photographed overlays while every
 * selector passed.
 *
 * This is the other half, and it did not exist. `visual-acceptance.ts` has
 * named five DOM_CERTIFIABLE_PROPERTIES since Session A — `text_content`,
 * `element_presence`, `element_count`, `link_target`,
 * `stated_n_equals_rendered_rows` — and nothing evaluated any of them. Every
 * one of them fell through `visual-suite.mts`'s switch to the default arm and
 * came back NOT_EVALUABLE naming a missing image evaluator, which was the
 * wrong diagnosis: an image evaluator is exactly what those five must NOT
 * have. The result was that the thirteen rows of the 8.30.26 sweep which cite
 * a `vac:` id had no instrument available to them even in principle.
 *
 * ## The division of labour, stated so it is not re-litigated
 *
 * ```
 *   IMAGE_ONLY_PROPERTIES     -> visual-evaluation.ts, from decoded pixels
 *   DOM_CERTIFIABLE_PROPERTIES-> this module, from an observation of the DOM
 * ```
 *
 * `requiredEvidenceKind()` in `visual-acceptance.ts` is the one place that
 * decides which side a property falls on. Nothing here re-derives it, and
 * nothing here may be pointed at an image-only property: `assertionFits()`
 * refuses the pairing rather than answering it.
 *
 * ## Why the observation is a value, and not a page handle
 *
 * The harness holds the browser; this module holds no I/O at all. The page is
 * asked ONE question — {@link DomObservation} — and every verdict is a pure
 * function of that value, so the reasoning is unit-testable without a browser
 * and a failing verdict can be reproduced from the recorded observation alone.
 *
 * ## `textContent` has no separators
 *
 * A word-boundary match against `textContent` never fires across element
 * boundaries: `<b>No</b><span>agenda</span>` is the single token `Noagenda`.
 * So the observation carries `innerText` — which the browser renders WITH the
 * separators a reader sees — normalised to single spaces. Every needle here is
 * matched against that, case-insensitively, and never against `textContent`.
 *
 * ## The one thing this module never does
 *
 * It never returns GREEN for a question it could not ask. A selector that
 * matched nothing, an assertion with no evaluator, an expectation that states
 * no expectation: each is `NOT_EVALUABLE` with the missing piece NAMED. A
 * check that cannot be run is not a check, and a check that cannot be
 * evaluated must say so loudly rather than pass quietly — that is the whole
 * reason this file exists.
 */

import {
  DOM_CERTIFIABLE_PROPERTIES,
  requiredEvidenceKind,
  type AssertedProperty,
  type DomCertifiableProperty,
} from "./visual-acceptance.ts";

/* --------------------------------------------------------- the observation */

/**
 * Everything the page was asked, in one value.
 *
 * Collected by the harness in a single `page.evaluate`, so a verdict rests on
 * ONE observation of ONE render rather than on several reads of a page that
 * may have changed between them.
 */
export interface DomObservation {
  /** The selector the observation was taken with. Echoed into every detail. */
  readonly selector: string;
  /** How many elements matched. Zero is an answer for some assertions only. */
  readonly matchCount: number;
  /**
   * `innerText` of the first match, whitespace-normalised to single spaces.
   * Null when nothing matched. NEVER `textContent` — see the header.
   */
  readonly text: string | null;
  /** The first match's attributes, lowercased names. Empty when nothing matched. */
  readonly attributes: Readonly<Record<string, string>>;
  /** The first match's resolved `href`, or null when it is not a link. */
  readonly href: string | null;
  /**
   * How many elements the assertion's own row selector matched, for
   * `stated_n_equals_rendered_rows`. Null when the assertion did not ask.
   */
  readonly rowCount: number | null;
  /**
   * Whether the first match is an OPEN `<details>`; null when the first match
   * is not a `<details>` element at all. A collapsed-by-default claim is about
   * this bit and nothing else.
   */
  readonly detailsOpen: boolean | null;
}

/* ---------------------------------------------------------- the assertions */

/**
 * What a DOM check claims. One shape per DOM-certifiable property, and the
 * pairing is enforced by {@link assertionFits} rather than by review.
 *
 * `needles` are matched case-insensitively against the normalised `innerText`
 * of the FIRST match. `TEXT_CONTAINS` requires every needle; `TEXT_ABSENT`
 * requires none of them, which is the shape a "we no longer claim X" check
 * needs and the shape that caught WGH-19 and WGH-21.
 */
export type DomAssertion =
  | { readonly kind: "TEXT_CONTAINS"; readonly needles: readonly string[] }
  | { readonly kind: "TEXT_ABSENT"; readonly needles: readonly string[] }
  | { readonly kind: "PRESENT" }
  | { readonly kind: "ABSENT" }
  | { readonly kind: "COUNT"; readonly expected: number }
  | { readonly kind: "COUNT_AT_LEAST"; readonly minimum: number }
  | { readonly kind: "DETAILS_COLLAPSED" }
  | { readonly kind: "ATTRIBUTE_EQUALS"; readonly attribute: string; readonly value: string }
  | { readonly kind: "LINK_TARGET"; readonly hrefContains: string }
  | {
      readonly kind: "STATED_N_EQUALS_ROWS";
      /** A regex source with ONE capturing group holding the stated integer. */
      readonly statedPattern: string;
      /** The selector whose matches are the rendered rows. */
      readonly rowSelector: string;
    };

export type DomAssertionKind = DomAssertion["kind"];

/** Which assertions may certify which property. There is no default arm. */
const ASSERTIONS_BY_PROPERTY: Readonly<
  Record<DomCertifiableProperty, readonly DomAssertionKind[]>
> = {
  text_content: ["TEXT_CONTAINS", "TEXT_ABSENT"],
  element_presence: ["PRESENT", "ABSENT", "DETAILS_COLLAPSED", "ATTRIBUTE_EQUALS"],
  element_count: ["COUNT", "COUNT_AT_LEAST"],
  link_target: ["LINK_TARGET"],
  stated_n_equals_rendered_rows: ["STATED_N_EQUALS_ROWS"],
};

/**
 * Is this assertion allowed to certify this property?
 *
 * Returns the reason it is NOT, or null when it fits. An image-only property
 * is refused BY NAME rather than answered: pointing a selector at `clipping`
 * is the exact shortcut `validateVisualAcceptanceCheck` exists to refuse, and
 * a second door into it would make that refusal decorative.
 */
export function assertionFits(property: AssertedProperty, assertion: DomAssertion): string | null {
  if (requiredEvidenceKind(property) !== "DOM_EVALUATED") {
    return (
      `property "${property}" is inherently visual and requires IMAGE_EVALUATED evidence. ` +
      "A DOM assertion may not certify it: DOM presence has photographed overlays while " +
      "every selector passed."
    );
  }
  if (!(DOM_CERTIFIABLE_PROPERTIES as readonly string[]).includes(property)) {
    return `property "${property}" is in no known property list, so no evaluator claims it`;
  }
  const allowed = ASSERTIONS_BY_PROPERTY[property as DomCertifiableProperty];
  if (!allowed.includes(assertion.kind)) {
    return (
      `assertion "${assertion.kind}" cannot certify property "${property}". ` +
      `That property is certified by: ${allowed.join(", ")}.`
    );
  }
  return null;
}

/* ------------------------------------------------------------- the verdict */

export interface DomVerdict {
  readonly verdict: "GREEN" | "RED" | "NOT_EVALUABLE";
  /** What was measured, in numbers and quoted strings, so a failure is arguable. */
  readonly detail: string;
}

/** Which selectors an assertion needs the harness to observe, beyond its own. */
export function rowSelectorFor(assertion: DomAssertion): string | null {
  return assertion.kind === "STATED_N_EQUALS_ROWS" ? assertion.rowSelector : null;
}

function quote(text: string, limit = 220): string {
  const trimmed = text.length > limit ? `${text.slice(0, limit)}…` : text;
  return JSON.stringify(trimmed);
}

/**
 * The assertions that need an element on the page to mean anything.
 *
 * `ABSENT` and the two counting assertions are answerable at zero matches —
 * "nothing is there" is the answer, not the absence of one. Everything else
 * asked of an empty match set is an UNANSWERED observation, and the harness
 * says so with the selector named rather than scoring the product.
 */
const NEEDS_AN_ELEMENT: readonly DomAssertionKind[] = [
  "TEXT_CONTAINS",
  "TEXT_ABSENT",
  "PRESENT",
  "DETAILS_COLLAPSED",
  "ATTRIBUTE_EQUALS",
  "LINK_TARGET",
  "STATED_N_EQUALS_ROWS",
];

/**
 * Evaluate one DOM assertion against one observation. Pure.
 *
 * The three verdicts are not interchangeable and the difference is the point:
 * `RED` is a claim about the PRODUCT, `NOT_EVALUABLE` is a claim about the
 * CHECK or the harness, and `GREEN` is only ever returned for a question that
 * was actually asked and actually answered.
 */
export function evaluateDomAssertion(
  observation: DomObservation,
  assertion: DomAssertion,
): DomVerdict {
  const where = `${observation.selector} matched ${observation.matchCount} element(s)`;

  if (observation.matchCount === 0 && NEEDS_AN_ELEMENT.includes(assertion.kind)) {
    return {
      verdict: "NOT_EVALUABLE",
      detail:
        `${where}, and "${assertion.kind}" is a claim ABOUT an element. A check whose subject ` +
        "is not on the page is a failed observation with the wall named, never a passing " +
        "check and never a red against the product.",
    };
  }

  switch (assertion.kind) {
    case "PRESENT":
      return {
        verdict: "GREEN",
        detail: `${where} — present, which is what this check asserts.`,
      };

    case "ABSENT":
      return observation.matchCount === 0
        ? { verdict: "GREEN", detail: `${where} — absent, which is what this check asserts.` }
        : {
            verdict: "RED",
            detail: `${where}, and this check asserts it is absent. First match reads ${quote(
              observation.text ?? "",
            )}.`,
          };

    case "COUNT":
      return observation.matchCount === assertion.expected
        ? {
            verdict: "GREEN",
            detail: `${where} — exactly the ${assertion.expected} this check states.`,
          }
        : {
            verdict: "RED",
            detail: `${where}; this check states ${assertion.expected}.`,
          };

    case "COUNT_AT_LEAST":
      return observation.matchCount >= assertion.minimum
        ? {
            verdict: "GREEN",
            detail: `${where} — at or above the floor of ${assertion.minimum} this check states.`,
          }
        : {
            verdict: "RED",
            detail: `${where}; this check states a floor of ${assertion.minimum}.`,
          };

    case "TEXT_CONTAINS": {
      if (assertion.needles.length === 0) {
        return {
          verdict: "NOT_EVALUABLE",
          detail:
            "a TEXT_CONTAINS assertion states what the surface must say; this one names no " +
            "needles, and an unstated expectation cannot be met or missed.",
        };
      }
      const text = (observation.text ?? "").toLowerCase();
      const missing = assertion.needles.filter((n) => !text.includes(n.toLowerCase()));
      return missing.length === 0
        ? {
            verdict: "GREEN",
            detail:
              `${where}; all ${assertion.needles.length} required phrase(s) are in its rendered ` +
              `text. Read: ${quote(observation.text ?? "")}`,
          }
        : {
            verdict: "RED",
            detail:
              `${where}; ${missing.length} of ${assertion.needles.length} required phrase(s) ` +
              `absent: ${missing.map((m) => quote(m, 80)).join(", ")}. Read: ${quote(
                observation.text ?? "",
              )}`,
          };
    }

    case "TEXT_ABSENT": {
      if (assertion.needles.length === 0) {
        return {
          verdict: "NOT_EVALUABLE",
          detail:
            "a TEXT_ABSENT assertion names the phrase that may no longer appear; this one " +
            "names none, so it asserts nothing.",
        };
      }
      const text = (observation.text ?? "").toLowerCase();
      const found = assertion.needles.filter((n) => text.includes(n.toLowerCase()));
      return found.length === 0
        ? {
            verdict: "GREEN",
            detail:
              `${where}; none of the ${assertion.needles.length} forbidden phrase(s) appear in ` +
              `its rendered text. Read: ${quote(observation.text ?? "")}`,
          }
        : {
            verdict: "RED",
            detail:
              `${where}; ${found.length} forbidden phrase(s) are back on the surface: ` +
              `${found.map((f) => quote(f, 80)).join(", ")}. Read: ${quote(
                observation.text ?? "",
              )}`,
          };
    }

    case "DETAILS_COLLAPSED":
      if (observation.detailsOpen === null) {
        return {
          verdict: "NOT_EVALUABLE",
          detail:
            `${where}, and the first match is not a <details> element — a collapsed-by-default ` +
            "claim is about the `open` attribute of a disclosure, and this selector found " +
            "something else. That is a gap in the CHECK's selector, not a verdict on the product.",
        };
      }
      return observation.detailsOpen
        ? {
            verdict: "RED",
            detail: `${where}; the <details> is OPEN, and this check asserts it starts collapsed.`,
          }
        : {
            verdict: "GREEN",
            detail:
              `${where}; the <details> carries no \`open\`, so it starts collapsed. Summary ` +
              `reads ${quote(observation.text ?? "")}`,
          };

    case "ATTRIBUTE_EQUALS": {
      const actual = observation.attributes[assertion.attribute.toLowerCase()];
      if (actual === undefined) {
        return {
          verdict: "RED",
          detail:
            `${where}; the first match carries no ${quote(assertion.attribute, 60)} attribute, ` +
            `and this check states it equals ${quote(assertion.value, 60)}.`,
        };
      }
      return actual === assertion.value
        ? {
            verdict: "GREEN",
            detail: `${where}; ${assertion.attribute}=${quote(actual, 60)}, as stated.`,
          }
        : {
            verdict: "RED",
            detail:
              `${where}; ${assertion.attribute}=${quote(actual, 60)} and this check states ` +
              `${quote(assertion.value, 60)}.`,
          };
    }

    case "LINK_TARGET": {
      if (observation.href === null) {
        return {
          verdict: "RED",
          detail:
            `${where}; the first match resolves no href, and a link-target check is a claim ` +
            "about where a reader is sent.",
        };
      }
      return observation.href.includes(assertion.hrefContains)
        ? {
            verdict: "GREEN",
            detail: `${where}; href ${quote(observation.href, 160)} carries the stated target.`,
          }
        : {
            verdict: "RED",
            detail:
              `${where}; href ${quote(observation.href, 160)} does not contain ` +
              `${quote(assertion.hrefContains, 80)}.`,
          };
    }

    case "STATED_N_EQUALS_ROWS": {
      if (observation.rowCount === null) {
        return {
          verdict: "NOT_EVALUABLE",
          detail:
            `the harness did not observe ${quote(assertion.rowSelector, 80)}, so the rendered ` +
            "rows were never counted and the stated number has nothing to be equal to.",
        };
      }
      let stated: RegExp;
      try {
        stated = new RegExp(assertion.statedPattern, "i");
      } catch {
        return {
          verdict: "NOT_EVALUABLE",
          detail: `statedPattern ${quote(assertion.statedPattern, 120)} is not a valid regex`,
        };
      }
      const match = stated.exec(observation.text ?? "");
      if (!match || match[1] === undefined) {
        return {
          verdict: "NOT_EVALUABLE",
          detail:
            `${where}, and ${quote(assertion.statedPattern, 120)} captured no number from its ` +
            `rendered text, so there is no STATED n to compare. Read: ${quote(
              observation.text ?? "",
            )}`,
        };
      }
      const statedN = Number(match[1]);
      if (!Number.isFinite(statedN)) {
        return {
          verdict: "NOT_EVALUABLE",
          detail: `the captured group ${quote(match[1], 40)} is not a number`,
        };
      }
      return statedN === observation.rowCount
        ? {
            verdict: "GREEN",
            detail:
              `${where}; it states ${statedN} and ${quote(assertion.rowSelector, 80)} renders ` +
              `${observation.rowCount} row(s). Stated N equals rendered rows.`,
          }
        : {
            verdict: "RED",
            detail:
              `${where}; it states ${statedN} while ${quote(assertion.rowSelector, 80)} renders ` +
              `${observation.rowCount} row(s). Stated N must equal rendered rows.`,
          };
    }

    default: {
      /*
       * A kind with no arm is a HARNESS gap, and it is named as one. This can
       * only be reached by a `DomAssertion` member added above without an arm
       * here, which is exactly the silent-drop this whole module refuses.
       */
      const unknown = assertion as { kind?: string };
      return {
        verdict: "NOT_EVALUABLE",
        detail:
          `no DOM evaluator is implemented for assertion kind ` +
          `${quote(String(unknown.kind ?? "undefined"), 60)}. That is a gap in ` +
          "lib/health/dom-evaluation.ts, stated as one — a harness gap is not evidence about " +
          "the product either way.",
      };
    }
  }
}
