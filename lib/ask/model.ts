import { askSettings } from "./runtime-settings.ts";
import { registerSetting, type SettingValue } from "../control-plane/settings.ts";
import { MODELS, activeModelOverrideId, activeModelTierFor, modelRefusal, type ModelThinkingMode, type ModelTier } from "../models.ts";

/** How a rung wants the model to think; what is sent is decided in `lib/models.ts`. */
export type AskThinkingMode = ModelThinkingMode;

/** Model choices come from the Admin settings published with the request's reader snapshot. */
export type AskModelSettings = Readonly<Record<string, SettingValue | undefined>>;

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

/** The settings keys. Declared once so the log and the docs agree. */
export const ASK_MODEL_SETTING = "ask.escalationWriterModel";
export const ASK_EFFORT_SETTING = "ask.writerEffort";
/** `off` (or `none`) turns the fast writer off without a deploy; any other value names it. */
export const ASK_FAST_WRITER_SETTING = "ask.fastWriterModel";

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
  /** The Admin key for this model choice. */
  readonly settings: readonly string[];
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
 * fails a check. `ask.escalationWriterModel` is an alias only on roles whose default is
 * the frontier.
 */
export const ASK_MODEL_ROLES: Readonly<Record<AskModelRole, AskModelRoleSpec>> = {
  READER: roleSpec({
    does: "reads the question (intent, tense, the government named)",
    defaultTier: "haiku",
    settings: ["ask.readerModel"],
    effort: "low",
    thinking: "OFF",
    canBeOff: false,
  }),
  FAST_WRITER: roleSpec({
    does: "writes the answer first",
    defaultTier: "haiku",
    settings: [ASK_FAST_WRITER_SETTING],
    effort: "low",
    thinking: "OFF",
    canBeOff: true,
  }),
  ESCALATION_WRITER: roleSpec({
    does: "writes when the fast answer fails a check, and the kinds routed to it",
    defaultTier: "opus",
    settings: [ASK_MODEL_SETTING],
    effort: ASK_SYNTHESIS_EFFORT,
    thinking: "ADAPTIVE",
    canBeOff: false,
  }),
  CLASSIFIER: roleSpec({
    does: "labels an unanswered question with a curated topic, or refuses it",
    defaultTier: "haiku",
    settings: ["ask.classifierModel"],
    effort: "low",
    thinking: "OFF",
    canBeOff: false,
  }),
  UNSOURCED: roleSpec({
    does: "answers an out-of-scope question, labelled unsourced",
    defaultTier: "haiku",
    settings: ["ask.fallbackModel"],
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
  /** The setting that set the model, or null when it is the code's default. */
  readonly overriddenBy: string | null;
  /** Overrides refused (unknown or retired model), each with its reason. */
  readonly refused: readonly string[];
}

const settingText = (settings: AskModelSettings, name: string): string => (typeof settings[name] === "string" ? (settings[name] as string).trim() : "");

/** Resolve one role, read at call time so an override reaches every call site. */
export function resolveAskRole(role: AskModelRole, settings: AskModelSettings = askSettings()): AskRoleResolution {
  const spec = ASK_MODEL_ROLES[role];
  const refused: string[] = [];
  let model: string | null = spec.defaultModel;
  let overriddenBy: string | null = null;
  for (const name of spec.settings) {
    const raw = settingText(settings, name);
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
  const effort = role === "ESCALATION_WRITER" ? resolveAskEffort(settings) : spec.effort;
  return { role, model, effort, thinking: spec.thinking, overriddenBy, refused };
}

/** The model a role sends. A role that cannot be off always has one. */
export function resolveAskRoleModel(role: Exclude<AskModelRole, "FAST_WRITER">, settings: AskModelSettings = askSettings()): string {
  return resolveAskRole(role, settings).model ?? ASK_MODEL_ROLES[role].defaultModel;
}

/** The fast writer this process will use, or null when it is switched off. */
export function resolveAskFastWriter(settings: AskModelSettings = askSettings()): string | null {
  return resolveAskRole("FAST_WRITER", settings).model;
}

/** The frontier model: the escalation writer. Read by the comparison harness, model economics and cache keys. */
export function resolveAskModel(settings: AskModelSettings = askSettings()): string {
  return resolveAskRoleModel("ESCALATION_WRITER", settings);
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
export function resolveAskEffort(settings: AskModelSettings = askSettings()): AskEffort {
  const value = settingText(settings, ASK_EFFORT_SETTING);
  return (ASK_EFFORT_LEVELS as readonly string[]).includes(value) ? (value as AskEffort) : ASK_SYNTHESIS_EFFORT;
}

/** Did an override actually take effect? Reported, never silently absorbed. */
export function askModelOverrides(settings: AskModelSettings = askSettings()): {
  readonly model: boolean;
  readonly effort: boolean;
  readonly effortRefused: string | null;
  readonly refused: readonly string[];
} {
  const rawEffort = settingText(settings, ASK_EFFORT_SETTING);
  const effortValid = (ASK_EFFORT_LEVELS as readonly string[]).includes(rawEffort);
  const refused = ASK_MODEL_ROLE_NAMES.flatMap((role) => resolveAskRole(role, settings).refused);
  return {
    model: resolveAskModel(settings) !== ASK_SYNTHESIS_MODEL,
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
export function askModelStartupLine(settings: AskModelSettings = askSettings()): string {
  const o = askModelOverrides(settings);
  const frontier = resolveAskRole("ESCALATION_WRITER", settings);
  const parts = [
    `ask · model ${frontier.model}${frontier.overriddenBy ? ` (overridden by ${frontier.overriddenBy})` : ""}`,
    `effort ${resolveAskEffort(settings)}${o.effort ? ` (overridden by ${ASK_EFFORT_SETTING})` : ""}`,
  ];
  for (const role of ASK_MODEL_ROLE_NAMES) {
    if (role === "ESCALATION_WRITER") continue;
    const r = resolveAskRole(role, settings);
    const label = role === "FAST_WRITER" ? "fast writer" : role.toLowerCase();
    parts.push(`${label} ${r.model ?? "off"}${r.overriddenBy ? ` (overridden by ${r.overriddenBy})` : ""}`);
  }
  if (o.effortRefused) {
    parts.push(`${ASK_EFFORT_SETTING}="${o.effortRefused}" REFUSED — not one of ${ASK_EFFORT_LEVELS.join("/")}`);
  }
  for (const refusal of o.refused) parts.push(refusal);
  return parts.join(" · ");
}

for (const role of ASK_MODEL_ROLE_NAMES) {
  const spec = ASK_MODEL_ROLES[role];
  registerSetting({ key: spec.settings[0], label: ({ READER: "Ask reader model", FAST_WRITER: "Ask first writer model", ESCALATION_WRITER: "Ask second writer model", CLASSIFIER: "Ask topic reader model", UNSOURCED: "Ask general answer model" } as const)[role],
    defaultValue: spec.defaultModel, readerFacing: true, control: "choice",
    choices: [...Object.values(MODELS).map(model => ({ value: model.model, label: model.name })), ...(spec.canBeOff ? [{ value: "off", label: "Off" }] : [])],
    validate: (value): value is string => typeof value === "string" && (spec.canBeOff && ["off", "none"].includes(value) || modelRefusal(activeModelOverrideId(value)) === null),
  });
}
registerSetting({ key: ASK_EFFORT_SETTING, label: "Ask writer effort", defaultValue: ASK_SYNTHESIS_EFFORT, readerFacing: true, control: "choice",
  choices: ASK_EFFORT_LEVELS.map(value => ({ value, label: ({ low: "Low", medium: "Medium", high: "High", xhigh: "Very high", max: "Maximum" } as const)[value] })),
  validate: (value): value is AskEffort => typeof value === "string" && (ASK_EFFORT_LEVELS as readonly string[]).includes(value) });
export const ASK_CLASSIFIER_CAP_SETTING = "ask.classifierDailyCap";
export const ASK_GROUNDED_CAP_SETTING = "ask.answerDailyCap";
for (const [key, label, defaultValue] of [[ASK_CLASSIFIER_CAP_SETTING, "Ask topic readings per instance per day", 500], [ASK_GROUNDED_CAP_SETTING, "Ask model calls per instance per day", 400]] as const) {
  registerSetting({ key, label, defaultValue, readerFacing: true, control: "number",
    validate: (value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 });
}
