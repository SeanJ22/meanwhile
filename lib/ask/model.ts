import { askSettings } from "./runtime-settings.ts";
import { registerSetting, type SettingValue } from "../control-plane/settings.ts";
import { MODELS, type ModelThinkingMode, type ModelTier } from "../models.ts";

type AskThinkingMode = ModelThinkingMode;
export type AskModelSettings = Readonly<Record<string, SettingValue | undefined>>;
export const ASK_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AskEffort = (typeof ASK_EFFORT_LEVELS)[number];
export const ASK_SYNTHESIS_MODEL: string = MODELS.sonnet.model;
export const ASK_SYNTHESIS_EFFORT: AskEffort = "medium";
export const ASK_FAST_WRITER_MODEL: string = MODELS.haiku.model;
export const ASK_EFFORT_SETTING = "ask.writerEffort";

type AskModelRole = "READER" | "FAST_WRITER" | "ESCALATION_WRITER" | "OPUS_WRITER" | "CLASSIFIER" | "UNSOURCED";

interface AskModelRoleSpec {
  readonly defaultTier: ModelTier;
  readonly defaultModel: string;
  readonly effort: AskEffort;
  readonly thinking: AskThinkingMode;
}
const role = (tier: ModelTier): AskModelRoleSpec => ({ defaultTier: tier, defaultModel: MODELS[tier].model,
  effort: tier === "haiku" ? "low" : ASK_SYNTHESIS_EFFORT, thinking: tier === "haiku" ? "OFF" : "ADAPTIVE" });

/** Every independent step starts on Haiku. Writers advance only after a failed check. */
export const ASK_MODEL_ROLES: Readonly<Record<AskModelRole, AskModelRoleSpec>> = {
  READER: role("haiku"), FAST_WRITER: role("haiku"), ESCALATION_WRITER: role("sonnet"),
  OPUS_WRITER: role("opus"), CLASSIFIER: role("haiku"), UNSOURCED: role("haiku"),
};

export function resolveAskRoleModel(role: AskModelRole): string { return ASK_MODEL_ROLES[role].defaultModel; }
export function resolveAskModel(): string { return resolveAskRoleModel("ESCALATION_WRITER"); }
export function resolveAskFastWriter(): string { return resolveAskRoleModel("FAST_WRITER"); }

export function resolveAskEffort(settings: AskModelSettings = askSettings()): AskEffort {
  const value = settings[ASK_EFFORT_SETTING];
  return typeof value === "string" && (ASK_EFFORT_LEVELS as readonly string[]).includes(value) ? value as AskEffort : ASK_SYNTHESIS_EFFORT;
}

export function askModelStartupLine(settings: AskModelSettings = askSettings()): string {
  return `ask · writers ${MODELS.haiku.model} > ${MODELS.sonnet.model} > ${MODELS.opus.model} · effort ${resolveAskEffort(settings)}`;
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
