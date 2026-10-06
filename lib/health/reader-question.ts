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
 *   1. The national ZIP index (`lib/geo/zip-division-index.ts`) — every
 *      division whose territory reaches inside the ZIP, derived from TIGER
 *      polygons (`NJ01`: a ZCTA crosses boundaries, so the AREA index is the
 *      honest zip answer).
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

import { createHash } from "node:crypto";
import { join } from "node:path";

import { createWorkItem, type WorkItem } from "../control-plane/work-item.ts";
// TYPE-ONLY, so this costs nothing at runtime. RULING 216 has two halves — the
// TARGET and the PROOF CLASS — and `satisfiesActivationGate` below refuses to
// answer with only one of them, which means it has to name the other's type.
import type { ProofClass } from "../ops/run-provenance.ts";
import type { ReaderExpectation } from "./ask-evaluation.ts";
import type { Body, Registry } from "../registry/types.ts";
import { readRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import { ZIP_DIVISIONS_DIR, readAllZipDivisions } from "../geo/zip-division-index.ts";

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
  /**
   * One instance per pilot ZIP; no body subject.
   *
   * A STRONG claim, and one that must be stated rather than defaulted to. It
   * says this question is owed of every pilot ZIP equally. Session B's resume
   * audit found all nine hand-authored adversarial questions carrying it,
   * including one about the Pima County Board of Supervisors — which was
   * therefore asked of a New Hampshire town and a New Jersey borough. Nine
   * questions became thirty-six instances and twenty-seven were about the
   * wrong government.
   */
  | { readonly kind: "PER_ZIP" }
  /**
   * One instance per NAMED ZIP. (Session B resume, W4.)
   *
   * For a question whose own text names where it applies — *"Where do I vote
   * if I live in 85641?"* is a question about 85641 and about nowhere else.
   */
  | { readonly kind: "SPECIFIC_ZIPS"; readonly zips: readonly string[] }
  /**
   * One instance per named ZIP, ABOUT a named subject. (Session B resume, W4.)
   *
   * `subject` is the owner's own name for the government the question is
   * about, carried through so an expectation can bind to it. It is not a
   * registry id: the point of a hand-authored adversarial question is that it
   * is written independent of the registry, so requiring a registry id here
   * would make the corpus inherit the blind spot it exists to detect.
   */
  | {
      readonly kind: "SPECIFIC_BODY";
      readonly zips: readonly string[];
      readonly subject: string;
    };

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
    default:
      return `the body for ${where}`;
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
  const indexPath = join(root, ...ZIP_DIVISIONS_DIR);

  const registryRead = await readRegistryRuntimeProjection();
  if (registryRead.kind !== "PROMOTED" && registryRead.kind !== "BOOTSTRAP") {
    throw new Error(`the canonical registry projection is ${registryRead.kind}`);
  }
  const registry = registryRead.value.registry as Registry;
  let index: { zips: Record<string, string[]> };
  try {
    index = { zips: Object.fromEntries([...readAllZipDivisions(root)].map(([zip, entry]) => [zip, [...entry.ids]])) };
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
    const rule = template.applicability;
    for (const universe of universes) {
      /*
       * **A TEMPLATE THAT NAMES ITS ZIPS IS ASKED ONLY THERE.**
       * (Session B resume, W4.)
       *
       * The two scoped kinds are skipped for every universe they do not name.
       * Without them every hand-authored question fell to `PER_ZIP` and was
       * asked of all four pilot ZIPs — so "Where do I vote if I live in
       * 85641?" was also asked of a New Hampshire town, and a question about
       * the Pima County Board of Supervisors was asked of a New Jersey
       * borough. Nine questions became thirty-six instances and twenty-seven
       * were about the wrong government.
       */
      if (
        (rule.kind === "SPECIFIC_ZIPS" || rule.kind === "SPECIFIC_BODY") &&
        !rule.zips.includes(universe.zip)
      ) {
        continue;
      }

      if (rule.kind === "PER_ZIP" || rule.kind === "SPECIFIC_ZIPS") {
        out.push(makeInstance(template, universe.zip, null, null, window, now));
        continue;
      }

      if (rule.kind === "SPECIFIC_BODY") {
        /*
         * ONE instance for the named subject, with NO registry body id.
         *
         * `subjectBodyId` stays null deliberately. The subject is the owner's
         * own name for a government, and binding it to a registry id here
         * would make a hand-authored adversarial question inherit the registry
         * — which is the one thing this class exists NOT to do. It also keeps
         * these instances out of the per-body denominator, which is correct:
         * they carry no one-per-body contract.
         */
        out.push(makeInstance(template, universe.zip, null, rule.subject, window, now));
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
 *
 * ## The bound on the word "independent" (Session B WI1.9)
 *
 * Independent OF THE GENERATED ARTIFACT, and of nothing further. The evidence
 * stores are the project's own accumulated enumeration knowledge, so this
 * refusal buys detection of a GENERATOR REGRESSION and buys nothing at all
 * against a body the project never discovered — which is absent from the
 * instances, absent from the evidence, and therefore invisible to any
 * comparison between them. `lib/health/body-denominator.ts` states the same
 * bound where the stores are read. The hand-authored adversarial questions are
 * what covers the remainder.
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

/**
 * The synthetic instance id a coverage defect is tracked under.
 *
 * One function, called by the runner that OPENS the diagnostic and by the
 * runner that reports the clean pass that CLOSES it. (Session B WI1.6.) Two
 * hand-written copies of this string is exactly how the diagnostic became
 * unclosable in the first place: the opener wrote an id and the closer had no
 * way to produce it, so the id existed in one direction only.
 */
export function coverageInstanceId(zip: string, layer: DenominatorLayer): string {
  return `coverage:${zip}:${layer}`;
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
  /**
   * What kind of disagreement this is. (Session B resume, W4.)
   *
   * `NO_GENERATED_POPULATION` is the case where the corpus holds no
   * `EVERY_BODY_IN_ZIP` template at all. It is still a defect — nobody is
   * asking a per-body coverage question anywhere — but it is a DIFFERENT
   * defect from "we ask per-body questions and 62 bodies are missing from
   * them", and reporting the first as the second sends whoever reads it to
   * look for a generator bug that is not there.
   */
  readonly kind: "SUBJECTS_DISAGREE" | "NO_GENERATED_POPULATION";
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
  /*
   * **ONLY THE GENERATED CLASS IS HELD TO A PER-BODY DENOMINATOR.**
   * (Session B resume, W4.)
   *
   * This filtered on `subjectBodyId !== null` and on nothing else, so the
   * population it compared against the denominator was every instance in the
   * ZIP. The hand-authored adversarial instances carry no body subject — they
   * are bespoke questions about named governments, not one-per-body coverage —
   * so they contributed nothing to `subjects`, and every enumerated body came
   * back as MISSING. The defect it reported, "62 enumerated bodies have no
   * question instance for 85701", was a fact about which class was measured
   * rather than about coverage.
   *
   * The contract "one instance per enumerated body" belongs to
   * `EVERY_BODY_IN_ZIP`, which is the generated class. A hand-authored question
   * makes no such promise and may not be failed for not keeping it. Holding it
   * to one would also create pressure to write sixty-two bespoke questions per
   * ZIP, which would destroy the one property that makes the adversarial class
   * worth having: that a person chose each one.
   */
  const generated = instances.filter((i) => i.questionClass === "GENERATED_FROM_REGISTRY");
  const subjects = new Set(
    generated
      .filter((i) => i.zip === denominator.zip && i.subjectBodyId !== null)
      .map((i) => i.subjectBodyId as string),
  );
  const enumerated = new Set(denominator.memberIds);
  const missingSubjects = [...enumerated].filter((id) => !subjects.has(id)).sort();
  const unexpectedSubjects = [...subjects].filter((id) => !enumerated.has(id)).sort();

  /*
   * NO GENERATED POPULATION AT ALL is reported as its own thing rather than as
   * "every enumerated body is missing". Both are defects and they need
   * different fixes: this one is "write a per-body template", and the other is
   * "find out why the generator dropped bodies". Collapsing them produced the
   * line "62 enumerated bodies have no question instance for 85701" on a
   * corpus that contained no per-body template to generate from, which points
   * a reader at a generator regression that never happened.
   */
  if (generated.length === 0) {
    return {
      zip: denominator.zip,
      layer: denominator.layer,
      source: denominator.source,
      missingSubjects: [],
      unexpectedSubjects: [],
      kind: "NO_GENERATED_POPULATION",
      detail:
        `zip ${denominator.zip}: the corpus holds NO GENERATED_FROM_REGISTRY template, so no ` +
        `per-body coverage question is asked of any of the ${enumerated.size} enumerated ` +
        `${denominator.layer} subject(s) here. This is a real gap and it is not a generator ` +
        "regression: there is nothing to generate from. The hand-authored adversarial questions " +
        "are not a substitute — they are bespoke and carry no one-per-body contract.",
    };
  }

  if (missingSubjects.length === 0 && unexpectedSubjects.length === 0) return null;
  return {
    zip: denominator.zip,
    layer: denominator.layer,
    source: denominator.source,
    missingSubjects,
    unexpectedSubjects,
    kind: "SUBJECTS_DISAGREE",
    detail:
      `zip ${denominator.zip}: the generated instance universe and the ${denominator.source} ` +
      `${denominator.layer} denominator disagree — ${missingSubjects.length} enumerated ` +
      `subject(s) have no GENERATED instance, ${unexpectedSubjects.length} generated instance ` +
      `subject(s) are not enumerated. Measured over the ${generated.length} ` +
      "GENERATED_FROM_REGISTRY instance(s) only; hand-authored adversarial questions carry no " +
      "one-per-body contract and are not held to this denominator.",
  };
}

/* --------------------------------------------------------------- runs */

/**
 * Where an evaluation actually looked. Recorded on every run.
 *
 * `STAGING_RENDER` joined this vocabulary on 2026-09-01 as a TYPED, RECORDED
 * value that the harness cannot yet reach — exactly as `PRODUCTION_RENDER`
 * already is. `scripts/reader-suite.mts` refuses every non-local host citing
 * RULING 125, and that refusal is deliberately NOT touched here: RULING 125's
 * claim slot `verification.target` can only be amended by a later dated ruling,
 * and naming a target is not amending one. A record that can SAY where it
 * looked is what makes a future non-local run legible; it is not permission to
 * take one.
 */
export const EVALUATION_TARGETS = ["LOCAL_RENDER", "PRODUCTION_RENDER", "STAGING_RENDER"] as const;
export type EvaluationTarget = (typeof EVALUATION_TARGETS)[number];

/**
 * **WHICH RESULTS COUNT TOWARD THE ACTIVATION GATE — RULING 216, both halves.**
 * (Lane 5, 2026-09-01.)
 *
 * The ruling is one sentence: *"only INDEPENDENTLY_REPRODUCED PRODUCTION_RENDER
 * results count toward the activation gate."* Until now it existed ONLY as
 * prose — in the ledger, and in a paragraph `scripts/status-ledger.mts` prints.
 * Nothing computed it, so nothing could disagree with it, and nothing could
 * enforce it either.
 *
 * **The failure this prevents, and it is a live one the moment a third target
 * exists.** A rule with no implementation gets implemented by whoever needs it
 * next, and the obvious shape is *"the target is not the local one, so it must
 * be production"*. That reading is CORRECT while the vocabulary has two members
 * and WRONG the instant it has three — and the wrong answer is not a cosmetic
 * one. `STAGING_RENDER` is a branch deploy of unreviewed code against a
 * separate database; treating a green there as production-verified would let
 * the activation gate pass on evidence about a site no reader has ever loaded.
 * The thing that then reaches a reader is a false claim about a government.
 *
 * So the predicate is stated POSITIVELY — an allowlist of one — and a new
 * target is excluded until somebody adds it here on purpose. Both halves are
 * required in one call, because a caller holding only the target could pass the
 * target half and quietly skip the proof-class half; there is deliberately no
 * way to ask this question about a target alone.
 */
export const ACTIVATION_GATING_TARGETS: readonly EvaluationTarget[] = ["PRODUCTION_RENDER"];

export function satisfiesActivationGate(input: {
  readonly target: EvaluationTarget | null | undefined;
  readonly proofClass: ProofClass | null | undefined;
}): { readonly counts: boolean; readonly why: string } {
  const target = input.target ?? null;
  const proofClass = input.proofClass ?? null;

  // An absent target is not a permissive one. A record that does not say where
  // it looked has not established that it looked at production.
  if (target === null || !ACTIVATION_GATING_TARGETS.includes(target)) {
    return {
      counts: false,
      why:
        `the result's target is ${JSON.stringify(target)}, and only ` +
        `${ACTIVATION_GATING_TARGETS.join(", ")} counts toward activation (RULING 216). ` +
        "A green anywhere else is a green about somewhere else.",
    };
  }
  if (proofClass !== "INDEPENDENTLY_REPRODUCED") {
    return {
      counts: false,
      why:
        `the result is ${JSON.stringify(proofClass)}, and RULING 216 counts only ` +
        "INDEPENDENTLY_REPRODUCED results — the implementing session's own observation of its " +
        "own work is not reproduction, however canonical the command was.",
    };
  }
  return {
    counts: true,
    why: "an INDEPENDENTLY_REPRODUCED PRODUCTION_RENDER result, which is what RULING 216 counts.",
  };
}

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
  /**
   * The diagnosed failure class on a RED, null otherwise. (2026-08-31.)
   *
   * It was recorded on the diagnostic WorkItem and NOT in the run record, so
   * the durable evidence said a question failed and not what kind of failure
   * it was. That is the field a later reader needs most: the class is the
   * thing most likely to be wrong, and until 2026-08-31 every NO_EVIDENCE was
   * classed `acquisition` — including the ones where nothing bound, nothing
   * was searched, and the record was held all along.
   */
  readonly failureClass?: FailureClass | null;
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
