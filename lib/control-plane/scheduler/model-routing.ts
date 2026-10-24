/**
 * The closed step registry: which steps may spend a model, which class and effort, and how many bytes a tool
 * result may hand the model. A deterministic step never consumes a model (`assertStepMayInvokeModel` throws);
 * a step name outside the registry cannot be routed.
 */

import { MODELS } from "../../models.ts";
import { MODEL_WORKER_MODEL, highestRates, rateFor } from "../model-cost.ts";

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
  /** The Scout's research loop, on whichever class runs it. */
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

export const SCOUT_STEPS = {
  /** Start each hunt on Haiku; failed results climb one tier at a time. */
  "scout-research-loop": {
    kind: "MODEL",
    modelClass: "haiku",
    role: "SCOUT",
    escalateTo: "sonnet",
    why: "Start with Haiku; escalate only after the current attempt fails its existing check.",
  },
  /** HTML/JSON/PDF -> title, visible text, links, extracted text. Code, in scout-tools.ts. */
  "page-to-representation": {
    kind: "DETERMINISTIC",
    implementedIn: "lib/control-plane/scheduler/scout-tools.ts and lib/extract/visible-text.ts (visibleText, extractLinks, htmlTitle, extractPdf, JSON pretty-print)",
    why: "deriving the sanitized representation from vaulted bytes is string work; no model runs and none may",
  },
  /** robots.txt -> ALLOWED / DISALLOWED / NO_ROBOTS / CANNOT_TELL. Code, in robots.ts. */
  "permission-reading": {
    kind: "DETERMINISTIC",
    implementedIn: "lib/control-plane/scheduler/robots.ts (evaluatePermission)",
    why: "a permission verdict is a rule evaluation over a document; a model reading robots.txt would be a guess wearing a verdict",
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
  /** A sub-call that summarizes a representation for the owner. Cheapest first. */
  summarization: {
    kind: "MODEL",
    modelClass: "haiku",
    role: "SUB_STEP",
    escalateTo: "sonnet",
    why: "Start with Haiku; a failed summary escalates to Sonnet, then the frontier.",
  },
  /** Independent evidence context and machine verification remain mandatory; an inconclusive response can escalate through separate durable attempts. */
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

export class DeterministicStepInvokedModel extends Error {
  readonly step: string;
  constructor(step: string, implementedIn: string) {
    super(
      `STEP ROUTING REFUSED: "${step}" is a DETERMINISTIC step (${implementedIn}) and may never consume a model. ` +
        "A step deterministic code can perform never spends a model.",
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

/** Why a model step moved up a class: a closed list of reasons observed on the cheaper attempt, never the model's own claim. Not the owner escalation in `work-item.ts`. */
export const MODEL_ESCALATION_REASONS = [
  /** The cheaper attempt reached its turn, tool-call or token bound (or the early stop) and still produced no accepted typed result. */
  "BOUND_EXHAUSTED_WITHOUT_RESULT",
  /** The cheaper attempt's typed result was refused by the executor's own validation (a SCOUT_* refusal) and never corrected. */
  "RESULT_REFUSED",
  /** The cheaper attempt stopped calling tools without ever calling finish. */
  "NO_TYPED_RESULT",
  /** The provider refused the cheaper model's request as invalid for it (HTTP 400) — a capability the cheaper model lacks. */
  "CAPABILITY_ERROR",
  /** The AI service did not answer the cheaper model on repeated attempts, so the next attempt starts a tier up. */
  "PROVIDER_UNAVAILABLE",
] as const;
export type ModelEscalationReason = (typeof MODEL_ESCALATION_REASONS)[number];

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
  const next = MODEL_CLASSES[MODEL_CLASSES.indexOf(from ?? base.modelClass) + 1];
  return next ? { ...base, model: MODEL_FOR_CLASS[next], modelClass: next } : null;
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

/**
 * The model ceiling: nothing routes above the frontier class or to a model named Fable. Checked at module
 * load over `MODEL_FOR_CLASS`. A model priced above the frontier on either rate, or with no rate row, is refused.
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
  const [card, top] = [highestRates(rate), highestRates(ceiling)];
  if (card.inputUsdPerMillion > top.inputUsdPerMillion || card.outputUsdPerMillion > top.outputUsdPerMillion) {
    return (
      `it is priced above the ceiling (${card.inputUsdPerMillion}/${card.outputUsdPerMillion} vs ` +
      `${top.inputUsdPerMillion}/${top.outputUsdPerMillion} USD per million in/out)`
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

// Module-load invariant: a routing edit that breaches the ceiling fails at import.
assertModelClassesWithinCeiling();

/** The outer byte bound on a whole tool result handed to the model. Past it the result is truncated with a stated truncation and the artifact id(s). */
export const REPRESENTATION_BUDGETS: Readonly<Record<string, number>> = {
  fetch_public: 9_000,
  browse: 9_000,
  read_held: 6_000,
  search: 10_000,
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
    `\n--- REPRESENTATION TRUNCATED: ${bytes} bytes exceeds the ${tool} budget of ${budget} bytes; ` +
    `the vaulted artifact${artifactIds.length === 1 ? "" : "s"} ${artifactIds.join(", ") || "(none)"} hold${artifactIds.length === 1 ? "s" : ""} the rest ---`;
  const room = Math.max(0, budget - Buffer.byteLength(notice, "utf8"));
  return { text: Buffer.from(text, "utf8").subarray(0, room).toString("utf8") + notice, bytes, budget, truncated: true };
}

/** Share the role's stable prefix across jobs for an hour; conversation turns keep a moving five-minute breakpoint. */
export const SCOUT_CACHE_POLICY = {
  ttl: "5m",
  cacheControl: { type: "ephemeral" } as const,
  stableCacheControl: { type: "ephemeral", ttl: "1h" } as const,
  /** `TOP_LEVEL`: the API places and moves the breakpoint. `LAST_BLOCK`: fallback that marks the last block of the newest user turn. */
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
  /** The frontier model's minimum cacheable prefix, used as the default and fallback. A cheaper class's minimum is higher; see `minimumCacheablePrefixTokensFor`. */
  minimumCacheablePrefixTokens: 512,
} as const;
