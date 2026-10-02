import { MODELS, activeModelOverrideId, activeModelTierFor, modelRefusal, type ModelThinkingMode, type ModelTier } from "../models.ts";

/** How a rung wants the model to think; what is sent is decided in `lib/models.ts`. */
export type AskThinkingMode = ModelThinkingMode;

/**
 * **THE ASK MODELS: ONE TABLE OF ROLES, ONE MODULE, AND THIS IS IT.**
 * (ITEM K 2026-09-01; per-role since 2026-09-25, the Ask model-routing test.)
 *
 * ## Why the models are declared here and not per environment
 *
 * **The reason is measurement integrity, and it is the whole reason.**
 *
 * Reader-answerability is this product's top-line health contract, and Ask is
 * a surface it measures. That suite is run LOCALLY, against a local production
 * build. If local and production could hold different model ids — a
 * per-environment variable, a per-deploy setting, a literal at one call site
 * that drifted from another — then the suite run locally would stop measuring
 * what production serves, and a real regression in a reader's answer would be
 * indistinguishable from environment drift.
 *
 * So each ROLE has exactly one default, compiled into the build, and both
 * environments serve it. Ask may route by tier, cheapest first (Sean,
 * 2026-10-01: the one-model-for-all-Ask-traffic rule is removed); the model
 * that served each call is recorded, so every answer stays attributable.
 *
 * ## The roles (Sean, 2026-09-25 7:50 PM MST: "Changing a model should be easy")
 *
 * `ASK_MODEL_ROLES` below is the one table. Each role — reading the question,
 * the fast writer, the escalation writer, the topic classifier, the unsourced
 * fallback — names its default model, its effort, how it wants the model to
 * think, and its own environment override. Changing a role's model is a
 * config change (the override) or one edited line (the default); what the
 * model ACCEPTS is `MODELS[tier].capabilities` in `lib/models.ts`, and every request builds its
 * fields from there, so a change cannot send a field the new model rejects.
 *
 * ## The overrides, and the two conditions they are allowed under
 *
 * ```
 *   1. UNSET  -> the role's default. The default is the code, never the environment.
 *   2. The RESOLVED value — never the default — is what is recorded on every
 *      stored answer and every trace, and what is logged at startup. The trace
 *      also records the model the API says served the call.
 * ```
 *
 * An override naming a model that is not a tier, or a RETIRED model
 * (`claude-opus-5`, retired 2026-09-25 by Sean), is REFUSED by name and the
 * role keeps its default — a typo in a deploy variable must not take Ask down.
 * `WTP_ASK_MODEL` and `WTP_ASK_FAST_MODEL` keep working: the first is an alias
 * for every role that defaults to the frontier model, the second is the fast
 * writer's override (`off` turns that rung off).
 */

/**
 * The slice of the environment these resolvers read. Deliberately NOT
 * `NodeJS.ProcessEnv`, which would force every test to build a whole
 * environment to ask about a few variables.
 */
export type AskModelEnv = Readonly<Record<string, string | undefined>>;

/** The closed set the Claude API accepts. An unknown value is a 400. */
export const ASK_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AskEffort = (typeof ASK_EFFORT_LEVELS)[number];

/**
 * **THE FRONTIER MODEL — `claude-opus-5-5`.** (2026-09-25.)
 *
 * Sean, 7:25 PM MST: Opus 5 must not be used any more, not as a test subject,
 * default or fallback; where Opus is used, it is Opus 5.5. This is the default
 * of every role that uses the frontier model (see `ASK_MODEL_ROLES`). The
 * history of the earlier `claude-opus-5` / `claude-sonnet-5` switch and revert
 * (RULINGs 234 and 236, the election-day weather question) is kept in
 * `lib/governance/adoptions.ts`; the weather question was re-measured on
 * 2026-09-25 on all three current models (Sonnet 5 still routes it to
 * elections; Haiku 4.5 and Opus 5.5 refuse it).
 */
export const ASK_SYNTHESIS_MODEL: string = MODELS.opus.model;

/**
 * **THE ESCALATION WRITER'S EFFORT, AND IT WAS MEASURED RATHER THAN REASONED.**
 *
 * An omitted effort defaults server-side (to `medium` on Opus 5.5, `high` on
 * earlier models) and thinking bills at the OUTPUT rate, so the field is
 * always pinned. The 2026-09-01 sweep found `xhigh` and `max` truncate the
 * structured answer at `max_tokens: 2048` (thinking counts against it), and
 * `low`/`medium`/`high` held the same questions. `medium` stays; changing it
 * is a measurement.
 */
export const ASK_SYNTHESIS_EFFORT: AskEffort = "medium";

/**
 * **THE FAST WRITER — THE ANSWER-WRITING RUNG'S FIRST MODEL.** (2026-09-25.)
 *
 * The owner's bar (docs/rulings.md §6) is three seconds to a usable answer.
 * Measured 2026-09-25 on production read-only packs, streaming, the complete
 * model call: Haiku 4.5 median 2.0 s; Sonnet 5 (low) 2.8 s; Opus 5.5
 * (medium) 3.7 s. Only this model can write inside the bar.
 * Dateless alias; `claude-haiku-4-5-20251001` is the same model.
 */
export const ASK_FAST_WRITER_MODEL: string = MODELS.haiku.model;

/** The override names. Declared once so the log and the docs agree. */
export const ASK_MODEL_ENV = "WTP_ASK_MODEL";
export const ASK_EFFORT_ENV = "WTP_ASK_EFFORT";
/** `off` (or `none`) turns the fast writer off without a deploy; any other value names it. */
export const ASK_FAST_WRITER_ENV = "WTP_ASK_FAST_MODEL";

/** The roles a model plays in Ask. */
export const ASK_MODEL_ROLE_NAMES = ["READER", "FAST_WRITER", "ESCALATION_WRITER", "CLASSIFIER", "UNSOURCED"] as const;
export type AskModelRole = (typeof ASK_MODEL_ROLE_NAMES)[number];

export interface AskModelRoleSpec {
  /** What the role does, for the startup line and the trace. */
  readonly does: string;
  /** The tier the role uses when no override is set; its model id is `MODELS[defaultTier].model`. */
  readonly defaultTier: ModelTier;
  /** The model the role uses when no override is set. */
  readonly defaultModel: string;
  /** Overrides, most specific first. The first set, valid one wins. */
  readonly env: readonly string[];
  /** The effort sent to a model that takes one. */
  readonly effort: AskEffort;
  /** How the rung wants the model to think (the registry decides what is sent). */
  readonly thinking: AskThinkingMode;
  /** Whether `off`/`none` may switch the role off (only the fast writer: the ladder still has the escalation writer). */
  readonly canBeOff: boolean;
}

/** A role's spec with its default model read from its tier. */
const roleSpec = (spec: Omit<AskModelRoleSpec, "defaultModel">): AskModelRoleSpec => ({ ...spec, defaultModel: MODELS[spec.defaultTier].model });

/**
 * **THE ONE TABLE.** Every Ask model call resolves its model here.
 *
 * Defaults as decided by the 2026-09-25 controlled comparison: Haiku 4.5,
 * Sonnet 5 and Opus 5.5 given identical inputs, built by the production route
 * over production read-only data (evidence, per-call ledger and grading in
 * meanwhile-evidence/admin-completion/2026-09-25/ask-model-test/):
 *
 * - READER → Haiku 4.5. Complete call median 1.6 s, slowest 2.5 s over 37
 *   calls (Opus 5.5: 1.9 s, slowest 3.5 s; Sonnet 5: 2.0 s, 3.1 s), about a
 *   fifth of Opus 5.5's cost. Its reading differed from Opus 5.5's on 6 of 27 questions; the
 *   answer written from each differing reading was checked against the
 *   records and none was wrong. Sonnet 5 was no faster than Opus 5.5 and read
 *   no better, so it has no role.
 * - FAST_WRITER → Haiku 4.5: the only writer inside three seconds (complete
 *   call median 2.0 s, 90th percentile 3.4 s; Sonnet 5 2.8 s / 5.0 s; Opus
 *   5.5 3.7 s / 5.9 s). It writes every question first, money and comparison
 *   questions included (Sean, 2026-09-29); the frontier writes only when its
 *   answer fails a check.
 * - ESCALATION_WRITER → Opus 5.5: 32 of 34 answers correct, none rejected for
 *   length (Sonnet 5: 28 of 34, including a miscounted list). It writes only
 *   when the fast writer's answer fails a check or cannot be had.
 * - CLASSIFIER → Haiku 4.5: 17 of 17 labels right, 0.7-1.7 s. Sonnet 5 sent
 *   the election-day weather question to "elections" 3 of 3 times; Opus 5.5
 *   took 1.3-6.2 s.
 * - UNSOURCED → Haiku 4.5 (2026-09-30, Sean's cheapest-first rule: the answer starts on the
 *   cheapest tier and nothing about an out-of-scope, labelled-unsourced reply needs more).
 *
 * `WTP_ASK_MODEL` is an alias only on roles whose default is the frontier.
 */
export const ASK_MODEL_ROLES: Readonly<Record<AskModelRole, AskModelRoleSpec>> = {
  READER: roleSpec({
    does: "reads the question (intent, tense, the government named)",
    defaultTier: "haiku",
    env: ["WTP_ASK_READER_MODEL"],
    effort: "low",
    thinking: "ADAPTIVE",
    canBeOff: false,
  }),
  FAST_WRITER: roleSpec({
    does: "writes the answer first",
    defaultTier: "haiku",
    env: [ASK_FAST_WRITER_ENV],
    effort: "low",
    thinking: "ADAPTIVE",
    canBeOff: true,
  }),
  ESCALATION_WRITER: roleSpec({
    does: "writes when the fast answer fails a check, and the kinds routed to it",
    defaultTier: "opus",
    env: ["WTP_ASK_ESCALATION_MODEL", ASK_MODEL_ENV],
    effort: ASK_SYNTHESIS_EFFORT,
    thinking: "ADAPTIVE",
    canBeOff: false,
  }),
  CLASSIFIER: roleSpec({
    does: "labels an unanswered question with a curated topic, or refuses it",
    defaultTier: "haiku",
    env: ["WTP_ASK_CLASSIFIER_MODEL"],
    effort: "low",
    thinking: "OFF",
    canBeOff: false,
  }),
  UNSOURCED: roleSpec({
    does: "answers an out-of-scope question, labelled unsourced",
    defaultTier: "haiku",
    env: ["WTP_ASK_UNSOURCED_MODEL"],
    effort: "low",
    thinking: "OFF",
    canBeOff: false,
  }),
};

export interface AskRoleResolution {
  readonly role: AskModelRole;
  /** The model to send, or null for a role switched off. */
  readonly model: string | null;
  readonly effort: AskEffort;
  readonly thinking: AskThinkingMode;
  /** The variable that set the model, or null when it is the code's default. */
  readonly overriddenBy: string | null;
  /** Overrides refused (unknown or retired model), each with its reason. */
  readonly refused: readonly string[];
}

const envValue = (env: AskModelEnv, name: string): string => (typeof env[name] === "string" ? env[name]!.trim() : "");

/**
 * **RESOLVE ONE ROLE.** Read at CALL time, never bound at module load, so an
 * override reaches every rung (the 2026-09-01 repair: three rungs once bound
 * the constant at import and ignored the override).
 */
export function resolveAskRole(role: AskModelRole, env: AskModelEnv = process.env): AskRoleResolution {
  const spec = ASK_MODEL_ROLES[role];
  const refused: string[] = [];
  let model: string | null = spec.defaultModel;
  let overriddenBy: string | null = null;
  for (const name of spec.env) {
    const raw = envValue(env, name);
    if (raw.length === 0) continue;
    if (spec.canBeOff && (raw === "off" || raw === "none")) {
      model = null;
      overriddenBy = name;
      break;
    }
    const active = activeModelOverrideId(raw);
    const refusal = modelRefusal(active);
    if (refusal) {
      refused.push(`${name}="${raw}" REFUSED — ${refusal}`);
      continue;
    }
    model = MODELS[activeModelTierFor(active)!].model;
    overriddenBy = model === spec.defaultModel ? null : name;
    break;
  }
  const effort = role === "ESCALATION_WRITER" ? resolveAskEffort(env) : spec.effort;
  return { role, model, effort, thinking: spec.thinking, overriddenBy, refused };
}

/** The model a role sends. A role that cannot be off always has one. */
export function resolveAskRoleModel(role: Exclude<AskModelRole, "FAST_WRITER">, env: AskModelEnv = process.env): string {
  return resolveAskRole(role, env).model ?? ASK_MODEL_ROLES[role].defaultModel;
}

/** The fast writer this process will use, or null when it is switched off. */
export function resolveAskFastWriter(env: AskModelEnv = process.env): string | null {
  return resolveAskRole("FAST_WRITER", env).model;
}

/**
 * The frontier model: the escalation writer. Kept under its old name because
 * the comparison harness, the model economics and the cache keys read it.
 */
export function resolveAskModel(env: AskModelEnv = process.env): string {
  return resolveAskRoleModel("ESCALATION_WRITER", env);
}

/** Does this model take `output_config.effort`? Read from `MODELS[tier].capabilities`. */
export function askModelTakesEffort(model: string): boolean {
  const tier = activeModelTierFor(model);
  return tier ? MODELS[tier].capabilities.effort : false;
}

/**
 * The escalation writer's effort. **An override off the closed set is REFUSED,
 * not passed through**: the API answers an unknown effort with a 400, and the
 * reader would meet a configuration typo as an unavailable answer.
 */
export function resolveAskEffort(env: AskModelEnv = process.env): AskEffort {
  const value = envValue(env, ASK_EFFORT_ENV);
  return (ASK_EFFORT_LEVELS as readonly string[]).includes(value) ? (value as AskEffort) : ASK_SYNTHESIS_EFFORT;
}

/** Did an override actually take effect? Reported, never silently absorbed. */
export function askModelOverrides(env: AskModelEnv = process.env): {
  readonly model: boolean;
  readonly effort: boolean;
  readonly effortRefused: string | null;
  readonly refused: readonly string[];
} {
  const rawEffort = envValue(env, ASK_EFFORT_ENV);
  const effortValid = (ASK_EFFORT_LEVELS as readonly string[]).includes(rawEffort);
  const refused = ASK_MODEL_ROLE_NAMES.flatMap((role) => resolveAskRole(role, env).refused);
  return {
    model: resolveAskModel(env) !== ASK_SYNTHESIS_MODEL,
    effort: effortValid,
    effortRefused: rawEffort.length > 0 && !effortValid ? rawEffort : null,
    refused: [...new Set(refused)],
  };
}

/**
 * **THE STARTUP LINE — the RESOLVED values, never the defaults.** Facts about
 * our machinery only: each role's model and whether an override moved it, and
 * any override refused. No reader fact, no credential, no request content.
 */
export function askModelStartupLine(env: AskModelEnv = process.env): string {
  const o = askModelOverrides(env);
  const frontier = resolveAskRole("ESCALATION_WRITER", env);
  const parts = [
    `ask · model ${frontier.model}${frontier.overriddenBy ? ` (overridden by ${frontier.overriddenBy})` : ""}`,
    `effort ${resolveAskEffort(env)}${o.effort ? ` (overridden by ${ASK_EFFORT_ENV})` : ""}`,
  ];
  for (const role of ASK_MODEL_ROLE_NAMES) {
    if (role === "ESCALATION_WRITER") continue;
    const r = resolveAskRole(role, env);
    const label = role === "FAST_WRITER" ? "fast writer" : role.toLowerCase();
    parts.push(`${label} ${r.model ?? "off"}${r.overriddenBy ? ` (overridden by ${r.overriddenBy})` : ""}`);
  }
  if (o.effortRefused) {
    parts.push(`${ASK_EFFORT_ENV}="${o.effortRefused}" REFUSED — not one of ${ASK_EFFORT_LEVELS.join("/")}`);
  }
  for (const refusal of o.refused) parts.push(refusal);
  return parts.join(" · ");
}
