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
 *       extraction / classification / page-to-representation: Haiku, then
 *       Sonnet on escalation; novelty / ambiguity / adversarial audit: the
 *       frontier model. A cheaper model that fails a step's standard ESCALATES
 *       and the escalation is recorded (`escalateTo`), never silent.
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

/** The model classes a step may route to. Cheapest first. */
export const MODEL_CLASSES = ["haiku", "sonnet", "frontier"] as const;
export type ModelClass = (typeof MODEL_CLASSES)[number];

/** The exact model id each class runs today. Ids as the claude-api reference lists them. */
export const MODEL_FOR_CLASS: Readonly<Record<ModelClass, string>> = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-5",
  frontier: "claude-opus-5",
};

export type ModelEffort = "low" | "medium" | "high";

/** The roles that invoke a model in this lane, and the effort each runs at. */
export const ROLE_EFFORT = {
  /** The Scout's research loop: a bounded frontier step. Medium — the cap is economic, never a truth judgement. */
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
  /** The research loop itself: novelty, ambiguity, an unknown route. Frontier. */
  "scout-research-loop": {
    kind: "MODEL",
    modelClass: "frontier",
    role: "SCOUT",
    escalateTo: null,
    why: "finding a compliant route nothing deterministic can open is the novelty case RULING 244 reserves for the frontier model",
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
  /** An adversarial audit of a Scout result. Frontier. */
  "adversarial-audit": {
    kind: "MODEL",
    modelClass: "frontier",
    role: "SUB_STEP",
    escalateTo: null,
    why: "an adversarial audit exists to find what the cheaper pass missed; it runs on the frontier model by RULING 244",
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
  /** Below this the provider silently never caches (claude-opus-5, per the reference). Tools + system alone exceed it (4,586 tokens measured 2026-09-06). */
  minimumCacheablePrefixTokens: 512,
} as const;
