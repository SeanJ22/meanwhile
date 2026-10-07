import { MODELS, activeModelOverrideId, activeModelTierFor, modelRefusal, type ModelThinkingMode, type ModelTier } from "../models.ts";

/** How a rung wants the model to think; what is sent is decided in `lib/models.ts`. */
export type AskThinkingMode = ModelThinkingMode;

/**
 * The Ask model roles. Each role has one default compiled into the build, so
 * local runs measure what production serves; the model that served each call
 * is recorded. `ASK_MODEL_ROLES` is the one table: each role names its default
 * tier, effort, thinking mode and environment overrides. What a model accepts
 * is `MODELS[tier].capabilities` in `lib/models.ts`.
 *
 * Overrides: unset means the role's default; the resolved value (never the
 * default) is what is recorded and logged. An override naming an unknown or
 * retired model is refused by name and the role keeps its default.
 * `WTP_ASK_MODEL` aliases every role that defaults to the frontier model;
 * `WTP_ASK_FAST_MODEL` overrides the fast writer (`off` turns it off).
 */

/** The slice of the environment these resolvers read. */
export type AskModelEnv = Readonly<Record<string, string | undefined>>;

/** The closed set the Claude API accepts. An unknown value is a 400. */
export const ASK_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AskEffort = (typeof ASK_EFFORT_LEVELS)[number];

/** The frontier model, the default of every role that uses it. */
export const ASK_SYNTHESIS_MODEL: string = MODELS.opus.model;

/**
 * The escalation writer's effort, always pinned (an omitted effort defaults
 * server-side and thinking bills at the output rate). `xhigh` and `max`
 * truncate the structured answer at `max_tokens: 2048`.
 */
export const ASK_SYNTHESIS_EFFORT: AskEffort = "medium";

/** The fast writer: the first model to write an answer. */
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
 * The one table; every Ask model call resolves its model here. READER,
 * FAST_WRITER, CLASSIFIER and UNSOURCED start on the cheapest tier.
 * ESCALATION_WRITER is the frontier model and writes when the fast answer
 * fails a check. `WTP_ASK_MODEL` is an alias only on roles whose default is
 * the frontier.
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

/** Resolve one role, read at call time so an override reaches every call site. */
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

/** The frontier model: the escalation writer. Read by the comparison harness, model economics and cache keys. */
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
