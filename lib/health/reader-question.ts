/**
 * READER QUESTIONS — the reader-contract corpus (Session A, WS-CONTRACT).
 *
 * A ReaderQuestionTemplate is durable law about what a reader must be able to
 * learn; a ReaderQuestionInstance is that law instantiated against the CURRENT
 * registry for the pilot ZIPs. The split matters because the two rot on
 * different clocks: a template survives every registry rebuild, while an
 * instance about a meeting that has passed or an election that has closed is
 * RETIRED — a recorded state, never a deletion — so a stale row can never
 * masquerade as an open obligation or as a green one.
 *
 * ## The two question classes, and why both exist
 *
 * `GENERATED_FROM_REGISTRY` instances inherit the registry's blind spots by
 * construction: a body the registry does not enumerate produces no question
 * about itself, so a generated-only corpus can be 100% green over an
 * incorrectly small universe. `HAND_AUTHORED_ADVERSARIAL` questions are
 * written by a person, independent of the registry, precisely to catch that —
 * they are the corpus's own denominator check, and nothing generates them.
 *
 * ## The applicability source, stated (the mechanically honest one)
 *
 * ZIP → body applicability is computed from two committed stores:
 *
 *   1. `data/derived/zip-division-ids.json` — every division whose territory
 *      reaches inside the ZIP, derived from TIGER polygons (`NJ01`: a ZCTA
 *      crosses boundaries, so the AREA index is the honest zip answer).
 *   2. `lib/registry/registry.json` — the bodies associated with those
 *      divisions, matching on `ocdId` OR `alsoServesOcdIds` (RULING 121).
 *
 * The per-contact `zips` arrays in `lib/routing/everyday.ts` were considered
 * and rejected: they key CONTACTS (a service line for a topic), not governing
 * bodies, so reading body applicability off them would substitute a curated
 * convenience sample for the enumerated universe.
 *
 * ## RULING 9, encoded in types
 *
 * Census/NCES establish the GOVERNMENT/district universe (Tier 0/1) and may
 * NEVER establish Tier-2 body enumeration. The denominator a universe check
 * runs against therefore carries its layer and its source as data, and
 * `assertDenominatorMayCertify` refuses a Census/NCES-sourced denominator for
 * the governing-body layer. No denominator may certify a layer it does not
 * enumerate.
 */

import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { createWorkItem, type WorkItem } from "../control-plane/work-item.ts";
import type { ReaderExpectation } from "./ask-evaluation.ts";
import type { Body, Registry } from "../registry/types.ts";

/* ---------------------------------------------------------------- classes */

export const QUESTION_CLASSES = [
  /** Instantiated from the registry's enumerated bodies. Inherits its gaps. */
  "GENERATED_FROM_REGISTRY",
  /**
   * Written by a person, independent of the registry, to guard against an
   * incorrectly small generated universe. Never generated.
   */
  "HAND_AUTHORED_ADVERSARIAL",
] as const;
export type QuestionClass = (typeof QUESTION_CLASSES)[number];

/** The placeholder vocabulary a template may use, closed so rendering is total. */
export const TEMPLATE_PLACEHOLDERS = ["BODY", "ZIP"] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

/**
 * When a template applies. Machine-checkable — instantiation reads this, so a
 * template cannot be silently skipped or silently over-applied.
 */
export type ApplicabilityRule =
  /** One instance per (pilot ZIP, enumerated body in that ZIP). */
  | { readonly kind: "EVERY_BODY_IN_ZIP" }
  /** One instance per pilot ZIP; no body subject. */
  | { readonly kind: "PER_ZIP" };

export interface ReaderQuestionTemplate {
  readonly id: string;
  readonly questionClass: QuestionClass;
  /** Template text using `[BODY]` / `[ZIP]` from the placeholder vocabulary. */
  readonly templateText: string;
  /** The placeholders this template actually uses. */
  readonly placeholders: readonly TemplatePlaceholder[];
  readonly applicability: ApplicabilityRule;
  /**
   * **THE TYPED PROPOSITION A CORRECT ANSWER ASSERTS.** (A.1 WI1, 2026-08-30.)
   *
   * This was `{ kind: "DOM_TEXT_INCLUDES"; text: string }`, and the harness
   * that read it tested `document.body.innerText.includes(text)`. A page
   * carrying the expected words anywhere — a nav label, an unrelated roster —
   * went green while the Ask engine could have returned a fallback, the wrong
   * government, or nothing at all. The check reported on a different question
   * than the one it claimed to answer.
   *
   * A substring is not a proposition. This is: an entity, a value, a list, or
   * a verified absence, evaluated against the ANSWER the reader actually got.
   * `lib/health/ask-evaluation.ts` holds what each kind requires.
   *
   * Absent, an instance is honestly NOT_EVALUABLE — never green.
   */
  readonly expectation?: ReaderExpectation;
}

/* -------------------------------------------------------------- instances */

/**
 * Retirement is a RECORDED state. A passed meeting or a closed election
 * retires its instances; deleting them would erase the fact that the corpus
 * once asked, and a denominator that forgets is a denominator that flatters.
 */
export type InstanceStatus =
  | { readonly state: "ACTIVE" }
  | { readonly state: "RETIRED"; readonly retiredAt: string; readonly reason: string };

export interface ApplicabilityWindow {
  /** ISO date-time before which the instance does not yet apply, or null. */
  readonly notBefore: string | null;
  /** ISO date-time after which the instance is retired, or null for standing. */
  readonly notAfter: string | null;
}

export interface ReaderQuestionInstance {
  readonly id: string;
  readonly templateId: string;
  readonly questionClass: QuestionClass;
  readonly zip: string;
  /** The registry body id (`<ocdId>#<slug>`), where the template has a body subject. */
  readonly subjectBodyId: string | null;
  /** The rendered question, plain language — no OCD-ID, no enum value. */
  readonly questionText: string;
  readonly window: ApplicabilityWindow;
  readonly status: InstanceStatus;
}

/**
 * Plain-language reference to a body, for question text.
 *
 * Never invents a name: a sourced `name` is used verbatim, and an unsourced
 * body is DESCRIBED — "the governing body for Newbury" — which is a claim the
 * registry actually makes (bodyClass + division association), not a minted
 * proper noun.
 */
export function bodyPlainLabel(body: Body, divisionLabel: string | null): string {
  if (body.name) return body.name;
  const where = divisionLabel ?? "this area";
  switch (body.bodyClass) {
    case "GOVERNING":
      return `the governing body for ${where}`;
    case "ADVISORY":
      return `the advisory board for ${where}`;
    case "COMMISSION":
      return `the commission for ${where}`;
    case "REGIONAL":
      return `the regional body for ${where}`;
    case "PRIVATE_ASSOCIATION":
      return `the community association for ${where}`;
    case "EXECUTIVE_AGENCY":
      return `the agency serving ${where}`;
    case "SOVEREIGN_TRIBAL":
      return `the tribal government for ${where}`;
  }
}

function instanceId(templateId: string, zip: string, subjectBodyId: string | null): string {
  const hash = createHash("sha256")
    .update(`${templateId}\u0000${zip}\u0000${subjectBodyId ?? ""}`)
    .digest("hex")
    .slice(0, 16);
  return `rq:${hash}`;
}

function renderQuestion(
  template: ReaderQuestionTemplate,
  zip: string,
  bodyLabel: string | null,
): string {
  let text = template.templateText;
  for (const placeholder of template.placeholders) {
    const token = `[${placeholder}]`;
    const value = placeholder === "ZIP" ? zip : bodyLabel;
    if (value === null) {
      throw new Error(
        `template ${template.id} uses ${token} but no value exists for it here — ` +
          "a placeholder rendered as its own token would ship an enum-shaped string.",
      );
    }
    text = text.split(token).join(value);
  }
  return text;
}

/* ------------------------------------------------------- the pilot universe */

/** One ZIP's slice of the enumerated body universe, with the division labels. */
export interface ZipBodyUniverse {
  readonly zip: string;
  /** Division OCD ids whose territory reaches this ZIP (TIGER-derived index). */
  readonly divisionIds: readonly string[];
  /** Registry bodies associated with those divisions (ocdId or alsoServesOcdIds). */
  readonly bodies: readonly Body[];
  /** ocdId → label, for plain-language body references. */
  readonly divisionLabels: ReadonlyMap<string, string>;
}

/**
 * Pure join: the bodies applicable to a ZIP, given the division index and the
 * registry. Matching on `ocdId` OR `alsoServesOcdIds` so a body spanning two
 * towns (RULING 121) is visible from both.
 */
export function bodiesForDivisions(
  divisionIds: readonly string[],
  bodies: readonly Body[],
): Body[] {
  const wanted = new Set(divisionIds);
  return bodies.filter(
    (b) =>
      (b.ocdId !== null && wanted.has(b.ocdId)) ||
      (b.alsoServesOcdIds ?? []).some((id) => wanted.has(id)),
  );
}

/**
 * Load the per-ZIP body universe for the given ZIPs from the committed stores.
 *
 * Both reads are load-bearing and neither failure is an empty answer: a store
 * that cannot be read throws, naming the file — "we could not read it" and
 * "there is nothing there" are different sentences.
 */
export async function loadZipBodyUniverses(
  zips: readonly string[],
  root: string = process.cwd(),
): Promise<ZipBodyUniverse[]> {
  const registryPath = join(root, "lib", "registry", "registry.json");
  const indexPath = join(root, "data", "derived", "zip-division-ids.json");

  let registry: Registry;
  try {
    registry = JSON.parse(await readFile(registryPath, "utf8")) as Registry;
  } catch (error) {
    throw new Error(`the registry at ${registryPath} could not be read: ${String(error)}`);
  }
  let index: { zips: Record<string, string[]> };
  try {
    index = JSON.parse(await readFile(indexPath, "utf8")) as { zips: Record<string, string[]> };
  } catch (error) {
    throw new Error(`the zip-division index at ${indexPath} could not be read: ${String(error)}`);
  }

  const divisionLabels = new Map<string, string>(
    registry.divisions.map((d) => [d.ocdId, d.label]),
  );

  return zips.map((zip) => {
    const divisionIds = index.zips[zip];
    if (!divisionIds || divisionIds.length === 0) {
      // A pilot ZIP absent from the index is a defect in the index, not an
      // empty government: refuse rather than generate zero questions quietly.
      throw new Error(
        `pilot ZIP ${zip} is absent from ${indexPath} — refusing to treat a missing ` +
          "index entry as a ZIP with no governments.",
      );
    }
    return {
      zip,
      divisionIds,
      bodies: bodiesForDivisions(divisionIds, registry.bodies),
      divisionLabels,
    };
  });
}

/* ------------------------------------------------------------- generation */

/**
 * Instantiate templates against the per-ZIP universes.
 *
 * `now` is a parameter, never a clock read — instances born already past
 * their window are born RETIRED rather than born stale.
 */
export function generateInstances(
  templates: readonly ReaderQuestionTemplate[],
  universes: readonly ZipBodyUniverse[],
  now: string,
  window: ApplicabilityWindow = { notBefore: null, notAfter: null },
): ReaderQuestionInstance[] {
  const out: ReaderQuestionInstance[] = [];
  for (const template of templates) {
    for (const universe of universes) {
      if (template.applicability.kind === "PER_ZIP") {
        out.push(makeInstance(template, universe.zip, null, null, window, now));
        continue;
      }
      for (const body of universe.bodies) {
        const label = bodyPlainLabel(
          body,
          body.ocdId ? (universe.divisionLabels.get(body.ocdId) ?? null) : null,
        );
        out.push(makeInstance(template, universe.zip, body.id, label, window, now));
      }
    }
  }
  return out;
}

function makeInstance(
  template: ReaderQuestionTemplate,
  zip: string,
  subjectBodyId: string | null,
  bodyLabel: string | null,
  window: ApplicabilityWindow,
  now: string,
): ReaderQuestionInstance {
  return {
    id: instanceId(template.id, zip, subjectBodyId),
    templateId: template.id,
    questionClass: template.questionClass,
    zip,
    subjectBodyId,
    questionText: renderQuestion(template, zip, bodyLabel),
    window,
    status: expired(window, now)
      ? { state: "RETIRED", retiredAt: now, reason: "applicability window passed at generation" }
      : { state: "ACTIVE" },
  };
}

function expired(window: ApplicabilityWindow, now: string): boolean {
  return window.notAfter !== null && Date.parse(window.notAfter) < Date.parse(now);
}

/**
 * Retire every instance whose window has passed. Returns a NEW array; a
 * retirement is recorded on the instance, and nothing is removed.
 */
export function retireExpiredInstances(
  instances: readonly ReaderQuestionInstance[],
  now: string,
): ReaderQuestionInstance[] {
  return instances.map((instance) => {
    if (instance.status.state === "RETIRED") return instance;
    if (!expired(instance.window, now)) return instance;
    return {
      ...instance,
      status: { state: "RETIRED", retiredAt: now, reason: "applicability window passed" },
    };
  });
}

/** Active = not retired. The READER denominator counts exactly these. */
export function activeInstances(
  instances: readonly ReaderQuestionInstance[],
): ReaderQuestionInstance[] {
  return instances.filter((i) => i.status.state === "ACTIVE");
}

/* ------------------------------------------------- the denominator check */

export const DENOMINATOR_LAYERS = [
  /** Governments/districts touching a ZIP. Census/NCES MAY establish this. */
  "GOVERNMENT_UNIVERSE",
  /** Enumerated governing bodies. ONLY the project's own registry evidence may. */
  "GOVERNING_BODY",
] as const;
export type DenominatorLayer = (typeof DENOMINATOR_LAYERS)[number];

export const DENOMINATOR_SOURCES = [
  "CENSUS_TIGER",
  "NCES",
  /**
   * The GENERATED registry. Valid law, and a MIRROR of the instance universe —
   * the instances are generated from it, so it can never disagree with them.
   */
  "PROJECT_REGISTRY",
  /**
   * The Tier-2 body-enumeration EVIDENCE: the canonical inputs
   * `curated-bodies.ts` and `promoted-bodies.json`, from which the registry is
   * generated. The only body-layer source that CAN disagree with the instance
   * universe, which is the only way a coverage defect is detectable at all.
   */
  "PROJECT_BODY_ENUMERATION_EVIDENCE",
] as const;
export type DenominatorSource = (typeof DENOMINATOR_SOURCES)[number];

/** An independently established enumeration for one ZIP at one layer. */
export interface EnumerationDenominator {
  readonly zip: string;
  readonly layer: DenominatorLayer;
  readonly source: DenominatorSource;
  /** The enumerated member ids — division OCD ids or registry body ids. */
  readonly memberIds: readonly string[];
}

/**
 * RULING 9, mechanically: Census counts GOVERNMENTS and this product renders
 * BODIES. A Census/NCES-sourced denominator offered for the governing-body
 * layer is refused — no denominator may certify a layer it does not enumerate.
 */
const BODY_LAYER_SOURCES: readonly DenominatorSource[] = [
  "PROJECT_REGISTRY",
  "PROJECT_BODY_ENUMERATION_EVIDENCE",
];

export function assertDenominatorMayCertify(denominator: EnumerationDenominator): void {
  if (
    denominator.layer === "GOVERNING_BODY" &&
    !BODY_LAYER_SOURCES.includes(denominator.source)
  ) {
    throw new Error(
      `RULING 9: a ${denominator.source} denominator may not certify the GOVERNING_BODY ` +
        "layer. Census/NCES enumerate governments, not the bodies inside them; the body " +
        "denominator comes only from the project's own registry/enumeration evidence.",
    );
  }
}

/**
 * **A DENOMINATOR MAY NOT BE THE THING IT MEASURES.** (A.1 WI2, 2026-08-30.)
 *
 * RULING 9 governs which SOURCE CLASS may certify a layer. This governs
 * something RULING 9 does not reach and Session A missed: whether the
 * denominator is INDEPENDENT of the population it is checking.
 *
 * Reader-question instances are generated from `registry.json`. A
 * `PROJECT_REGISTRY` denominator for the governing-body layer is therefore
 * that same file compared against itself. It agrees perfectly, always,
 * including over a universe missing every body the registry forgot — which is
 * precisely the failure the check exists to find. NH232 is the proof that the
 * failure is real: a regeneration silently dropped 731 promoted bodies and
 * every green stayed green.
 *
 * So a RUN may not score the body layer off the registry. It is still a legal
 * denominator for anything generated from something else, which is why the
 * refusal lives here rather than in `assertDenominatorMayCertify`.
 */
export function assertDenominatorIsIndependent(denominator: EnumerationDenominator): void {
  if (denominator.layer === "GOVERNING_BODY" && denominator.source === "PROJECT_REGISTRY") {
    throw new Error(
      "a PROJECT_REGISTRY denominator cannot check a GOVERNING_BODY universe that was " +
        "GENERATED from PROJECT_REGISTRY. Registry checking registry is a mirror: it agrees " +
        "over any universe, including one missing every body the registry omitted. Use " +
        "PROJECT_BODY_ENUMERATION_EVIDENCE — the canonical inputs the registry is built from.",
    );
  }
}

/** A layer where the generated instance universe and the denominator disagree. */
export interface CoverageDefect {
  readonly zip: string;
  readonly layer: DenominatorLayer;
  readonly source: DenominatorSource;
  /** Denominator members with no generated instance about them. */
  readonly missingSubjects: readonly string[];
  /** Instance subjects the denominator does not enumerate. */
  readonly unexpectedSubjects: readonly string[];
  readonly detail: string;
}

/**
 * Compare the generated instance universe per ZIP against an independently
 * established denominator. Either direction of disagreement is a defect: a
 * missing subject is a question the corpus silently never asks, and an
 * unexpected subject is an instance about something no enumeration backs.
 */
export function checkInstanceUniverse(
  instances: readonly ReaderQuestionInstance[],
  denominator: EnumerationDenominator,
): CoverageDefect | null {
  assertDenominatorMayCertify(denominator);
  const subjects = new Set(
    instances
      .filter((i) => i.zip === denominator.zip && i.subjectBodyId !== null)
      .map((i) => i.subjectBodyId as string),
  );
  const enumerated = new Set(denominator.memberIds);
  const missingSubjects = [...enumerated].filter((id) => !subjects.has(id)).sort();
  const unexpectedSubjects = [...subjects].filter((id) => !enumerated.has(id)).sort();
  if (missingSubjects.length === 0 && unexpectedSubjects.length === 0) return null;
  return {
    zip: denominator.zip,
    layer: denominator.layer,
    source: denominator.source,
    missingSubjects,
    unexpectedSubjects,
    detail:
      `zip ${denominator.zip}: the generated instance universe and the ${denominator.source} ` +
      `${denominator.layer} denominator disagree — ${missingSubjects.length} enumerated ` +
      `subject(s) have no instance, ${unexpectedSubjects.length} instance subject(s) are ` +
      "not enumerated.",
  };
}

/* --------------------------------------------------------------- runs */

/** Where an evaluation actually looked. Recorded on every run. */
export const EVALUATION_TARGETS = ["LOCAL_RENDER", "PRODUCTION_RENDER"] as const;
export type EvaluationTarget = (typeof EVALUATION_TARGETS)[number];

export type InstanceVerdict =
  | { readonly kind: "GREEN" }
  /**
   * Red carries what was observed, never a failure class: diagnosis is a
   * separate act (`diagnosticWorkItemFor` requires the class explicitly).
   */
  | { readonly kind: "RED"; readonly detail: string }
  /** The owner stated no expectation; recorded, and never counted green. */
  | { readonly kind: "NOT_EVALUABLE"; readonly detail: string };

export interface InstanceResult {
  readonly instanceId: string;
  readonly questionText: string;
  readonly verdict: InstanceVerdict;
}

/* ------------------------------------------------------- failure classes */

/** The twelve failure classes. Red never defaults to "go acquire". */
export const FAILURE_CLASSES = [
  "acquisition",
  "extraction",
  "identity",
  "linkage",
  "retrieval",
  "evidence_selection",
  "synthesis",
  "validation",
  "rendering",
  "accessibility",
  "interaction",
  "freshness",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

export function isFailureClass(v: unknown): v is FailureClass {
  return typeof v === "string" && (FAILURE_CLASSES as readonly string[]).includes(v);
}

/**
 * Build the diagnostic WorkItem for a red question.
 *
 * `failureClass` is REQUIRED and validated: a red question is diagnosed before
 * it is worked, and there is deliberately no default class — "red" defaulting
 * to "go acquire" is how a rendering defect buys a pointless second hunt.
 */
export function diagnosticWorkItemFor(
  question: ReaderQuestionInstance,
  failureClass: FailureClass,
  now: string,
): WorkItem {
  if (!isFailureClass(failureClass)) {
    throw new Error(
      `diagnosticWorkItemFor requires one of the twelve failure classes; got ${JSON.stringify(
        failureClass,
      )}. A red question is diagnosed first — there is no default class.`,
    );
  }
  return createWorkItem({
    project: "pilot-health",
    subject: question.subjectBodyId ?? `zip:${question.zip}`,
    obligation: `reader-diagnostic:${failureClass}:${question.id}`,
    why:
      `Reader question ${question.id} (${JSON.stringify(question.questionText)}) evaluated ` +
      `red with failure class "${failureClass}". The completion contract is that question ` +
      "turning green on a recorded evaluation run — not effort, not a route disposition.",
    priority: "P1",
    now,
  });
}
