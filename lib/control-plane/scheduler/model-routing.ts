/**
 * **THE STEP REGISTRY — WHICH STEPS MAY SPEND A MODEL, WHICH MODEL, AT WHAT
 * EFFORT, AND HOW MUCH THE MODEL MAY BE SHOWN.** (Worker Efficiency Law,
 * 2026-09-02, RULING 244.)
 *
 * The law, as this file enforces it:
 *
 * ```
 *   A STEP DETERMINISTIC CODE CAN PERFORM NEVER CONSUMES A MODEL
 *       `assertStepMayInvokeModel` throws for a DETERMINISTIC step; the
 *       executor calls it before every transport call, so a model turn on a
 *       deterministic step is a thrown defect, never a billed one.
 *   EACH MODEL STEP ROUTES TO THE CHEAPEST CLASS THAT MEETS ITS STANDARD
 *       extraction / classification: Haiku, then Sonnet on escalation; the
 *       Scout research loop: Haiku, then Sonnet and the frontier on escalation
 *       (MW-033, 2026-09-25); independent audit: the same cheaper-first order,
 *       with durable evidence-backed escalations. A cheaper model that fails a
 *       step's standard ESCALATES only for a reason in the closed
 *       `MODEL_ESCALATION_REASONS`, and the reason, its evidence and the cost
 *       of both attempts are recorded on the step's result, never silent.
 *   EFFORT IS SET PER ROLE
 *       `output_config.effort` comes from `ROLE_EFFORT`, is recorded on the
 *       result, and never varies within an Attempt (an effort change
 *       invalidates the provider's message cache).
 *   THE MODEL RECEIVES A SANITIZED REPRESENTATION SIZED TO THE STEP
 *       `REPRESENTATION_BUDGETS` states, per tool, how many bytes a tool
 *       result may hand the model. Past the budget the result is TRUNCATED
 *       with a stated truncation and a pointer to the artifact id — never
 *       silently, and never a raw DOM.
 * ```
 *
 * The registry is CLOSED and typed: a step name outside it cannot be routed,
 * which is how a new sub-call is forced to declare its class here before it
 * can run anywhere.
 */

import { MODELS } from "../../models.ts";
import { MODEL_WORKER_MODEL, rateFor } from "../model-cost.ts";

/** The model classes a step may route to. Cheapest first. */
export const MODEL_CLASSES = ["haiku", "sonnet", "frontier"] as const;
export type ModelClass = (typeof MODEL_CLASSES)[number];

/** The exact model id each class runs today. Ids as the claude-api reference lists them. */
export const MODEL_FOR_CLASS: Readonly<Record<ModelClass, string>> = {
  haiku: MODELS.haiku.model,
  sonnet: MODELS.sonnet.model,
  frontier: MODELS.opus.model,
};

export type ModelEffort = "low" | "medium" | "high";

/** The roles that invoke a model in this lane, and the effort each runs at. */
export const ROLE_EFFORT = {
  /** The Scout's research loop, on whichever class runs it. Medium — the cap is economic, never a truth judgement. */
  SCOUT: "medium",
  /** Sub-steps (extraction, classification, summarization): terse, single-purpose. */
  SUB_STEP: "low",
} as const satisfies Record<string, ModelEffort>;
export type ModelRole = keyof typeof ROLE_EFFORT;

export type StepRoute =
  | {
      readonly kind: "DETERMINISTIC";
      /** Where the deterministic implementation lives, so the claim is checkable. */
      readonly implementedIn: string;
      readonly why: string;
    }
  | {
      readonly kind: "MODEL";
      readonly modelClass: ModelClass;
      readonly role: ModelRole;
      /** The class a failed standard escalates to, or null at the top. */
      readonly escalateTo: ModelClass | null;
      readonly why: string;
    };

/**
 * THE STEPS. Every place in the lane that could spend a model is named here,
 * and the deterministic ones say where the code is.
 */
export const SCOUT_STEPS = {
  /** Acquisition starts with Haiku. Unsupported adaptive-thinking/effort fields
   * are omitted by the request builder; configuration is not evidence of quality.
   * A failed standard must carry an observed reason before escalation. */
  "scout-research-loop": {
    kind: "MODEL",
    modelClass: "haiku",
    role: "SCOUT",
    escalateTo: "sonnet",
    why: "Acquisition starts with Haiku after deterministic routes; an evidenced failure may escalate to Sonnet. Ask comparisons do not establish acquisition routing.",
  },
  /** HTML/JSON/PDF -> title, visible text, links, extracted text. Code, in scout-tools.ts. */
  "page-to-representation": {
    kind: "DETERMINISTIC",
    implementedIn: "lib/control-plane/scheduler/scout-tools.ts (visibleText, extractLinks, htmlTitle, extractPdf, JSON pretty-print)",
    why: "deriving the sanitized representation from vaulted bytes is string work; no model runs and none may",
  },
  /** robots.txt -> ALLOWED / DISALLOWED / NO_ROBOTS / CANNOT_TELL. Code, in robots.ts. */
  "permission-reading": {
    kind: "DETERMINISTIC",
    implementedIn: "lib/control-plane/scheduler/robots.ts (evaluatePermission)",
    why: "a permission verdict is a rule evaluation over a document; a model reading robots.txt would be a guess wearing a verdict",
  },
  /** observedOn from the cited artifacts' retrievedAt. Code, in scout-result.ts. */
  "date-parsing": {
    kind: "DETERMINISTIC",
    implementedIn: "lib/control-plane/scheduler/scout-result.ts (deriveCandidateProvenance)",
    why: "RULING 243: provenance dates are written by the machine from the artifact record; a model's date is a claim",
  },
  /** A sub-call that extracts a field from a representation. Haiku, escalating to Sonnet. */
  extraction: {
    kind: "MODEL",
    modelClass: "haiku",
    role: "SUB_STEP",
    escalateTo: "sonnet",
    why: "field extraction over a sanitized representation is the cheapest-class case; a failed standard escalates one class and is recorded",
  },
  /** A sub-call that classifies a representation. Haiku, escalating to Sonnet. */
  classification: {
    kind: "MODEL",
    modelClass: "haiku",
    role: "SUB_STEP",
    escalateTo: "sonnet",
    why: "classification over a sanitized representation is the cheapest-class case; a failed standard escalates one class and is recorded",
  },
  /** A sub-call that summarizes a representation for the owner. Sonnet, escalating to the frontier. */
  summarization: {
    kind: "MODEL",
    modelClass: "sonnet",
    role: "SUB_STEP",
    escalateTo: "frontier",
    why: "summarization for a reader-facing owner surface needs Sonnet's standard; ambiguity escalates to the frontier and is recorded",
  },
  /** Independent evidence context and machine verification remain mandatory.
   * Acquisition routing follows the owner's cheaper-first hunt instruction;
   * an inconclusive response can escalate through separate durable attempts. */
  "adversarial-audit": {
    kind: "MODEL",
    modelClass: "haiku",
    role: "SUB_STEP",
    escalateTo: "sonnet",
    why: "Start with Haiku on independent source evidence; escalate unresolved model responses with a recorded reason. Grounded challenges require evidence repair, not another model's approval.",
  },
} as const satisfies Record<string, StepRoute>;

export type ScoutStepName = keyof typeof SCOUT_STEPS;
export const SCOUT_STEP_NAMES = Object.keys(SCOUT_STEPS) as readonly ScoutStepName[];

export function routeForStep(step: ScoutStepName): StepRoute {
  return SCOUT_STEPS[step];
}

export class DeterministicStepInvokedModel extends Error {
  readonly step: string;
  constructor(step: string, implementedIn: string) {
    super(
      `STEP ROUTING REFUSED: "${step}" is a DETERMINISTIC step (${implementedIn}) and may never consume a model. ` +
        "RULING 244: a step deterministic code can perform never spends a model.",
    );
    this.name = "DeterministicStepInvokedModel";
    this.step = step;
  }
}

export class UnknownStepInvokedModel extends Error {
  constructor(step: string) {
    super(
      `STEP ROUTING REFUSED: "${step}" is not in the step registry (${SCOUT_STEP_NAMES.join(", ")}). ` +
        "A step must declare its class before it can spend a model anywhere.",
    );
    this.name = "UnknownStepInvokedModel";
  }
}

/**
 * The model, effort and class for a MODEL step. Throws for a deterministic
 * or unknown step — the executor calls this before every transport call.
 * `escalated` selects the escalation class when the cheaper one failed the
 * step's standard; the caller records why.
 */
export function assertStepMayInvokeModel(
  step: string,
  escalated = false,
): { readonly model: string; readonly modelClass: ModelClass; readonly effort: ModelEffort; readonly role: ModelRole } {
  const route = (SCOUT_STEPS as Record<string, StepRoute>)[step];
  if (route === undefined) throw new UnknownStepInvokedModel(step);
  if (route.kind === "DETERMINISTIC") throw new DeterministicStepInvokedModel(step, route.implementedIn);
  const modelClass = escalated && route.escalateTo !== null ? route.escalateTo : route.modelClass;
  return { model: MODEL_FOR_CLASS[modelClass], modelClass, effort: ROLE_EFFORT[route.role], role: route.role };
}

/* ------------------------------------------------ the escalation vocabulary */

/**
 * **WHY A MODEL STEP MOVED UP A CLASS — A CLOSED LIST.** (MW-031, MW-033,
 * 2026-09-25.)
 *
 * `assertStepMayInvokeModel(step, escalated)` takes escalation as a yes-or-no,
 * so it could never say why. A step moves up only for one of these reasons, each
 * OBSERVED on the cheaper attempt by the executor — never the model's own claim
 * that it needs help — and the reason travels with a short machine-written
 * evidence line and the cost of both attempts on the step's own result.
 *
 * This is MODEL-ROUTING escalation. It is not the owner escalation in
 * `work-item.ts` (work handed to a person); the two are never mixed.
 */
export const MODEL_ESCALATION_REASONS = [
  /** The cheaper attempt reached its turn, tool-call or token bound (or the early stop) and still produced no accepted typed result. */
  "BOUND_EXHAUSTED_WITHOUT_RESULT",
  /** The cheaper attempt's typed result was refused by the executor's own validation (a SCOUT_* refusal) and never corrected. */
  "RESULT_REFUSED",
  /** The cheaper attempt stopped calling tools without ever calling finish. */
  "NO_TYPED_RESULT",
  /** The provider refused the cheaper model's request as invalid for it (HTTP 400) — a capability the cheaper model lacks. */
  "CAPABILITY_ERROR",
  /** CH-30: the AI service did not answer the cheaper model on repeated attempts, so the next attempt starts a tier up. */
  "PROVIDER_UNAVAILABLE",
] as const;
export type ModelEscalationReason = (typeof MODEL_ESCALATION_REASONS)[number];

/**
 * **WHY AN ESCALATION THE LADDER CALLED FOR DID NOT RUN — ALSO CLOSED.** A
 * refused escalation is recorded on the result with the reason it would have
 * run for; the Attempt then ends on the cheaper attempt's own outcome.
 */
export const MODEL_ESCALATION_REFUSALS = [
  /** No reservation seam was supplied, so the second attempt could not be reserved first: fail closed. */
  "NOT_RESERVED",
  /** The rolling spend ceiling cannot cover the second attempt's worst case (or its spend is unmeasured). */
  "CEILING",
  /** The cheaper attempt's own cost is unmeasured, so the combined cost could not be known or reserved against. */
  "UNMEASURED_SPEND",
  /** Too little of the Attempt's shared wall clock remains for a second attempt. */
  "WALL_CLOCK",
] as const;
export type ModelEscalationRefusal = (typeof MODEL_ESCALATION_REFUSALS)[number];

export class UnrecordedEscalation extends Error {
  constructor(step: string, why: string) {
    super(
      `STEP ESCALATION REFUSED: "${step}" ${why}. A step moves up a class only for a reason in MODEL_ESCALATION_REASONS ` +
        `(${MODEL_ESCALATION_REASONS.join(", ")}), and only below the top of its ladder (MW-033).`,
    );
    this.name = "UnrecordedEscalation";
  }
}

/** The class a MODEL step escalates to, or null at the top of its ladder (or for a deterministic/unknown step, which throws first). */
export function escalationTargetFor(
  step: string,
  from?: ModelClass,
): { readonly model: string; readonly modelClass: ModelClass; readonly effort: ModelEffort; readonly role: ModelRole } | null {
  const base = assertStepMayInvokeModel(step);
  if (step === "scout-research-loop" && from !== undefined) {
    const next = MODEL_CLASSES[MODEL_CLASSES.indexOf(from) + 1];
    return next ? { ...base, model: MODEL_FOR_CLASS[next], modelClass: next } : null;
  }
  const up = assertStepMayInvokeModel(step, true);
  return up.modelClass === base.modelClass ? null : up;
}

/**
 * The model, effort and class for an ESCALATED call of a MODEL step. Throws
 * for a deterministic or unknown step, for a reason outside the closed list,
 * for a step already at the top of its ladder, and — re-checked at the call,
 * not only at module load — for a target above the ceiling. The escalated
 * executor calls this before EVERY transport call of its second attempt.
 */
export function assertStepMayEscalate(
  step: string,
  reason: ModelEscalationReason,
  from?: ModelClass,
): { readonly model: string; readonly modelClass: ModelClass; readonly effort: ModelEffort; readonly role: ModelRole; readonly escalatedFrom: ModelClass } {
  if (!(MODEL_ESCALATION_REASONS as readonly string[]).includes(reason)) throw new UnrecordedEscalation(step, `names no recorded reason (${JSON.stringify(reason)})`);
  const base = assertStepMayInvokeModel(step);
  const up = escalationTargetFor(step, from);
  if (up === null) throw new UnrecordedEscalation(step, `is already at the top of its ladder (${base.modelClass})`);
  const violation = modelCeilingViolation(up.model);
  if (violation !== null) throw new ModelAboveCeiling(up.modelClass, up.model, violation);
  return { ...up, escalatedFrom: from ?? base.modelClass };
}

/* ------------------------------------------------------- the model ceiling */

/**
 * **OPUS IS THE CEILING, AND NO MODEL NAMED "FABLE" EVER ROUTES.** (MW-034;
 * owner rule, 2026-09-21.)
 *
 * The ladder tops out at the frontier class (`escalateTo: null`), so structurally
 * nothing escalates past it. That was true by construction and by nothing else —
 * a one-character edit to `MODEL_FOR_CLASS` could point any class at a costlier
 * model or at a Fable, and only a human noticing would have caught it. This makes
 * the ceiling a GUARD: a pure predicate, run as a module-load invariant over
 * `MODEL_FOR_CLASS`, so a routing edit that breaches the ceiling throws at import —
 * in tests, and at boot — before any step can route to it.
 *
 * "Above the ceiling" is read from the rate table (`model-cost.ts`): a class whose
 * model is priced above the frontier's input OR output rate is above the ceiling.
 * A model with no rate row is UNAPPROVED — it cannot be certified within the
 * ceiling, so it is refused rather than waved through.
 */
export const MODEL_CEILING = MODEL_WORKER_MODEL;

export class ModelAboveCeiling extends Error {
  readonly modelClass: string;
  readonly model: string;
  constructor(modelClass: string, model: string, why: string) {
    super(
      `MODEL CEILING REFUSED: class "${modelClass}" resolves to "${model}" — ${why}. ` +
        `Opus (${MODEL_CEILING}) is the ceiling and no model named "fable" may route (owner rule, MW-034).`,
    );
    this.name = "ModelAboveCeiling";
    this.modelClass = modelClass;
    this.model = model;
  }
}

/**
 * Why a model id breaches the ceiling, or `null` when it is within it. Pure.
 * Refuses a Fable model, an unrated (unapproved) model, and any model priced
 * above the frontier on either the input or the output rate.
 */
export function modelCeilingViolation(model: string): string | null {
  if (/fable/i.test(model)) return 'a model named "fable" is denied by owner rule';
  const rate = rateFor(model);
  if (rate === null) {
    return "no rate row is stated, so it is unapproved and cannot be certified within the ceiling";
  }
  const ceiling = rateFor(MODEL_CEILING);
  if (ceiling === null) return "the ceiling model itself has no rate row (control-plane misconfiguration)";
  if (rate.inputUsdPerMillion > ceiling.inputUsdPerMillion || rate.outputUsdPerMillion > ceiling.outputUsdPerMillion) {
    return (
      `it is priced above the ceiling (${rate.inputUsdPerMillion}/${rate.outputUsdPerMillion} vs ` +
      `${ceiling.inputUsdPerMillion}/${ceiling.outputUsdPerMillion} USD per million in/out)`
    );
  }
  return null;
}

/**
 * Assert every routable class is within the ceiling. Called once at module load
 * (below) so a breaching edit fails before anything can route; also callable
 * from a test with the real map.
 */
export function assertModelClassesWithinCeiling(
  map: Readonly<Record<ModelClass, string>> = MODEL_FOR_CLASS,
): void {
  for (const modelClass of MODEL_CLASSES) {
    const model = map[modelClass];
    const violation = modelCeilingViolation(model);
    if (violation !== null) throw new ModelAboveCeiling(modelClass, model, violation);
  }
}

// The invariant. A routing edit that points a class above Opus or at a Fable
// fails at import — in every test and at boot — not in production.
assertModelClassesWithinCeiling();

/* -------------------------------------------------- representation budgets */

/**
 * **HOW MUCH A TOOL RESULT MAY HAND THE MODEL, IN BYTES.**
 *
 * Sized to what the step needs: a page's visible text, its links and the
 * envelope; a browse's text plus its observed request list; a permission
 * reading's operative lines; the inherited summary. The toolkit already caps
 * body text at `TEXT_CAP_CHARS`; this is the outer bound on the WHOLE result
 * the executor enforces, so a tool that grew a new section could not quietly
 * hand the model a raw document. A result past its budget is truncated with a
 * stated truncation and the artifact id(s) it came from, and the overrun is
 * recorded on the result.
 */
export const REPRESENTATION_BUDGETS: Readonly<Record<string, number>> = {
  fetch_public: 64_000,
  browse: 96_000,
  read_permission: 12_000,
  read_inherited: 48_000,
  // A ranked pointer list (URLs + titles), no page content — small by construction.
  search: 12_000,
};

/** The budget for a tool, or the smallest budget when the tool is not named (never unbounded). */
export function representationBudgetFor(tool: string): number {
  return REPRESENTATION_BUDGETS[tool] ?? Math.min(...Object.values(REPRESENTATION_BUDGETS));
}

export interface RepresentationFit {
  readonly text: string;
  readonly bytes: number;
  readonly budget: number;
  readonly truncated: boolean;
}

/**
 * Fit a tool result to its budget. Truncation is STATED in the text the model
 * reads and points at the artifact id(s), so the model knows the rest exists
 * and where; nothing is dropped silently.
 */
export function fitRepresentation(tool: string, text: string, artifactIds: readonly string[]): RepresentationFit {
  const budget = representationBudgetFor(tool);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= budget) return { text, bytes, budget, truncated: false };
  const notice =
    `\n--- REPRESENTATION TRUNCATED: ${bytes} bytes exceeds the ${tool} budget of ${budget} bytes (RULING 244); ` +
    `the vaulted artifact${artifactIds.length === 1 ? "" : "s"} ${artifactIds.join(", ") || "(none)"} hold${artifactIds.length === 1 ? "s" : ""} the rest ---`;
  const room = Math.max(0, budget - Buffer.byteLength(notice, "utf8"));
  return { text: Buffer.from(text, "utf8").subarray(0, room).toString("utf8") + notice, bytes, budget, truncated: true };
}

/* ------------------------------------------------------- the cache policy */

/**
 * **THE TTL, AND WHY IT IS THE DEFAULT FIVE MINUTES.**
 *
 * The turns of one Attempt are seconds apart (a tool runs, the next request
 * starts), and a cache read refreshes the entry's timer at no cost, so the
 * entry stays warm for the whole Attempt without anyone paying for retention.
 * The 1-hour TTL costs 2x on write against 1.25x and only pays when the gap
 * between requests sharing the prefix is 5-60 minutes; the only such gap in
 * this lane is between Attempts on the same obligation, which are at least a
 * cycle (an hour) apart, so the 1-hour TTL would buy nothing there either.
 * The reasoning is `lib/ask/prompt-cache.ts`'s SYNTHESIS_CACHE_TTL, which
 * fits this traffic unchanged; the wire form is the bare ephemeral marker.
 */
export const SCOUT_CACHE_POLICY = {
  /**
   * The TTL of every breakpoint this lane sends. Measured 2026-09-06 against
   * the ledger and the cycle records (prompt-caching session): consecutive
   * Scout cycles start 70–76 minutes apart (median 76.2 min between the
   * SCOUT ledger rows of consecutive cycles, 71 min start-to-start between
   * the runner's cycle records), so a 1-hour entry written by one cycle has
   * expired before the next cycle could read it; the 2× write price would buy
   * no cross-cycle read. Inside a cycle the turns are seconds apart and the
   * concurrent Attempts start together, which the 5-minute entry covers. The
   * ordering rule the API enforces when a 1h entry IS used — every 1h marker
   * must precede every 5m marker across tools → system → messages — is
   * asserted by `tests/scout-prewarm.test.ts` against the message the API
   * returned that day.
   */
  ttl: "5m",
  cacheControl: { type: "ephemeral" } as const,
  /**
   * WHERE THE MOVING BREAKPOINT LIVES (2026-09-06). `TOP_LEVEL`: the request
   * carries `cache_control` at the top level and the API places the
   * breakpoint on the last cacheable block and moves it forward each turn
   * (accepted HTTP 200 on 2026-09-06, `tests/scout-prewarm.test.ts` records
   * the shape). `LAST_BLOCK`: the fallback for a platform that rejects the
   * top-level field — the executor marks the last content block of the newest
   * user turn itself, which is what this lane did from 2026-09-02 to
   * 2026-09-06 and what the five instrumented Attempts of that window proved
   * to read the prefix turn over turn.
   */
  movingBreakpoint: "TOP_LEVEL" as "TOP_LEVEL" | "LAST_BLOCK",
  /**
   * The breakpoints, in render order. The static prefix (tools + system)
   * carries explicit markers so it is re-written on the next request if the
   * cache evicts it and so the pre-warm request can target exactly it; the
   * conversation carries the moving one.
   */
  breakpoints: [
    "the last tool definition (tools render first; a stable tool list is the widest prefix)",
    "the system block (tools + system cached together; the pre-warm's target)",
    "the moving breakpoint — top-level cache_control, placed by the API on the last cacheable block and moved forward every turn so turn N reads turns 1..N-1",
  ],
  /** Provider limit; the three above leave one slot spare. */
  maxBreakpoints: 4,
  /**
   * The frontier (claude-opus-5-5) minimum, kept as this lane's default and
   * fallback. The provider silently never caches below it; tools + system alone
   * exceed it (4,586 tokens measured 2026-09-06; Opus 5.5's minimum is also
   * 512). The cache-defect detector is fed the ATTEMPT's own model minimum via
   * `minimumCacheablePrefixTokensFor` (model-cost.ts) — a cheaper class's
   * minimum is HIGHER (Sonnet 1024, Haiku 4096), so this single scalar serves
   * only the frontier and the unrated fallback, never a cheaper class.
   */
  minimumCacheablePrefixTokens: 512,
} as const;
